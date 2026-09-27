import assert from 'node:assert/strict'
import test from 'node:test'
import { addItem, createMacro, createMacroCursor, createMacroRunner, INPUT_CORE_IDS, macroUsesKeyboardKey, migrateMacro, updateItem, validateMacro } from './input-macro-simulator.mjs'

test('GBA inputs use the shared core mapping', () => {
  assert.deepEqual(INPUT_CORE_IDS, { up: 4, down: 5, left: 6, right: 7, a: 8, b: 0, l: 10, r: 11 })
})

test('keyboard conflicts include only buttons in the macro with their current binding', () => {
  const macro = addItem(addItem(createMacro('A'), 'button', { input: 'a' }), 'delay')
  const bindings = { 8: { keyboard: 'z' }, 0: { keyboard: 'x' } }
  assert.equal(macroUsesKeyboardKey(macro, 'Z', bindings), true)
  assert.equal(macroUsesKeyboardKey(macro, 'x', bindings), false)
  assert.equal(macroUsesKeyboardKey(macro, 'ArrowUp', bindings), false)
})

test('version 2 items use the configured defaults', () => {
  let macro = createMacro('Demo')
  macro = addItem(macro, 'button')
  macro = addItem(macro, 'delay')
  macro = addItem(macro, 'repeat')
  assert.equal(macro.schemaVersion, 2)
  assert.deepEqual(macro.items.map(({ id, ...item }) => item), [
    { kind: 'button', input: 'a', action: 'press', count: 1, delayAfterMs: 800 },
    { kind: 'delay', durationMs: 1200 },
    { kind: 'repeat', count: 1 },
  ])
  assert.equal(validateMacro(macro).valid, true)
})

test('later repeat restarts earlier repeat counters', () => {
  let macro = createMacro('Nested')
  macro = addItem(macro, 'button', { input: 'a', delayAfterMs: 0 })
  macro = addItem(macro, 'repeat', { count: 2 })
  macro = addItem(macro, 'button', { input: 'b', delayAfterMs: 0 })
  macro = addItem(macro, 'repeat', { count: 2 })
  const cursor = createMacroCursor(macro)
  const inputs = []
  for (let i = 0; i < 6; i += 1) inputs.push(cursor.next().input)
  assert.deepEqual(inputs, ['a', 'a', 'b', 'a', 'a', 'b'])
  assert.equal(cursor.next(), null)
})

test('repeat zero loops without expanding a timeline', () => {
  let macro = createMacro('Infinite')
  macro = addItem(macro, 'button', { delayAfterMs: 0 })
  macro = addItem(macro, 'repeat', { count: 0 })
  macro = addItem(macro, 'button', { input: 'b' })
  const cursor = createMacroCursor(macro)
  assert.deepEqual(Array.from({ length: 20 }, () => cursor.next()?.input), Array(20).fill('a'))
  assert.equal(validateMacro(macro).valid, true)
})

test('invalid shapes and fractional counts return errors rather than throwing', () => {
  assert.equal(validateMacro(null).valid, false)
  assert.equal(validateMacro({ schemaVersion: 2, name: 'x', items: [null] }).valid, false)
  const macro = addItem(createMacro('x'), 'button', { count: 1.5 })
  assert.equal(validateMacro(macro).valid, false)
  assert.equal(validateMacro({ ...macro, items: [{ ...macro.items[0], count: NaN }] }).valid, false)
  assert.equal(validateMacro({ ...macro, items: [{ ...macro.items[0], count: 1, holdMs: 2000 }] }).valid, false)
  assert.equal(validateMacro({ ...macro, items: [{ ...macro.items[0], count: 1, unexpected: true }] }).valid, false)
})

test('Hold zero is valid while negative and excessive durations are rejected', () => {
  const macro = addItem(createMacro('Continuous'), 'button', { action: 'hold', holdMs: 0 })
  assert.equal(validateMacro(macro).valid, true)
  assert.equal(validateMacro({ ...macro, items: [{ ...macro.items[0], holdMs: -1 }] }).valid, false)
  assert.equal(validateMacro({ ...macro, items: [{ ...macro.items[0], holdMs: 600001 }] }).valid, false)
})

test('Press zero is valid while negative counts remain invalid', () => {
  const macro = addItem(createMacro('Infinite Press'), 'button', { action: 'press', count: 0 })
  assert.equal(validateMacro(macro).valid, true)
  assert.equal(validateMacro({ ...macro, items: [{ ...macro.items[0], count: -1 }] }).valid, false)
})

