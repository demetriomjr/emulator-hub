export function installAudioResumeOnUserGesture({ element, getAudioContext }) {
  if (!element || typeof getAudioContext !== 'function') return () => {}
  // iOS may not grant activation until the gesture ends. In particular, a
  // resume promise started from touch pointerdown can stay pending forever.
  // Keep every completed gesture eligible to retry instead of latching it.
  const events = ['pointerup', 'touchend', 'keydown']
  const remove = () => events.forEach(type => element.removeEventListener(type, resume))
  async function resume() {
    const context = getAudioContext()
    if (!context?.resume) return
    if (context.state === 'running') return remove()
    try {
      await context.resume()
      if (context.state === 'running') remove()
    } catch {
      // A later user gesture may be accepted even if this one was not.
    }
  }
  events.forEach(type => element.addEventListener(type, resume))
  return remove
}

export function getEmulatorAudioContext(emulator) {
  const current = emulator?.Module?.AL?.currentCtx
  if (current?.audioCtx) return current.audioCtx
  return Object.values(current?.sources ?? {}).find(source => source?.gain?.context)?.gain.context ?? null
}
