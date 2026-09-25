import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createGamepadInputGate } from './gamepad-input-gate.mjs'

test('unlock suppresses only inputs held at unlock, then accepts each after release', () => {
  const gate = createGamepadInputGate()
  gate.lock()
  assert.deepEqual(gate.filter(['DRIFT']), [])
  gate.unlock(['DRIFT'])
  assert.deepEqual(gate.filter(['DRIFT', 'BUTTON_1']), ['BUTTON_1'])
  assert.deepEqual(gate.filter(['DRIFT', 'BUTTON_2']), ['BUTTON_2'])
  assert.deepEqual(gate.filter([]), [])
  assert.deepEqual(gate.filter(['DRIFT']), ['DRIFT'])
})

test('a full player close clears suppression before the next player starts', () => {
  const gate = createGamepadInputGate()
  gate.lock()
  gate.unlock(['BUTTON_1'])
  assert.deepEqual(gate.filter(['BUTTON_1']), [])
  gate.reset()
  assert.deepEqual(gate.filter(['BUTTON_1']), ['BUTTON_1'])
})

test('independent player gates do not suppress another player', () => {
  const first = createGamepadInputGate()
  const second = createGamepadInputGate()
  second.lock()
  assert.deepEqual(first.filter(['BUTTON_1']), ['BUTTON_1'])
  assert.deepEqual(second.filter(['BUTTON_1']), [])
  second.unlock(['BUTTON_1'])
  assert.deepEqual(first.filter(['BUTTON_1', 'BUTTON_2']), ['BUTTON_1', 'BUTTON_2'])
  assert.deepEqual(second.filter(['BUTTON_1', 'BUTTON_2']), ['BUTTON_2'])
})
