import { captureGen3EnemyBaseline, inspectGen3Encounter } from './pokemon-gen3-encounter.mjs'

export function createShinyHuntPlayer({
  getLayout,
  getState,
  captureBaseline = captureGen3EnemyBaseline,
  inspect = inspectGen3Encounter,
  configureOdds,
  softReset,
  setA,
  saveState,
}) {
  let huntId = null
  let cycleId = null
  let layout = null
  let baselineEnemy = null
  let pressIndex = 0
  let aDown = false

  function releaseA() {
    if (!aDown) return
    setA(false)
    aDown = false
  }

  function current(message) {
    return huntId !== null && message.huntId === huntId && (message.type === 'prepare' || message.cycleId === cycleId)
  }

  async function handle(message) {
    try {
      if (message.type === 'prepare') {
        if (typeof message.huntId !== 'string' || !message.huntId) return { ok: false, error: 'invalid-hunt' }
        const nextLayout = getLayout()
        if (!nextLayout) return { ok: false, error: 'unsupported-rom' }
        releaseA()
        huntId = message.huntId
        cycleId = null
        layout = nextLayout
        baselineEnemy = null
        pressIndex = 0
        return { ok: true }
      }
      if (message.type === 'cancel') {
        if (message.huntId === huntId) {
          releaseA()
          huntId = null
          cycleId = null
        }
        return { ok: true }
      }
      if (message.type === 'reset') {
        if (message.huntId !== huntId || message.cycleId !== (cycleId ?? 0) + 1 || !Number.isSafeInteger(message.oddsResetCount) || message.oddsResetCount < 0) return { ok: false, error: 'stale-cycle' }
        releaseA()
        if (!configureOdds(message.oddsResetCount)) return { ok: false, error: 'odds-clock-rejected' }
        if (!await softReset()) return { ok: false, error: 'soft-reset-failed' }
        const baseline = captureBaseline(getState(), layout)
        if (!baseline) return { ok: false, error: 'state-unavailable' }
        baselineEnemy = baseline
        cycleId = message.cycleId
        pressIndex = 0
        return { ok: true }
      }
      if (!current(message)) return { ok: false, error: 'stale-cycle' }
      if (message.type === 'input') {
        if (!Number.isInteger(message.pressIndex) || message.pressIndex < 1 || message.pressIndex > 5 || typeof message.down !== 'boolean') return { ok: false, error: 'invalid-input' }
        if (!message.down) {
          if (!aDown || message.pressIndex !== pressIndex + 1) return { ok: false, error: 'invalid-input-order' }
          releaseA()
          pressIndex = message.pressIndex
          return { ok: true }
        }
        if (aDown || message.pressIndex !== pressIndex + 1) return { ok: false, error: 'invalid-input-order' }
        const result = inspect(getState(), { ...layout, baselineEnemy })
        if (result.status !== 'pending') return { ok: false, error: result.status === 'normal' || result.status === 'shiny' ? 'enemy-already-created' : 'unsafe-state' }
        setA(true)
        aDown = true
        return { ok: true }
      }
      if (message.type === 'inspect') {
        if (pressIndex !== 5 || aDown) return { ok: true, status: 'pending' }
        const result = inspect(getState(), { ...layout, baselineEnemy })
        return { ok: true, ...result }
      }
      if (message.type === 'save') return { ok: await saveState() }
      return { ok: false, error: 'unknown-command' }
    } catch (error) {
      releaseA()
      return { ok: false, error: error.message }
    }
  }

  return { handle, releaseA, isActive: () => huntId !== null }
}
