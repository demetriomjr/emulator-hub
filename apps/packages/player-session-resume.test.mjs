import assert from 'node:assert/strict'
import test from 'node:test'

import { acquireResumeLeases, assertResumeCheckpointCompatible } from './player-session-resume.mjs'

const members = [{ gameId: 'emerald', profileId: 'may', sessionRevision: 2 }, { gameId: 'ruby', profileId: 'brendan', sessionRevision: 5 }]

test('reacquires every saved member in order with its expected revision', async () => {
  const acquired = []
  const result = await acquireResumeLeases({ members, createSessionId: () => `new-${acquired.length}`, acquire: async (member, sessionId) => {
    acquired.push([member.gameId, member.sessionRevision, sessionId])
    return { leaseGeneration: 9, sessionRevision: member.sessionRevision + 1 }
  }, release: async () => {} })
  assert.deepEqual(acquired, [['emerald', 2, 'new-0'], ['ruby', 5, 'new-1']])
  assert.equal(result.length, 2)
})

test('a failed member releases prior leases and never returns a partial wrapper', async () => {
  const released = []
  await assert.rejects(acquireResumeLeases({ members, createSessionId: () => 'new', acquire: async member => {
    if (member.gameId === 'ruby') throw new Error('stale')
    return { leaseGeneration: 3, sessionRevision: 3 }
  }, release: async acquired => released.push(acquired.member.gameId) }), /stale/)
  assert.deepEqual(released, ['emerald'])
})

test('a busy first profile reports no acquired leases so the local offer can be retried', async () => {
  const error = Object.assign(new Error('busy'), { code: 'PLAYER_LEASE_HELD' })
  await assert.rejects(acquireResumeLeases({ members, createSessionId: () => 'new', acquire: async () => { throw error }, release: async () => {} }), cause => cause === error && cause.acquiredCount === 0)
})

test('local runtime state requires the same canonical save revision and launch identity', () => {
  const checkpoint = { gameId: 'emerald', profileId: 'may', saveRevision: 3, core: 'gba', romSha256: 'a'.repeat(64), runtimeId: 'mgba-1', patchSha256: 'b'.repeat(64) }
  const launch = { id: 'emerald', profileId: 'may', core: 'gba', romSha256: 'a'.repeat(64), runtimeId: 'mgba-1', patchSha256: 'b'.repeat(64) }
  assert.equal(assertResumeCheckpointCompatible(checkpoint, launch, 3), true)
  assert.throws(() => assertResumeCheckpointCompatible(checkpoint, launch, 4), /save revision/i)
  assert.throws(() => assertResumeCheckpointCompatible(checkpoint, { ...launch, patchSha256: undefined }, 3), /launch/i)
})
