import assert from 'node:assert/strict'
import test from 'node:test'

import { createMemoryRedisPersistence } from './redis-persistence.mjs'
import { createPlayerLeaseCoordinator } from './player-lease-coordinator.mjs'

function createCoordinator(now = () => 1_000) {
  return createPlayerLeaseCoordinator({ persistence: createMemoryRedisPersistence(), now, leaseDurationMs: 45_000 })
}

test('rejects another device while a profile game lease is alive', async () => {
  const coordinator = createCoordinator()
  await coordinator.acquire({ profileId: 'may', gameId: 'emerald', deviceId: 'iphone', sessionId: 'session-a' })

  await assert.rejects(
    () => coordinator.acquire({ profileId: 'may', gameId: 'emerald', deviceId: 'desktop', sessionId: 'session-b' }),
    error => error.code === 'PLAYER_LEASE_HELD',
  )
})

test('same device replaces the session and fences the old owner', async () => {
  const coordinator = createCoordinator()
  const first = await coordinator.acquire({ profileId: 'may', gameId: 'emerald', deviceId: 'iphone', sessionId: 'session-a' })
  const second = await coordinator.acquire({ profileId: 'may', gameId: 'emerald', deviceId: 'iphone', sessionId: 'session-b' })

  assert.equal(second.generation, first.generation + 1)
  await assert.rejects(
    () => coordinator.renew({ profileId: 'may', gameId: 'emerald', deviceId: 'iphone', sessionId: 'session-a', generation: first.generation }),
    error => error.code === 'PLAYER_LEASE_INVALID',
  )
  assert.equal((await coordinator.assertWrite({ profileId: 'may', gameId: 'emerald', deviceId: 'iphone', sessionId: 'session-b', generation: second.generation })).generation, second.generation)
})

test('allows a different device to acquire only after expiry', async () => {
  let time = 1_000
  const coordinator = createCoordinator(() => time)
  await coordinator.acquire({ profileId: 'may', gameId: 'emerald', deviceId: 'iphone', sessionId: 'session-a' })
  time += 45_001

  const recovered = await coordinator.acquire({ profileId: 'may', gameId: 'emerald', deviceId: 'desktop', sessionId: 'session-b' })
  assert.equal(recovered.generation, 2)
})

test('never lets an expired heartbeat revive its former lease', async () => {
  let time = 1_000
  const coordinator = createCoordinator(() => time)
  const first = await coordinator.acquire({ profileId: 'may', gameId: 'emerald', deviceId: 'iphone', sessionId: 'session-a' })
  time += 45_001

  await assert.rejects(
    () => coordinator.renew({ profileId: 'may', gameId: 'emerald', deviceId: 'iphone', sessionId: 'session-a', generation: first.generation }),
    error => error.code === 'PLAYER_LEASE_INVALID',
  )
})
