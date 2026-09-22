import assert from 'node:assert/strict'
import test from 'node:test'

import { createPlayerTriggerActions, playerTriggerActionOptions } from './player-trigger-actions.mjs'

test('defaults both controller triggers to doing nothing', () => {
  const triggers = createPlayerTriggerActions()

  assert.deepEqual(triggers.defaults, { l2: 'none', r2: 'none' })
  assert.deepEqual(playerTriggerActionOptions, [
    { value: 'none', label: 'Do nothing' },
    { value: 'soft-reset', label: 'Soft Reset' },
    { value: 'reset', label: 'Hard Reset' },
    { value: 'save-state', label: 'Save state' },
    { value: 'load-state', label: 'Load state' },
    { value: 'fast-forward', label: 'Fast Forward' },
  ])
})

test('runs one fast-forward toggle for each configured trigger press edge', () => {
  const toggles = []
  const triggers = createPlayerTriggerActions({ toggleFastForward: trigger => toggles.push(trigger) })

  triggers.update(['LEFT_BOTTOM_SHOULDER', 'RIGHT_BOTTOM_SHOULDER'], { l2: 'fast-forward', r2: 'fast-forward' })
  triggers.update(['LEFT_BOTTOM_SHOULDER', 'RIGHT_BOTTOM_SHOULDER'], { l2: 'fast-forward', r2: 'fast-forward' })
  triggers.update([], { l2: 'fast-forward', r2: 'fast-forward' })
  triggers.update(['RIGHT_BOTTOM_SHOULDER'], { l2: 'fast-forward', r2: 'fast-forward' })

  assert.deepEqual(toggles, ['l2', 'r2', 'r2'])
})

test('dispatches each configured trigger action once per controller press', () => {
  const dispatched = []
  const triggers = createPlayerTriggerActions({ dispatch: type => dispatched.push(type) })

  triggers.update(['LEFT_BOTTOM_SHOULDER', 'RIGHT_BOTTOM_SHOULDER'], { l2: 'save-state', r2: 'reset' })
  triggers.update(['LEFT_BOTTOM_SHOULDER', 'RIGHT_BOTTOM_SHOULDER'], { l2: 'save-state', r2: 'reset' })
  triggers.update([], { l2: 'save-state', r2: 'reset' })
  triggers.update(['RIGHT_BOTTOM_SHOULDER'], { l2: 'save-state', r2: 'load-state' })

  assert.deepEqual(dispatched, [
    'emulator-hub:save-state',
    'emulator-hub:reset',
    'emulator-hub:load-state',
  ])
})

test('does not dispatch when a trigger is configured to do nothing', () => {
  const dispatched = []
  const triggers = createPlayerTriggerActions({ dispatch: type => dispatched.push(type) })

  triggers.update(['LEFT_BOTTOM_SHOULDER', 'RIGHT_BOTTOM_SHOULDER'], { l2: 'none', r2: 'none' })

  assert.deepEqual(dispatched, [])
})

test('uses the controller bindings configured for L2 and R2', () => {
  const dispatched = []
  const triggers = createPlayerTriggerActions({ dispatch: type => dispatched.push(type) })

  triggers.update(['BUTTON_18', 'BUTTON_19'], { l2: 'save-state', r2: 'load-state' }, {
    l2: 'BUTTON_18',
    r2: 'BUTTON_19',
  })

  assert.deepEqual(dispatched, ['emulator-hub:save-state', 'emulator-hub:load-state'])
})
