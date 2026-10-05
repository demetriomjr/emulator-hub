import assert from 'node:assert/strict'
import test from 'node:test'

let api = {}
try { api = await import('./frontend-events.mjs') } catch {}
const event = { sessionId: 'session', source: 'player', kind: 'rng-reset', message: 'hunt.rng-reset', rngValue: 0xffffffff, seed: 123, samples: [{ frame: 4, rngValue: 123 }], status: 'observed' }

test('frontend event contract exists', () => assert.equal(typeof api.normalizeFrontendEvent, 'function'))
test('asset events preserve download and effective ROM identity without carrying raw bytes', () => {
  const result = api.normalizeFrontendEvent({ sessionId: 'hub-assets', source: 'hub', kind: 'game-asset', phase: 'rom-prepared',
    assetSource: 'disk', assetSha256: 'a'.repeat(64), effectiveRomSha256: 'b'.repeat(64), assetBytes: 16, patchApplied: true, bytes: [1,2] })
  assert.equal(result.kind, 'game-asset')
  assert.equal(result.assetSource, 'disk')
  assert.equal(result.effectiveRomSha256, 'b'.repeat(64))
  assert.equal(result.assetBytes, 16)
  assert.equal('bytes' in result, false)
})
test('normalizes RNG uint32 and preserves real server timestamp separately from virtual time', () => {
  const result = api.normalizeFrontendEvent({ ...event, virtualTimestamp: 60000 }, () => '2026-10-03T15:00:00.000Z')
  assert.equal(result.receivedAt, '2026-10-03T15:00:00.000Z')
  assert.equal(result.rngValue, 0xffffffff)
  assert.equal(result.seed, 123)
  assert.equal(result.virtualTimestamp, 60000)
  assert.deepEqual(result.samples, [{ frame: 4, rngValue: 123 }])
})
test('removes raw state, saves, tokens and unregistered fields before stdout', () => {
  const result = api.normalizeFrontendEvent({ ...event, state: [1, 2], save: 'secret', leaseToken: 'secret', arbitrary: true })
  for (const key of ['state', 'save', 'leaseToken', 'arbitrary']) assert.equal(key in result, false)
})
test('requires explicit null seed when initial seed could not be observed', () => {
  const result = api.normalizeFrontendEvent({ ...event, seed: null, status: 'missed-window' })
  assert.equal(result.seed, null)
})
test('rejects invalid identities, uint32, samples and oversized fields', () => {
  for (const change of [{ sessionId: '../bad' }, { source: 'backend' }, { rngValue: -1 }, { rngValue: 2 ** 32 }, { seed: 65536 }, { samples: Array(17).fill({ frame: 1, rngValue: 1 }) }, { message: 'x'.repeat(513) }]) {
    assert.throws(() => api.normalizeFrontendEvent({ ...event, ...change }))
  }
})
test('HTTP route rejects method, content type, cross origin, oversized body and malformed JSON', () => {
  const request = { method: 'POST', contentType: 'application/json', host: 'hub.test:8444', origin: 'https://hub.test:8444', body: JSON.stringify(event) }
  assert.equal(api.handleFrontendEventRequest(request).status, 204)
  for (const [change, status] of [[{ method: 'GET' }, 405], [{ contentType: 'text/plain' }, 415], [{ origin: 'https://other.test' }, 403], [{ body: 'x'.repeat(16385) }, 413], [{ body: '{' }, 400]]) {
    const result = api.handleFrontendEventRequest({ ...request, ...change })
    assert.equal(result.status, status)
    assert.equal(result.json, null)
  }
})
test('stdout record is one JSON line even with attempted log injection', () => {
  const result = api.handleFrontendEventRequest({ method: 'POST', contentType: 'application/json', host: 'hub.test', body: JSON.stringify({ ...event, message: 'line\n{"forged":true}' }) })
  assert.equal(result.json.includes('\n'), false)
  assert.equal(JSON.parse(result.json).message, 'line\n{"forged":true}')
})
test('snapshot HTTP status remains numeric while RNG capture status remains explicit', () => {
  const snapshot = api.normalizeFrontendEvent({ sessionId: 's', source: 'player', kind: 'snapshot-flow', message: 'restore-load-failed', status: 409 })
  assert.equal(snapshot.status, 409)
  assert.equal(api.normalizeFrontendEvent(event).status, 'observed')
})
