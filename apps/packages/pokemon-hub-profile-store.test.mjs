import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createPokemonHubProfileStore, createRedisPokemonHubProfileStore } from './pokemon-hub-profile-store.mjs'
import { createMemoryRedisPersistence } from './redis-persistence.mjs'

async function createStore() {
  const dataPath = await mkdtemp(join(tmpdir(), 'emulator-hub-pokemon-hub-profiles-'))
  return { dataPath, store: createPokemonHubProfileStore({ dataPath }) }
}

test('persists a named Hub profile with sparse empty storage', async () => {
  const { store } = await createStore()

  const profile = await store.create({ name: ' Shiny collection ' })

  assert.match(profile.hubProfileId, /^[0-9a-f-]{36}$/i)
  assert.equal(profile.name, 'Shiny collection')
  assert.deepEqual(profile.grid, { entries: {} })
  assert.deepEqual(await store.list(), [profile])
})

test('binds an empty Hub grid permanently to its first backend profile', async () => {
  const { store } = await createStore()
  const profile = await store.create({ name: 'Transfer box' })

  const bound = await store.bindOwner(profile.hubProfileId, 'profile-may')

  assert.equal(bound.ownerProfileId, 'profile-may')
  assert.equal((await store.bindOwner(profile.hubProfileId, 'profile-may')).ownerProfileId, 'profile-may')
  await assert.rejects(() => store.bindOwner(profile.hubProfileId, 'profile-dawn'), { code: 'POKEMON_HUB_PROFILE_OWNER_CONFLICT' })
})

test('keeps a Redis-backed Hub grid bound to the profile that first owns it', async () => {
  const store = createRedisPokemonHubProfileStore({ persistence: createMemoryRedisPersistence() })
  const profile = await store.create({ name: 'Redis transfer box' })

  await store.bindOwner(profile.hubProfileId, 'profile-may')

  assert.equal((await store.list())[0].ownerProfileId, 'profile-may')
  await assert.rejects(() => store.bindOwner(profile.hubProfileId, 'profile-dawn'), { code: 'POKEMON_HUB_PROFILE_OWNER_CONFLICT' })
})

test('rejects duplicate normalized Hub profile names and invalid grid dimensions', async () => {
  const { store } = await createStore()
  await store.create({ name: 'Shiny collection' })

  await assert.rejects(() => store.create({ name: ' shiny collection ' }), { code: 'POKEMON_HUB_PROFILE_NAME_DUPLICATE' })
})

test('rejects Hub profile names longer than 26 characters when creating or renaming', async () => {
  const { store } = await createStore()
  const profile = await store.create({ name: 'Test box' })

  await assert.rejects(() => store.create({ name: 'x'.repeat(27) }), { code: 'POKEMON_HUB_PROFILE_INVALID' })
  await assert.rejects(() => store.rename(profile.hubProfileId, 'x'.repeat(27)), { code: 'POKEMON_HUB_PROFILE_INVALID' })
})

test('migrates legacy empty slots into sparse entries with no persisted layout when an existing profile is loaded', async () => {
  const { dataPath, store } = await createStore()
  const collectionPath = join(dataPath, 'profiles.json')
  const legacyProfile = {
    schemaVersion: 3,
    hubProfileId: '11111111-1111-4111-8111-111111111111',
    name: 'Test box',
    createdAt: '2026-09-17T00:00:00.000Z',
    grid: { slots: [null, { species: 'Pikachu' }, ...Array(28).fill(null)] },
  }
  await writeFile(collectionPath, JSON.stringify([legacyProfile]), 'utf8')

  const [profile] = await store.list()
  assert.deepEqual(profile.grid, { entries: { 1: { species: 'Pikachu' } } })

  const [persisted] = JSON.parse(await readFile(collectionPath, 'utf8'))
  assert.deepEqual(persisted.grid, { entries: { 1: { species: 'Pikachu' } } })
})

test('migrates a schema-version-4 profile without retaining its capacity', async () => {
  const { dataPath, store } = await createStore()
  const collectionPath = join(dataPath, 'profiles.json')
  const legacyProfile = {
    schemaVersion: 4,
    hubProfileId: '22222222-2222-4222-8222-222222222222',
    name: 'Old layout',
    createdAt: '2026-09-17T00:00:00.000Z',
    grid: { capacity: 60, entries: { 59: { species: 'Eevee' } } },
  }
  await writeFile(collectionPath, JSON.stringify([legacyProfile]), 'utf8')

  const [profile] = await store.list()
  assert.deepEqual(profile.grid, { entries: { 59: { species: 'Eevee' } } })

  const [persisted] = JSON.parse(await readFile(collectionPath, 'utf8'))
  assert.deepEqual(persisted.grid, { entries: { 59: { species: 'Eevee' } } })
})

test('renames a Hub profile and requires explicit discard before deleting occupied slots', async () => {
  const { dataPath, store } = await createStore()
  const created = await store.create({ name: 'Shiny collection' })

  const renamed = await store.rename(created.hubProfileId, 'Living dex')
  assert.equal(renamed.name, 'Living dex')

  const collectionPath = join(dataPath, 'profiles.json')
  const [persisted] = JSON.parse(await readFile(collectionPath, 'utf8'))
  persisted.grid.entries[0] = { species: 'Pikachu' }
  await writeFile(collectionPath, JSON.stringify([persisted]), 'utf8')

  const reloaded = createPokemonHubProfileStore({ dataPath })
  await assert.rejects(() => reloaded.delete(created.hubProfileId), { code: 'POKEMON_HUB_PROFILE_NOT_EMPTY' })
  assert.deepEqual(await reloaded.delete(created.hubProfileId, { discardOccupied: true }), { hubProfileId: created.hubProfileId, discardedPokemonCount: 1 })
  assert.deepEqual(await reloaded.list(), [])
})
