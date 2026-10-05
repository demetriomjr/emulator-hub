import assert from 'node:assert/strict'
import test from 'node:test'
import { loadDebuggingEnvironment } from './debugging-environment-client.mjs'

test('reads configuration once without cache and defaults off on any unavailable or invalid response', async () => {
  let calls = 0
  const enabled = await loadDebuggingEnvironment({ fetch: async (url, options) => {
    calls++; assert.equal(url, '/api/debug/environment'); assert.equal(options.cache, 'no-store'); assert.ok(options.signal)
    return { ok: true, json: async () => ({ rngDebugLogging: true }) }
  } })
  assert.deepEqual(enabled, { rngDebugLogging: true }); assert.equal(calls, 1)
  for (const fetch of [async () => { throw new Error('offline') }, async () => ({ ok: false }), async () => ({ ok: true, json: async () => ({ rngDebugLogging: 'true' }) })]) assert.deepEqual(await loadDebuggingEnvironment({ fetch }), { rngDebugLogging: false })
})
