import assert from 'node:assert/strict'
import test from 'node:test'

import clusterKeySlot from 'cluster-key-slot'

import {
  pokemonHubRedisKeys,
  profileHashTag,
} from '../../packages/pokemon-hub-redis-keys.mjs'

const profileId = 'profile/with:reserved characters'

test('all authoritative keys for one profile share the real Redis Cluster slot', () => {
  const keys = [
    pokemonHubRedisKeys.session(profileId, 'session-1'),
    pokemonHubRedisKeys.sessionOperation(profileId, 'session-1', 'operation-1'),
    pokemonHubRedisKeys.sessionTerminal(profileId, 'close-1'),
    pokemonHubRedisKeys.sessionOutbox(profileId, 'outbox-1'),
    pokemonHubRedisKeys.source(profileId, 'save:profile/game'),
    pokemonHubRedisKeys.sourceCloseClaim(profileId, 'save:profile/game'),
    pokemonHubRedisKeys.record(profileId, 'pokemon-1'),
    pokemonHubRedisKeys.lease(profileId, 'save:profile/game'),
    pokemonHubRedisKeys.workspaceLease(profileId, 'session-1'),
    pokemonHubRedisKeys.snapshotSync(profileId, 'session-1', 'sync-1'),
    pokemonHubRedisKeys.event(profileId, 'pokemon-1', 'event-1'),
    pokemonHubRedisKeys.eventOutbox(profileId, 'event-1'),
    pokemonHubRedisKeys.migrationMarker(profileId),
  ]

  assert.ok(keys.every(key => key.includes(profileHashTag(profileId))))
  assert.equal(new Set(keys.map(clusterKeySlot)).size, 1)
})

test('global expiry indexes are outside the profile hash-tagged key family', () => {
  const keys = [
    pokemonHubRedisKeys.expiringSessionIndex(),
    pokemonHubRedisKeys.expiringLeaseIndex(),
  ]

  assert.ok(keys.every(key => !key.includes('{ph:')))
  assert.deepEqual(keys, [
    'pokemon-hub:v2:expiring-session',
    'pokemon-hub:v2:expiring-lease',
  ])
})

test('profile and key components are encoded and empty components are rejected', () => {
  const key = pokemonHubRedisKeys.source('profile/one', 'save:emerald')

  assert.match(key, /^pokemon-hub:v2:\{ph:profile%2Fone\}:source:save%3Aemerald$/)
  assert.throws(() => pokemonHubRedisKeys.session('', 'session-1'), /Profile ID is required/)
  assert.throws(() => pokemonHubRedisKeys.session('profile-1', ''), /Session ID is required/)
  assert.throws(() => pokemonHubRedisKeys.source('profile-1', ''), /Source key is required/)
})
