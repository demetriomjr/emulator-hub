import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { activeGamepadBindings, readGamepadBinding, readGamepadSnapshot, createEmulatorGamepadInput } from './gamepad-input.mjs'

const pad = (buttons = [], axes = [], index = 0) => ({ index, buttons: buttons.map(value => ({ pressed: value === 1, value })), axes })

test('capture uses EmulatorJS button and signed axis identifiers, including extra inputs', () => {
  for (const [index, label] of [[0, 'BUTTON_1'], [4, 'LEFT_TOP_SHOULDER'], [12, 'DPAD_UP'], [17, 'GAMEPAD_17']]) {
    const buttons = Array(index + 1).fill(0)
    buttons[index] = 1
    assert.equal(readGamepadBinding([], readGamepadSnapshot([pad(buttons)])), label)
  }
  assert.equal(readGamepadBinding([], readGamepadSnapshot([pad([], [0, -1])])), 'LEFT_STICK_Y:-1')
  assert.equal(readGamepadBinding([], readGamepadSnapshot([pad([], [0, 0, 0, 0, 1])])), 'EXTRA_STICK_4:+1')
})

test('capture waits for a new press or axis direction, ignoring held inputs and noise', () => {
  const baseline = readGamepadSnapshot([pad([1], [-1])])
  assert.equal(readGamepadBinding(baseline, baseline), null)
  assert.equal(readGamepadBinding(baseline, readGamepadSnapshot([pad([1], [1])])), 'LEFT_STICK_X:+1')
  assert.equal(readGamepadBinding([], readGamepadSnapshot([pad([], [0.2])])), null)
  assert.equal(readGamepadBinding(readGamepadSnapshot([pad([0])]), baseline), 'BUTTON_1')
})

test('snapshots copy mutable browser objects and include all connected controllers', () => {
  const first = pad([1])
  const snapshot = readGamepadSnapshot([first, null, pad([], [0, 1], 2)])
  first.buttons[0].pressed = false
  first.buttons[0].value = 0
  assert.deepEqual(activeGamepadBindings(snapshot), ['BUTTON_1', 'LEFT_STICK_Y:+1'])
})

test('bridge disables native polling and sends mapped transitions without iframe focus', () => {
  const events = []
  const emulator = {
    gamepad: { terminate: () => events.push('stop') },
    gameManager: { simulateInput: (...args) => events.push(args) },
  }
  const input = createEmulatorGamepadInput(emulator, { 8: { gamepad: 'BUTTON_1' }, 4: { gamepad: 'LEFT_STICK_Y:-1' }, 5: { gamepad: 'LEFT_STICK_Y:+1' } })
  assert.equal(events.shift(), 'stop')
  events.length = 0
  input.update(['BUTTON_1', 'LEFT_STICK_Y:-1'])
  input.update(['BUTTON_1', 'LEFT_STICK_Y:-1'])
  assert.deepEqual(events, [[0, 4, 1], [0, 8, 1]])
  events.length = 0
  input.update(['LEFT_STICK_Y:+1'])
  assert.deepEqual(events, [[0, 4, 0], [0, 5, 1], [0, 8, 0]])
  events.length = 0
  input.release()
  assert.deepEqual(events, [[0, 5, 0]])
})

test('disconnect releases input while another controller holding the same binding keeps it pressed', () => {
  const events = []
  const input = createEmulatorGamepadInput({ gamepad: { terminate() {} }, gameManager: { simulateInput: (...args) => events.push(args) } }, { 8: { gamepad: 'BUTTON_1' } })
  events.length = 0
  input.update(activeGamepadBindings(readGamepadSnapshot([pad([1]), pad([1], [], 1)])))
  input.update(activeGamepadBindings(readGamepadSnapshot([null, pad([1], [], 1)])))
  input.update(activeGamepadBindings([]))
  assert.deepEqual(events, [[0, 8, 1], [0, 8, 0]])
})

test('player boot keeps backend controls authoritative and applies pre-start parent input', async () => {
  const source = (await readFile(new URL('../frontend/src/player.js', import.meta.url), 'utf8')).replace(/^import .+\r?\n/gm, '')
  const listeners = new Map()
  const calls = []
  const parent = {}
  const origin = 'http://localhost:5173'
  const bindings = { 8: { keyboard: 'z', gamepad: 'BUTTON_1' } }
  const window = {
    parent,
    addEventListener: (type, listener) => listeners.set(type, listener),
    setInterval: () => 1,
    EJS_emulator: {
      gamepad: { terminate: () => calls.push('stop') },
      gameManager: { simulateInput: (...args) => calls.push(args) },
    },
  }
  let loaded
  const loaderAdded = new Promise(resolve => { loaded = resolve })
  const game = { querySelectorAll: () => [] }
  vm.runInNewContext(source, {
    window, location: { origin, search: '?id=game&profileId=profile' }, URLSearchParams,
    document: { getElementById: () => game, createElement: () => ({}), body: { appendChild: loaded } },
    MutationObserver: class { observe() {} },
    getLaunch: async () => ({ romUrl: '/roms/game.gba', core: 'gba', gameId: 'game', title: 'Game', saveUrl: '/api/profiles/profile/games/game/save' }),
    getControlProfile: async () => ({ bindings }),
    getCloudSave: async () => null,
    putCloudSave: async () => ({ revision: 1 }),
    createCloudSaveSynchronizer: () => ({ load: async () => null, restore: () => false, sync: async () => false }),
    createEmulatorGamepadInput,
  })
  await loaderAdded
  assert.equal(window.EJS_disableLocalStorage, true)
  assert.equal(window.EJS_defaultControls[0], bindings)
  const receive = (source, eventOrigin, labels) => listeners.get('message')({ source, origin: eventOrigin, data: { type: 'emulator-hub:gamepad', bindings: labels } })
  receive(parent, origin, ['BUTTON_1'])
  assert.deepEqual(calls, [])
  window.EJS_onGameStart()
  assert.deepEqual(calls, ['stop', [0, 8, 0], [0, 8, 1]])
  calls.length = 0
  receive({}, origin, [])
  receive(parent, 'https://other.example', [])
  assert.deepEqual(calls, [])
  receive(parent, origin, [])
  assert.deepEqual(calls, [[0, 8, 0]])
})
