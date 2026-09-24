export const playerTriggerActionOptions = Object.freeze([
  { value: 'none', label: 'Do nothing' },
  { value: 'fast-forward', label: 'Fast Forward' },
  { value: 'soft-reset', label: 'Soft Reset' },
  { value: 'reset', label: 'Hard Reset' },
  { value: 'save-state', label: 'Save state' },
  { value: 'load-state', label: 'Load state' },
])

const triggerBindings = Object.freeze({
  l2: 'LEFT_BOTTOM_SHOULDER',
  r2: 'RIGHT_BOTTOM_SHOULDER',
})

const actionMessages = Object.freeze({
  'soft-reset': 'emulator-hub:soft-reset',
  reset: 'emulator-hub:reset',
  'save-state': 'emulator-hub:save-state',
  'load-state': 'emulator-hub:load-state',
})

export function createPlayerTriggerActions({ dispatch = () => {}, toggleFastForward = () => {} } = {}) {
  let held = new Set()
  return {
    defaults: { l2: 'none', r2: 'none' },
    update(bindings, actions, configuredBindings = triggerBindings) {
      const active = new Set(bindings)
      for (const [trigger, binding] of Object.entries(configuredBindings)) {
        const action = actions?.[trigger]
        const message = actionMessages[action]
        if (action === 'fast-forward' && active.has(binding) && !held.has(binding)) toggleFastForward(trigger)
        if (message && active.has(binding) && !held.has(binding)) dispatch(message)
      }
      held = active
    },
  }
}
