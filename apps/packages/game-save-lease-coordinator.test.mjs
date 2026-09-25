import assert from 'node:assert/strict'
import test from 'node:test'

import { createMemoryRedisPersistence } from './redis-persistence.mjs'
import { createGameSaveLeaseCoordinator } from './game-save-lease-coordinator.mjs'

test('makes player and Pokemon Hub ownership mutually exclusive for one save', async () => {
  let now = 1_000
  const leases = createGameSaveLeaseCoordinator({ persistence: createMemoryRedisPersistence(), now: () => now })
  await leases.acquirePlayer({ profileId: 'may', gameId: 'emerald', deviceId: 'device-a', sessionId: 'player-a' })

  await assert.rejects(
    leases.acquireHub({ profileId: 'may', gameId: 'emerald', workspaceId: 'hub-a' }),
    error => error.code === 'SAVE_IN_USE_BY_PLAYER',
  )

  now += 46_000
  await leases.acquireHub({ profileId: 'may', gameId: 'emerald', workspaceId: 'hub-a' })
  await assert.rejects(
    leases.acquirePlayer({ profileId: 'may', gameId: 'emerald', deviceId: 'device-a', sessionId: 'player-b' }),
    error => error.code === 'SAVE_IN_USE_BY_POKEMON_HUB',
  )
})

test('keeps a durable player session revision and history after release and expiry', async () => {
  let now = 1_000
  const leases = createGameSaveLeaseCoordinator({ persistence: createMemoryRedisPersistence(), now: () => now })
  const identity = { profileId: 'may', gameId: 'emerald' }
  const first = await leases.acquirePlayer({ ...identity, deviceId: 'device-a', sessionId: 'player-a' })
  assert.equal(first.sessionRevision, 1)
  assert.equal(first.startedAt, now)
  const same = await leases.acquirePlayer({ ...identity, deviceId: 'device-a', sessionId: 'player-a' })
  assert.equal(same.sessionRevision, 1)
  assert.equal(same.startedAt, first.startedAt)
  const renewed = await leases.renewPlayer({ ...identity, deviceId: 'device-a', sessionId: 'player-a', generation: first.generation })
  assert.equal(renewed.sessionRevision, 1)
  now += 1_000
  await leases.releasePlayer({ ...identity, deviceId: 'device-a', sessionId: 'player-a', generation: first.generation })
  assert.equal(await leases.getSessionRevision(identity), 1)
  const second = await leases.acquirePlayer({ ...identity, deviceId: 'device-a', sessionId: 'player-b' })
  assert.equal(second.sessionRevision, 2)
  now += 46_000
  const third = await leases.acquirePlayer({ ...identity, deviceId: 'device-b', sessionId: 'player-c' })
  assert.equal(third.sessionRevision, 3)
  assert.deepEqual((await leases.getSessionHistory(identity)).map(entry => [entry.sessionId, entry.sessionRevision, entry.endReason]), [
    ['player-a', 1, 'released'],
    ['player-b', 2, 'expired'],
    ['player-c', 3, null],
  ])
})

test('conditional resume rejects a later session or any active lease without changing history', async () => {
  const leases = createGameSaveLeaseCoordinator({ persistence: createMemoryRedisPersistence(), now: () => 1_000 })
  const identity = { profileId: 'may', gameId: 'ruby' }
  const first = await leases.acquirePlayer({ ...identity, deviceId: 'device-a', sessionId: 'first' })
  await assert.rejects(leases.acquirePlayer({ ...identity, deviceId: 'device-a', sessionId: 'resume', expectedSessionRevision: 1 }), error => error.code === 'SAVE_IN_USE_BY_PLAYER')
  await leases.releasePlayer({ ...identity, deviceId: 'device-a', sessionId: 'first', generation: first.generation })
  const resumed = await leases.acquirePlayer({ ...identity, deviceId: 'device-a', sessionId: 'resume', expectedSessionRevision: 1 })
  assert.equal(resumed.sessionRevision, 2)
  await leases.releasePlayer({ ...identity, deviceId: 'device-a', sessionId: 'resume', generation: resumed.generation })
  await assert.rejects(leases.acquirePlayer({ ...identity, deviceId: 'device-a', sessionId: 'stale', expectedSessionRevision: 1 }), error => error.code === 'PLAYER_SESSION_STALE')
  assert.equal(await leases.getSessionRevision(identity), 2)
  assert.equal((await leases.getSessionHistory(identity)).length, 2)
})

test('an active legacy lease without a session revision gains one when reacquired', async () => {
  const persistence = createMemoryRedisPersistence()
  await persistence.set('game-save-lease:may:emerald', JSON.stringify({ profileId: 'may', gameId: 'emerald', ownerKind: 'player', deviceId: 'device-a', sessionId: 'legacy', generation: 4, expiresAt: 46_000 }))
  const leases = createGameSaveLeaseCoordinator({ persistence, now: () => 1_000 })
  const lease = await leases.acquirePlayer({ profileId: 'may', gameId: 'emerald', deviceId: 'device-a', sessionId: 'legacy', minimumGeneration: 4 })
  assert.equal(lease.sessionRevision, 1)
  assert.equal((await leases.getSessionHistory({ profileId: 'may', gameId: 'emerald' })).length, 1)
})

test('history reports an expired lease before any later acquisition', async () => {
  let now = 1_000
  const identity = { profileId: 'may', gameId: 'sapphire' }
  const leases = createGameSaveLeaseCoordinator({ persistence: createMemoryRedisPersistence(), now: () => now })
  await leases.acquirePlayer({ ...identity, deviceId: 'device-a', sessionId: 'old' })
  now += 46_000
  assert.deepEqual((await leases.getSessionHistory(identity)).map(entry => [entry.endReason, entry.endedAt]), [['expired', 46_000]])
})

test('Pokemon Hub acquisition closes the history of an expired player lease', async () => {
  let now = 1_000
  const persistence = createMemoryRedisPersistence()
  const identity = { profileId: 'may', gameId: 'emerald' }
  const leases = createGameSaveLeaseCoordinator({ persistence, now: () => now })
  await leases.acquirePlayer({ ...identity, deviceId: 'device-a', sessionId: 'old' })
  now = 47_000
  await leases.acquireHub({ ...identity, workspaceId: 'hub-a' })
  assert.deepEqual(await leases.getSessionHistory(identity), [{ sessionId: 'old', sessionRevision: 1, startedAt: 1_000, endedAt: 46_000, endReason: 'expired' }])
  assert.equal(await leases.getSessionRevision(identity), 1)
})
