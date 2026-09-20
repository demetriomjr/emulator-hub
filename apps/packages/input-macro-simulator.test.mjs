import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ActionType,
  AVAILABLE_INPUTS,
  createMacro,
  addStep,
  removeStep,
  updateStep,
  reorderSteps,
  validateMacro,
  buildMacroTimeline,
  MAX_STEPS,
  InputMacroSimulator,
} from './input-macro-simulator.mjs'

test('creates an empty macro with the given name', () => {
  const macro = createMacro('Dash Combo')
  assert.equal(macro.name, 'Dash Combo')
  assert.deepEqual(macro.steps, [])
  assert.equal(typeof macro.id, 'string')
  assert.equal(typeof macro.createdAt, 'number')
  assert.equal(macro.updatedAt, macro.createdAt)
})

test('rejects invalid macro names', () => {
  assert.throws(() => createMacro('   '))
  assert.throws(() => createMacro(''))
  assert.throws(() => createMacro('x'.repeat(51)))
})

test('adds a step to the end of a macro', () => {
  const macro = createMacro('Combo')
  const next = addStep(macro, { input: 'up', action: ActionType.PRESS })
  assert.equal(next.steps.length, 1)
  assert.equal(next.steps[0].input, 'up')
  assert.equal(next.steps[0].action, ActionType.PRESS)
  assert.equal(typeof next.steps[0].id, 'string')
  assert.notEqual(next, macro)
  assert.equal(macro.steps.length, 0)
})

test('adds a step at a specific index', () => {
  const macro = createMacro('Combo')
  const first = addStep(macro, { input: 'a', action: ActionType.PRESS })
  const second = addStep(first, { input: 'b', action: ActionType.PRESS })
  const between = addStep(second, { input: 'left', action: ActionType.PRESS }, 1)
  assert.deepEqual(between.steps.map(s => s.input), ['a', 'left', 'b'])
})

test('fills defaults for steps', () => {
  const macro = createMacro('Combo')
  const next = addStep(macro, {})
  assert.equal(next.steps[0].input, InputMacroSimulator.DEFAULT_STEP.input)
  assert.equal(next.steps[0].action, InputMacroSimulator.DEFAULT_STEP.action)
  assert.equal(next.steps[0].delay, InputMacroSimulator.DEFAULT_STEP.delay)
})

test('rejects exceeding the maximum number of steps', () => {
  let macro = createMacro('Combo')
  for (let i = 0; i < MAX_STEPS; i += 1) {
    macro = addStep(macro, { input: 'a', action: ActionType.PRESS })
  }
  assert.equal(macro.steps.length, MAX_STEPS)
  assert.throws(() => addStep(macro, { input: 'a', action: ActionType.PRESS }))
})

test('removes a step by id', () => {
  const macro = createMacro('Combo')
  const first = addStep(macro, { input: 'a', action: ActionType.PRESS })
  const second = addStep(first, { input: 'b', action: ActionType.PRESS })
  const removed = removeStep(second, first.steps[0].id)
  assert.equal(removed.steps.length, 1)
  assert.equal(removed.steps[0].input, 'b')
})

test('throws when removing a missing step', () => {
  const macro = createMacro('Combo')
  assert.throws(() => removeStep(macro, 'missing-id'))
})

test('updates a step by id without mutating the original', () => {
  const macro = createMacro('Combo')
  const next = addStep(macro, { input: 'a', action: ActionType.PRESS })
  const updated = updateStep(next, next.steps[0].id, { input: 'right', action: ActionType.HOLD, duration: 3000 })
  assert.equal(updated.steps[0].input, 'right')
  assert.equal(updated.steps[0].action, ActionType.HOLD)
  assert.equal(updated.steps[0].duration, 3000)
  assert.equal(next.steps[0].input, 'a')
})

test('throws when updating a missing step', () => {
  const macro = createMacro('Combo')
  assert.throws(() => updateStep(macro, 'missing-id', { input: 'a' }))
})

test('reorders steps by index', () => {
  const macro = createMacro('Combo')
  const first = addStep(macro, { input: 'a', action: ActionType.PRESS })
  const second = addStep(first, { input: 'b', action: ActionType.PRESS })
  const reordered = reorderSteps(second, 0, 1)
  assert.deepEqual(reordered.steps.map(s => s.input), ['b', 'a'])
})

test('returns the same macro when reordering to the same index', () => {
  const macro = createMacro('Combo')
  const next = addStep(macro, { input: 'a', action: ActionType.PRESS })
  assert.equal(reorderSteps(next, 0, 0), next)
})

test('rejects reordering with invalid indices', () => {
  const macro = createMacro('Combo')
  const next = addStep(macro, { input: 'a', action: ActionType.PRESS })
  assert.throws(() => reorderSteps(next, -1, 0))
  assert.throws(() => reorderSteps(next, 0, 2))
  assert.throws(() => reorderSteps(next, 1, 0))
})

test('validates a complete macro as valid', () => {
  let macro = createMacro('Combo')
  macro = addStep(macro, { input: 'up', action: ActionType.PRESS })
  macro = addStep(macro, { input: 'a', action: ActionType.HOLD, duration: 500 })
  macro = addStep(macro, { input: 'b', action: ActionType.REPEAT, duration: 3, delay: 200 })
  const result = validateMacro(macro)
  assert.equal(result.valid, true)
  assert.deepEqual(result.errors, [])
})

test('validates every available input', () => {
  assert.equal(AVAILABLE_INPUTS.length, 8)
  for (const input of AVAILABLE_INPUTS) {
    const macro = addStep(createMacro('Combo'), { input, action: ActionType.PRESS })
    assert.equal(validateMacro(macro).valid, true, `input ${input} should be valid`)
  }
})

