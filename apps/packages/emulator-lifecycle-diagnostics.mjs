const methods = ['downloadGameCore', 'initGameCore', 'initModule', 'startGame']

export function instrumentEmulatorLifecycle({ emulator, report } = {}) {
  if (!emulator || typeof report !== 'function') return () => {}
  const restores = []
  const observed = new Set()
  const capture = message => {
    if (observed.has(message)) return
    observed.add(message)
    report({ kind: 'emulator-lifecycle', message })
  }

  capture('EmulatorJS ready')
  for (const method of methods) {
    const original = emulator[method]
    if (typeof original !== 'function') continue
    const message = `EmulatorJS ${method} entered`
    const wrapped = function (...args) {
      capture(message)
      return original.apply(this, args)
    }
    try {
      emulator[method] = wrapped
      restores.push(() => { if (emulator[method] === wrapped) emulator[method] = original })
    } catch {
      // Some upstream versions may expose a non-writable method. Diagnostics
      // must never alter or prevent normal EmulatorJS startup in that case.
    }
  }
  return () => restores.forEach(restore => restore())
}
