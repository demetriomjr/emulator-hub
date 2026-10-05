import assert from 'node:assert/strict'
import test from 'node:test'
let api = {}
try { api = await import('./rng-reset-observer.mjs') } catch {}
const descriptor = { core: 'gba', runtimeId: 'emulatorjs-4.2.3', romSha256: 'a9dec84dfe7f62ab2220bafaef7479da0929d066ece16a6885f6226db19085af' }
function harness(options = {}) {
  let frame = 400; let rng = 0x12345678; const events = []; let callbacks = 0
  const module = { postMainLoop: () => callbacks++ }
  const original = module.postMainLoop
  const manager = { Module: module, getFrameNum: () => frame, getState: () => {
    const state = new Uint8Array(0x61010)
    state.set(new TextEncoder().encode('RASTATE\x01'))
    new DataView(state.buffer).setUint32(0x10, 0x01000007, true)
    state.set(new TextEncoder().encode('BPEE'), 0x2c)
    new DataView(state.buffer).setUint32(0x1ed90, rng, true)
    return state
  } }
  const observer = api.createRngResetObserver({ getManager: () => manager, getDescriptor: () => descriptor, emit: event => events.push(event), ...options })
  return { observer, manager, module, original, events, callbacks: () => callbacks, step(value, gap = 1) { frame += gap; rng = value; module.postMainLoop() } }
}
test('RNG observer exists', () => assert.equal(typeof api.createRngResetObserver, 'function'))

