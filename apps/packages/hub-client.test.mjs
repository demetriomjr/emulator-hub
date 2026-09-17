import assert from 'node:assert/strict'
import test from 'node:test'

import { createProfile, deleteProfile, getProfiles, updateProfile } from './hub-client.js'

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
