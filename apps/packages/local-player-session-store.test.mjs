import assert from 'node:assert/strict'
import test from 'node:test'

import { buildCompletePlayerSessionBundle, createLocalPlayerSessionStore, createMemoryPlayerSessionStorage } from './local-player-session-store.mjs'

function bundle(capturedAt = 1_000) {
  return {
    version: 1, bundleId: 'bundle-a', capturedAt, expiresAt: capturedAt + 30 * 60_000,
    settings: { fastForwardEnabled: true, fastForwardSpeed: 5, muted: false, oddsManipulatorEnabled: true, focusedSessionId: 'a', triggerActions: { l2: 'save-state', r2: 'soft-reset' } },
    members: [
      { sessionId: 'a', gameId: 'emerald', profileId: 'may', sessionRevision: 3, saveRevision: 2, core: 'gba', romSha256: 'a'.repeat(64), runtimeId: 'runtime', capturedAt, oddsResetCount: 10, state: new Uint8Array([1, 2]) },
      { sessionId: 'b', gameId: 'ruby', profileId: 'brendan', sessionRevision: 6, saveRevision: 1, core: 'gba', romSha256: 'b'.repeat(64), runtimeId: 'runtime', capturedAt, oddsResetCount: 4, state: new Uint8Array([3, 4]) },
    ],
  }
}

test('stores one complete private wrapper bundle and expires it after 30 minutes', async () => {
  let now = 1_000
  const store = createLocalPlayerSessionStore({ storage: createMemoryPlayerSessionStorage(), now: () => now })
  await store.put(bundle())
  const loaded = await store.get('bundle-a')
  assert.deepEqual(loaded.members.map(member => [...member.state]), [[1, 2], [3, 4]])
  loaded.members[0].state[0] = 9
  assert.equal((await store.get('bundle-a')).members[0].state[0], 1)
  now = 1_000 + 30 * 60_000
  assert.equal(await store.get('bundle-a'), null)
})

test('keeps independent wrapper sessions by bundle ID and clears only the chosen one', async () => {
  const store = createLocalPlayerSessionStore({ storage: createMemoryPlayerSessionStorage(), now: () => 2_000 })
  await store.put(bundle(1_000))
  const second = { ...bundle(2_000), bundleId: 'bundle-b', members: bundle(2_000).members.map(member => ({ ...member, sessionId: `${member.sessionId}-b` })), settings: { ...bundle(2_000).settings, focusedSessionId: 'a-b' } }
  await store.put(second)
  assert.deepEqual((await store.list()).map(item => item.bundleId), ['bundle-b', 'bundle-a'])
  assert.equal((await store.get('bundle-a')).members[0].sessionId, 'a')
  assert.equal((await store.get('bundle-b')).members[0].sessionId, 'a-b')
  await store.clear('bundle-a')
  assert.equal(await store.get('bundle-a'), null)
  assert.equal((await store.get('bundle-b')).members[0].sessionId, 'a-b')
})

test('expiration prunes one wrapper without deleting another tab checkpoint', async () => {
  let now = 2_000
  const store = createLocalPlayerSessionStore({ storage: createMemoryPlayerSessionStorage(), now: () => now })
  await store.put(bundle(1_000))
  await store.put({ ...bundle(2_000), bundleId: 'bundle-b' })
  now = 1_801_000
  assert.deepEqual((await store.list()).map(item => item.bundleId), ['bundle-b'])
  assert.equal(await store.get('bundle-a'), null)
  assert.ok(await store.get('bundle-b'))
})

test('normal-close cleanup waits for an in-flight checkpoint write', async () => {
  const storage = createMemoryPlayerSessionStorage()
  const originalPut = storage.put
  let releaseWrite
  storage.put = async (key, value) => {
    await new Promise(resolve => { releaseWrite = resolve })
    return originalPut(key, value)
  }
  const store = createLocalPlayerSessionStore({ storage, now: () => 1_000 })
  const write = store.put(bundle())
  const cleanup = store.clear('bundle-a')
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(await storage.get('bundle-a'), null)
  releaseWrite()
  await Promise.all([write, cleanup])
  assert.equal(await store.get('bundle-a'), null)
})

test('unavailable IndexedDB disables private resume without blocking the Hub', async () => {
  const store = createLocalPlayerSessionStore({ indexedDb: null })
  assert.equal(await store.get('bundle-a'), null)
  assert.deepEqual(await store.list(), [])
  await assert.rejects(store.put(bundle()), /IndexedDB is unavailable/i)
  await store.clear('bundle-a')
})

test('refuses partial or incompatible bundles without replacing the last complete one', async () => {
  const store = createLocalPlayerSessionStore({ storage: createMemoryPlayerSessionStorage(), now: () => 1_000 })
  await store.put(bundle())
  await assert.rejects(store.put({ ...bundle(2_000), members: [{ ...bundle(2_000).members[0], state: null }] }), /state/i)
  await assert.rejects(store.put({ ...bundle(2_000), members: [bundle(2_000).members[0], bundle(2_000).members[0]] }), /duplicate/i)
  await assert.rejects(store.put({ ...bundle(2_000), version: 2 }), /version/i)
  await assert.rejects(store.put({ ...bundle(2_000), expiresAt: 2_000 + 60 * 60_000 }), /expiry/i)
  await assert.rejects(store.put({ ...bundle(2_000), settings: { ...bundle(2_000).settings, triggerActions: { l2: 'unknown', r2: 'none' } } }), /settings/i)
  await assert.rejects(store.put({ ...bundle(2_000), settings: { ...bundle(2_000).settings, focusedSessionId: 'missing' } }), /focus/i)
  assert.equal((await store.get('bundle-a')).capturedAt, 1_000)
  await store.clear('bundle-a')
  assert.equal(await store.get('bundle-a'), null)
})

test('publishes only when every current wrapper member has a fresh matching capture', () => {
  const sessions = bundle().members.map(({ state, capturedAt, saveRevision, core, romSha256, runtimeId, ...session }) => session)
  const captures = new Map(bundle().members.map(member => [member.sessionId, member]))
  const complete = buildCompletePlayerSessionBundle({ bundleId: 'bundle-a', sessions, captures, settings: bundle().settings, now: 1_000 })
  assert.equal(complete.members.length, 2)
  assert.equal(buildCompletePlayerSessionBundle({ bundleId: 'bundle-a', sessions, captures: new Map([['a', captures.get('a')]]), settings: bundle().settings, now: 1_000 }), null)
  assert.equal(buildCompletePlayerSessionBundle({ bundleId: 'bundle-a', sessions, captures, settings: bundle().settings, now: 22_000 }), null)
  assert.equal(buildCompletePlayerSessionBundle({ bundleId: 'bundle-a', sessions: [{ ...sessions[0], sessionRevision: 4 }, sessions[1]], captures, settings: bundle().settings, now: 1_000 }), null)
})
