const SOFT_RESET_INPUTS = Object.freeze([
  { id: 8, label: 'A' },
  { id: 0, label: 'B' },
  { id: 3, label: 'START' },
  { id: 2, label: 'SELECT' },
])

export function softResetEmulator(manager, { holdMs = 120, setTimeoutFn = globalThis.setTimeout } = {}) {
  if (!manager || typeof manager.simulateInput !== 'function') return Promise.resolve(false)
  for (const input of SOFT_RESET_INPUTS) manager.simulateInput(0, input.id, 1)
  return new Promise(resolve => {
    setTimeoutFn(() => {
      for (const input of SOFT_RESET_INPUTS) manager.simulateInput(0, input.id, 0)
      resolve(true)
    }, holdMs)
  })
}

