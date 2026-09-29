import assert from 'node:assert/strict'
import test from 'node:test'

import { acquirePlayerLease, closePokemonHubSession, getCloudSave, getPokemonHubProfile, getPokemonHubProfiles, getSaveProfileLayout, loadPokemonHubSessionPane, openPokemonHubSession, putCloudSave, releasePlayerLease, reorderPokemonSaveItems, transferPokemonSaveItems, syncPokemonHubSessionSnapshot } from './hub-client.js'

test('posts a direct save item transfer through the loaded Hub session', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return { ok: true, status: 200, json: async () => ({ itemKey: 'potion', quantity: 2 }) } }
  const request = { source: { gameId: 'ruby', profileId: 'may', expectedSaveRevision: 3 }, destination: { gameId: 'sapphire', profileId: 'brendan', expectedSaveRevision: 5 }, area: 'items', fromSlot: 0, quantity: 2 }
  try { assert.deepEqual(await transferPokemonSaveItems('owner', 'session-a', request), { itemKey: 'potion', quantity: 2 }) }
  finally { globalThis.fetch = originalFetch }
  assert.deepEqual(calls, [{ url: '/api/profiles/owner/pokemon-hub/sessions/session-a/items/transfer', options: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) } }])
})

test('posts a session-scoped item reorder with its save revision', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return { ok: true, status: 200, json: async () => ({ changed: true, itemInventory: { status: 'ready', saveRevision: 8 } }) } }
  try {
    assert.deepEqual(await reorderPokemonSaveItems('owner', 'session-a', { gameId: 'emerald', sourceProfileId: 'may', area: 'items', fromSlot: 0, toSlot: 2, expectedSaveRevision: 7 }), { changed: true, itemInventory: { status: 'ready', saveRevision: 8 } })
  } finally { globalThis.fetch = originalFetch }
  assert.deepEqual(calls, [{ url: '/api/profiles/owner/pokemon-hub/sessions/session-a/items/reorder', options: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gameId: 'emerald', sourceProfileId: 'may', area: 'items', fromSlot: 0, toSlot: 2, expectedSaveRevision: 7 }) } }])
})

test('passes a pane-load deadline through each request that opens or loads a source', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (_url, options = {}) => {
    calls.push(options.signal)
    return { ok: true, status: 200, json: async () => ({ layout: {}, party: [], boxes: [], pokemonDetailsById: {} }) }
  }
  const signal = AbortSignal.timeout(300_000)
  try {
    await openPokemonHubSession('owner', signal)
    await getSaveProfileLayout('emerald', 'may', 'owner', signal)
    await loadPokemonHubSessionPane('owner', 'session', 0, { kind: 'game', gameId: 'emerald', profileId: 'may' }, signal)
  } finally { globalThis.fetch = originalFetch }
  assert.deepEqual(calls, [signal, signal, signal])
})

test('loads Hub profile names separately from the selected grid and card details', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  const detail = { pokemonInstanceId: 'one', availability: 'ready' }
  globalThis.fetch = async url => {
    calls.push(url)
    return { ok: true, json: async () => url === '/api/pokemon-hub/profiles'
      ? { profiles: [{ hubProfileId: 'hub-a', name: 'Box' }] }
      : url === '/api/pokemon-hub/profiles/hub-a'
        ? { profile: { hubProfileId: 'hub-a', name: 'Box', grid: { entries: {} } }, pokemonDetailsById: { one: detail } }
        : { layout: {}, party: [], boxes: [], pokemonDetailsById: { one: detail } } }
  }
  try {
    assert.deepEqual((await getPokemonHubProfiles()).profiles, [{ hubProfileId: 'hub-a', name: 'Box' }])
    assert.deepEqual((await getPokemonHubProfile('hub-a')).pokemonDetailsById.one, detail)
    assert.deepEqual((await getSaveProfileLayout('emerald', 'may')).pokemonDetailsById.one, detail)
  } finally { globalThis.fetch = originalFetch }
  assert.deepEqual(calls, ['/api/pokemon-hub/profiles', '/api/pokemon-hub/profiles/hub-a', '/api/pokemon-hub/save-profiles/emerald/may/layout'])
})

test('passes the complete item inventory through the save layout request', async () => {
  const originalFetch = globalThis.fetch
  const itemInventory = {
    status: 'ready', saveRevision: 4, title: 'pokemon-emerald',
    areas: { items: { capacity: 30, maxPerStack: 99, freeSlots: 29, slots: [{ index: 0, nativeId: 13, itemKey: 'potion', quantity: 7 }], issues: [] } },
  }
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ layout: {}, party: [], boxes: [], pokemonDetailsById: {}, itemInventory }),
  })
  try {
    assert.deepEqual((await getSaveProfileLayout('emerald', 'may')).itemInventory, itemInventory)
  } finally { globalThis.fetch = originalFetch }
})

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
