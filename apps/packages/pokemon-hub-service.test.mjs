import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createPokemonHubService } from './pokemon-hub-service.mjs'
import { createPokemonHubStore } from './pokemon-hub-store.mjs'

const profileId = '00000000-0000-4000-8000-000000000001'

test('moves one record from an inactive game into an empty Hub slot', async () => {
  let save = Buffer.from([1])
  const invalidations = []
  const hubStore = createPokemonHubStore({ dataPath: await mkdtemp(join(tmpdir(), 'pokemon-hub-service-')) })
  const adapter = {
    id: 'gen3-gba-v1',
    inspect: () => ({ boxes: [] }),
    readSlot: bytes => bytes[0] === 1 ? { bytes: Buffer.alloc(80, 1), identity: { pid: 1 }, canonical: { species: 25 } } : null,
    writeSlot: (_bytes, _box, _slot, record) => Buffer.from([record ? 1 : 0]),
    describe: record => ({ species: record.canonical.species }),
  }
  const service = createPokemonHubService({
    profileStore: { get: async id => id === profileId ? { id } : null },
    saveStore: { get: async () => ({ bytes: save, revision: 1, sha256: 'a'.repeat(64) }), put: async (_p, _g, bytes) => { save = bytes; return { revision: 2 } } },
    hubStore,
    registry: { get: id => id === adapter.id ? adapter : null },
    sessions: { hasLiveSession: () => false }, snapshots: { invalidateGames: (...args) => invalidations.push(args) },
    catalogLoader: async () => [{ id: 'pokemon-emerald', pokemonSave: { supported: true, adapter: adapter.id } }],
  })

  const result = await service.transfer({ profileId, source: { kind: 'game', gameId: 'pokemon-emerald', box: 0, slot: 0 }, destination: { kind: 'hub', slot: 0 }, expectedRevisions: { 'pokemon-emerald': 1 }, expectedHubEpoch: 0 })

  assert.equal(result.hubEpoch, 1)
  assert.equal(save[0], 0)
  assert.deepEqual(invalidations, [[profileId, ['pokemon-emerald'], 1]])
  assert.equal((await hubStore.getProfileState(profileId)).slots[0].length, 36)
})

test('refuses a transfer while the source game has a live session', async () => {
  const hubStore = createPokemonHubStore({ dataPath: await mkdtemp(join(tmpdir(), 'pokemon-hub-service-')) })
  const service = createPokemonHubService({
    profileStore: { get: async () => ({ id: profileId }) }, saveStore: { get: async () => null }, hubStore,
    registry: { get: () => null }, sessions: { hasLiveSession: () => true }, catalogLoader: async () => [],
  })

  await assert.rejects(() => service.transfer({ profileId, source: { kind: 'game', gameId: 'pokemon-emerald', box: 0, slot: 0 }, destination: { kind: 'hub', slot: 0 }, expectedRevisions: { 'pokemon-emerald': 1 }, expectedHubEpoch: 0 }), { code: 'POKEMON_HUB_GAME_ACTIVE' })
})

test('withdraws a retained native record from Hub into an empty game slot', async () => {
  let save = Buffer.from([0])
  const hubStore = createPokemonHubStore({ dataPath: await mkdtemp(join(tmpdir(), 'pokemon-hub-service-')) })
  const hubPokemonId = '00000000-0000-4000-8000-000000000002'
  const inventory = await hubStore.getProfileState(profileId)
  inventory.slots[0] = hubPokemonId
  await hubStore.putProfileState(inventory, inventory.revision)
  await hubStore.putPokemon({ schemaVersion: 1, hubPokemonId, profileId, state: 'stored', location: { kind: 'hub', slot: 0 }, identity: {}, canonical: { trainer: {}, moves: [], stats: {}, met: {}, ribbons: [], attributes: {}, gameData: {}, unknownFields: {} }, representations: [{ adapter: 'gen3-gba-v1', kind: 'pc-record', bytesBase64: Buffer.alloc(80, 9).toString('base64') }], provenance: {}, history: [], revision: 1 })
  const adapter = { id: 'gen3-gba-v1', readSlot: bytes => bytes[0] ? { bytes: Buffer.alloc(80, bytes[0]) } : null, writeSlot: (_bytes, _box, _slot, record) => Buffer.from([record.bytes[0]]), inspect: () => ({ boxes: [] }) }
  const service = createPokemonHubService({ profileStore: { get: async () => ({ id: profileId }) }, saveStore: { get: async () => ({ bytes: save, revision: 1 }), put: async (_p, _g, bytes) => { save = bytes } }, hubStore, registry: { get: () => adapter }, sessions: { hasLiveSession: () => false }, catalogLoader: async () => [{ id: 'pokemon-emerald', pokemonSave: { supported: true, adapter: adapter.id } }] })

  await service.transfer({ profileId, source: { kind: 'hub', slot: 0 }, destination: { kind: 'game', gameId: 'pokemon-emerald', box: 0, slot: 0 }, expectedRevisions: { 'pokemon-emerald': 1 }, expectedHubEpoch: 0 })

  assert.equal(save[0], 9)
  assert.equal((await hubStore.getProfileState(profileId)).slots[0], null)
})
