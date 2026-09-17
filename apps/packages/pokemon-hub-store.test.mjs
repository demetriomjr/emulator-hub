import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createPokemonHubStore } from './pokemon-hub-store.mjs'

async function createStore() {
  return createPokemonHubStore({ dataPath: await mkdtemp(join(tmpdir(), 'emulator-hub-pokemon-hub-')) })
}

test('creates a stable empty inventory for a profile', async () => {
  const store = await createStore()

  const inventory = await store.getProfileState('00000000-0000-4000-8000-000000000001')

  assert.equal(inventory.schemaVersion, 1)
  assert.equal(inventory.hubEpoch, 0)
  assert.equal(inventory.revision, 1)
  assert.deepEqual(inventory.slots, Array(30).fill(null))
})

test('persists a document without sharing mutable nested state', async () => {
  const store = await createStore()
  const profileId = '00000000-0000-4000-8000-000000000001'
  const document = {
    schemaVersion: 1,
    hubPokemonId: '00000000-0000-4000-8000-000000000002',
    profileId,
    state: 'stored',
    location: { kind: 'hub', slot: 0 },
    identity: { species: 25, form: 0, shiny: false, nativeIdentity: {} },
    canonical: { trainer: {}, moves: [], stats: {}, met: {}, ribbons: [], attributes: {}, gameData: { teraType: 'fire' }, unknownFields: {} },
    representations: [],
    provenance: { firstSeenAt: '2026-09-17T00:00:00.000Z', sourceGameId: 'pokemon-emerald' },
    history: [],
    revision: 1,
  }

  await store.putPokemon(document)
  const loaded = await store.getPokemon(profileId, document.hubPokemonId)
  loaded.canonical.gameData.teraType = 'water'

  assert.equal((await store.getPokemon(profileId, document.hubPokemonId)).canonical.gameData.teraType, 'fire')
})
