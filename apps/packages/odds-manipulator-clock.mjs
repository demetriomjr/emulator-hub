const MINUTE_MS = 60_000

export function createOddsManipulatorClock({ nativeNow = Date.now.bind(Date), target = Date } = {}) {
  let installed = false
  let enabled = false
  let virtualTimestamp = 0
  const originalNow = target.now

  return { install, configure, restore, get enabled() { return enabled }, get virtualTimestamp() { return virtualTimestamp } }

  function install() {
    if (!installed) {
      target.now = () => enabled ? virtualTimestamp : nativeNow()
      installed = true
    }
    return true
  }

  function configure({ enabled: nextEnabled, oddsResetCount, virtualTimestamp: nextTimestamp } = {}) {
    if (typeof nextEnabled !== 'boolean') return false
    if (nextEnabled) {
      if (!Number.isSafeInteger(oddsResetCount) || oddsResetCount < 0 || nextTimestamp !== oddsResetCount * MINUTE_MS) return false
      virtualTimestamp = nextTimestamp
    }
    enabled = nextEnabled
    return true
  }

  function restore() {
    if (installed) target.now = originalNow
    installed = false
    enabled = false
  }
}

export const ODDS_RESET_MINUTE_MS = MINUTE_MS
