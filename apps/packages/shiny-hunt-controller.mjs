import { getShinyHuntStartSequence, resolveShinyHuntStartPlan } from './shiny-hunt-start-sequence.mjs'

const FIRST_A_DELAY_MS = 2000
const A_INTERVAL_MS = 1000
const A_HOLD_MS = 40
const ENCOUNTER_WAIT_MS = 1000
const COMMON_DIRECTION_HOLD_MS = 400
const COMMON_DIRECTION_INTERVAL_MS = 50
const PENDING_INTERVAL_MS = 500
const MAX_PENDING_READS = 20
const MAX_SCHEDULE_LAG_MS = 500

function abortError() {
  const error = new Error('Shiny hunt stopped')
  error.name = 'AbortError'
  return error
}

function sleepWithAbort(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError())
    const timeout = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, ms)
    const abort = () => { clearTimeout(timeout); reject(abortError()) }
    signal.addEventListener('abort', abort, { once: true })
  })
}

export function createShinyHuntController({ now = () => performance.now(), sleep = sleepWithAbort, getGameCode = session => session.gameCode, prepare, reset, confirmReset, pulse, begin, input, tap, releaseInput, inspect, inspectPhase, saveState, release, onStatus = () => {} }) {
  let active = null
  let lastStatus = { phase: 'idle', resetCount: 0 }

  function publish(status) {
    lastStatus = status
    onStatus(status)
    return status
  }

  function check(signal) {
    if (signal.aborted) throw abortError()
  }

  async function waitUntil(time, signal) {
    const lag = now() - time
    if (lag > MAX_SCHEDULE_LAG_MS) throw new Error('A timing deadline was missed')
    if (lag < 0) await sleep(-lag, signal)
    check(signal)
  }

  async function run(sessions, signal) {
    let resetCount = 0
    await prepare(sessions, signal)
    check(signal)
    while (true) {
      publish({ phase: 'resetting', resetCount })
      const cycleId = resetCount + 1
      await Promise.all(sessions.map(session => reset(session, signal, cycleId)))
      check(signal)
      resetCount += 1
      publish({ phase: 'pressing', resetCount })
      const resetConfirmedAt = now()
      for (let index = 1; index <= 5; index += 1) {
        await waitUntil(resetConfirmedAt + FIRST_A_DELAY_MS + (index - 1) * A_INTERVAL_MS, signal)
        await pulse(sessions, true, index, signal, cycleId)
        try { await sleep(A_HOLD_MS, signal) }
        finally { await pulse(sessions, false, index, signal, cycleId) }
        check(signal)
      }
      publish({ phase: 'inspecting', resetCount })
      await sleep(ENCOUNTER_WAIT_MS, signal)
      let pending = sessions
      const results = new Map()
      for (let attempt = 0; attempt < MAX_PENDING_READS; attempt += 1) {
        check(signal)
        const replies = await Promise.all(pending.map(async session => {
          try { return [session, await inspect(session, signal, cycleId)] }
          catch { return [session, { status: 'error' }] }
        }))
        check(signal)
        const shiny = replies.find(([, reply]) => reply.status === 'shiny')
        if (shiny) {
          const [session, reply] = shiny
          const found = { resetCount, foundSessionId: session.sessionId, ...(reply.species !== undefined ? { species: reply.species } : {}) }
          publish({ phase: 'saving', ...found })
          const saves = await Promise.allSettled(sessions.map(candidate => saveState(candidate, signal, cycleId)))
          const failedSave = saves.find(result => result.status === 'rejected')
          if (failedSave) throw failedSave.reason
          return publish({ phase: 'found', ...found })
        }
        for (const [session, reply] of replies) {
          if (reply.status === 'error') throw new Error('Encounter inspection failed in ' + session.sessionId)
          if (reply.status === 'normal') results.set(session.sessionId, reply)
          else if (reply.status !== 'pending') throw new Error('Invalid encounter result from ' + session.sessionId)
        }
        pending = sessions.filter(session => !results.has(session.sessionId))
        if (pending.length === 0) break
        await sleep(PENDING_INTERVAL_MS, signal)
      }
      if (pending.length > 0) throw new Error('Encounter inspection timed out')
    }
  }

  async function runConfigured(sessions, signal, config) {
    const { resetMode, startMode, stopMode } = config
    if (!['soft-reset', 'exit-encounter'].includes(resetMode) || !['interact-a', 'walk-right', 'walk-left', 'walk-up', 'common', 'hoenn-starter', 'fossil'].includes(startMode) || !['first-shiny', 'all-shiny'].includes(stopMode)) throw new Error('Configuração de caça inválida')
    getShinyHuntStartSequence(config)
    if (startMode === 'hoenn-starter' && resetMode !== 'soft-reset') throw new Error('Caça de iniciais requer soft reset')
    if (startMode === 'fossil' && resetMode !== 'soft-reset') throw new Error('invalid-fossil-reset')
    if (typeof begin !== 'function' || typeof input !== 'function' || resetMode === 'exit-encounter' && typeof inspectPhase !== 'function') throw new Error('Entrada de caça indisponível')
    const completed = new Set()
    const plans = new Map()
    const foundIds = new Set()
    const progress = new Map(sessions.map(session => [session.sessionId, { cycleId: 0, attemptCount: 0, phase: 'starting' }]))
    const workers = new Map(sessions.map(session => [session.sessionId, new AbortController()]))
    let winner = null
    let fatal = null
    let initialResetAt = null
    const details = () => {
      const attemptCount = [...progress.values()].reduce((total, item) => total + item.attemptCount, 0)
      return {
        running: true, attemptCount, resetCount: attemptCount,
        completedSessionIds: [...completed],
        activeSessionIds: sessions.filter(session => !completed.has(session.sessionId)).map(session => session.sessionId),
        foundSessionIds: [...foundIds],
        ...(winner ? { foundSessionId: winner.sessionId } : {}),
      }
    }
    const status = (phase, sessionId) => {
      if (sessionId) progress.get(sessionId).phase = phase
      return publish({ phase, ...details() })
    }
    const abortOthers = exceptId => {
      for (const [sessionId, worker] of workers) if (sessionId !== exceptId) worker.abort()
    }
    const abortAll = () => abortOthers(null)
    signal.addEventListener('abort', abortAll, { once: true })
    const saveWithRetry = async (session, saveSignal, cycleId) => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        check(signal)
        try {
          const result = await saveState(session, saveSignal, cycleId)
          if (result === false) throw new Error('State save failed in ' + session.sessionId)
          return result
        }
        catch (error) {
          check(signal)
          if (attempt === 2) throw error
          await sleep(PENDING_INTERVAL_MS, saveSignal)
        }
      }
    }
    const resetWithConfirmation = async (session, resetSignal, cycleId) => {
      try { return await reset(session, resetSignal, cycleId) }
      catch (error) {
        if (error.message !== 'Player request timed out' || !confirmReset) throw error
        for (let attempt = 0; attempt < 10; attempt += 1) {
          check(signal)
          check(resetSignal)
          await sleep(PENDING_INTERVAL_MS, resetSignal)
          try { if (await confirmReset(session, resetSignal, cycleId)) return }
          catch { check(signal); check(resetSignal) }
        }
        throw error
      }
    }
    const runSession = async session => {
      const state = progress.get(session.sessionId)
      const plan = plans.get(session.sessionId)
      const workerSignal = workers.get(session.sessionId).signal
      let inputStage = 'encounter'
      let lastNormalAt = null
      let initialReset = true
      const checkWork = () => {
        check(signal)
        check(workerSignal)
        if (winner || fatal) throw abortError()
      }
      const waitAtLeast = async target => {
        checkWork()
        const remaining = target - now()
        if (remaining > 0) await sleep(remaining, workerSignal)
        checkWork()
      }
      const hold = async (button, ms) => {
        checkWork()
        try { await input(session, button, true, workerSignal, state.cycleId, inputStage) }
        catch (error) {
          error.huntInputPhase = 'down'
          if (error.message === 'Player request timed out' && releaseInput) await releaseInput(session, workerSignal, state.cycleId)
          throw error
        }
        try { await sleep(ms, workerSignal) }
        finally {
          try { await input(session, button, false, workerSignal, state.cycleId, inputStage) }
          catch (error) {
            if (!workerSignal.aborted) {
              error.huntInputPhase = 'up'
              if (error.message === 'Player request timed out' && releaseInput) await releaseInput(session, workerSignal, state.cycleId)
              throw error
            }
          }
        }
        checkWork()
      }
      const read = async () => {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          checkWork()
          let reply
          try { reply = await inspect(session, workerSignal, state.cycleId) }
          catch (error) {
            checkWork()
            if (attempt === 2) throw error
            await sleep(PENDING_INTERVAL_MS, workerSignal)
            continue
          }
          checkWork()
          if (reply && ['pending', 'normal', 'shiny'].includes(reply.status)) return reply
          if (attempt === 2) throw new Error('Encounter inspection failed in ' + session.sessionId)
          await sleep(PENDING_INTERVAL_MS, workerSignal)
        }
      }
      const holdOrReadEncounter = async (button, ms) => {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try { await hold(button, ms); return null }
          catch (error) {
            if (!['enemy-already-created', 'unsafe-state', 'invalid-input-order', 'Player request timed out'].includes(error.message)) throw error
            if (error.message === 'invalid-input-order' && error.huntInputPhase !== 'down') throw error
            for (let readIndex = 0; readIndex < MAX_PENDING_READS; readIndex += 1) {
              const reply = await read()
              if (reply.status !== 'pending') return reply
              if (error.message === 'unsafe-state' || error.message === 'invalid-input-order') break
              await sleep(PENDING_INTERVAL_MS, workerSignal)
            }
            if (error.message === 'unsafe-state' || error.message === 'invalid-input-order') {
              if (attempt === 2) throw error
              await sleep(PENDING_INTERVAL_MS, workerSignal)
              continue
            }
            if (error.message === 'Player request timed out' && releaseInput && (button !== 'A' || error.huntInputPhase === 'up')) return null
            throw new Error('Encounter could not be confirmed after ' + error.message + ' in ' + session.sessionId)
          }
        }
      }
      const resultOf = async () => {
        if (startMode !== 'fossil') {
          const existing = await read()
          if (existing.status !== 'pending') return existing
        }
        if (startMode === 'common') {
          let movements = 0
          while (true) {
            for (let index = 0; index < 4; index += 1) {
              if (movements > 0) await sleep(COMMON_DIRECTION_INTERVAL_MS, workerSignal)
              const encounter = await holdOrReadEncounter(movements % 2 === 0 ? 'LEFT' : 'RIGHT', COMMON_DIRECTION_HOLD_MS)
              movements += 1
              if (encounter) return encounter
            }
            const reply = await read()
            if (reply.status !== 'pending') return reply
          }
        }
        if (plan.repeatUntilEncounter) {
          const step = plan.startSequence[0]
          for (let index = 0; index < MAX_PENDING_READS; index++) {
            const pressedAt = now()
            const earlyEncounter = await holdOrReadEncounter(step.button, step.holdMs)
            if (earlyEncounter) return earlyEncounter
            await waitAtLeast(pressedAt + step.intervalMs)
            const reply = await read()
            if (reply.status !== 'pending') return reply
          }
          throw new Error('Encounter inspection timed out in ' + session.sessionId)
        }
        for (const step of plan.startSequence) {
          checkWork()
          const pressedAt = now()
          if (step.localTap) {
            // One iframe command owns both edges. Never retry a direction on timeout.
            await tap(session, step.button, workerSignal, state.cycleId)
          } else if (startMode === 'fossil') {
            // Complete the NPC dialogue, including both B, before inspection.
            await hold(step.button, step.holdMs)
          } else {
            const earlyEncounter = await holdOrReadEncounter(step.button, step.holdMs)
            if (earlyEncounter) return earlyEncounter
          }
          if (step.intervalMs) await waitAtLeast(pressedAt + step.intervalMs)
          if (step.releaseIntervalMs) await sleep(step.releaseIntervalMs, workerSignal)
        }
        if (startMode === 'interact-a' || startMode === 'hoenn-starter') await sleep(ENCOUNTER_WAIT_MS, workerSignal)
        for (let readIndex = 0; readIndex < MAX_PENDING_READS; readIndex += 1) {
          const reply = await read()
          if (reply.status !== 'pending') return reply
          await sleep(PENDING_INTERVAL_MS, workerSignal)
        }
        throw new Error('Encounter inspection timed out in ' + session.sessionId)
      }
      while (true) {
        checkWork()
        let fallbackReset = false
        if (resetMode === 'exit-encounter' && state.cycleId > 0) {
          status('exiting', session.sessionId)
          inputStage = 'exit'
          await waitAtLeast(lastNormalAt + 1300)
          try {
            for (let index = 0; index < 4; index += 1) {
              await hold('B', 200)
              await sleep(200, workerSignal)
            }
            await hold('DOWN', 200)
            await sleep(200, workerSignal)
            await hold('RIGHT', 200)
            await sleep(200, workerSignal)
            await hold('A', 400)
            await sleep(400, workerSignal)
            await hold('A', 400)
            await sleep(800, workerSignal)
          }
          catch (error) {
            checkWork()
            if (!['Player request timed out', 'invalid-input-order', 'unsafe-state'].includes(error.message)) throw error
            fallbackReset = true
          }
          checkWork()
          if (!fallbackReset) {
            for (let attempt = 0; attempt < 3; attempt += 1) {
              let phase
              try { phase = await inspectPhase(session, workerSignal, state.cycleId) }
              catch { checkWork() }
              checkWork()
              if (phase?.status === 'map') break
              if (attempt === 2) fallbackReset = true
              else await sleep(PENDING_INTERVAL_MS, workerSignal)
            }
          }
          status('exiting', session.sessionId)
        }
        state.cycleId += 1
        const afterReset = state.cycleId === 1 || resetMode === 'soft-reset' || fallbackReset
        if (afterReset) {
          if (!initialReset) {
            status('resetting', session.sessionId)
            await resetWithConfirmation(session, workerSignal, state.cycleId)
            checkWork()
            status('pressing', session.sessionId)
          }
          inputStage = 'navigation'
          let nextPressAt = (initialReset ? initialResetAt : now()) + FIRST_A_DELAY_MS
          let encounterDuringNavigation = false
          for (let index = 0; index < 4; index += 1) {
            await waitAtLeast(nextPressAt)
            nextPressAt = now() + A_INTERVAL_MS
            const encountered = await holdOrReadEncounter('A', A_HOLD_MS)
            if (encountered) {
              encounterDuringNavigation = true
              break
            }
          }
          if (!encounterDuringNavigation) await waitAtLeast(nextPressAt)
        }
        initialReset = false
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try { await begin(session, workerSignal, state.cycleId, { afterReset }); break }
          catch (error) {
            checkWork()
            if (error.message !== 'state-unavailable' || attempt === 2) throw error
            await sleep(PENDING_INTERVAL_MS, workerSignal)
          }
        }
        checkWork()
        inputStage = 'encounter'
        status(startMode === 'common' ? 'walking' : 'pressing', session.sessionId)
        const reply = await resultOf()
        // Resets and navigation only prepare a hunt; count a checked Pokemon.
        state.attemptCount += 1
        if (reply.status === 'shiny' && !signal.aborted) {
          foundIds.add(session.sessionId)
          if (stopMode === 'first-shiny') {
            winner ??= { sessionId: session.sessionId, ...reply }
            abortOthers(session.sessionId)
            return
          }
          status('saving', session.sessionId)
          await saveWithRetry(session, workerSignal, state.cycleId)
          completed.add(session.sessionId)
          status('inspecting', session.sessionId)
          return
        }
        checkWork()
        lastNormalAt = now()
        status('inspecting', session.sessionId)
      }
    }
    try {
      await prepare(sessions, signal)
      check(signal)
      for (const session of sessions) {
        const plan = resolveShinyHuntStartPlan(config, getGameCode(session))
        if (plan.startSequence?.some(step => step.localTap) && typeof tap !== 'function') throw new Error('Toque direcional local indisponível')
        plans.set(session.sessionId, plan)
      }
      status('resetting')
      const initialResets = await Promise.allSettled(sessions.map(session => resetWithConfirmation(session, workers.get(session.sessionId).signal, 1)))
      check(signal)
      const failedReset = initialResets.find(result => result.status === 'rejected')
      if (failedReset) throw failedReset.reason
      initialResetAt = now()
      status('pressing')
      const tasks = sessions.map(session => runSession(session).catch(error => {
        if (error.name === 'AbortError' && (signal.aborted || winner || fatal)) return
        if (error && typeof error === 'object') error.huntSessionId = session.sessionId
        fatal ??= error
        abortOthers(session.sessionId)
      }))
      await Promise.all(tasks)
      if (winner) {
        status('saving')
        const saves = await Promise.allSettled(sessions.map(session => saveWithRetry(session, signal, Math.max(1, progress.get(session.sessionId).cycleId))))
        const failedSave = saves.find(result => result.status === 'rejected')
        if (failedSave) throw failedSave.reason
        if (fatal) throw fatal
        return publish({ ...details(), phase: 'found', running: false })
      }
      if (fatal) throw fatal
      check(signal)
      return publish({ ...details(), phase: 'found', running: false })
    } finally {
      signal.removeEventListener('abort', abortAll)
      abortAll()
    }
  }

  return {
    getStatus: () => lastStatus,
    stop() {
      if (!active) return
      active.controller.abort()
      void release(active.sessions).catch(() => {})
    },
    async start(selectedSessions, config = null) {
      if (active) throw new Error('Shiny hunt is already running')
      if (!Array.isArray(selectedSessions) || selectedSessions.length < 1 || selectedSessions.length > 9) throw new Error('Open players are required')
      const sessions = Object.freeze(selectedSessions.map(session => ({ ...session })))
      const controller = new AbortController()
      active = { controller, sessions }
      publish(config ? { phase: 'starting', running: true, resetCount: 0, attemptCount: 0, activeSessionIds: sessions.map(session => session.sessionId), completedSessionIds: [] } : { phase: 'starting', resetCount: 0 })
      try {
        return await (config ? runConfigured(sessions, controller.signal, config) : run(sessions, controller.signal))
      } catch (error) {
        return publish(config
          ? { ...lastStatus, phase: controller.signal.aborted ? 'stopped' : 'error', running: false, error: error.message, ...(error.huntSessionId ? { failedSessionId: error.huntSessionId } : {}) }
          : { phase: controller.signal.aborted ? 'stopped' : 'error', resetCount: lastStatus.resetCount, ...(lastStatus.foundSessionId ? { foundSessionId: lastStatus.foundSessionId } : {}), error: error.message })
      } finally {
        controller.abort()
        await release(sessions).catch(() => {})
        active = null
      }
    },
  }
}
