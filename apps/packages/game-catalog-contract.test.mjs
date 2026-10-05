import assert from 'node:assert/strict'
import test from 'node:test'

test('asset metadata must match game routes and contain paired valid hashes', async () => {
  const { parseGameCatalogResponse } = await import('./game-catalog-contract.mjs')
  const game = { id: 'game', title: 'Game', system: 'gba', status: 'ready', pokemonHubSaveSupported: false, profiles: [] }
  for (const assets of [{ romSha256: 'wrong', romUrl: '/roms/game' }, { romSha256: 'a'.repeat(64), romUrl: 'https://evil' }, { romSha256: 'a'.repeat(64), romUrl: '/roms/game', patchUrl: '/roms/game/patch' }]) {
    assert.throws(() => parseGameCatalogResponse({ games: [{ ...game, assets }] }), /asset/)
  }
})

test('shares one game-catalog response contract between producers and consumers', async () => {
  const contract = await import('./game-catalog-contract.mjs').catch(() => ({}))
  assert.equal(typeof contract.createGameCatalogResponse, 'function')
  assert.equal(typeof contract.parseGameCatalogResponse, 'function')

  const games = [{
    id: 'pokemon-emerald',
    title: 'Pokémon Emerald Version',
    system: 'gba',
    status: 'ready',
    pokemonHubSaveSupported: true,
    profiles: [{ id: 'may', name: 'May', createdAt: '2026-09-17T00:00:00.000Z', hasSave: true }],
  }]
  const response = contract.createGameCatalogResponse(games)

  assert.deepEqual(response, { games })
  assert.equal(contract.parseGameCatalogResponse(response), games)
})

test('rejects a catalog envelope or profile projection that violates the shared contract', async () => {
  const contract = await import('./game-catalog-contract.mjs').catch(() => ({}))
  assert.equal(typeof contract.parseGameCatalogResponse, 'function')

  assert.throws(() => contract.parseGameCatalogResponse([]), /catalog response/i)
  assert.throws(() => contract.parseGameCatalogResponse({ games: [{ id: 'pokemon-emerald', title: 'Emerald', system: 'gba', status: 'ready', pokemonHubSaveSupported: true }] }), /profiles/i)
  assert.throws(() => contract.parseGameCatalogResponse({ games: [{
    id: 'pokemon-emerald',
    title: 'Emerald',
    system: 'gba',
    status: 'ready',
    profiles: [],
  }] }), /Hub/i)
  assert.throws(() => contract.parseGameCatalogResponse({ games: [{
    id: 'pokemon-emerald',
    title: 'Emerald',
    system: 'gba',
    status: 'ready',
    pokemonHubSaveSupported: true,
    profiles: [{ id: 'may', name: 'May', createdAt: '2026-09-17T00:00:00.000Z' }],
  }] }), /profile/i)
})
