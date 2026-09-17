import assert from 'node:assert/strict'
import test from 'node:test'

import { applyPokemonHubLocalDrop } from './pokemon-hub-local-drag.mjs'

const occupied = (species, shiny = false) => ({ occupied: true, species, shiny })
const empty = () => ({ occupied: false })

function fixture() {
  return {
    hubProfiles: [{
      hubProfileId: 'hub-a',
      name: 'Local box',
      grid: { entries: { 0: { species: 25, shiny: false }, 1: { species: 1, shiny: true } } },
    }],
    saveLayoutsBySource: {
      'emerald:may': {
        party: [occupied(289), occupied(64), empty()],
        boxes: [{ slots: [occupied(183), occupied(276), empty()] }],
      },
      'ruby:dawn': {
        party: [occupied(4), empty()],
        boxes: [{ slots: [occupied(7), empty()] }],
      },
    },
  }
}

const party = (gameId, profileId, slot) => ({ kind: 'game', gameId, profileId, area: 'party', slot })
const box = (gameId, profileId, slot) => ({ kind: 'game', gameId, profileId, area: 'box', box: 0, slot })
const hub = slot => ({ kind: 'hub', hubProfileId: 'hub-a', slot })

test('swaps occupied slots within one Party and within one Box', () => {
  const state = fixture()
  const partyResult = applyPokemonHubLocalDrop(state, party('emerald', 'may', 0), party('emerald', 'may', 1))
  const boxResult = applyPokemonHubLocalDrop(state, box('emerald', 'may', 0), box('emerald', 'may', 1))

  assert.equal(partyResult.action, 'swap')
  assert.equal(partyResult.saveLayoutsBySource['emerald:may'].party[0].species, 64)
  assert.equal(partyResult.saveLayoutsBySource['emerald:may'].party[1].species, 289)
  assert.equal(boxResult.action, 'swap')
  assert.equal(boxResult.saveLayoutsBySource['emerald:may'].boxes[0].slots[0].species, 276)
  assert.equal(boxResult.saveLayoutsBySource['emerald:may'].boxes[0].slots[1].species, 183)
  assert.equal(state.saveLayoutsBySource['emerald:may'].party[0].species, 289)
  assert.equal(state.saveLayoutsBySource['emerald:may'].boxes[0].slots[0].species, 183)
})

test('swaps occupied Hub slots only within the same Hub profile grid', () => {
  const state = fixture()
  const result = applyPokemonHubLocalDrop(state, hub(0), hub(1))

  assert.equal(result.action, 'swap')
  assert.deepEqual(result.hubProfiles[0].grid.entries, { 0: { species: 1, shiny: true }, 1: { species: 25, shiny: false } })
  assert.deepEqual(state.hubProfiles[0].grid.entries, { 0: { species: 25, shiny: false }, 1: { species: 1, shiny: true } })
})

test('moves an occupied Pokémon into any empty local target without persistence', () => {
  const state = fixture()
  const toHub = applyPokemonHubLocalDrop(state, party('emerald', 'may', 0), hub(4))
  const toSave = applyPokemonHubLocalDrop(state, hub(0), box('ruby', 'dawn', 1))

  assert.equal(toHub.action, 'move')
  assert.deepEqual(toHub.saveLayoutsBySource['emerald:may'].party[0], { occupied: false })
  assert.deepEqual(toHub.hubProfiles[0].grid.entries[4], { species: 289, shiny: false })
  assert.equal(toSave.action, 'move')
  assert.equal(toSave.hubProfiles[0].grid.entries[0], undefined)
  assert.deepEqual(toSave.saveLayoutsBySource['ruby:dawn'].boxes[0].slots[1], { occupied: true, species: 25, shiny: false })
})

test('rejects occupied cross-area and cross-save targets without changing references', () => {
  const state = fixture()
  const partyToBox = applyPokemonHubLocalDrop(state, party('emerald', 'may', 0), box('emerald', 'may', 0))
  const saveToSave = applyPokemonHubLocalDrop(state, party('emerald', 'may', 0), party('ruby', 'dawn', 0))
  const hubToSave = applyPokemonHubLocalDrop(state, hub(0), party('emerald', 'may', 0))

  for (const result of [partyToBox, saveToSave, hubToSave]) {
    assert.equal(result.action, 'none')
    assert.equal(result.hubProfiles, state.hubProfiles)
    assert.equal(result.saveLayoutsBySource, state.saveLayoutsBySource)
  }
})

test('treats self-drops and missing locations as no-ops', () => {
  const state = fixture()

  assert.equal(applyPokemonHubLocalDrop(state, party('emerald', 'may', 0), party('emerald', 'may', 0)).action, 'none')
  assert.equal(applyPokemonHubLocalDrop(state, party('emerald', 'may', 0), party('emerald', 'missing', 0)).action, 'none')
})
