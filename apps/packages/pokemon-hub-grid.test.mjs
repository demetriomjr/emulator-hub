import assert from 'node:assert/strict'
import test from 'node:test'

import { getPokemonHubColumnCount, getPokemonHubVisibleSlotCount } from './pokemon-hub-grid.mjs'

test('keeps between five and twenty Hub cards in each visual row', () => {
  assert.equal(getPokemonHubColumnCount(100), 5)
  assert.equal(getPokemonHubColumnCount(747), 9)
  assert.equal(getPokemonHubColumnCount(5000), 20)
})

test('renders the first sixty positions plus a completely empty final row', () => {
  assert.equal(getPokemonHubVisibleSlotCount({}, 5), 65)
  assert.equal(getPokemonHubVisibleSlotCount({}, 7), 63)
  assert.equal(getPokemonHubVisibleSlotCount({}, 20), 80)
})

test('adds a new empty row when the last visible row receives a Pokémon', () => {
  assert.equal(getPokemonHubVisibleSlotCount({ 59: { species: 'Pikachu' } }, 20), 80)
  assert.equal(getPokemonHubVisibleSlotCount({ 79: { species: 'Pikachu' } }, 20), 100)
  assert.equal(getPokemonHubVisibleSlotCount({ 62: { species: 'Pikachu' } }, 7), 70)
})
