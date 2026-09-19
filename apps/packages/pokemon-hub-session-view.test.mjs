import assert from 'node:assert/strict'
import test from 'node:test'

import { createGameSessionSourceSnapshot, snapshotToSaveLayout, visiblePokemonHubPanes } from './pokemon-hub-session-view.mjs'

test('keeps the visual workspace at its current pane count when reconciling a three-slot snapshot', () => {
  const panes = visiblePokemonHubPanes([
      { pane: 0, profile: { type: 'save', profileId: 'may', gameId: 'pokemon-emerald' }, party: [], boxes: [] },
    { pane: 1, profile: { type: 'hub-profile', hubProfileId: 'living-dex' }, hub: [] },
    null,
  ], 2, 'may')

  assert.deepEqual(panes, [
    { kind: 'game', gameId: 'pokemon-emerald', profileId: 'may' },
    { kind: 'hub', hubProfileId: 'living-dex' },
  ])
})

test('projects a loaded save layout into renderable Party and Box slots', () => {
  const layout = {
    party: [{ pokemonInstanceId: 'party-1', species: 252 }, {}, {}, {}, {}, {}],
    boxes: [{ slots: [{ pokemonInstanceId: 'box-1', species: 253 }, {}] }],
  }

  const snapshot = createGameSessionSourceSnapshot({ profileId: 'may', gameId: 'pokemon-emerald', layout })

  assert.deepEqual(snapshotToSaveLayout(snapshot, layout), {
    party: [{ occupied: true, pokemonInstanceId: 'party-1', species: 252 }, { occupied: false }, { occupied: false }, { occupied: false }, { occupied: false }, { occupied: false }],
    boxes: [{ slots: [{ occupied: true, pokemonInstanceId: 'box-1', species: 253 }, { occupied: false }] }],
  })
})

test('matches persisted placements when Redis changes location property order', () => {
  const layout = {
    party: [{ occupied: true, species: 25 }],
    boxes: [{ slots: [{ occupied: true, species: 133 }] }],
  }
  const snapshot = {
    pokemonDisplay: {
      'party-1': { species: 25 },
      'box-1': { species: 133 },
    },
    placements: [
      { location: { kind: 'game', slot: 0, area: 'party' }, pokemonInstanceId: 'party-1' },
      { location: { slot: 0, kind: 'game', box: 0, area: 'box' }, pokemonInstanceId: 'box-1' },
    ],
  }

  assert.deepEqual(snapshotToSaveLayout(snapshot, layout), {
    party: [{ occupied: true, pokemonInstanceId: 'party-1', species: 25 }],
    boxes: [{ slots: [{ occupied: true, pokemonInstanceId: 'box-1', species: 133 }] }],
  })
})
