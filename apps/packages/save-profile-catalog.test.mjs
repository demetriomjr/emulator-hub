import assert from 'node:assert/strict'
import test from 'node:test'

import { deriveSaveProfileCatalog } from './save-profile-catalog.mjs'

test('derives selectable Save ROMs and their profiles from the shared catalog', () => {
  const emeraldProfile = { id: 'may', name: 'May', createdAt: '2026-09-17T00:00:00.000Z' }
  const result = deriveSaveProfileCatalog([
    { id: 'pokemon-emerald', status: 'ready', profiles: [emeraldProfile] },
    { id: 'pokemon-firered', status: 'ready', profiles: [] },
    { id: 'pokemon-ruby', status: 'unavailable', profiles: [{ id: 'brendan', name: 'Brendan', createdAt: '2026-09-17T00:00:00.000Z' }] },
  ])

  assert.deepEqual(result.saveProfileGames.map(game => game.id), ['pokemon-emerald'])
  assert.deepEqual(result.profilesByGame, {
    'pokemon-emerald': [emeraldProfile],
    'pokemon-firered': [],
    'pokemon-ruby': [{ id: 'brendan', name: 'Brendan', createdAt: '2026-09-17T00:00:00.000Z' }],
  })
})
