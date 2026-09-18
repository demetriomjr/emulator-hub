import assert from 'node:assert/strict'
import test from 'node:test'

import { acquirePokemonHubSnapshot, closePokemonHubSession, releasePokemonHubSnapshot, renewPokemonHubSnapshot, syncPokemonHubSessionSnapshot, syncPokemonHubSnapshot, transferPokemonHub } from './hub-client.js'

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
