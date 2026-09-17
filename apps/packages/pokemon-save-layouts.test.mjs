import assert from 'node:assert/strict'
import test from 'node:test'

import { getPokemonSaveLayout } from './pokemon-save-layouts.mjs'

test('provides an authoritative Party count offset for every supported Generation III layout', () => {
  for (const [id, countOffset, offset] of [
    ['pokemon-ruby-gba', 0x234, 0x238],
    ['pokemon-sapphire-gba', 0x234, 0x238],
    ['pokemon-emerald-gba', 0x234, 0x238],
    ['pokemon-firered-gba', 0x34, 0x38],
    ['pokemon-leafgreen-gba', 0x34, 0x38],
  ]) {
    const layout = getPokemonSaveLayout(id, 'gen3-gba-v1')
    assert.equal(layout.party.countOffset, countOffset)
    assert.equal(layout.party.offset, offset)
  }
})
