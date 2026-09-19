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
