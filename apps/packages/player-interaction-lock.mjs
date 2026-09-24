export function createPlayerInteractionLock({ getEmulator, releaseGamepadInput, canResume }) {
  let locked = false
  let pausedByLock = false

  function apply() {
    const emulator = getEmulator()
    if (locked) {
      releaseGamepadInput()
      if (emulator?.gameManager && !emulator.paused) {
        emulator.pause()
        pausedByLock = true
      }
    } else if (pausedByLock && emulator?.gameManager && canResume()) {
      emulator.play()
      pausedByLock = false
    }
  }

  return {
    isLocked: () => locked,
    setLocked(value) {
      locked = Boolean(value)
      apply()
    },
    apply,
    blockKeyboard(event) {
      if (!locked) return false
      event.preventDefault()
      event.stopImmediatePropagation()
      return true
    },
  }
}
