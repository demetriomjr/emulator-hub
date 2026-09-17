import assert from 'node:assert/strict'
import test from 'node:test'

import { getPokemonSlotSprite, hidePokemonSlotSprite } from './pokemon-slot-sprite.mjs'

test('returns no sprite for empty or invalid current slot projections', () => {
  assert.equal(getPokemonSlotSprite({ occupied: false, species: 6 }), null)
  assert.equal(getPokemonSlotSprite({ occupied: true, species: 0 }), null)
  assert.equal(getPokemonSlotSprite({ occupied: true, species: '6' }), null)
})

test('returns local normal and shiny sprite paths from the current slot projection', () => {
  assert.equal(getPokemonSlotSprite({ occupied: true, species: 6, shiny: false }), '/resources/pokemon/6.png')
  assert.equal(getPokemonSlotSprite({ occupied: true, species: 6, shiny: true }), '/resources/pokemon/6-shiny.png')
})

test('hides a failed image so the existing number remains visible', () => {
  const image = { hidden: false }
  hidePokemonSlotSprite(image)
  assert.equal(image.hidden, true)
})
