import { captureGen3EnemyBaseline, inspectGen3BattlePhase, inspectGen3Encounter } from './pokemon-gen3-encounter.mjs'
import { resolveShinyHuntStartPlan, hoennStarterChoices, HOENN_DIRECTION_TAP_MS } from './shiny-hunt-start-sequence.mjs'

export function createShinyHuntPlayer({
  getLayout,
  getState,
  getFrameNumber = () => null,
  captureBaseline = captureGen3EnemyBaseline,
  inspect = inspectGen3Encounter,
  inspectPhase = inspectGen3BattlePhase,
  configureOdds,
  softReset,
  observeReset = () => {},
  cancelObservation = () => {},
  reportEncounter = () => {},
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
  setA,
  setButton = (button, down) => { if (button !== 'A') throw new Error('unsupported-button'); setA(down) },
  saveState,
}) {
  let huntId = null
  let cycleId = null
  let layout = null
  let baselineEnemy = null
  let pressIndex = 0
  let aDown = false
  let heldButton = null
  let completed = false
  let savedCycleId = null
  let saving = null
  let starterButtons = null
  let starterInputIndex = 0
  let starterRepeat = false
  let starterStarted = false
  let pendingTap = null
  let reportedCycle = null
  let fossilButtons = null
  let fossilInputIndex = 0
  let fossilStarted = false

  function diagnostic(callback, context) { try { callback(context) } catch {} }

  function releaseA() {
    pendingTap = null
    if (heldButton) {
      setButton(heldButton, false)
      heldButton = null
    }
    if (!aDown) return
    setA(false)
    aDown = false
  }

  function current(message) {
    return huntId !== null && message.huntId === huntId && (message.type === 'prepare' || message.cycleId === cycleId)
  }

  function inspectCurrent() {
    if (fossilButtons && (!fossilStarted || fossilInputIndex < fossilButtons.length || heldButton)) return { status: 'pending' }
    if (starterButtons && (!starterStarted || !starterRepeat && starterInputIndex < starterButtons.length)) return { status: 'pending' }
    const result = inspect(getState(), { ...layout, baselineEnemy })
    if ((result.status === 'normal' || result.status === 'shiny') && reportedCycle !== cycleId) {
      reportedCycle = cycleId
      diagnostic(reportEncounter, { huntId, cycleId, pid: result.pid, shiny: result.status === 'shiny' })
    }
    return result
  }

  async function handle(message) {
    try {
      if (message.type === 'prepare') {
        if (typeof message.huntId !== 'string' || !message.huntId) return { ok: false, error: 'invalid-hunt' }
        const nextLayout = getLayout()
        if (!nextLayout) return { ok: false, error: 'unsupported-rom' }
        if (message.startMode === 'fossil' && message.resetMode !== 'soft-reset') return { ok: false, error: 'invalid-fossil-reset' }
        let plan = null
        if (message.startMode === 'hoenn-starter') {
          const choice = hoennStarterChoices.find(candidate => candidate.value === message.starterPosition)
          if (!choice || message.resetMode !== 'soft-reset') return { ok: false, error: 'invalid-starter-choice' }
          plan = resolveShinyHuntStartPlan(message, nextLayout.gameCode)
        }
        releaseA()
        diagnostic(cancelObservation)
        reportedCycle = null
        huntId = message.huntId
        cycleId = null
        layout = message.startMode === 'fossil' ? { ...nextLayout, fossil: true } : plan ? { ...nextLayout, starterSpecies: plan.starterSpecies } : nextLayout
        fossilButtons = message.startMode === 'fossil' ? resolveShinyHuntStartPlan(message, nextLayout.gameCode).startSequence.map(step => step.button) : null
        fossilInputIndex = 0
        fossilStarted = false
        starterButtons = plan ? plan.startSequence.map(step => step.button) : null
        starterInputIndex = 0
        starterRepeat = plan?.repeatUntilEncounter ?? false
        starterStarted = false
        baselineEnemy = null
        pressIndex = 0
        completed = false
        savedCycleId = null
        saving = null
        return { ok: true, ...(plan ? { gameCode: nextLayout.gameCode } : {}) }
      }
      if (message.type === 'cancel') {
        if (message.huntId === huntId) {
          releaseA()
          diagnostic(cancelObservation)
          huntId = null
          cycleId = null
        }
        return { ok: true }
      }
      if (message.type === 'confirm-reset') {
        if (message.huntId !== huntId) return { ok: false, error: 'stale-hunt' }
        return { ok: true, confirmed: cycleId === message.cycleId && baselineEnemy !== null }
      }
      if (message.type === 'reset') {
        if (message.huntId !== huntId || message.cycleId !== (cycleId ?? 0) + 1 || !Number.isSafeInteger(message.oddsResetCount) || message.oddsResetCount < 0) return { ok: false, error: 'stale-cycle' }
        releaseA()
        starterInputIndex = 0
        starterStarted = false
        if (!configureOdds(message.oddsResetCount)) return { ok: false, error: 'odds-clock-rejected' }
        fossilInputIndex = 0
        fossilStarted = false
        diagnostic(observeReset, { huntId, cycleId: message.cycleId, oddsResetCount: message.oddsResetCount, virtualTimestamp: message.oddsResetCount * 60000, resetType: 'soft' })
        if (!await softReset()) return { ok: false, error: 'soft-reset-failed' }
        let baseline = null
        for (let attempt = 0; attempt < 3 && !baseline; attempt += 1) {
          try { baseline = captureBaseline(getState(), layout) }
          catch { baseline = null }
          if (!baseline && attempt < 2) await wait(500)
        }
        if (!baseline) return { ok: false, error: 'state-unavailable' }
        baselineEnemy = baseline
        cycleId = message.cycleId
        pressIndex = 0
        return { ok: true }
      }
      if (message.type === 'begin') {
        if (message.huntId !== huntId || completed || (message.afterReset ? message.cycleId !== cycleId : message.cycleId !== (cycleId ?? 0) + 1)) return { ok: false, error: 'stale-cycle' }
        releaseA()
        if (fossilButtons) {
          if (!message.afterReset) return { ok: false, error: 'invalid-fossil-reset' }
          const state = getState()
          const existing = inspect(state, layout)
          if (existing.status !== 'pending') return { ok: false, error: existing.reason ?? 'state-unavailable' }
          baselineEnemy = captureBaseline(state, layout)
          if (!baselineEnemy) return { ok: false, error: 'state-unavailable' }
          fossilInputIndex = 0
          fossilStarted = true
          return { ok: true }
        }
        if (starterButtons) {
          if (!message.afterReset) return { ok: false, error: 'invalid-starter-choice' }
          const state = getState()
          const existing = inspect(state, layout)
          if (existing.status === 'normal' || existing.status === 'shiny') return { ok: false, error: 'starter-already-owned' }
          if (existing.status !== 'pending') return { ok: false, error: 'state-unavailable' }
          baselineEnemy = captureBaseline(state, layout)
          if (!baselineEnemy) return { ok: false, error: 'state-unavailable' }
          starterInputIndex = 0
          starterStarted = true
          return { ok: true }
        }
        let existing
        let baseline
        try {
          const state = message.afterReset ? null : getState()
          existing = state && baselineEnemy ? inspect(state, { ...layout, baselineEnemy }) : null
          const alreadyEncountered = existing?.status === 'normal' || existing?.status === 'shiny'
          baseline = message.afterReset || alreadyEncountered ? baselineEnemy : captureBaseline(state, layout)
        } catch { return { ok: false, error: 'state-unavailable' } }
        if (existing?.status === 'error') return { ok: false, error: 'state-unavailable' }
        if (!baseline) return { ok: false, error: 'state-unavailable' }
        baselineEnemy = baseline
        cycleId = message.cycleId
        pressIndex = 0
        return existing?.status === 'normal' || existing?.status === 'shiny' ? { ok: true, alreadyEncountered: true } : { ok: true }
      }
      if (!current(message)) return { ok: false, error: 'stale-cycle' }
      if (message.type === 'release-input') {
        releaseA()
        return { ok: true }
      }
      if (message.type === 'phase') return completed ? { ok: false, error: 'completed' } : { ok: true, ...inspectPhase(getState(), layout) }
      if (message.type === 'tap') {
        if (!starterButtons || completed || heldButton || aDown || !['LEFT', 'RIGHT'].includes(message.button) || starterButtons[starterInputIndex] !== message.button) return { ok: false, error: 'invalid-input-order' }
        const token = {}
        const initialFrame = getFrameNumber()
        pendingTap = token
        heldButton = message.button
        try {
          setButton(heldButton, true)
          // A timer shorter than a rendered batch can miss every emulated frame.
          // The bag uses JOY_NEW, so keeping this single edge until sampling is safe.
          for (let attempt = 0; attempt < 50; attempt += 1) {
            await wait(HOENN_DIRECTION_TAP_MS)
            if (!current(message) || pendingTap !== token) return { ok: false, error: 'stale-cycle' }
            if (initialFrame === null || getFrameNumber() !== initialFrame) break
            if (attempt === 49) throw new Error('input-frame-timeout')
          }
          starterInputIndex += 1
          return { ok: true }
        } finally {
          if (pendingTap === token) releaseA()
        }
      }
      if (message.type === 'input') {
        if (message.button !== undefined) {
          if (completed || !['A', 'B', 'UP', 'DOWN', 'LEFT', 'RIGHT'].includes(message.button) || typeof message.down !== 'boolean') return { ok: false, error: 'invalid-input' }
          if (fossilButtons && message.stage === 'encounter' && (!fossilStarted || fossilButtons[fossilInputIndex] !== message.button)) return { ok: false, error: 'invalid-input-order' }
          if (starterButtons && message.stage === 'encounter' && (!starterStarted || message.button !== 'A' || !starterRepeat && starterButtons[starterInputIndex] !== 'A')) return { ok: false, error: 'invalid-input-order' }
          if (message.down) {
            if (heldButton || aDown) {
              releaseA()
              return { ok: false, error: 'invalid-input-order' }
            }
            if (message.stage === 'navigation' || message.stage === 'encounter') {
              const result = inspectCurrent()
              if (result.status !== 'pending') return { ok: false, error: result.status === 'normal' || result.status === 'shiny' ? 'enemy-already-created' : 'unsafe-state' }
            }
            if (message.stage === 'exit') {
              if (!['A', 'B', 'DOWN', 'RIGHT'].includes(message.button)) return { ok: false, error: 'invalid-input' }
            }
            heldButton = message.button
            setButton(heldButton, true)
          } else {
            if (heldButton !== message.button) return { ok: false, error: 'invalid-input-order' }
            releaseA()
            if (starterButtons && message.stage === 'encounter') starterInputIndex += 1
            if (fossilButtons && message.stage === 'encounter') fossilInputIndex += 1
          }
          return { ok: true }
        }
        if (!Number.isInteger(message.pressIndex) || message.pressIndex < 1 || message.pressIndex > 5 || typeof message.down !== 'boolean') return { ok: false, error: 'invalid-input' }
        if (!message.down) {
          if (!aDown || message.pressIndex !== pressIndex + 1) return { ok: false, error: 'invalid-input-order' }
          releaseA()
          pressIndex = message.pressIndex
          return { ok: true }
        }
        if (aDown || message.pressIndex !== pressIndex + 1) return { ok: false, error: 'invalid-input-order' }
        const result = inspectCurrent()
        if (result.status !== 'pending') return { ok: false, error: result.status === 'normal' || result.status === 'shiny' ? 'enemy-already-created' : 'unsafe-state' }
        setA(true)
        aDown = true
        return { ok: true }
      }
      if (message.type === 'inspect') {
        if (completed) return { ok: false, error: 'completed' }
        if (message.configured || fossilButtons) return { ok: true, ...inspectCurrent() }
        if (pressIndex !== 5 || aDown) return { ok: true, status: 'pending' }
        const result = inspect(getState(), { ...layout, baselineEnemy })
        return { ok: true, ...result }
      }
      if (message.type === 'save') {
        if (savedCycleId === cycleId) {
          if (message.complete) completed = true
          return { ok: true }
        }
        if (!saving || saving.cycleId !== cycleId) saving = { cycleId, promise: Promise.resolve(saveState()) }
        let saved
        try { saved = await saving.promise }
        finally { if (saving?.cycleId === cycleId) saving = null }
        if (saved) savedCycleId = cycleId
        if (saved && message.complete) completed = true
        return { ok: saved }
      }
      return { ok: false, error: 'unknown-command' }
    } catch (error) {
      releaseA()
      return { ok: false, error: error.message }
    }
  }

  return { handle, releaseA, isActive: () => huntId !== null }
}
