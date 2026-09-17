import assert from 'node:assert/strict'
import test from 'node:test'

import { createPokemonHubSessionStore } from './pokemon-hub-session-store.mjs'

test('keeps a game live only until its lease expires', () => {
  let now = 1000
  const sessions = createPokemonHubSessionStore({ now: () => now, leaseMs: 100 })
  const opened = sessions.open({ profileId: 'profile', gameId: 'pokemon-emerald' })

  assert.equal(sessions.hasLiveSession('profile', 'pokemon-emerald'), true)
  now = 1101
  assert.equal(sessions.hasLiveSession('profile', 'pokemon-emerald'), false)
  assert.throws(() => sessions.renew(opened), /session/i)
})

test('requires the opaque lease token to close a game session', () => {
  const sessions = createPokemonHubSessionStore()
  const opened = sessions.open({ profileId: 'profile', gameId: 'pokemon-emerald' })

  assert.throws(() => sessions.close({ ...opened, leaseToken: 'wrong' }), /session/i)
  sessions.close(opened)
  assert.equal(sessions.hasLiveSession('profile', 'pokemon-emerald'), false)
})
