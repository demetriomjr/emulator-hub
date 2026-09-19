import assert from 'node:assert/strict'
import test from 'node:test'

import { getPokemonSaveLayout, getPokemonSaveMetadataForTitle } from './pokemon-save-layouts.mjs'

test('provides an authoritative Party count offset for every supported Generation III layout', () => {
  for (const [id, countOffset, offset] of [
    ['pokemon-ruby-sapphire-gba', 0x234, 0x238],
    ['pokemon-emerald-gba', 0x234, 0x238],
    ['pokemon-firered-leafgreen-gba', 0x34, 0x38],
  ]) {
    const layout = getPokemonSaveLayout(id, 'gen3-gba-v1')
    assert.equal(layout.party.countOffset, countOffset)
    assert.equal(layout.party.offset, offset)
  }
})

test('maps every supported Generation III title to its shared save layout', () => {
  assert.deepEqual(getPokemonSaveMetadataForTitle('Pokémon Ruby Version'), { adapter: 'gen3-gba-v1', layoutProfile: 'pokemon-ruby-sapphire-gba', title: 'pokemon-ruby', saveKind: 'battery', supported: true })
  assert.deepEqual(getPokemonSaveMetadataForTitle('Pokémon Sapphire Version'), { adapter: 'gen3-gba-v1', layoutProfile: 'pokemon-ruby-sapphire-gba', title: 'pokemon-sapphire', saveKind: 'battery', supported: true })
  assert.deepEqual(getPokemonSaveMetadataForTitle('Pokémon Emerald Version'), { adapter: 'gen3-gba-v1', layoutProfile: 'pokemon-emerald-gba', title: 'pokemon-emerald', saveKind: 'battery', supported: true })
  assert.deepEqual(getPokemonSaveMetadataForTitle('Pokémon FireRed Version'), { adapter: 'gen3-gba-v1', layoutProfile: 'pokemon-firered-leafgreen-gba', title: 'pokemon-firered', saveKind: 'battery', supported: true })
  assert.deepEqual(getPokemonSaveMetadataForTitle('Pokémon LeafGreen Version'), { adapter: 'gen3-gba-v1', layoutProfile: 'pokemon-firered-leafgreen-gba', title: 'pokemon-leafgreen', saveKind: 'battery', supported: true })
})
