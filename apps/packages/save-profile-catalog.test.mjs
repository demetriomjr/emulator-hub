import assert from 'node:assert/strict'
import test from 'node:test'

import * as saveProfileCatalog from './save-profile-catalog.mjs'

const { deriveSaveProfileCatalog } = saveProfileCatalog

test('derives selectable Save ROMs and their profiles from the shared catalog', () => {
  const emeraldProfile = { id: 'may', name: 'May', createdAt: '2026-09-17T00:00:00.000Z', hasSave: true }
  const emptyEmeraldProfile = { id: 'wally', name: 'Wally', createdAt: '2026-09-17T00:00:01.000Z', hasSave: false }
  const result = deriveSaveProfileCatalog([
    { id: 'pokemon-emerald', status: 'ready', pokemonHubSaveSupported: true, profiles: [emeraldProfile, emptyEmeraldProfile] },
    { id: 'pokemon-firered', status: 'ready', pokemonHubSaveSupported: true, profiles: [] },
    { id: 'pokemon-ruby', status: 'ready', pokemonHubSaveSupported: false, profiles: [{ id: 'brendan', name: 'Brendan', createdAt: '2026-09-17T00:00:00.000Z', hasSave: true }] },
  ])

  assert.deepEqual(result.saveProfileGames.map(game => game.id), ['pokemon-emerald'])
  assert.deepEqual(result.profilesByGame, {
    'pokemon-emerald': [emeraldProfile],
    'pokemon-firered': [],
    'pokemon-ruby': [{ id: 'brendan', name: 'Brendan', createdAt: '2026-09-17T00:00:00.000Z', hasSave: true }],
  })
})

test('preserves save availability when profile metadata is replaced', () => {
  assert.equal(typeof saveProfileCatalog.replaceCatalogProfile, 'function')
  const current = [{ id: 'may', name: 'May', createdAt: '2026-09-17T00:00:00.000Z', hasSave: true }]

  assert.deepEqual(saveProfileCatalog.replaceCatalogProfile(current, {
    id: 'may', name: 'May renamed', createdAt: '2026-09-17T00:00:00.000Z',
  }), [{ id: 'may', name: 'May renamed', createdAt: '2026-09-17T00:00:00.000Z', hasSave: true }])
})
