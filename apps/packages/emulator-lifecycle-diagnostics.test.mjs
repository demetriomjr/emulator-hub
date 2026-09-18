import assert from 'node:assert/strict'
import { test } from 'node:test'

import { instrumentEmulatorLifecycle } from './emulator-lifecycle-diagnostics.mjs'

test('reports ready and each instrumented EmulatorJS bootstrap boundary once', () => {
  const reports = []
  const emulator = {
    initGameCore(value) { return `core:${value}` },
    initModule(value) { return `module:${value}` },
  }

  const restore = instrumentEmulatorLifecycle({ emulator, report: event => reports.push(event) })

  assert.equal(emulator.initGameCore('mgba'), 'core:mgba')
  assert.equal(emulator.initGameCore('mgba'), 'core:mgba')
  assert.equal(emulator.initModule('runtime'), 'module:runtime')
  assert.deepEqual(reports, [
    { kind: 'emulator-lifecycle', message: 'EmulatorJS ready' },
    { kind: 'emulator-lifecycle', message: 'EmulatorJS initGameCore entered' },
    { kind: 'emulator-lifecycle', message: 'EmulatorJS initModule entered' },
  ])

  restore()
  assert.equal(emulator.initModule('after'), 'module:after')
  assert.equal(reports.length, 3)
})
