import assert from 'node:assert/strict'
import test from 'node:test'
let api = {}
try { api = await import('./frontend-event-transport.mjs') } catch {}
const tick = () => new Promise(resolve => setImmediate(resolve))
test('event transport exists', () => assert.equal(typeof api.createFrontendEventTransport, 'function'))
test('serializes network delivery and never sends frontend logs to backend', async () => {
  const calls = []
  let finish
  const transport = api.createFrontendEventTransport({ fetch: (url, options) => { calls.push({ url, options }); return new Promise(resolve => { finish = resolve }) } })
  transport.send({ kind: 'rng-reset' }); transport.send({ kind: 'rng-reset' })
  await tick()
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, '/_frontend/events')
  finish({ ok: true }); await tick()
  assert.equal(calls.length, 2)
  finish({ ok: true }); await tick()
  transport.dispose()
})
test('bounded queue reports dropped events on next successful attempt', async () => {
  const calls = []; let finish
  const transport = api.createFrontendEventTransport({ capacity: 2, fetch: async (_url, options) => { calls.push(JSON.parse(options.body)); return new Promise(resolve => { finish = resolve }) } })
  for (let i = 0; i < 6; i++) transport.send({ eventId: String(i) })
  await tick(); finish({ ok: true }); await tick()
  assert.equal(calls[1].droppedEvents, 3)
  finish({ ok: true }); await tick(); finish({ ok: true }); await tick()
  transport.dispose()
})
test('offline and rejected HTTP are swallowed without retries or console recursion', async () => {
  let calls = 0
  const transport = api.createFrontendEventTransport({ fetch: async () => { calls++; if (calls === 1) throw new Error('offline'); return { ok: false } } })
  transport.send({}); transport.send({}); await tick(); await tick()
  assert.equal(calls, 2)
  assert.equal(transport.stats().droppedEvents, 2)
  transport.dispose()
})
test('timeout aborts stalled delivery and continues the queue', async () => {
  let calls = 0
  const transport = api.createFrontendEventTransport({ timeoutMs: 10, fetch: () => { calls++; return new Promise(() => {}) } })
  transport.send({}); transport.send({})
  const deadline = Date.now() + 1000
  while (transport.stats().droppedEvents < 2 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(calls, 2)
  assert.equal(transport.stats().droppedEvents, 2)
  transport.dispose()
})
