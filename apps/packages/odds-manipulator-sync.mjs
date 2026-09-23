export function createOddsManipulatorSync({ send, intervalMs = 30_000, setIntervalFn = globalThis.setInterval, clearIntervalFn = globalThis.clearInterval, onError = () => {}, onEvent = () => {} } = {}) {
  if (typeof send !== 'function') throw new TypeError('send is required')
  let dirtyCount = null
  let inFlight = null
  let stopped = false
  const timer = setIntervalFn(() => { void flush() }, intervalMs)

  return { markDirty, flush, stop }

  function markDirty(count) {
    if (!Number.isSafeInteger(count) || count < 0) throw new TypeError('Odds reset count is invalid')
    dirtyCount = Math.max(dirtyCount ?? 0, count)
    return true
  }

  async function flush() {
    if (stopped || dirtyCount === null) return false
    if (inFlight) return inFlight
    const count = dirtyCount
    onEvent('odds.sync.started', { oddsResetCount: count })
    inFlight = Promise.resolve().then(() => send(count)).then(() => {
      if (dirtyCount === count) dirtyCount = null
      onEvent('odds.sync.succeeded', { oddsResetCount: count, pending: dirtyCount !== null })
      return true
    }).catch(error => {
      onEvent('odds.sync.failed', { oddsResetCount: count, error: error?.message ?? String(error) })
      onError(error)
      return false
    }).finally(() => { inFlight = null })
    return inFlight
  }

  function stop() {
    stopped = true
    clearIntervalFn(timer)
    return flush()
  }
}
