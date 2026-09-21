import assert from 'node:assert/strict'
import test from 'node:test'

import { acquirePlayerLease, acquirePokemonHubSnapshot, closePokemonHubSession, getCloudSave, putCloudSave, releasePlayerLease, releasePokemonHubSnapshot, renewPokemonHubSnapshot, syncPokemonHubSessionSnapshot, syncPokemonHubSnapshot, transferPokemonHub } from './hub-client.js'

test('sends player lease identity for acquire, save, and release', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  const saveEvents = []
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options })
    if (options.method === 'PUT') return { ok: true, status: 201, json: async () => ({ revision: 1 }) }
    return { ok: true, json: async () => ({ leaseGeneration: 3 }) }
  }
  try {
    await acquirePlayerLease('emerald', 'may', 'session-a')
    await putCloudSave('/api/save', new Uint8Array([1]), null, { sessionId: 'session-a', generation: 3 }, 'trace-save-1', (event, context) => saveEvents.push({ event, context }))
    await releasePlayerLease('session-a', { profileId: 'may', gameId: 'emerald', generation: 3 })
  } finally { globalThis.fetch = originalFetch }
  assert.deepEqual(calls.map(call => call.url), ['/api/games/emerald/player-leases', '/api/save', '/api/player-leases/session-a'])
  assert.equal(calls[1].options.headers['X-Player-Session-Id'], 'session-a')
  assert.equal(calls[1].options.headers['X-Player-Lease-Generation'], '3')
  assert.equal(calls[1].options.headers['X-Save-Trace-Id'], 'trace-save-1')
  assert.deepEqual(saveEvents, [{ event: 'save.front.put-response', context: { traceId: 'trace-save-1', status: 201, ok: true, revision: 1 } }])
  assert.equal(calls[2].options.method, 'DELETE')
})

test('reports the HTTP rejection status and backend code for a failed save PUT', async () => {
  const originalFetch = globalThis.fetch
  const events = []
  globalThis.fetch = async () => ({ ok: false, status: 412, json: async () => ({ error: 'Save revision conflict.', code: 'SAVE_REVISION_CONFLICT' }) })
  try {
    await assert.rejects(() => putCloudSave('/api/save', new Uint8Array([1]), 2, null, 'trace-conflict', (event, context) => events.push({ event, context })), {
      code: 'SAVE_REVISION_CONFLICT', status: 412,
    })
  } finally { globalThis.fetch = originalFetch }
  assert.deepEqual(events, [{ event: 'save.front.put-response', context: { traceId: 'trace-conflict', status: 412, ok: false, code: 'SAVE_REVISION_CONFLICT' } }])
})

test('correlates a battery-save GET and reports the returned revision and size', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  const events = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return {
      ok: true,
      status: 200,
      headers: new Headers({ etag: '"7"' }),
      arrayBuffer: async () => new Uint8Array([4, 5, 6]).buffer,
    }
  }
  try {
    const loaded = await getCloudSave('/api/save', { sessionId: 'session-a', generation: 3 }, 'trace-load-1', (event, context) => events.push({ event, context }))
    assert.deepEqual([...loaded.bytes], [4, 5, 6])
    assert.equal(loaded.revision, 7)
  } finally { globalThis.fetch = originalFetch }
  assert.equal(calls[0].options.headers['X-Save-Trace-Id'], 'trace-load-1')
  assert.deepEqual(events, [{ event: 'save.front.get-response', context: { traceId: 'trace-load-1', status: 200, ok: true, found: true, sizeBytes: 3, revision: 7 } }])
})

test('sends the Pokemon Hub snapshot lifecycle to its profile-scoped routes', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return { ok: true, json: async () => ({ ok: true }) }
  }
  try {
    await acquirePokemonHubSnapshot('profile-may', { sourceKey: 'save:profile-may:emerald', workspaceId: 'workspace-a' })
    await renewPokemonHubSnapshot('profile-may', { sourceKey: 'save:profile-may:emerald', workspaceId: 'workspace-a', sourceSessionId: 'session-a', leaseToken: 'token-a' })
    await syncPokemonHubSnapshot('profile-may', { workspaceId: 'workspace-a', clientSequence: 1, idempotencyKey: 'sync-1', sources: [] })
    await releasePokemonHubSnapshot('profile-may', { sourceKey: 'save:profile-may:emerald', workspaceId: 'workspace-a', sourceSessionId: 'session-a', leaseToken: 'token-a' })
  } finally { globalThis.fetch = originalFetch }

  assert.deepEqual(calls.map(call => call.url), [
    '/api/profiles/profile-may/pokemon-hub/snapshots/acquire',
    '/api/profiles/profile-may/pokemon-hub/snapshots/renew',
    '/api/profiles/profile-may/pokemon-hub/snapshots/sync',
    '/api/profiles/profile-may/pokemon-hub/snapshots/release',
  ])
  assert.ok(calls.every(call => call.options.method === 'POST' && call.options.headers['Content-Type'] === 'application/json'))
})

test('preserves a structured backend error code for a persistent grid transfer', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({ ok: false, status: 409, json: async () => ({ error: 'Destination is occupied.', code: 'POKEMON_HUB_DESTINATION_OCCUPIED' }) })
  try {
    await assert.rejects(() => transferPokemonHub('profile-may', { workspaceId: 'workspace-a' }), { code: 'POKEMON_HUB_DESTINATION_OCCUPIED' })
  } finally { globalThis.fetch = originalFetch }
})

test('sends a canonical session snapshot with an idempotency key and treats an empty 200 as acceptance', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return { ok: true, status: 200, text: async () => '' }
  }
  const snapshot = { revision: 2, panes: [null, null, null] }
  try {
    assert.equal(await syncPokemonHubSessionSnapshot('profile-may', 'session-a', snapshot, 'snapshot-3'), null)
  } finally { globalThis.fetch = originalFetch }

  assert.deepEqual(calls, [{
    url: '/api/profiles/profile-may/pokemon-hub/sessions/session-a/snapshots',
    options: { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'snapshot-3' }, body: JSON.stringify(snapshot) },
  }])
})

test('returns the raw canonical correction only for a rejected session snapshot', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({ ok: false, status: 409, json: async () => ({ revision: 4, panes: [null, null, null] }) })
  try {
    assert.deepEqual(await syncPokemonHubSessionSnapshot('profile-may', 'session-a', { revision: 3, panes: [null, null, null] }, 'snapshot-4'), { revision: 4, panes: [null, null, null] })
  } finally { globalThis.fetch = originalFetch }
})

test('closes a Pokemon Hub session with the latest complete snapshot', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return { ok: true, status: 200, text: async () => '' } }
  const snapshot = { revision: 5, panes: [null, null, null] }
  try {
    assert.equal(await closePokemonHubSession('profile-may', 'session-a', snapshot, 'close-5'), null)
  } finally { globalThis.fetch = originalFetch }

  assert.deepEqual(calls, [{
    url: '/api/profiles/profile-may/pokemon-hub/sessions/session-a/close',
    options: { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'close-5' }, body: JSON.stringify(snapshot) },
  }])
})
