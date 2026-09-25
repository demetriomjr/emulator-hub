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

test('orders eligible ROMs like the home layout and save profiles from oldest to newest', () => {
  const sameDate = '2026-09-18T00:00:00.000Z'
  const older = { id: 'older', name: 'Older', createdAt: '2026-09-17T00:00:00.000Z', hasSave: true }
  const tiedFirst = { id: 'tied-first', name: 'Tied first', createdAt: sameDate, hasSave: true }
  const tiedSecond = { id: 'tied-second', name: 'Tied second', createdAt: sameDate, hasSave: true }
  const noSave = { id: 'no-save', name: 'No save', createdAt: '2026-09-16T00:00:00.000Z', hasSave: false }
  const layout = { sections: [{ id: 'gba', title: 'GBA', system: 'gba', gameIds: ['ruby', 'emerald'] }] }
  const catalog = [
    { id: 'sapphire', title: 'Sapphire', system: 'gba', status: 'ready', pokemonHubSaveSupported: true, profiles: [older] },
    { id: 'emerald', title: 'Emerald', system: 'gba', status: 'ready', pokemonHubSaveSupported: true, profiles: [tiedFirst, noSave, older, tiedSecond] },
    { id: 'ruby', title: 'Ruby', system: 'gba', status: 'ready', pokemonHubSaveSupported: true, profiles: [older] },
    { id: 'firered', title: 'FireRed', system: 'gba', status: 'ready', pokemonHubSaveSupported: false, profiles: [older] },
  ]

  const result = deriveSaveProfileCatalog(catalog, layout)
  assert.deepEqual(result.saveProfileGames.map(game => game.id), ['ruby', 'emerald', 'sapphire'])
  assert.deepEqual(result.profilesByGame.emerald.map(profile => profile.id), ['older', 'tied-first', 'tied-second'])
})
