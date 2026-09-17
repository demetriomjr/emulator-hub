import assert from 'node:assert/strict'
import test from 'node:test'

import { createProfile, deleteProfile, getGames, getProfiles, getSaveProfileGames, getSaveProfileLayout, updateProfile } from './hub-client.js'

test('gets the shared ROM catalog with each ROM profile projection', async (t) => {
  const originalFetch = globalThis.fetch
  const profile = { id: 'profile-1', name: 'Leaf', createdAt: '2026-09-17T00:00:00.000Z' }
  const game = { id: 'pokemon-emerald', title: 'Pokemon Emerald', system: 'gba', status: 'ready', profiles: [profile] }
  let body = { games: [game] }
  globalThis.fetch = async () => ({ ok: true, json: async () => body })
  t.after(() => { globalThis.fetch = originalFetch })

  assert.deepEqual(await getGames(), [game])

  body = { games: [{ ...game, profiles: [{ id: 'profile-1', name: 'Leaf' }] }] }
  await assert.rejects(() => getGames(), /Invalid catalog profile response/)
})

test('preserves the missing-save code from a Save layout request', async (t) => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({ error: 'Save was not found.', code: 'SAVE_MISSING' }) })
  t.after(() => { globalThis.fetch = originalFetch })

  await assert.rejects(
    () => getSaveProfileLayout('pokemon-ruby', 'profile-1'),
    error => error.code === 'SAVE_MISSING' && error.message === 'Save was not found.',
  )
})

test('sends every game-profile request to the selected ROM', async (t) => {
  const originalFetch = globalThis.fetch
  const requests = []
  const profile = { id: 'profile-1', name: 'Leaf', createdAt: '2026-09-17T00:00:00.000Z' }
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, options })
    return { ok: true, json: async () => url.endsWith('/profiles') && !options.method ? { profiles: [profile] } : profile }
  }
  t.after(() => { globalThis.fetch = originalFetch })

  assert.deepEqual(await getProfiles('pokemon-emerald'), [profile])
  await createProfile('pokemon-emerald', 'Leaf')
  await updateProfile('pokemon-emerald', profile.id, 'Green')
  await deleteProfile('pokemon-emerald', profile.id)

  assert.deepEqual(requests.map(({ url, options }) => [url, options.method ?? 'GET']), [
    ['/api/games/pokemon-emerald/profiles', 'GET'],
    ['/api/games/pokemon-emerald/profiles', 'POST'],
    ['/api/games/pokemon-emerald/profiles/profile-1', 'PATCH'],
    ['/api/games/pokemon-emerald/profiles/profile-1', 'DELETE'],
  ])
})

test('gets save-profile ROMs and rejects an invalid response shape', async (t) => {
  const originalFetch = globalThis.fetch
  const requests = []
  const game = { id: 'pokemon-emerald', title: 'Pokemon Emerald', system: 'gba' }
  let body = { games: [game] }
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, options })
    return { ok: true, json: async () => body }
  }
  t.after(() => { globalThis.fetch = originalFetch })

  assert.deepEqual(await getSaveProfileGames(), [game])
  assert.deepEqual(requests, [{ url: '/api/pokemon-hub/save-profile-games', options: { cache: 'no-store' } }])

  body = { games: {} }
  await assert.rejects(() => getSaveProfileGames(), /Invalid save-profile game response/)
})