test('live disable cancels hooks and reads; live enable restores observation', () => {
  let reads = 0
  const h = harness({ enabled: false })
  const read = h.manager.getState
  h.manager.getState = () => { reads++; return read() }
  h.observer.arm({ cycleId: 1 }); h.step(123)
  assert.equal(reads, 0)
  assert.equal(h.module.postMainLoop, h.original)
  h.observer.setEnabled(true); h.observer.arm({ cycleId: 2 })
  assert.ok(reads > 0)
  h.observer.setEnabled(false)
  const before = reads
  h.step(234); h.observer.arm({ cycleId: 3 }); h.observer.finish()
  assert.equal(reads, before)
  assert.equal(h.module.postMainLoop, h.original)
  assert.equal(h.events.length, 0)
})
test('reads validated RNG word and rejects unknown ROM/core/state layouts', () => {
  const h = harness()
  assert.equal(api.readRngSnapshot(h.manager, descriptor).rngValue, 0x12345678)
  assert.throws(() => api.readRngSnapshot(h.manager, { ...descriptor, romSha256: 'unknown' }))
  assert.throws(() => api.readRngSnapshot({ ...h.manager, getState: () => new Uint8Array(4) }, descriptor))
})
test('arms before reset, keeps previous callback and records conservative seed evidence', () => {
  const h = harness(); h.observer.arm({ huntId: 'hunt', cycleId: 1, resetType: 'soft', oddsResetCount: 1 })
  let value = 123
  h.step(value)
  for (let i = 0; i < 4; i++) { value = api.nextRng(value); h.step(value) }
  h.observer.finish()
  assert.equal(h.events.length, 1)
  assert.equal(h.events[0].seed, 123)
  assert.equal(h.events[0].seedEvidence, 'observed-reseed-lcg')
  assert.equal(h.events[0].rngValue, value)
  assert.equal(h.callbacks(), 5)
  assert.equal(h.module.postMainLoop, h.original)
})
test('normal advancing RNG is never relabeled as a seed', () => {
  const h = harness(); h.observer.arm({})
  let value = 0x12345678
  for (let i = 0; i < 7; i++) { value = api.nextRng(value); h.step(value) }
  h.observer.finish()
  assert.equal(h.events[0].seed, null)
  assert.equal(h.events[0].status, 'missed-window')
})
test('missed early frames keep seed null and report actual gaps', () => {
  const h = harness(); h.observer.arm({})
  h.step(123, 8); h.step(api.nextRng(123), 1)
  h.observer.finish()
  assert.equal(h.events[0].seed, null)
  assert.equal(h.events[0].framesSkipped, 7)
})
test('cancel discards old cycle and restores callbacks without emitting old evidence', () => {
  const h = harness(); h.observer.arm({ cycleId: 1 }); h.observer.cancel()
  h.step(123)
  assert.equal(h.events.length, 0)
  h.observer.arm({ cycleId: 2 }); h.step(555); h.observer.finish()
  assert.equal(h.events[0].cycleId, 2)
})
test('unsupported runtime and failed reads emit limitations without throwing into reset', () => {
  const h = harness({ getDescriptor: () => ({ ...descriptor, core: 'nes' }) })
  assert.doesNotThrow(() => h.observer.arm({ cycleId: 1 }))
  assert.equal(h.events[0].status, 'unsupported')
  assert.equal(h.events[0].seed, null)
})
test('timeout records unavailable runtime without leaving callbacks installed', async () => {
  const h = harness({ timeoutMs: 15 }); h.observer.arm({})
  await new Promise(resolve => setTimeout(resolve, 35))
  assert.equal(h.events[0].status, 'unavailable')
  assert.equal(h.module.postMainLoop, h.original)
})
test('preserves the seed proof samples even after the ring buffer advances', () => {
  const h = harness({ maxFrames: 100 }); h.observer.arm({})
  let value = 123; h.step(value)
  for (let i = 0; i < 30; i++) { value = api.nextRng(value); h.step(value) }
  h.observer.finish()
  assert.equal(h.events[0].samples[0].rngValue, 123)
  assert.equal(h.events[0].samples[0].frame, h.events[0].seedFrame)
  assert.ok(h.events[0].samples.length <= 16)
})
test('a later discontinuity invalidates transient initialization zero even across skipped frames', () => {
  const h = harness(); h.observer.arm({})
  let value = 0; h.step(value)
  for (let i = 0; i < 3; i++) { value = api.nextRng(value); h.step(value) }
  h.step(api.nextRng(48015), 2)
  h.observer.finish()
  assert.equal(h.events[0].seed, null)
  assert.equal(h.events[0].reason, 'later-rng-discontinuity')
})
test('a later observed reseed replaces initialization zero with the final seed', () => {
  const h = harness(); h.observer.arm({})
  let value = 0; h.step(value)
  for (let i = 0; i < 3; i++) { value = api.nextRng(value); h.step(value) }
  value = 48015; h.step(value)
  for (let i = 0; i < 3; i++) { value = api.nextRng(value); h.step(value) }
  h.observer.finish()
  assert.equal(h.events[0].seed, 48015)
})
test('skipped frames following the expected LCG retain confirmed seed proof', () => {
  const h = harness(); h.observer.arm({})
  let value = 123; h.step(value)
  for (let i = 0; i < 3; i++) { value = api.nextRng(value); h.step(value) }
  for (let i = 0; i < 4; i++) value = api.nextRng(value)
  h.step(value, 4); h.observer.finish()
  assert.equal(h.events[0].seed, 123)
  assert.equal(h.events[0].framesSkipped, 3)
})
test('failed context lookup cannot prevent the reset caller from continuing', () => {
  const h = harness({ getManager: () => { throw new Error('manager lookup failed') } })
  assert.doesNotThrow(() => h.observer.arm({ resetType: 'hard' }))
  assert.equal(h.events[0].status, 'unavailable')
  assert.equal(h.observer.active, false)
})
test('immutable runtime hook falls back to polling and remains safe to cancel', async () => {
  const h = harness({ pollMs: 2 })
  Object.defineProperty(h.module, 'postMainLoop', { writable: false })
  assert.doesNotThrow(() => h.observer.arm({}))
  h.step(123)
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.doesNotThrow(() => h.observer.finish())
  assert.equal(h.events[0].rngValue, 123)
})
