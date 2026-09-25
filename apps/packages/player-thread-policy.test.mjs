import assert from 'node:assert/strict'
import test from 'node:test'
import { playerThreadFallbackUrl, selectPlayerThreadMode } from './player-thread-policy.mjs'

test('comparison defaults to the ordinary core even for an isolated GBA player', () => {
  const compatible = { core: 'gba', protocol: 'https:', crossOriginIsolated: true, sharedArrayBufferAvailable: true }
  assert.deepEqual(selectPlayerThreadMode(compatible), { enabled: false, reason: 'ordinary-core-comparison' })
  assert.deepEqual(selectPlayerThreadMode({ ...compatible, mode: 'threaded' }), { enabled: true, reason: 'isolated-mgba' })
  assert.equal(selectPlayerThreadMode({ ...compatible, crossOriginIsolated: false }).enabled, false)
  assert.equal(selectPlayerThreadMode({ ...compatible, sharedArrayBufferAvailable: false }).enabled, false)
  assert.equal(selectPlayerThreadMode({ ...compatible, core: 'nes' }).enabled, false)
  assert.equal(selectPlayerThreadMode({ ...compatible, protocol: 'file:' }).enabled, false)
  assert.deepEqual(selectPlayerThreadMode({ ...compatible, mode: 'threaded', retryWithoutThreads: true }), { enabled: false, reason: 'startup-fallback' })
})

test('thread failure can reload the same player URL only once', () => {
  const original = 'https://hub.example/player.html?id=game&profileId=profile&sessionId=session'
  const fallback = playerThreadFallbackUrl(original)
  const parsed = new URL(fallback)
  assert.equal(parsed.searchParams.get('threadFallback'), '1')
  assert.equal(parsed.searchParams.get('sessionId'), 'session')
  assert.equal(playerThreadFallbackUrl(fallback), null)
})
