import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'

import { createProfileStore } from '../../packages/profile-store.mjs'

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
  assert.deepEqual(await profiles.list('pokemon-emerald'), [created])
  assert.deepEqual(await profiles.list('pokemon-firered'), [])

  const reopened = createProfileStore({ dataPath })
  assert.deepEqual(await reopened.list('pokemon-emerald'), [created])
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
  await assert.rejects(() => profiles.update('pokemon-emerald', created.id, 'Erika'), { code: 'PROFILE_NAME_DUPLICATE' })
  assert.equal(await profiles.update('pokemon-emerald', '00000000-0000-0000-0000-000000000000', 'Lorelei'), null)
})

test('rejects empty, oversized, and duplicate profile names within one game', async () => {
  const profiles = createProfileStore({ dataPath: await profilePath() })
  await assert.rejects(() => profiles.create('pokemon-emerald', '   '), { code: 'PROFILE_NAME_INVALID' })
  await assert.rejects(() => profiles.create('pokemon-emerald', 'x'.repeat(33)), { code: 'PROFILE_NAME_INVALID' })
  await profiles.create('pokemon-emerald', 'May')
  await assert.rejects(() => profiles.create('pokemon-emerald', ' may '), { code: 'PROFILE_NAME_DUPLICATE' })
  const fireredProfile = await profiles.create('pokemon-firered', 'May')
  assert.equal(await profiles.get('pokemon-emerald', fireredProfile.id), null)
  assert.deepEqual(await profiles.list('pokemon-firered'), [fireredProfile])
})
