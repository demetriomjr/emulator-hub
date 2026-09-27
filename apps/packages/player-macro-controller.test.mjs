import assert from 'node:assert/strict'
import test from 'node:test'
import { addItem, createMacro } from './input-macro-simulator.mjs'
import { createPlayerMacroController } from './player-macro-controller.mjs'

test('prepare sends no input; start runs; stop releases exactly once', () => {
  const inputs = []
  const jobs = new Map()
  let serial = 0
  const macro = addItem(createMacro('Demo'), 'button', { action: 'hold', holdMs: 2000, delayAfterMs: 0 })
  const controller = createPlayerMacroController({
    canRun: () => true,
    setPressed: (input, down) => inputs.push([input, down]),
    schedule: (fn, ms) => { jobs.set(++serial, fn); return serial },
    clear: id => jobs.delete(id),
    onEnded() {},
  })
  assert.equal(controller.prepare('run-1', macro).ok, true)
  assert.deepEqual(inputs, [])
  assert.equal(controller.start('run-1').ok, true)
  assert.deepEqual(inputs, [['a', true]])
  controller.stop('run-1')
  assert.deepEqual(inputs, [['a', true], ['a', false]])
  assert.equal(jobs.size, 0)
})

test('start refuses stale and unprepared run IDs', () => {
  const controller = createPlayerMacroController({ canRun: () => true, setPressed() {}, schedule: setTimeout, clear: clearTimeout, onEnded() {} })
  assert.equal(controller.start('missing').ok, false)
  assert.equal(controller.prepare('one', addItem(createMacro('x'), 'delay')).ok, true)
  assert.equal(controller.start('other').ok, false)
  controller.cancel()
})

test('preparation expires without sending input or leaving a run active', () => {
  const jobs = new Map()
  let serial = 0
  const controller = createPlayerMacroController({
    canRun: () => true, setPressed() { throw new Error('unexpected input') },
    schedule: fn => { jobs.set(++serial, fn); return serial }, clear: id => jobs.delete(id), onEnded() {},
  })
  assert.equal(controller.prepare('run', addItem(createMacro('x'), 'delay')).ok, true)
  assert.equal(jobs.size, 1)
  const expire = jobs.values().next().value
  jobs.clear()
  expire()
  assert.equal(controller.start('run').ok, false)
  assert.equal(controller.isRunning(), false)
})

test('controller checks only keyboard inputs used by the macro', () => {
  const macro = addItem(createMacro('A'), 'button', { input: 'a', action: 'hold', holdMs: 2000 })
  let allowed = true
  const controller = createPlayerMacroController({
    canRun: candidate => allowed && candidate?.id === macro.id,
    setPressed() {}, onEnded() {},
  })
  assert.equal(controller.prepare('one', macro).ok, true)
  assert.equal(controller.start('one').ok, true)
  assert.equal(controller.usesKeyboardKey('z', { 8: { keyboard: 'z' }, 0: { keyboard: 'x' } }), true)
  assert.equal(controller.usesKeyboardKey('x', { 8: { keyboard: 'z' }, 0: { keyboard: 'x' } }), false)
  controller.stop('one')
  allowed = false
  assert.equal(controller.prepare('two', macro).ok, false)
})
