import assert from 'node:assert/strict'
import test from 'node:test'

import { createInitialPokemonHubCanonicalSnapshot, validatePokemonHubCanonicalSnapshot } from './pokemon-hub-canonical-session-snapshot.mjs'

test('creates an independent three-pane canonical snapshot for a new session', () => {
  const first = createInitialPokemonHubCanonicalSnapshot()
  const second = createInitialPokemonHubCanonicalSnapshot()

  assert.deepEqual(first, { revision: 0, panes: [null, null, null] })
  assert.notEqual(first, second)
  assert.notEqual(first.panes, second.panes)

  first.panes[0] = { pane: 0 }
  assert.deepEqual(second, { revision: 0, panes: [null, null, null] })
})

test('accepts readable Hub and save panes without server-only fields', () => {
  const snapshot = {
    revision: 4,
    panes: [
      { pane: 0, profile: { type: 'hub-profile', hubProfileId: 'home' }, hub: [{ pokemonInstanceId: 'pokemon-a', slot: 7 }] },
      { pane: 1, profile: { type: 'save', profileId: 'may', gameId: 'pokemon-emerald' }, party: [{ pokemonInstanceId: 'pokemon-b', slot: 0 }], boxes: [{ pokemonInstanceId: 'pokemon-c', slot: 419 }] },
      null,
    ],
  }

  assert.deepEqual(validatePokemonHubCanonicalSnapshot(snapshot), snapshot)
})

test('accepts two saves of the same title when their save profiles differ', () => {
  const snapshot = {
    revision: 1,
    panes: [
      { pane: 0, profile: { type: 'save', profileId: 'may', gameId: 'pokemon-emerald' }, party: [{ pokemonInstanceId: 'pokemon-a', slot: 0 }], boxes: [] },
      { pane: 1, profile: { type: 'save', profileId: 'dawn', gameId: 'pokemon-emerald' }, party: [{ pokemonInstanceId: 'pokemon-b', slot: 0 }], boxes: [] },
      null,
    ],
  }
  assert.deepEqual(validatePokemonHubCanonicalSnapshot(snapshot), snapshot)
})

test('rejects a duplicated Pokemon identity before source authorization', () => {
  assert.throws(() => validatePokemonHubCanonicalSnapshot({
    revision: 1,
    panes: [
      { pane: 0, profile: { type: 'hub-profile', hubProfileId: 'home' }, hub: [{ pokemonInstanceId: 'pokemon-a', slot: 0 }] },
      { pane: 1, profile: { type: 'save', profileId: 'may', gameId: 'pokemon-emerald' }, party: [{ pokemonInstanceId: 'pokemon-a', slot: 0 }], boxes: [] },
      null,
    ],
  }), /duplicate/i)
})

test('rejects an empty or non-contiguous save Party', () => {
  const savePane = party => ({ pane: 0, profile: { type: 'save', profileId: 'may', gameId: 'pokemon-emerald' }, party, boxes: [] })
  const snapshot = pane => ({ revision: 1, panes: [pane, null, null] })

  assert.throws(() => validatePokemonHubCanonicalSnapshot(snapshot(savePane([]))), /Party/i)
  assert.throws(() => validatePokemonHubCanonicalSnapshot(snapshot(savePane([{ pokemonInstanceId: 'pokemon-a', slot: 1 }]))), /Party/i)
})
