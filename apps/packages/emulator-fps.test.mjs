import assert from 'node:assert/strict'
import test from 'node:test'
import { gbaNominalFps, sampleEmulatedFps } from './emulator-fps.mjs'

test('measures emulated FPS against elapsed wall time and derives achieved GBA speed', () => {
  const first = sampleEmulatedFps(null, 1000, 100)
  const result = sampleEmulatedFps(first.baseline, 1299, 1100)
  assert.equal(result.fps, 299)
  assert.ok(Math.abs(result.speed - 5) < 0.01)
  assert.ok(gbaNominalFps > 59.7 && gbaNominalFps < 59.8)
})

test('counter reset, unavailable values and paused frames do not invent throughput', () => {
  const earlier = { frame: 500, timestamp: 1000 }
  const paused = sampleEmulatedFps(earlier, 500, 2000)
  assert.equal(paused.fps, 0)
  assert.equal(paused.speed, 0)
  const reset = sampleEmulatedFps(earlier, 4, 2000)
  assert.equal(reset.fps, null)
  assert.deepEqual(reset.baseline, { frame: 4, timestamp: 2000 })
  assert.equal(sampleEmulatedFps(earlier, undefined, 2000).baseline, null)
  assert.equal(sampleEmulatedFps(earlier, null, 2000).baseline, null)
  assert.equal(sampleEmulatedFps(earlier, 550, 1000).fps, null)
})