test('Press zero pulses its own button indefinitely after one-time continuous Hold setup', () => {
  let macro = addItem(createMacro('Infinite Press'), 'button', { input: 'b', action: 'hold', holdMs: 0, delayAfterMs: 300 })
  macro = addItem(macro, 'button', { input: 'left', action: 'hold', holdMs: 0, delayAfterMs: 200 })
  macro = addItem(macro, 'button', { input: 'a', action: 'press', count: 0, delayAfterMs: 0 })
  macro = addItem(macro, 'button', { input: 'r', action: 'press', count: 1, delayAfterMs: 0 })
  const jobs = new Map()
  let time = 0
  let id = 0
  const events = []
  const runner = createMacroRunner({ macro, setPressed: (input, down) => events.push([time, input, down]), schedule: (fn, ms) => { jobs.set(++id, { at: time + ms, fn }); return id }, clear: key => jobs.delete(key) })
  runner.start()
  while (jobs.size && Math.min(...[...jobs.values()].map(job => job.at)) <= 1400) {
    const [key, job] = [...jobs].sort((a, b) => a[1].at - b[1].at)[0]
    jobs.delete(key)
    time = job.at
    job.fn()
  }
  assert.deepEqual(events, [[0, 'b', true], [300, 'left', true], [500, 'a', true], [560, 'a', false], [1360, 'a', true]])
  assert.equal(runner.isActive(), true)
  runner.stop()
  assert.deepEqual(events.slice(-3), [[1360, 'b', false], [1360, 'left', false], [1360, 'a', false]])
  assert.equal(jobs.size, 0)
})

test('two continuous Holds remain down through another button and release on completion', () => {
  let macro = addItem(createMacro('Chord'), 'button', { input: 'a', action: 'hold', holdMs: 0, delayAfterMs: 0 })
  macro = addItem(macro, 'button', { input: 'b', action: 'hold', holdMs: 0, delayAfterMs: 0 })
  macro = addItem(macro, 'button', { input: 'l', action: 'press', delayAfterMs: 0 })
  const jobs = []
  const events = []
  let outcome
  const runner = createMacroRunner({ macro, setPressed: (input, down) => events.push([input, down]), schedule: fn => { jobs.push(fn); return jobs.length }, clear() {}, onEnd: value => { outcome = value } })
  runner.start()
  while (jobs.length) jobs.shift()()
  assert.deepEqual(events, [['a', true], ['b', true], ['l', true], ['l', false], ['a', false], ['b', false]])
  assert.equal(outcome, 'completed')
})

test('a finite Hold releases while a preceding continuous Hold stays down', () => {
  let macro = addItem(createMacro('Mixed Holds'), 'button', { input: 'a', action: 'hold', holdMs: 0, delayAfterMs: 0 })
  macro = addItem(macro, 'button', { input: 'b', action: 'hold', holdMs: 200, delayAfterMs: 0 })
  const jobs = []
  const events = []
  const runner = createMacroRunner({ macro, setPressed: (input, down) => events.push([input, down]), schedule: fn => { jobs.push(fn); return jobs.length }, clear() {} })
  runner.start()
  jobs.shift()()
  assert.deepEqual(events, [['a', true], ['b', true]])
  jobs.shift()()
  assert.deepEqual(events, [['a', true], ['b', true], ['b', false]])
  jobs.shift()()
  assert.deepEqual(events.at(-1), ['a', false])
})

test('continuous Hold survives Repeat and a later action on the same input until stopped', () => {
  let macro = addItem(createMacro('Loop'), 'button', { input: 'a', action: 'hold', holdMs: 0, delayAfterMs: 0 })
  macro = addItem(macro, 'button', { input: 'a', action: 'press', delayAfterMs: 0 })
  macro = addItem(macro, 'repeat', { count: 0 })
  const jobs = new Map()
  let id = 0
  const events = []
  const runner = createMacroRunner({ macro, setPressed: (input, down) => events.push([input, down]), schedule: fn => { jobs.set(++id, fn); return id }, clear: key => jobs.delete(key) })
  runner.start()
  for (let index = 0; index < 10; index += 1) {
    const [key, job] = jobs.entries().next().value
    jobs.delete(key)
    job()
  }
  assert.deepEqual(events, [['a', true]])
  runner.stop()
  assert.deepEqual(events, [['a', true], ['a', false]])
  assert.equal(jobs.size, 0)
})

