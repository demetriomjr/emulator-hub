import assert from 'node:assert/strict'
import { test } from 'node:test'

import { monitorEmulatorFrameProgress } from './emulator-frame-progress.mjs'

test('reports when the emulator frame counter does not advance after game start', () => {
  const reports = []
  let callback
  monitorEmulatorFrameProgress({
    getFrame: () => 3,
    schedule: task => { callback = task; return 1 },
    report: event => reports.push(event),
  })

  callback()

  assert.deepEqual(reports, [{ kind: 'emulator-frame-stall', message: 'Emulator frame count did not advance after startup.' }])
})

test('does not report when the frame counter progresses', () => {
  const reports = []
  let frame = 3
  const callbacks = []
  monitorEmulatorFrameProgress({
    getFrame: () => frame,
    schedule: task => { callbacks.push(task); return callbacks.length },
    report: event => reports.push(event),
  })

  frame = 80
  callbacks.shift()()
  frame = 160
  callbacks.shift()()

  assert.deepEqual(reports, [])
})

test('reports when only the first frames advance and then the emulator freezes', () => {
  const reports = []
  let frame = 0
  const callbacks = []
  monitorEmulatorFrameProgress({
    getFrame: () => frame,
    schedule: task => { callbacks.push(task); return callbacks.length },
    report: event => reports.push(event),
  })

  frame = 2
  callbacks.shift()()
  callbacks.shift()()

  assert.deepEqual(reports, [{ kind: 'emulator-frame-stall', message: 'Emulator frame count stopped advancing after startup.' }])
})
