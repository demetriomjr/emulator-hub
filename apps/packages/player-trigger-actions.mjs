export const playerTriggerActionOptions = Object.freeze([
  { value: 'none', label: 'Do nothing' },
  { value: 'reset', label: 'Reset game' },
  { value: 'save-state', label: 'Save state' },
  { value: 'load-state', label: 'Load state' },
])

const triggerBindings = Object.freeze({
  l2: 'LEFT_BOTTOM_SHOULDER',
  r2: 'RIGHT_BOTTOM_SHOULDER',
})

const actionMessages = Object.freeze({
  reset: 'emulator-hub:reset',
  'save-state': 'emulator-hub:save-state',
  'load-state': 'emulator-hub:load-state',
})

export function createPlayerTriggerActions({ dispatch = () => {} } = {}) {
  let held = new Set()
  return {
    defaults: { l2: 'none', r2: 'none' },
    update(bindings, actions, configuredBindings = triggerBindings) {
      const active = new Set(bindings)
      for (const [trigger, binding] of Object.entries(configuredBindings)) {
        const action = actions?.[trigger]
        const message = actionMessages[action]
        if (message && active.has(binding) && !held.has(binding)) dispatch(message)
      }
      held = active
    },
  }
}
