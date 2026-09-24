import assert from 'node:assert/strict'
import test from 'node:test'
import { deleteEmulatorSnapshot, getEmulatorSnapshot, putEmulatorSnapshot } from '../packages/hub-client.js'
import { createRestoreRequest, resolveRestoreRequest } from '../packages/snapshot-restore-routing.mjs'
import { remoteCandidateSummary, snapshotUrlForKind } from '../packages/restore-candidate.mjs'

test('frontend transport keeps a manual state when cloud recovery is replaced and deleted', async () => {
  const previousFetch = globalThis.fetch
  const slots = new Map()
  globalThis.fetch = async (url, options = {}) => {
    const method = options.method ?? 'GET'
    const current = slots.get(url)
    if (method === 'GET') return current
      ? { status: 200, ok: true, headers: { get: key => key === 'etag' ? `"${current.revision}"` : null }, arrayBuffer: async () => current.bytes.buffer.slice(current.bytes.byteOffset, current.bytes.byteOffset + current.bytes.byteLength) }
      : { status: 404, ok: false }
    if (method === 'PUT') {
      const revision = (current?.revision ?? 0) + 1
      slots.set(url, { revision, bytes: new Uint8Array(options.body) })
      return { status: current ? 200 : 201, ok: true, json: async () => ({ revision, capturedAt: '2026-09-24T12:00:00.000Z' }) }
    }
    if (method === 'DELETE') {
      assert.equal(options.headers['If-Match'], `"${current.revision}"`)
      slots.delete(url)
      return { status: 204, ok: true }
    }
    throw new Error(`Unexpected method ${method}`)
  }
  try {
    const base = '/api/profiles/p/games/g/snapshot'
    const userUrl = snapshotUrlForKind(base, 'user-state')
    const metadata = (kind, reasonCode) => ({ profileId: 'p', gameId: 'g', core: 'gba', romSha256: 'a'.repeat(64), runtimeId: 'emulatorjs-4.2.3', saveRevision: 1, kind, reasonCode })
    const lease = { sessionId: 'session-1', generation: 2 }
    await putEmulatorSnapshot(userUrl, { metadata: metadata('user-state', 'user-request'), state: new Uint8Array([7]) }, null, lease)
    await putEmulatorSnapshot(base, { metadata: metadata('cloud-recovery', 'periodic-recovery'), state: new Uint8Array([9]) }, null, lease)
    const cloud = await getEmulatorSnapshot(base, lease)
    const user = await getEmulatorSnapshot(userUrl, lease)
    assert.deepEqual([...user.state], [7])
    const candidates = [remoteCandidateSummary({ ...user, metadata: { ...user.metadata, capturedAt: '2026-09-24T12:00:00.000Z' } }), remoteCandidateSummary({ ...cloud, metadata: { ...cloud.metadata, capturedAt: '2026-09-24T12:00:00.000Z' } })]
    const request = createRestoreRequest({ requestId: 'choice', kind: 'candidate-list', gameId: 'g', profileId: 'p', sessionId: 'session-1', candidates })
    assert.equal(request.candidates.length, 2)
    assert.equal(request.candidates.some(candidate => 'state' in candidate), false)
    const pending = new Map([['choice', { sessionId: 'session-1', gameId: 'g', profileId: 'p', candidates }]])
    assert.equal(resolveRestoreRequest(pending, { requestId: 'choice', sessionId: 'session-1', gameId: 'g', profileId: 'p', candidateId: 'user:1' }).candidateId, 'user:1')
    assert.equal(await deleteEmulatorSnapshot(base, cloud.revision, lease), true)
    assert.equal(await getEmulatorSnapshot(base, lease), null)
    assert.deepEqual([...(await getEmulatorSnapshot(userUrl, lease)).state], [7])
  } finally { globalThis.fetch = previousFetch }
})
