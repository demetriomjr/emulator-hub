import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

const hub = await readFile(new URL('./src/main.jsx', import.meta.url), 'utf8')
const pollStart = hub.indexOf('    const poll = () => {', hub.indexOf('const triggerActions = createPlayerTriggerActions('))
const pollEnd = hub.indexOf('    poll()', pollStart)
assert.ok(pollStart > 0 && pollEnd > pollStart)
const pollSource = `${hub.slice(pollStart, pollEnd)}\npoll`

test('gamepad input keeps reaching players while the Hub document is hidden', () => {
  const sent = []
  const poll = runInNewContext(pollSource, {
    controlPanelOpen: false, profileGame: null, instancePicker: false,
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
    controlPanelOpen: true, profileGame: null, instancePicker: false,
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
