import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { createPlayerTriggerActions } from '../packages/player-trigger-actions.mjs'

const hub = await readFile(new URL('./src/main.jsx', import.meta.url), 'utf8')
const pollStart = hub.indexOf('    const poll = () => {', hub.indexOf('const triggerActions = createPlayerTriggerActions('))
const pollEnd = hub.indexOf('    poll()', pollStart)
assert.ok(pollStart > 0 && pollEnd > pollStart)
const pollSource = `${hub.slice(pollStart, pollEnd)}\npoll`

test('gamepad input keeps reaching players while the Hub document is hidden', () => {
  const sent = []
  const poll = runInNewContext(pollSource, {
    hubPerformance: null,
    controlPanelOpen: false, profileGame: null, instancePicker: false,
    closeLockRef: { current: false }, awaitGamepadNeutralRef: { current: false },
    document: { hidden: true },
    readGamepadSnapshot: () => ['connected-pad'],
    activeGamepadBindings: snapshot => snapshot.length ? ['BUTTON_1'] : [],
    triggerActions: { update() {} },
    l2TriggerAction: null, r2TriggerAction: null, triggerBindings: {},
    broadcast: bindings => sent.push([...bindings]),
  })
  poll()
  assert.deepEqual(sent, [['BUTTON_1']])
})

test('open controls still suspend gamepad input while the document is hidden', () => {
  const sent = []
  const poll = runInNewContext(pollSource, {
    hubPerformance: null,
    controlPanelOpen: true, profileGame: null, instancePicker: false,
    closeLockRef: { current: false }, awaitGamepadNeutralRef: { current: false },
    document: { hidden: true },
    readGamepadSnapshot: () => ['connected-pad'],
    activeGamepadBindings: () => ['BUTTON_1'],
    triggerActions: { update() {} },
    l2TriggerAction: null, r2TriggerAction: null, triggerBindings: {},
    broadcast: bindings => sent.push([...bindings]),
  })
  poll()
  assert.deepEqual(sent, [[]])
})

test('close lock releases gamepad input and waits for neutral before accepting held buttons again', () => {
  const sent = []
  let buttons = ['BUTTON_1']
  const context = {
    hubPerformance: null,
    controlPanelOpen: false, profileGame: null, instancePicker: false,
    closeLockRef: { current: true }, awaitGamepadNeutralRef: { current: true },
    readGamepadSnapshot: () => buttons,
    activeGamepadBindings: snapshot => snapshot,
    triggerActions: { update() {} },
    l2TriggerAction: null, r2TriggerAction: null, triggerBindings: {},
    broadcast: bindings => sent.push([...bindings]),
  }
  const poll = runInNewContext(pollSource, context)
  poll()
  context.closeLockRef.current = false
  poll()
  buttons = []
  poll()
  buttons = ['BUTTON_1']
  poll()
  assert.deepEqual(sent, [[], [], [], ['BUTTON_1']])
})

test('L2 and R2 emulator actions stay blocked through close modal and save overlay', () => {
  const actions = []
  let buttons = ['LEFT_BOTTOM_SHOULDER', 'RIGHT_BOTTOM_SHOULDER']
  const context = {
    hubPerformance: null,
    controlPanelOpen: false, profileGame: null, instancePicker: false,
    closeLockRef: { current: true }, awaitGamepadNeutralRef: { current: true },
    readGamepadSnapshot: () => buttons,
    activeGamepadBindings: snapshot => snapshot,
    triggerActions: createPlayerTriggerActions({
      dispatch: message => actions.push(message),
      toggleFastForward: () => actions.push('fast-forward'),
    }),
    l2TriggerAction: 'save-state', r2TriggerAction: 'fast-forward',
    triggerBindings: { l2: 'LEFT_BOTTOM_SHOULDER', r2: 'RIGHT_BOTTOM_SHOULDER' },
    broadcast() {},
  }
  const poll = runInNewContext(pollSource, context)
  poll() // selection modal
  poll() // save overlay, same lock
  context.closeLockRef.current = false
  poll() // buttons held at unlock
  assert.deepEqual(actions, [])
  buttons = []
  poll()
  buttons = ['LEFT_BOTTOM_SHOULDER', 'RIGHT_BOTTOM_SHOULDER']
  poll()
  assert.deepEqual(actions, ['emulator-hub:save-state', 'fast-forward'])
})
