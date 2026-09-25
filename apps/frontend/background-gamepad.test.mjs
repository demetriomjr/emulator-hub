import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { createGamepadInputGate } from '../packages/gamepad-input-gate.mjs'
import { createPlayerTriggerActions } from '../packages/player-trigger-actions.mjs'

const hub = await readFile(new URL('./src/main.jsx', import.meta.url), 'utf8')
const pollStart = hub.indexOf('    const poll = () => {', hub.indexOf('const triggerActions = createPlayerTriggerActions('))
const pollEnd = hub.indexOf('    poll()', pollStart)
const lockStart = hub.indexOf('  function setPlayerInteractionLocked(')
const lockEnd = hub.indexOf('  function sendPlayerInteractionLock(', lockStart)
const broadcastStart = hub.indexOf('    const broadcast = bindings => {', hub.indexOf('const triggerActions = createPlayerTriggerActions('))
const broadcastEnd = hub.indexOf('    // Poll the parent document', broadcastStart)
assert.ok(pollStart > 0 && pollEnd > pollStart && lockStart > 0 && lockEnd > lockStart && broadcastStart > 0 && broadcastEnd > broadcastStart)
const pollSource = `${hub.slice(pollStart, pollEnd)}\npoll`
const lockSource = `${hub.slice(lockStart, lockEnd)}\nsetPlayerInteractionLocked`
const broadcastSource = `${hub.slice(broadcastStart, broadcastEnd)}\nbroadcast`

function context(overrides = {}) {
  return {
    hubPerformance: null, controlPanelOpen: false, profileGame: null, instancePicker: false,
    closeLockRef: { current: false }, globalGamepadGateRef: { current: createGamepadInputGate() },
    profileInfoGamepadGatesRef: { current: new Map() }, profileInfoSessionId: null, selectedPlayerSessionId: 'a',
    readGamepadSnapshot: () => [], activeGamepadBindings: snapshot => snapshot,
    triggerActions: { update() {} }, l2TriggerAction: null, r2TriggerAction: null, triggerBindings: {}, broadcast() {},
    ...overrides,
  }
}

test('running profile editor blocks only its player and releases new buttons individually', () => {
  const sent = []
  const frames = ['a', 'b'].map(sessionId => ({ closest: () => ({ dataset: { sessionId } }), sessionId }))
  const gate = createGamepadInputGate()
  gate.lock()
  const state = context({ profileInfoSessionId: 'b', profileInfoGamepadGatesRef: { current: new Map([['b', gate]]) },
    document: { querySelectorAll: () => frames }, configurePlayerFrame: (frame, message) => sent.push([frame.sessionId, [...message.bindings]]) })
  const broadcast = runInNewContext(broadcastSource, state)
  broadcast(['DRIFT'])
  gate.unlock(['DRIFT'])
  state.profileInfoSessionId = null
  broadcast(['DRIFT', 'BUTTON_1'])
  assert.deepEqual(sent, [['a', ['DRIFT']], ['b', []], ['a', ['DRIFT', 'BUTTON_1']], ['b', ['BUTTON_1']]])
})

test('global lock permits a new button despite a continuously held axis', () => {
  const sent = []
  let buttons = ['DRIFT']
  const state = context({ readGamepadSnapshot: () => buttons, broadcast: bindings => sent.push([...bindings]),
    activeSessionsRef: { current: [{ sessionId: 'a' }] }, closeLockRevisionRef: { current: 0 }, profileInfoLockSessionIdRef: { current: null },
    document: { querySelectorAll: () => [] }, sendPlayerInteractionLock() {}, configurePlayerFrame() {} })
  const lock = runInNewContext(lockSource, state)
  const poll = runInNewContext(pollSource, state)
  lock(true)
  poll()
  lock(false)
  buttons = ['DRIFT', 'BUTTON_1']
  poll()
  buttons = []
  poll()
  buttons = ['DRIFT']
  poll()
  assert.deepEqual(sent, [[], ['BUTTON_1'], [], ['DRIFT']])
})

test('last close clears suppression before the next game starts', () => {
  const sent = []
  const state = context({ readGamepadSnapshot: () => ['BUTTON_1'], broadcast: bindings => sent.push([...bindings]),
    activeSessionsRef: { current: [{ sessionId: 'old' }] }, closeLockRevisionRef: { current: 0 }, profileInfoLockSessionIdRef: { current: null },
    document: { querySelectorAll: () => [] }, sendPlayerInteractionLock() {}, configurePlayerFrame() {} })
  const lock = runInNewContext(lockSource, state)
  const poll = runInNewContext(pollSource, state)
  lock(true)
  state.activeSessionsRef.current = []
  lock(false)
  poll()
  assert.deepEqual(sent, [['BUTTON_1']])
})

test('polling continues in hidden Hub and control configuration suppresses input', () => {
  const sent = []
  const state = context({ document: { hidden: true }, readGamepadSnapshot: () => ['BUTTON_1'], broadcast: bindings => sent.push([...bindings]) })
  const poll = runInNewContext(pollSource, state)
  poll()
  state.controlPanelOpen = true
  poll()
  assert.deepEqual(sent, [['BUTTON_1'], []])
})

test('profile and global locks suppress controller trigger actions', () => {
  const actions = []
  const gate = createGamepadInputGate()
  gate.lock()
  const state = context({ profileInfoSessionId: 'b', selectedPlayerSessionId: 'b', profileInfoGamepadGatesRef: { current: new Map([['b', gate]]) },
    readGamepadSnapshot: () => ['LEFT_BOTTOM_SHOULDER'],
    triggerActions: createPlayerTriggerActions({ dispatch: message => actions.push(message) }),
    l2TriggerAction: 'save-state', r2TriggerAction: 'none', triggerBindings: { l2: 'LEFT_BOTTOM_SHOULDER' } })
  const poll = runInNewContext(pollSource, state)
  poll()
  state.profileInfoSessionId = null
  gate.unlock(['LEFT_BOTTOM_SHOULDER'])
  poll()
  state.closeLockRef.current = true
  state.globalGamepadGateRef.current.lock()
  poll()
  assert.deepEqual(actions, [])
})
