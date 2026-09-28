import assert from 'node:assert/strict'
import test from 'node:test'

import * as slotSprite from './pokemon-slot-sprite.mjs'

const { getPokemonSlotSprite, hidePokemonSlotSprite } = slotSprite

test('returns no sprite for empty or invalid current slot projections', () => {
  assert.equal(getPokemonSlotSprite({ occupied: false, species: 6 }), null)
  assert.equal(getPokemonSlotSprite({ occupied: true, species: 0 }), null)
  assert.equal(getPokemonSlotSprite({ occupied: true, species: '6' }), null)
})

test('returns local normal and shiny sprite paths from the current slot projection', () => {
  assert.equal(getPokemonSlotSprite({ occupied: true, species: 6, shiny: false }), '/resources/pokemon/6.png')
  assert.equal(getPokemonSlotSprite({ occupied: true, species: 6, shiny: true }), '/resources/pokemon/6-shiny.png')
})

test('renders an egg without exposing its species or shiny sprite', () => {
  for (const slot of [
    { occupied: true, species: 25, shiny: false, isEgg: true },
    { occupied: true, species: 6, shiny: true, isEgg: true },
    { occupied: true, isEgg: true },
  ]) {
    assert.equal(getPokemonSlotSprite(slot), '/resources/pokemon/egg.png')
  }
})

test('uses an egg label as the image fallback without revealing the species', () => {
  assert.equal(slotSprite.getPokemonSlotFallback?.({ occupied: true, species: 25, isEgg: true }), 'Ovo')
  assert.equal(slotSprite.getPokemonSlotFallback?.({ occupied: true, species: 25 }), '#25')
})

test('hides a failed image so the existing number remains visible', () => {
  const image = { hidden: false }
  hidePokemonSlotSprite(image)
  assert.equal(image.hidden, true)
})
