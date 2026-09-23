import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createOddsManipulatorClock } from './odds-manipulator-clock.mjs'

test('switches Date.now between native and frozen timestamp', () => {
  const nativeNow = Date.now
  const clock = createOddsManipulatorClock({ nativeNow: () => 123 })
  assert.equal(clock.install(), true)
  assert.equal(Date.now(), 123)
  assert.equal(clock.configure({ enabled: true, oddsResetCount: 4, virtualTimestamp: 240000 }), true)
  assert.equal(Date.now(), 240000)
  assert.equal(clock.configure({ enabled: false }), true)
  assert.equal(Date.now(), 123)
  clock.restore()
  assert.equal(Date.now, nativeNow)
})

test('rejects inconsistent timestamp/count pairs', () => {
  const clock = createOddsManipulatorClock({ nativeNow: () => 123 })
  clock.install()
  assert.equal(clock.configure({ enabled: true, oddsResetCount: 4, virtualTimestamp: 1 }), false)
  clock.restore()
})
