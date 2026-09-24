import assert from 'node:assert/strict'
import test from 'node:test'
import { deleteEmulatorSnapshot } from '../packages/hub-client.js'
import { createLocalRuntimeRecoveryStore, createMemoryRecoveryStorage } from '../packages/local-runtime-recovery-store.mjs'
import { createSnapshotDeleteWatchdog, restorePromptAfterDeleteTimeout } from '../packages/snapshot-restore-routing.mjs'

test('frontend deletion sends the displayed revision and lease, then restores choices when the iframe is silent', async () => {
  const previousFetch = globalThis.fetch
  const requests = []
  const timers = new Map()
  let nextTimer = 0
  let prompts = { sessionA: { requestId: 'restore-1', candidateId: 'remote:7', kind: 'cloud-recovery', deleting: true, deleteRequestId: 'delete-1' } }
  globalThis.fetch = async (url, options) => { requests.push({ url, options }); return { status: 204, ok: true } }
  try {
    const watchdog = createSnapshotDeleteWatchdog({
      schedule(callback) { const id = ++nextTimer; timers.set(id, callback); return id },
      cancel(id) { timers.delete(id) },
      onTimeout: pending => { prompts = restorePromptAfterDeleteTimeout(prompts, pending) },
    })
    const identity = { sessionId: 'sessionA', requestId: 'delete-1', restoreRequestId: 'restore-1', candidateId: 'remote:7', kind: 'cloud-recovery' }
    assert.equal(watchdog.begin(identity), true)
    assert.equal(await deleteEmulatorSnapshot('/snapshot', 7, { sessionId: 'sessionA', generation: 3 }), true)
    assert.deepEqual(requests.map(({ url, options }) => ({ url, method: options.method, ifMatch: options.headers['If-Match'], session: options.headers['X-Player-Session-Id'], generation: options.headers['X-Player-Lease-Generation'] })), [
      { url: '/snapshot', method: 'DELETE', ifMatch: '"7"', session: 'sessionA', generation: '3' },
    ])
    timers.get(1)()
    assert.equal(prompts.sessionA.deleting, false)
    assert.equal(prompts.sessionA.candidateId, 'remote:7')
    assert.equal(watchdog.settle(identity), null)
  } finally { globalThis.fetch = previousFetch }
})

test('frontend remote deletion propagates a revision conflict for the prompt to keep the candidate', async () => {
  const previousFetch = globalThis.fetch
  globalThis.fetch = async () => ({ status: 412, ok: false, json: async () => ({ code: 'SNAPSHOT_REVISION_CONFLICT', error: 'Snapshot revision changed.' }) })
  try {
    await assert.rejects(() => deleteEmulatorSnapshot('/snapshot', 7, { sessionId: 'sessionA', generation: 3 }), { status: 412, code: 'SNAPSHOT_REVISION_CONFLICT' })
  } finally { globalThis.fetch = previousFetch }
})

test('frontend local deletion leaves a candidate written after the prompt opened', async () => {
  const store = createLocalRuntimeRecoveryStore({ storage: createMemoryRecoveryStorage() })
  const bundle = state => ({ profileId: 'may', gameId: 'emerald', core: 'gba', romSha256: 'a'.repeat(64), runtimeId: 'emulatorjs-4.2.3', state: new Uint8Array(state) })
  await store.put(bundle([1]))
  const offered = await store.get('may', 'emerald')
  await store.put(bundle([2]))
  assert.equal(await store.deleteIfMatches('may', 'emerald', offered.candidateId), false)
  const current = await store.get('may', 'emerald')
  assert.deepEqual([...current.state], [2])
  assert.notEqual(current.candidateId, offered.candidateId)
})
