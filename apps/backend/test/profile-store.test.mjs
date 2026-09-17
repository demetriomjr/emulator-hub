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
  return join(root, 'data', 'profiles.json')
}

test('creates and lists a durable profile', async () => {
  const dataPath = await profilePath()
  const profiles = createProfileStore({ dataPath })
  const created = await profiles.create('  Ash  ')

  assert.match(created.id, /^[0-9a-f-]{36}$/)
  assert.equal(created.name, 'Ash')
  assert.match(created.createdAt, /^\d{4}-\d{2}-\d{2}T/)
  assert.deepEqual(await profiles.list(), [created])

  const reopened = createProfileStore({ dataPath })
  assert.deepEqual(await reopened.list(), [created])
})

test('deletes a durable profile', async () => {
  const dataPath = await profilePath()
  const profiles = createProfileStore({ dataPath })
  const created = await profiles.create('Misty')

  assert.deepEqual(await profiles.remove(created.id), created)
  assert.deepEqual(await profiles.list(), [])

  const reopened = createProfileStore({ dataPath })
  assert.deepEqual(await reopened.list(), [])
  assert.equal(await reopened.remove(created.id), null)
})

test('renames a durable profile without changing its identity', async () => {
  const dataPath = await profilePath()
  const profiles = createProfileStore({ dataPath })
  const created = await profiles.create('Misty')

  const renamed = await profiles.update(created.id, '  Sabrina  ')
  assert.deepEqual(renamed, { ...created, name: 'Sabrina' })
  assert.deepEqual(await createProfileStore({ dataPath }).list(), [renamed])

  await profiles.create('Erika')
  await assert.rejects(() => profiles.update(created.id, 'Erika'), { code: 'PROFILE_NAME_DUPLICATE' })
  assert.equal(await profiles.update('00000000-0000-0000-0000-000000000000', 'Lorelei'), null)
})

test('rejects empty, oversized, and duplicate profile names', async () => {
  const profiles = createProfileStore({ dataPath: await profilePath() })
  await assert.rejects(() => profiles.create('   '), { code: 'PROFILE_NAME_INVALID' })
  await assert.rejects(() => profiles.create('x'.repeat(33)), { code: 'PROFILE_NAME_INVALID' })
  await profiles.create('May')
  await assert.rejects(() => profiles.create(' may '), { code: 'PROFILE_NAME_DUPLICATE' })
})
