import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createOddsManipulatorSync } from './odds-manipulator-sync.mjs'

test('coalesces dirty counts and retries a failed asynchronous sync', async () => {
  const calls = []
  let rejectNext = true
  let intervalCallback
  const sync = createOddsManipulatorSync({
    send: async count => {
      calls.push(count)
      if (rejectNext) { rejectNext = false; throw new Error('offline') }
    },
    setIntervalFn: callback => { intervalCallback = callback; return 1 },
    clearIntervalFn: () => {},
  })

  sync.markDirty(1)
  sync.markDirty(2)
  await sync.flush()
  assert.deepEqual(calls, [2])
  await sync.flush()
  assert.deepEqual(calls, [2, 2])
  sync.markDirty(3)
  await intervalCallback()
  assert.deepEqual(calls, [2, 2, 3])
  sync.stop()
})
