import assert from 'node:assert/strict'
import test from 'node:test'
import { createPokemonHubSnapshotStore } from './pokemon-hub-snapshot-store.mjs'

test('rejects a binding invalidated by a Pokémon Hub transfer', () => {
  const store = createPokemonHubSnapshotStore()
  const binding = store.createBinding({ profileId: 'profile', gameId: 'pokemon-emerald', saveRevision: 1, saveSha256: 'a', hubEpoch: 0 })
  store.invalidateGames('profile', ['pokemon-emerald'], 1)
  assert.throws(() => store.assertRestorable(binding, { profileId: 'profile', gameId: 'pokemon-emerald', saveRevision: 1, saveSha256: 'a', hubEpoch: 1 }), { code: 'SNAPSHOT_STALE' })
})
