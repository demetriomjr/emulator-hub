import assert from 'node:assert/strict'
import test from 'node:test'

import { createGameSessionSourceSnapshot, snapshotToSaveLayout, visiblePokemonHubPanes } from './pokemon-hub-session-view.mjs'
import * as sessionView from './pokemon-hub-session-view.mjs'

test('keeps the visual workspace at its current pane count when reconciling a three-slot snapshot', () => {
  const panes = visiblePokemonHubPanes([
      { pane: 0, profile: { type: 'save', profileId: 'may', gameId: 'pokemon-emerald' }, party: [], boxes: [] },
    { pane: 1, profile: { type: 'hub-profile', hubProfileId: 'living-dex' }, hub: [] },
    null,
  ], 2)

  assert.deepEqual(panes, [
    { kind: 'game', gameId: 'pokemon-emerald', profileId: 'may' },
    { kind: 'hub', hubProfileId: 'living-dex' },
  ])
})

test('a correction preserves the snapshot of a pane added after session opening', () => {
  assert.equal(typeof sessionView.reconcileCanonicalSessionSnapshot, 'function')
  const sourceSnapshots = {
    'emerald:may': {
      sourceKey: 'save:may:emerald',
      placements: [{ location: { kind: 'game', area: 'party', slot: 0 }, pokemonInstanceId: 'old-save' }],
    },
    'hub:living-dex': {
      sourceKey: 'hub:living-dex',
      placements: [{ location: { kind: 'hub', hubProfileId: 'living-dex', slot: 0 }, pokemonInstanceId: 'old-hub' }],
    },
  }
  const correction = { revision: 4, panes: [
    { pane: 0, profile: { type: 'save', profileId: 'may', gameId: 'emerald' }, party: [{ pokemonInstanceId: 'new-save', slot: 0 }], boxes: [] },
    { pane: 1, profile: { type: 'hub-profile', hubProfileId: 'living-dex' }, hub: [{ pokemonInstanceId: 'new-hub', slot: 0 }] },
    null,
  ] }

  const result = sessionView.reconcileCanonicalSessionSnapshot(correction, 2, sourceSnapshots)

  assert.equal(result.panes.length, 2)
  assert.equal(result.snapshots['emerald:may'].placements[0].pokemonInstanceId, 'new-save')
  assert.equal(result.snapshots['hub:living-dex'].placements[0].pokemonInstanceId, 'new-hub')
  assert.equal(sourceSnapshots['hub:living-dex'].placements[0].pokemonInstanceId, 'old-hub')
})

test('a canonical correction retains a Hub occupant beyond the current local projection', () => {
  const sourceSnapshots = { 'hub:living-dex': {
    kind: 'hub', hubProfileId: 'living-dex', sourceKey: 'hub:living-dex',
    placements: [{ location: { kind: 'hub', hubProfileId: 'living-dex', slot: 0 }, pokemonInstanceId: 'old-hub' }],
  } }
  const correction = { revision: 2, panes: [
    { pane: 0, profile: { type: 'hub-profile', hubProfileId: 'living-dex' }, hub: [{ pokemonInstanceId: 'authoritative-hub', slot: 2 }] },
    null, null,
  ] }

  const result = sessionView.reconcileCanonicalSessionSnapshot(correction, 1, sourceSnapshots)
  assert.equal(result.snapshots['hub:living-dex'].placements.length, 3)
  assert.equal(result.snapshots['hub:living-dex'].placements[2].pokemonInstanceId, 'authoritative-hub')
  assert.equal(sourceSnapshots['hub:living-dex'].placements.length, 1)
})

test('keeps occupied Hub slots above the initial grid and extends a local target without mutating its source', () => {
  const profile = { hubProfileId: 'living-dex', grid: { entries: { 0: { pokemonInstanceId: 'first', species: 25 }, 70: { pokemonInstanceId: 'later', species: 133 } } } }
  const snapshot = sessionView.createHubSessionSourceSnapshot({ profileId: 'may', profile })
  assert.equal(snapshot.placements.length, 71)
  assert.equal(snapshot.placements[70].pokemonInstanceId, 'later')

  const extended = sessionView.extendHubSessionSourceSnapshot(snapshot, 100)
  assert.equal(extended.placements.length, 101)
  assert.equal(extended.placements[100].pokemonInstanceId, null)
  assert.equal(snapshot.placements.length, 71)
  assert.equal(extended.placements[70].pokemonInstanceId, 'later')
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

test('preserves item inventory while projecting Pokémon placement changes', () => {
  const itemInventory = { status: 'ready', saveRevision: 4, title: 'pokemon-emerald', areas: { pc: { capacity: 50, freeSlots: 50, slots: [], issues: [] } } }
  const layout = { party: [{}], boxes: [], itemInventory }
  const snapshot = createGameSessionSourceSnapshot({ profileId: 'may', gameId: 'pokemon-emerald', layout })

  assert.deepEqual(snapshotToSaveLayout(snapshot, layout).itemInventory, itemInventory)
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
