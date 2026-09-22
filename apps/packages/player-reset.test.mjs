import assert from 'node:assert/strict'
import { test } from 'node:test'
import { softResetEmulator } from './player-reset.mjs'

test('soft reset presses A B Start Select together, holds, then releases all inputs', async () => {
  const calls = []
  const manager = { simulateInput: (_port, id, value) => calls.push([id, value]) }
  const timers = []
  const reset = softResetEmulator(manager, { holdMs: 1, setTimeoutFn: (callback, delay) => { timers.push({ callback, delay }); return timers.length } })
  assert.deepEqual(calls, [[8, 1], [0, 1], [3, 1], [2, 1]])
  assert.deepEqual(timers.map(timer => timer.delay), [1])
  timers[0].callback()
  await reset
  assert.deepEqual(calls, [[8, 1], [0, 1], [3, 1], [2, 1], [8, 0], [0, 0], [3, 0], [2, 0]])
})

test('soft reset safely ignores an unavailable manager', async () => {
  await assert.doesNotReject(() => softResetEmulator(null))
})
