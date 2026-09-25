const minimumPollIntervalMs = 3_000
const bytesPerMillisecond = 1_024

export function startEmulatorSavePolling(emulator, { setIntervalFn = setInterval, clearIntervalFn = clearInterval, now = () => performance.now(), onPoll } = {}) {
  const gameManager = emulator?.gameManager
  if (typeof gameManager?.getSaveFile !== 'function' || typeof gameManager.saveSaveFiles !== 'function') return null

  const saveBytes = gameManager.getSaveFile(false)?.byteLength ?? 0
  const intervalMs = Math.max(minimumPollIntervalMs, saveBytes / bytesPerMillisecond)
  const timer = setIntervalFn(() => {
    if (!emulator.started) return
    if (!onPoll) { gameManager.saveSaveFiles(); return }
    const startedAt = now()
    try { gameManager.saveSaveFiles() }
    finally { onPoll(now() - startedAt) }
  }, intervalMs)

  return () => clearIntervalFn(timer)
}
