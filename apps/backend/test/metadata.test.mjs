import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createGameMetadataLoader } from '../../packages/game-metadata.mjs'

test('loads version name and trusted cover URL once per source', async () => {
  const calls = []
  const loader = createGameMetadataLoader(async url => {
    calls.push(url)
    return { ok: true, json: async () => url.includes('pokeapi.co')
      ? { names: [{ name: 'Emerald', language: { name: 'en' } }] }
      : { thumbnail: { source: 'https://upload.wikimedia.org/wikipedia/en/f/f7/PokemonEmeraldBox.jpg' } } }
  })
  const entry = { pokeapiVersion: 'emerald', wikipediaPage: 'Pokémon_Emerald' }

  assert.deepEqual(await loader(entry), {
    versionName: 'Emerald',
    coverUrl: 'https://upload.wikimedia.org/wikipedia/en/f/f7/PokemonEmeraldBox.jpg',
  })
  assert.deepEqual(await loader(entry), await loader(entry))
  assert.equal(calls.length, 2)
})

test('rejects an unrelated image and keeps metadata failures non-fatal', async () => {
  const loader = createGameMetadataLoader(async url => {
    if (url.includes('pokeapi.co')) throw new Error('offline')
    return { ok: true, json: async () => ({ thumbnail: { source: 'https://example.com/cover.jpg' } }) }
  })
  assert.deepEqual(await loader({ pokeapiVersion: 'emerald', wikipediaPage: 'Pokémon_Emerald' }), {})
})
