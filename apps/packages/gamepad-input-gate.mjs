export function createGamepadInputGate() {
  let locked = false
  let heldAtUnlock = new Set()
  return {
    lock() {
      locked = true
      heldAtUnlock.clear()
    },
    unlock(bindings) {
      if (!locked) return
      locked = false
      heldAtUnlock = new Set(bindings)
    },
    reset() {
      locked = false
      heldAtUnlock.clear()
    },
    filter(bindings) {
      if (locked) return []
      const current = new Set(bindings)
      for (const binding of heldAtUnlock) if (!current.has(binding)) heldAtUnlock.delete(binding)
      return bindings.filter(binding => !heldAtUnlock.has(binding))
    },
  }
}