test('legacy macro converts to an editable draft without changing stored data', () => {
  const old = { id: 'm', name: 'Old', steps: [{ id: 's', input: 'a', action: 'repeat', duration: 3, delay: 1000 }], createdAt: 1, updatedAt: 2 }
  const { macro, warnings } = migrateMacro(old)
  assert.equal(old.steps[0].action, 'repeat')
  assert.deepEqual(macro.items[0], { id: 's', kind: 'button', input: 'a', action: 'press', count: 3, delayAfterMs: 1000 })
  assert.ok(warnings.length)
})

test('old finite fractional values remain visible for review', () => {
  const old = { id: 'old', name: 'Old', steps: [{ id: 's', input: 'a', action: 'repeat', duration: 2.5, delay: 1000.5 }], createdAt: 1, updatedAt: 2 }
  const { macro } = migrateMacro(old)
  assert.equal(macro.items[0].kind, 'legacy')
  assert.equal(validateMacro(macro).valid, false)
})

test('legacy infinite Hold requires explicit review before choosing Hold zero', () => {
  const old = { id: 'old', name: 'Old', steps: [{ id: 's', input: 'a', action: 'hold', duration: 0, delay: 800 }], createdAt: 1, updatedAt: 2 }
  const { macro } = migrateMacro(old)
  assert.equal(validateMacro(macro).valid, false)
  const reviewed = updateItem(macro, 's', { action: 'hold' })
  assert.equal(reviewed.items[0].holdMs, 2000)
  assert.equal(validateMacro(reviewed).valid, true)
  assert.equal(validateMacro(updateItem(reviewed, 's', { holdMs: 0 })).valid, true)
})

test('runner releases before waits and cancellation releases its held input', () => {
  let macro = createMacro('Timing')
  macro = addItem(macro, 'button', { count: 2, delayAfterMs: 1200 })
  macro = addItem(macro, 'button', { action: 'hold', holdMs: 2000, delayAfterMs: 0 })
  const jobs = new Map()
  let time = 0
  let id = 0
  const events = []
  const schedule = (fn, ms) => { jobs.set(++id, { at: time + ms, fn }); return id }
  const clear = key => jobs.delete(key)
  const runner = createMacroRunner({ macro, setPressed: (input, down) => events.push([time, input, down]), schedule, clear })
  runner.start()
  while (jobs.size && Math.min(...[...jobs.values()].map(job => job.at)) <= 3000) {
    const [key, job] = [...jobs].sort((a, b) => a[1].at - b[1].at)[0]
    jobs.delete(key)
    time = job.at
    job.fn()
  }
  assert.deepEqual(events.slice(0, 4), [[0, 'a', true], [60, 'a', false], [860, 'a', true], [920, 'a', false]])
  assert.deepEqual(events[4], [2120, 'a', true])
  runner.stop()
  assert.deepEqual(events.at(-1), [time, 'a', false])
  assert.equal(jobs.size, 0)
})

test('standalone Delay waits before the next button without emitting input', () => {
  let macro = addItem(createMacro('Delay'), 'delay', { durationMs: 1200 })
  macro = addItem(macro, 'button', { delayAfterMs: 0 })
  const jobs = []
  const inputs = []
  const runner = createMacroRunner({ macro, setPressed: (input, down) => inputs.push([input, down]), schedule: (fn, ms) => { jobs.push({ fn, ms }); return jobs.length }, clear() {} })
  runner.start()
  assert.deepEqual(inputs, [])
  assert.equal(jobs[0].ms, 1200)
  jobs[0].fn()
  assert.deepEqual(inputs, [['a', true]])
  runner.stop()
})

test('repeat-only infinite loop yields to a timer and can be stopped', () => {
  const macro = addItem(createMacro('Repeat'), 'repeat', { count: 0 })
  const jobs = new Map()
  let id = 0
  const runner = createMacroRunner({ macro, setPressed() { throw new Error('unexpected input') }, schedule: fn => { jobs.set(++id, fn); return id }, clear: key => jobs.delete(key) })
  runner.start()
  assert.equal(jobs.size, 1)
  runner.stop()
  assert.equal(jobs.size, 0)
})

test('a lost input adapter ends the macro as failed', () => {
  const macro = addItem(createMacro('Failure'), 'button')
  let outcome = null
  const runner = createMacroRunner({ macro, setPressed() { throw new Error('core lost') }, onEnd: value => { outcome = value } })
  runner.start()
  assert.equal(outcome, 'failed')
  assert.equal(runner.isActive(), false)
})
