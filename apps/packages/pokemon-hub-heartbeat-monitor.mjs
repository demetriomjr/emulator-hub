export function createPokemonHubHeartbeatMonitor({ maximumFailures = 3 } = {}) {
  if (!Number.isInteger(maximumFailures) || maximumFailures < 1) throw new TypeError('Pokemon Hub maximum heartbeat failures must be a positive integer')
  let failures = 0

  return { observe }

  async function observe(heartbeat) {
    if (typeof heartbeat !== 'function') throw new TypeError('Pokemon Hub heartbeat must be a function')
    try {
      await heartbeat()
      failures = 0
      return { status: 'healthy' }
    } catch (error) {
      failures += 1
      return failures >= maximumFailures
        ? { status: 'expired', failures, error }
        : { status: 'retrying', failures }
    }
  }
}
