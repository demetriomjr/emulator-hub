import assert from 'node:assert/strict'
import test from 'node:test'

import { getPokemonItemSpriteUrl } from './pokemon-item-sprite-view.mjs'

test('uses a local semantic item key without trusting unknown paths', () => {
  assert.equal(getPokemonItemSpriteUrl('rare-candy'), '/resources/items/rare-candy.png')
  assert.equal(getPokemonItemSpriteUrl(null), null)
  assert.equal(getPokemonItemSpriteUrl('../other'), null)
})
