// Identifiers emitted by EmulatorJS 4.2.3's GamepadHandler. Keep capture and
// gameplay on the same mapping, including non-standard buttons and axes.
const buttonLabels = Object.freeze([
  'BUTTON_1', 'BUTTON_2', 'BUTTON_3', 'BUTTON_4',
  'LEFT_TOP_SHOULDER', 'RIGHT_TOP_SHOULDER',
  'LEFT_BOTTOM_SHOULDER', 'RIGHT_BOTTOM_SHOULDER',
  'SELECT', 'START', 'LEFT_STICK', 'RIGHT_STICK',
  'DPAD_UP', 'DPAD_DOWN', 'DPAD_LEFT', 'DPAD_RIGHT',
])
const axisLabels = Object.freeze(['LEFT_STICK_X', 'LEFT_STICK_Y', 'RIGHT_STICK_X', 'RIGHT_STICK_Y'])

export function readGamepadSnapshot(gamepads = globalThis.navigator?.getGamepads?.() ?? []) {
  return Array.from(gamepads).filter(Boolean).map(gamepad => ({
    index: gamepad.index,
    buttons: Array.from(gamepad.buttons, button => ({ pressed: button.pressed, value: button.value })),
    axes: Array.from(gamepad.axes),
  }))
}

function bindingsForGamepad(gamepad, threshold) {
  const bindings = []
  gamepad.buttons.forEach((button, index) => {
    if (button.pressed || button.value >= threshold) bindings.push(buttonLabels[index] ?? `GAMEPAD_${index}`)
  })
  gamepad.axes.forEach((value, index) => {
    if (Math.abs(value) >= threshold) bindings.push(`${axisLabels[index] ?? `EXTRA_STICK_${index}`}:${value < 0 ? '-1' : '+1'}`)
  })
  return bindings
}

export function activeGamepadBindings(snapshot) {
  return [...new Set(snapshot.flatMap(gamepad => bindingsForGamepad(gamepad, 0.5)))]
}

export function readGamepadBinding(baseline = [], snapshot = readGamepadSnapshot()) {
  for (const gamepad of snapshot) {
    const previous = baseline.find(candidate => candidate.index === gamepad.index)
    const held = new Set(previous ? bindingsForGamepad(previous, 0.7) : [])
    const binding = bindingsForGamepad(gamepad, 0.7).find(value => !held.has(value))
    if (binding) return binding
  }
  return null
}

export function createEmulatorGamepadInput(emulator, bindings) {
  // Bypass iframe-local polling and gamepadSelection. Once the core starts,
  // the hub becomes the sole gamepad input producer for every instance.
  emulator.gamepad.terminate()
  const inputs = Object.entries(bindings).map(([id, binding]) => ({ id: Number(id), label: binding.gamepad, pressed: false }))
  for (const input of inputs) emulator.gameManager.simulateInput(0, input.id, 0)
  const update = labels => {
    const active = new Set(labels)
    for (const input of inputs) {
      const pressed = active.has(input.label)
      if (pressed === input.pressed) continue
      emulator.gameManager.simulateInput(0, input.id, pressed ? 1 : 0)
      input.pressed = pressed
    }
  }
  return { update, release: () => update([]) }
}
