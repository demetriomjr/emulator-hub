import assert from 'node:assert/strict'
import test from 'node:test'

import { createPokemonHubLocalDragOutput } from './pokemon-hub-local-drag-output.mjs'

test('creates a console-safe local drag output from the resulting visual state', () => {
  const hubProfiles = [{ hubProfileId: 'box-a', grid: { entries: { 0: { species: 25, shiny: false } } } }]
  const saveLayoutsBySource = { 'emerald:may': { party: [{ occupied: false }], boxes: [] } }

  assert.deepEqual(createPokemonHubLocalDragOutput({
    source: { kind: 'hub', hubProfileId: 'box-a', slot: 0 },
    target: { kind: 'game', gameId: 'emerald', profileId: 'may', area: 'party', slot: 0 },
    result: { action: 'move', hubProfiles, saveLayoutsBySource },
  }), {
    type: 'pokemon-hub-local-drag',
    mode: 'local-preview',
    action: 'move',
    source: { kind: 'hub', hubProfileId: 'box-a', slot: 0 },
    target: { kind: 'game', gameId: 'emerald', profileId: 'may', area: 'party', slot: 0 },
    nextState: { hubProfiles, saveLayoutsBySource },
  })
})

test('preserves a rejected drag output without inventing a backend result', () => {
  const output = createPokemonHubLocalDragOutput({
    source: { kind: 'game', gameId: 'emerald', profileId: 'may', area: 'party', slot: 0 },
    target: { kind: 'game', gameId: 'ruby', profileId: 'dawn', area: 'party', slot: 0 },
    result: { action: 'none', hubProfiles: [], saveLayoutsBySource: {} },
  })

  assert.equal(output.mode, 'local-preview')
  assert.equal(output.action, 'none')
  assert.equal('serverResult' in output, false)
})
