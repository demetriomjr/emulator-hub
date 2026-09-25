import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'

import { createProfileStore, createRedisProfileStore } from '../../packages/profile-store.mjs'
import { createMemoryRedisPersistence } from '../../packages/redis-persistence.mjs'

const roots = new Set()

afterEach(async () => {
  await Promise.all([...roots].map(root => rm(root, { recursive: true, force: true })))
  roots.clear()
})

async function profilePath() {
  const root = await mkdtemp(join(tmpdir(), 'emulator-hub-profiles-'))
  roots.add(root)
  return join(root, 'data', 'profiles')
}

test('creates and lists a durable profile for one game only', async () => {
  const dataPath = await profilePath()
  const profiles = createProfileStore({ dataPath })
  const created = await profiles.create('pokemon-emerald', '  Ash  ')

  assert.match(created.id, /^[0-9a-f-]{36}$/)
  assert.equal(created.name, 'Ash')
  assert.match(created.createdAt, /^\d{4}-\d{2}-\d{2}T/)
  assert.equal(created.oddsResetCount, 0)
  assert.deepEqual(await profiles.list('pokemon-emerald'), [created])
  assert.deepEqual(await profiles.list('pokemon-firered'), [])

  const reopened = createProfileStore({ dataPath })
  assert.deepEqual(await reopened.list('pokemon-emerald'), [created])
})

test('persists odds reset count monotonically and migrates legacy profiles', async () => {
  const dataPath = await profilePath()
  const profiles = createProfileStore({ dataPath })
  const created = await profiles.create('pokemon-emerald', 'Ash')

  assert.deepEqual(await profiles.updateOddsResetCount('pokemon-emerald', created.id, 3), { ...created, oddsResetCount: 3 })
  assert.deepEqual(await profiles.updateOddsResetCount('pokemon-emerald', created.id, 2), { ...created, oddsResetCount: 3 })
  assert.equal((await profiles.get('pokemon-emerald', created.id)).oddsResetCount, 3)
  await assert.rejects(() => profiles.updateOddsResetCount('pokemon-emerald', created.id, -1), { code: 'PROFILE_ODDS_COUNT_INVALID' })
  await assert.rejects(() => profiles.updateOddsResetCount('pokemon-emerald', created.id, 1.5), { code: 'PROFILE_ODDS_COUNT_INVALID' })
})

test('normalizes a null odds reset count left by an interrupted legacy migration', async () => {
  const dataPath = await profilePath()
  const profile = { id: '972e1110-fbd6-4f88-bbd5-2039fe20ee65', name: 'Ash', createdAt: '2026-09-23T00:00:00.000Z', oddsResetCount: null }
  await mkdir(dataPath, { recursive: true })
  await writeFile(join(dataPath, 'pokemon-emerald.json'), JSON.stringify([profile]))
  const profiles = createProfileStore({ dataPath })

  assert.equal((await profiles.get('pokemon-emerald', profile.id)).oddsResetCount, 0)
  assert.equal((await profiles.updateOddsResetCount('pokemon-emerald', profile.id, 1)).oddsResetCount, 1)
})

test('deletes a durable profile from its own game collection', async () => {
  const dataPath = await profilePath()
  const profiles = createProfileStore({ dataPath })
  const created = await profiles.create('pokemon-emerald', 'Misty')

  assert.deepEqual(await profiles.remove('pokemon-emerald', created.id), created)
  assert.deepEqual(await profiles.list('pokemon-emerald'), [])

  const reopened = createProfileStore({ dataPath })
  assert.deepEqual(await reopened.list('pokemon-emerald'), [])
  assert.equal(await reopened.remove('pokemon-emerald', created.id), null)
})

test('renames a durable profile without changing its identity', async () => {
  const dataPath = await profilePath()
  const profiles = createProfileStore({ dataPath })
  const created = await profiles.create('pokemon-emerald', 'Misty')

  const renamed = await profiles.update('pokemon-emerald', created.id, '  Sabrina  ')
  assert.deepEqual(renamed, { ...created, name: 'Sabrina' })
  assert.deepEqual(await createProfileStore({ dataPath }).list('pokemon-emerald'), [renamed])

  await profiles.create('pokemon-emerald', 'Erika')
  assert.equal((await profiles.update('pokemon-emerald', created.id, 'Erika')).name, 'Erika')
  assert.equal(await profiles.update('pokemon-emerald', '00000000-0000-0000-0000-000000000000', 'Lorelei'), null)
})

