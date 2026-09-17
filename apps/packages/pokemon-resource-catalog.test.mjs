import assert from 'node:assert/strict'
import test from 'node:test'

import { selectPokemonResources, spriteUrl } from './pokemon-resource-catalog.mjs'

const images = id => ({ normal: `https://assets.example/${id}.png`, shiny: `https://assets.example/${id}-shiny.png` })

test('selects each default species with number-only normal and shiny filenames', () => {
  assert.deepEqual(selectPokemonResources([
    { sourceId: 6, speciesId: 6, name: 'charizard', isDefault: true, images: images(6) },
  ]), [{
    nationalDex: 6,
    region: null,
    variant: null,
    sourceId: 6,
    normalFile: '6.png',
    shinyFile: '6-shiny.png',
    images: images(6),
  }])
})

test('selects regional forms with the region before the shiny suffix', () => {
  assert.deepEqual(selectPokemonResources([
    { sourceId: 10091, speciesId: 19, name: 'rattata-alola', isDefault: false, images: images(10091) },
    { sourceId: 10163, speciesId: 77, name: 'ponyta-galar', isDefault: false, images: images(10163) },
    { sourceId: 10229, speciesId: 58, name: 'growlithe-hisui', isDefault: false, images: images(10229) },
    { sourceId: 10250, speciesId: 128, name: 'tauros-paldea-combat-breed', isDefault: false, images: images(10250) },
    { sourceId: 10178, speciesId: 555, name: 'darmanitan-galar-standard', isDefault: false, images: images(10178) },
  ]), [
    { nationalDex: 19, region: 'alola', variant: null, sourceId: 10091, normalFile: '19-alola.png', shinyFile: '19-alola-shiny.png', images: images(10091) },
    { nationalDex: 58, region: 'hisui', variant: null, sourceId: 10229, normalFile: '58-hisui.png', shinyFile: '58-hisui-shiny.png', images: images(10229) },
    { nationalDex: 77, region: 'galar', variant: null, sourceId: 10163, normalFile: '77-galar.png', shinyFile: '77-galar-shiny.png', images: images(10163) },
    { nationalDex: 128, region: 'paldea', variant: 'combat-breed', sourceId: 10250, normalFile: '128-paldea-combat-breed.png', shinyFile: '128-paldea-combat-breed-shiny.png', images: images(10250) },
    { nationalDex: 555, region: 'galar', variant: null, sourceId: 10178, normalFile: '555-galar.png', shinyFile: '555-galar-shiny.png', images: images(10178) },
  ])
})

test('excludes non-regional alternate forms', () => {
  assert.deepEqual(selectPokemonResources([
    { sourceId: 10034, speciesId: 6, name: 'charizard-mega-x', isDefault: false, images: images(10034) },
    { sourceId: 10195, speciesId: 25, name: 'pikachu-gmax', isDefault: false, images: images(10195) },
    { sourceId: 10001, speciesId: 386, name: 'deoxys-attack', isDefault: false, images: images(10001) },
    { sourceId: 10092, speciesId: 20, name: 'raticate-totem-alola', isDefault: false, images: images(10092) },
    { sourceId: 10179, speciesId: 555, name: 'darmanitan-galar-zen', isDefault: false, images: images(10179) },
  ]), [])
})

test('rejects duplicate local filenames', () => {
  assert.throws(() => selectPokemonResources([
    { sourceId: 6, speciesId: 6, name: 'charizard', isDefault: true, images: images(6) },
    { sourceId: 60006, speciesId: 6, name: 'charizard-copy', isDefault: true, images: images(60006) },
  ]), /Duplicate local resource filename/)
})

test('builds only valid local public paths', () => {
  assert.equal(spriteUrl({ nationalDex: 6 }), '/resources/pokemon/6.png')
  assert.equal(spriteUrl({ nationalDex: 6, shiny: true }), '/resources/pokemon/6-shiny.png')
  assert.equal(spriteUrl({ nationalDex: 26, region: 'alola', shiny: true }), '/resources/pokemon/26-alola-shiny.png')
  assert.equal(spriteUrl({ nationalDex: 128, region: 'paldea', variant: 'combat-breed', shiny: true }), '/resources/pokemon/128-paldea-combat-breed-shiny.png')
  assert.throws(() => spriteUrl({ nationalDex: 0 }), /National Pokédex number/)
  assert.throws(() => spriteUrl({ nationalDex: 6, region: 'kalos' }), /Unsupported region/)
})
