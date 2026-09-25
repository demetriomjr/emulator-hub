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
const lockStart = hub.indexOf('  function setPlayerInteractionLocked(')
const lockEnd = hub.indexOf('  function sendPlayerInteractionLock(', lockStart)
assert.ok(lockStart > 0 && lockEnd > lockStart)
const lockSource = `${hub.slice(lockStart, lockEnd)}\nsetPlayerInteractionLocked`
const profileInputDefaults = { profileInfoSessionId: null, profileInfoNeutralSessionIdRef: { current: null }, selectedPlayerSessionId: 'a' }
const broadcastStart = hub.indexOf('    const broadcast = bindings => {', hub.indexOf('const triggerActions = createPlayerTriggerActions('))
const broadcastEnd = hub.indexOf('    // Poll the parent document', broadcastStart)
assert.ok(broadcastStart > 0 && broadcastEnd > broadcastStart)
const broadcastSource = `${hub.slice(broadcastStart, broadcastEnd)}\nbroadcast`

test('profile editor suppresses gamepad input only in its own emulator', () => {
  const sent = []
  const frames = ['a', 'b'].map(sessionId => ({ closest: () => ({ dataset: { sessionId } }), sessionId }))
  const broadcast = runInNewContext(broadcastSource, {
    document: { querySelectorAll: () => frames },
    profileInfoSessionId: 'b', profileInfoNeutralSessionIdRef: { current: null },
    configurePlayerFrame: (frame, message) => sent.push([frame.sessionId, [...message.bindings]]),
  })
  broadcast(['BUTTON_1'])
  assert.deepEqual(sent, [['a', ['BUTTON_1']], ['b', []]])
})

test('edited emulator waits for a neutral controller reading after modal close', () => {
  const sent = []
  const frame = { closest: () => ({ dataset: { sessionId: 'b' } }) }
  const neutralRef = { current: 'b' }
  const broadcast = runInNewContext(broadcastSource, {
    document: { querySelectorAll: () => [frame] }, profileInfoSessionId: null,
    profileInfoNeutralSessionIdRef: neutralRef,
    configurePlayerFrame: (_frame, message) => sent.push([...message.bindings]),
  })
  let buttons = ['BUTTON_1']
  const poll = runInNewContext(pollSource, {
    ...profileInputDefaults, profileInfoNeutralSessionIdRef: neutralRef, selectedPlayerSessionId: 'b',
    hubPerformance: null, controlPanelOpen: false, profileGame: null, instancePicker: false,
    closeLockRef: { current: false }, awaitGamepadNeutralRef: { current: false },
    readGamepadSnapshot: () => buttons, activeGamepadBindings: snapshot => snapshot,
    triggerActions: { update() {} }, l2TriggerAction: null, r2TriggerAction: null, triggerBindings: {}, broadcast,
  })
  poll()
  buttons = []
  poll()
  buttons = ['BUTTON_1']
  poll()
  assert.deepEqual(sent, [[], [], ['BUTTON_1']])
})

test('profile editor suppresses controller trigger actions for its focused emulator', () => {
  const actions = []
  const poll = runInNewContext(pollSource, {
    ...profileInputDefaults, profileInfoSessionId: 'b', selectedPlayerSessionId: 'b',
    hubPerformance: null, controlPanelOpen: false, profileGame: null, instancePicker: false,
    closeLockRef: { current: false }, awaitGamepadNeutralRef: { current: false },
    readGamepadSnapshot: () => ['LEFT_BOTTOM_SHOULDER'], activeGamepadBindings: snapshot => snapshot,
    triggerActions: createPlayerTriggerActions({ dispatch: message => actions.push(message) }),
    l2TriggerAction: 'save-state', r2TriggerAction: 'none',
    triggerBindings: { l2: 'LEFT_BOTTOM_SHOULDER' }, broadcast() {},
  })
  poll()
  assert.deepEqual(actions, [])
})

test('profile editor lock keeps global close lock in force', () => {
  const sent = []
  const frames = ['a', 'b'].map(sessionId => ({ closest: () => ({ dataset: { sessionId } }), sessionId }))
  const lock = runInNewContext(lockSource, {
    closeLockRef: { current: false }, closeLockRevisionRef: { current: 0 },
    awaitGamepadNeutralRef: { current: false }, activeSessionsRef: { current: frames },
    profileInfoSessionId: 'b', profileInfoLockSessionIdRef: { current: null },
    document: { querySelectorAll: () => frames },
    sendPlayerInteractionLock: (frame, locked) => sent.push([frame.sessionId, locked]),
    configurePlayerFrame() {},
  })
  lock(false)
  lock(true)
  lock(false)
  assert.deepEqual(sent, [['a', false], ['b', true], ['a', true], ['b', true], ['a', false], ['b', true]])
})

test('gamepad input keeps reaching players while the Hub document is hidden', () => {
  const sent = []
  const poll = runInNewContext(pollSource, {
    ...profileInputDefaults,
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
    ...profileInputDefaults,
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
    ...profileInputDefaults,
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

test('closing the last session clears the neutral wait before a new game starts', () => {
  const closeLockRef = { current: false }
  const awaitGamepadNeutralRef = { current: false }
  const activeSessionsRef = { current: [{ sessionId: 'old' }] }
  const lock = runInNewContext(lockSource, {
    closeLockRef, closeLockRevisionRef: { current: 0 }, awaitGamepadNeutralRef,
    activeSessionsRef, document: { querySelectorAll: () => [] },
    profileInfoSessionId: null, profileInfoLockSessionIdRef: { current: null },
  })
  lock(true)
  lock(false)
  assert.equal(awaitGamepadNeutralRef.current, true)
  lock(true)
  activeSessionsRef.current = []
  lock(false)

  const sent = []
  const poll = runInNewContext(pollSource, {
    ...profileInputDefaults,
    hubPerformance: null,
    controlPanelOpen: false, profileGame: null, instancePicker: false,
    closeLockRef, awaitGamepadNeutralRef,
    readGamepadSnapshot: () => ['BUTTON_1'],
    activeGamepadBindings: snapshot => snapshot,
    triggerActions: { update() {} },
    l2TriggerAction: null, r2TriggerAction: null, triggerBindings: {},
    broadcast: bindings => sent.push([...bindings]),
  })
  poll()
  assert.deepEqual(sent, [['BUTTON_1']])
})

test('L2 and R2 emulator actions stay blocked through close modal and save overlay', () => {
  const actions = []
  let buttons = ['LEFT_BOTTOM_SHOULDER', 'RIGHT_BOTTOM_SHOULDER']
  const context = {
    ...profileInputDefaults,
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
