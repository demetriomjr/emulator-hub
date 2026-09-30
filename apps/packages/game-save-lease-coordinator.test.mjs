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

test('checks the active Hub workspace before an item save write', async () => {
  let now = 1_000
  const leases = createGameSaveLeaseCoordinator({ persistence: createMemoryRedisPersistence(), now: () => now })
  await leases.acquireHub({ profileId: 'may', gameId: 'ruby', workspaceId: 'hub-a' })
  await leases.assertHub({ profileId: 'may', gameId: 'ruby', workspaceId: 'hub-a' })
  await assert.rejects(leases.assertHub({ profileId: 'may', gameId: 'ruby', workspaceId: 'hub-b' }), { code: 'HUB_LEASE_INVALID' })
  now += 10_000
  await assert.rejects(leases.assertHub({ profileId: 'may', gameId: 'ruby', workspaceId: 'hub-a' }), { code: 'HUB_LEASE_INVALID' })
})

test('an expired Hub lease remains fenced from the player until its pending save is finalized', async () => {
 let instant=1000
 const leases=createGameSaveLeaseCoordinator({persistence:createMemoryRedisPersistence(),now:()=>instant,hubLeaseDurationMs:9})
 const hub={profileId:'may',gameId:'emerald',workspaceId:'pending-session'}
 await leases.acquireHub(hub)
 instant=1010
 assert.equal((await leases.get(hub)).ownerKind,'pokemon-hub')
 await assert.rejects(leases.acquirePlayer({profileId:'may',gameId:'emerald',deviceId:'browser',sessionId:'player'}),{code:'SAVE_IN_USE_BY_POKEMON_HUB'})
 await leases.releaseHub(hub)
 assert.equal((await leases.acquirePlayer({profileId:'may',gameId:'emerald',deviceId:'browser',sessionId:'player'})).ownerKind,'player')
})

test('checking a native write does not shorten a reservation extended for a pending operation', async () => {
 let instant=1000
 const leases=createGameSaveLeaseCoordinator({persistence:createMemoryRedisPersistence(),now:()=>instant,hubLeaseDurationMs:9})
 const identity={profileId:'may',gameId:'emerald',workspaceId:'operation'}
 await leases.acquireHub(identity)
 await leases.renewHub({...identity,minimumExpiresAt:2000})
 instant=1001
 await leases.assertHub(identity)
 assert.equal((await leases.get(identity)).expiresAt,2000)
 await leases.acquireHub(identity)
 assert.equal((await leases.get(identity)).expiresAt,2000)
})
