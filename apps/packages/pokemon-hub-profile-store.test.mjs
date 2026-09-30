import assert from 'node:assert/strict'
import test from 'node:test'

import { createRedisPokemonHubProfileStore } from './pokemon-hub-profile-store.mjs'
import { createMemoryRedisPersistence } from './redis-persistence.mjs'

function createStore() {
  const persistence = createMemoryRedisPersistence()
  return { persistence, store: createRedisPokemonHubProfileStore({ persistence }) }
}

test('persists a named Hub profile with sparse empty storage', async () => {
  const { store } = await createStore()

  const profile = await store.create({ name: ' Shiny collection ' })

  assert.match(profile.hubProfileId, /^[0-9a-f-]{36}$/i)
  assert.equal(profile.name, 'Shiny collection')
  assert.deepEqual(profile.grid, { entries: {} })
  assert.deepEqual(await store.list(), [profile])
})

test('Hub profiles do not expose or bind a Save owner', async () => {
 const { store } = createStore()
 const profile = await store.create({ name: 'Independent box' })
 assert.equal(Object.hasOwn(profile, 'ownerProfileId'), false)
 assert.equal(typeof store.bindOwner, 'undefined')
 assert.deepEqual(await store.list(), [profile])
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

test('normalizes legacy empty slots on read and persists sparse entries on the next write', async () => {
  const { persistence, store } = createStore()
  const legacyProfile = {
    schemaVersion: 3,
    hubProfileId: '11111111-1111-4111-8111-111111111111',
    name: 'Test box',
    createdAt: '2026-09-17T00:00:00.000Z',
    grid: { slots: [null, { species: 'Pikachu' }, ...Array(28).fill(null)] },
  }
  await persistence.set('pokemon-hub:profiles', JSON.stringify([legacyProfile]))

  const [profile] = await store.list()
  assert.deepEqual(profile.grid, { entries: { 1: { species: 'Pikachu' } } })

  await store.rename(profile.hubProfileId, profile.name)
  const [persisted] = JSON.parse(await persistence.get('pokemon-hub:profiles'))
  assert.deepEqual(persisted.grid, { entries: { 1: { species: 'Pikachu' } } })
})

test('serializes catalogue changes and continues after a rejected change', async () => {
  const { store } = createStore()
  const first = store.create({ name: 'First' })
  const rejected = store.create({ name: 'First' })
  const second = store.create({ name: 'Second' })

  const createdFirst = await first
  await assert.rejects(rejected, { code: 'POKEMON_HUB_PROFILE_NAME_DUPLICATE' })
  const createdSecond = await second
  assert.deepEqual((await store.list()).map(profile => profile.hubProfileId), [createdFirst.hubProfileId, createdSecond.hubProfileId])
})

test('normalizes a schema-version-4 profile without retaining its capacity on the next write', async () => {
  const { persistence, store } = createStore()
  const legacyProfile = {
    schemaVersion: 4,
    hubProfileId: '22222222-2222-4222-8222-222222222222',
    name: 'Old layout',
    createdAt: '2026-09-17T00:00:00.000Z',
    grid: { capacity: 60, entries: { 59: { species: 'Eevee' } } },
  }
  await persistence.set('pokemon-hub:profiles', JSON.stringify([legacyProfile]))

  const [profile] = await store.list()
  assert.deepEqual(profile.grid, { entries: { 59: { species: 'Eevee' } } })

  await store.rename(profile.hubProfileId, profile.name)
  const [persisted] = JSON.parse(await persistence.get('pokemon-hub:profiles'))
  assert.deepEqual(persisted.grid, { entries: { 59: { species: 'Eevee' } } })
})

test('renames a Hub profile and requires explicit discard before deleting occupied slots', async () => {
  const { persistence, store } = createStore()
  const created = await store.create({ name: 'Shiny collection' })

  const renamed = await store.rename(created.hubProfileId, 'Living dex')
  assert.equal(renamed.name, 'Living dex')

  const [persisted] = JSON.parse(await persistence.get('pokemon-hub:profiles'))
  persisted.grid.entries[0] = { species: 'Pikachu' }
  await persistence.set('pokemon-hub:profiles', JSON.stringify([persisted]))

  const reloaded = createRedisPokemonHubProfileStore({ persistence })
  await assert.rejects(() => reloaded.delete(created.hubProfileId), { code: 'POKEMON_HUB_PROFILE_NOT_EMPTY' })
  assert.deepEqual(await reloaded.delete(created.hubProfileId, { discardOccupied: true }), { hubProfileId: created.hubProfileId, discardedPokemonCount: 1 })
  assert.deepEqual(await reloaded.list(), [])
})
