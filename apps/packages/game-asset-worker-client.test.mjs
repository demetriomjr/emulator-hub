import assert from 'node:assert/strict'
import test from 'node:test'
const module = await import('./game-asset-worker-client.mjs').catch(() => ({}))
test('worker failure and timeout fall back once for all pending users', async () => {
  assert.equal(typeof module.createGameAssetWorkerClient, 'function', 'Asset worker client must exist')
  const listeners = {}, sent = [], calls = []
  const worker = { addEventListener: (name, fn) => { listeners[name] = fn }, postMessage: m => sent.push(m), terminate() {} }
  const fallback = { async prepare(value) { calls.push(value); return { bytes: new Uint8Array([1]) } }, async prefetch() {} }
  const client = module.createGameAssetWorkerClient({ worker, fallback, timeoutMs: 10 })
  const first = client.prepare({ romSha256: 'a' })
  listeners.error({ preventDefault() {} })
  assert.deepEqual((await first).bytes, new Uint8Array([1]))
  await client.prepare({ romSha256: 'b' })
  assert.equal(sent.length, 1)
  assert.equal(calls.length, 2)
  client.dispose()
})
test('worker application error is surfaced rather than retried as a bridge failure', async () => {
  assert.equal(typeof module.createGameAssetWorkerClient, 'function')
  const listeners = {}, sent = []
  const worker = { addEventListener: (name, fn) => { listeners[name] = fn }, postMessage: m => sent.push(m), terminate() {} }
  const client = module.createGameAssetWorkerClient({ worker, fallback: { prepare() { throw new Error('must not retry') } } })
  const pending = client.prepare({})
  listeners.message({ data: { requestId: sent[0].requestId, ok: false, error: 'ROM hash mismatch' } })
  await assert.rejects(pending, /ROM hash mismatch/)
  client.dispose()
})