test('rejects invalid names but allows repeated display names within one game', async () => {
  const profiles = createProfileStore({ dataPath: await profilePath() })
  await assert.rejects(() => profiles.create('pokemon-emerald', '   '), { code: 'PROFILE_NAME_INVALID' })
  await assert.rejects(() => profiles.create('pokemon-emerald', 'x'.repeat(33)), { code: 'PROFILE_NAME_INVALID' })
  const first = await profiles.create('pokemon-emerald', 'May')
  const second = await profiles.create('pokemon-emerald', ' may ')
  assert.notEqual(first.id, second.id)
  assert.deepEqual((await profiles.list('pokemon-emerald')).map(profile => profile.name), ['May', 'may'])
  assert.equal((await profiles.get('pokemon-emerald', first.id)).name, 'May')
  assert.equal((await profiles.get('pokemon-emerald', second.id)).name, 'may')
  const fireredProfile = await profiles.create('pokemon-firered', 'May')
  assert.equal(await profiles.get('pokemon-emerald', fireredProfile.id), null)
  assert.deepEqual(await profiles.list('pokemon-firered'), [fireredProfile])
})

test('unchanged normalized names succeed without rewriting filesystem or Redis storage', async () => {
  const dataPath = await profilePath()
  const fileProfiles = createProfileStore({ dataPath })
  const fileProfile = await fileProfiles.create('pokemon-emerald', 'May')
  const filePath = join(dataPath, 'pokemon-emerald.json')
  const oldTime = new Date('2020-01-01T00:00:00.000Z')
  await utimes(filePath, oldTime, oldTime)
  assert.deepEqual(await fileProfiles.update('pokemon-emerald', fileProfile.id, '  May  '), fileProfile)
  assert.equal((await stat(filePath)).mtime.toISOString(), oldTime.toISOString())

  const persistence = createMemoryRedisPersistence()
  let writes = 0
  const originalSet = persistence.set.bind(persistence)
  persistence.set = (...args) => { writes += 1; return originalSet(...args) }
  const redisProfiles = createRedisProfileStore({ persistence })
  const redisProfile = await redisProfiles.create('pokemon-emerald', 'May')
  const writesAfterCreate = writes
  assert.deepEqual(await redisProfiles.update('pokemon-emerald', redisProfile.id, 'May'), redisProfile)
  assert.equal(writes, writesAfterCreate)
})

test('lists existing filesystem profiles by creation date and keeps their order after rename', async () => {
  const dataPath = await profilePath()
  await mkdir(dataPath, { recursive: true })
  const later = { id: '00000000-0000-0000-0000-000000000002', name: 'Same', createdAt: '2026-09-25T12:00:00.000Z' }
  const earlier = { id: '00000000-0000-0000-0000-000000000001', name: 'Same', createdAt: '2026-09-24T12:00:00.000Z' }
  const sameTime = { id: '00000000-0000-0000-0000-000000000003', name: 'Same', createdAt: later.createdAt }
  await writeFile(join(dataPath, 'pokemon-emerald.json'), JSON.stringify([later, sameTime, earlier]))
  const profiles = createProfileStore({ dataPath })
  assert.deepEqual((await profiles.list('pokemon-emerald')).map(profile => profile.id), [earlier.id, later.id, sameTime.id])
  await profiles.update('pokemon-emerald', later.id, 'Same')
  assert.deepEqual((await profiles.list('pokemon-emerald')).map(profile => profile.id), [earlier.id, later.id, sameTime.id])
})

test('Redis profiles allow repeated names and list by creation date without changing IDs', async () => {
  const persistence = createMemoryRedisPersistence()
  const later = { id: '00000000-0000-0000-0000-000000000002', name: 'Same', createdAt: '2026-09-25T12:00:00.000Z' }
  const earlier = { id: '00000000-0000-0000-0000-000000000001', name: 'Same', createdAt: '2026-09-24T12:00:00.000Z' }
  await persistence.set('profiles:game:pokemon-emerald', JSON.stringify([later, earlier]))
  const profiles = createRedisProfileStore({ persistence })
  assert.deepEqual((await profiles.list('pokemon-emerald')).map(profile => profile.id), [earlier.id, later.id])
  const created = await profiles.create('pokemon-emerald', 'Same')
  assert.notEqual(created.id, earlier.id)
  const renamed = await profiles.update('pokemon-emerald', created.id, 'Same')
  assert.equal(renamed.id, created.id)
  assert.deepEqual((await profiles.list('pokemon-emerald')).map(profile => profile.id), [earlier.id, later.id, created.id])
  assert.equal((await profiles.get('pokemon-emerald', earlier.id)).name, 'Same')
  assert.equal((await profiles.get('pokemon-emerald', created.id)).name, 'Same')
})
