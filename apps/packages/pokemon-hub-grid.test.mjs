import assert from 'node:assert/strict'
import test from 'node:test'

import { getPokemonHubColumnCount, getPokemonHubGridWidth, getPokemonHubVisibleSlotCount, pokemonHubSlotSize } from './pokemon-hub-grid.mjs'

test('derives responsive Hub columns using the shared fixed slot size', () => {
  assert.equal(pokemonHubSlotSize, 86)
  assert.equal(getPokemonHubColumnCount(100), 1)
  assert.equal(getPokemonHubColumnCount(500), 5)
  assert.equal(getPokemonHubColumnCount(5000), 53)
})

test('uses the exact card-row width for symmetric Hub sections', () => {
  assert.equal(getPokemonHubGridWidth(1), 86)
  assert.equal(getPokemonHubGridWidth(6), 551)
  assert.equal(getPokemonHubGridWidth(10), 923)
})

test('renders an empty Hub profile in exactly five visual rows', () => {
  assert.equal(getPokemonHubVisibleSlotCount({}, 5), 25)
  assert.equal(getPokemonHubVisibleSlotCount({}, 7), 35)
  assert.equal(getPokemonHubVisibleSlotCount({}, 20), 100)
})

test('adds a new empty row when the last visible row receives a Pokémon', () => {
  assert.equal(getPokemonHubVisibleSlotCount({ 24: { species: 'Pikachu' } }, 5), 30)
  assert.equal(getPokemonHubVisibleSlotCount({ 34: { species: 'Pikachu' } }, 7), 42)
  assert.equal(getPokemonHubVisibleSlotCount({ 99: { species: 'Pikachu' } }, 20), 120)
})