test('rejects an empty macro', () => {
  const result = validateMacro(createMacro('Combo'))
  assert.equal(result.valid, false)
  assert.ok(result.errors.some(error => error.includes('at least one step')))
})

test('rejects hold durations outside the allowed range while zero means infinite', () => {
  let macro = addStep(createMacro('Combo'), { input: 'a', action: ActionType.HOLD, duration: 50 })
  assert.equal(validateMacro(macro).valid, false)
  macro = addStep(createMacro('Combo'), { input: 'a', action: ActionType.HOLD, duration: 60000 })
  assert.equal(validateMacro(macro).valid, false)
  macro = addStep(createMacro('Combo'), { input: 'a', action: ActionType.HOLD, duration: 0 })
  assert.equal(validateMacro(macro).valid, true)
  macro = addStep(createMacro('Combo'), { input: 'a', action: ActionType.HOLD, duration: 100 })
  assert.equal(validateMacro(macro).valid, true)
  macro = addStep(createMacro('Combo'), { input: 'a', action: ActionType.HOLD, duration: 30000 })
  assert.equal(validateMacro(macro).valid, true)
})

test('rejects repeat counts outside the allowed range', () => {
  let macro = addStep(createMacro('Combo'), { input: 'a', action: ActionType.REPEAT, duration: 0 })
  assert.equal(validateMacro(macro).valid, false)
  macro = addStep(createMacro('Combo'), { input: 'a', action: ActionType.REPEAT, duration: 101 })
  assert.equal(validateMacro(macro).valid, false)
  macro = addStep(createMacro('Combo'), { input: 'a', action: ActionType.REPEAT, duration: 1 })
  assert.equal(validateMacro(macro).valid, true)
  macro = addStep(createMacro('Combo'), { input: 'a', action: ActionType.REPEAT, duration: 100 })
  assert.equal(validateMacro(macro).valid, true)
})

test('accepts press without a duration or with zero as infinite', () => {
  const plain = addStep(createMacro('Combo'), { input: 'a', action: ActionType.PRESS })
  assert.equal(validateMacro(plain).valid, true)
  const infinite = addStep(createMacro('Combo'), { input: 'a', action: ActionType.PRESS, duration: 0 })
  assert.equal(validateMacro(infinite).valid, true)
  const invalid = addStep(createMacro('Combo'), { input: 'a', action: ActionType.PRESS, duration: 1000 })
  assert.equal(validateMacro(invalid).valid, false)
})

test('rejects invalid steps and substitutions', () => {
  const macro = addStep(createMacro('Combo'), { input: 'not-a-button', action: ActionType.PRESS })
  assert.equal(validateMacro(macro).valid, false)
})

test('builds a timeline for a single press', () => {
  const macro = addStep(createMacro('Combo'), { input: 'a', action: ActionType.PRESS })
  const timeline = buildMacroTimeline(macro)
  assert.deepEqual(timeline, [
    { at: 0, input: 'a', value: 1 },
    { at: 60, input: 'a', value: 0 },
  ])
})

test('keeps an infinite press pressed with no release event', () => {
  const macro = addStep(createMacro('Combo'), { input: 'a', action: ActionType.PRESS, duration: 0 })
  const timeline = buildMacroTimeline(macro)
  assert.deepEqual(timeline, [{ at: 0, input: 'a', value: 1 }])
})

test('applies press duration and repeat interval options', () => {
  const macro = addStep(createMacro('Combo'), { input: 'up', action: ActionType.PRESS })
  const timeline = buildMacroTimeline(macro, { pressDurationMs: 80 })
  assert.deepEqual(timeline, [
    { at: 0, input: 'up', value: 1 },
    { at: 80, input: 'up', value: 0 },
  ])
})

test('builds a timeline for repeated presses', () => {
  const macro = addStep(createMacro('Combo'), { input: 'b', action: ActionType.REPEAT, duration: 3 })
  const timeline = buildMacroTimeline(macro, { pressDurationMs: 50, repeatIntervalMs: 100 })
  assert.deepEqual(timeline, [
    { at: 0, input: 'b', value: 1 }, { at: 50, input: 'b', value: 0 },
    { at: 100, input: 'b', value: 1 }, { at: 150, input: 'b', value: 0 },
    { at: 200, input: 'b', value: 1 }, { at: 250, input: 'b', value: 0 },
  ])
})

test('builds a timeline for a hold', () => {
  const macro = addStep(createMacro('Combo'), { input: 'l', action: ActionType.HOLD, duration: 500 })
  const timeline = buildMacroTimeline(macro)
  assert.deepEqual(timeline, [
    { at: 0, input: 'l', value: 1 },
    { at: 500, input: 'l', value: 0 },
  ])
})

test('keeps an infinite hold pressed with no release event', () => {
  const macro = addStep(createMacro('Combo'), { input: 'l', action: ActionType.HOLD, duration: 0 })
  const timeline = buildMacroTimeline(macro)
  assert.deepEqual(timeline, [{ at: 0, input: 'l', value: 1 }])
})

test('shifts the following step start by the delay', () => {
  let macro = addStep(createMacro('Combo'), { input: 'a', action: ActionType.PRESS, delay: 250 })
  macro = addStep(macro, { input: 'b', action: ActionType.PRESS })
  const timeline = buildMacroTimeline(macro)
  assert.deepEqual(timeline, [
    { at: 0, input: 'a', value: 1 }, { at: 60, input: 'a', value: 0 },
    { at: 250, input: 'b', value: 1 }, { at: 310, input: 'b', value: 0 },
  ])
})