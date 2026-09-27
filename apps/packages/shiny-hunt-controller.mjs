const FIRST_A_DELAY_MS = 2000
const A_INTERVAL_MS = 1000
const A_HOLD_MS = 40
const ENCOUNTER_WAIT_MS = 1000
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

export function createShinyHuntController({ now = () => performance.now(), sleep = sleepWithAbort, prepare, reset, pulse, inspect, saveState, release, onStatus = () => {} }) {
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
          await Promise.all(sessions.map(candidate => saveState(candidate, signal, cycleId)))
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

  return {
    getStatus: () => lastStatus,
    stop() {
      if (!active) return
      active.controller.abort()
      void release(active.sessions).catch(() => {})
    },
    async start(selectedSessions) {
      if (active) throw new Error('Shiny hunt is already running')
      if (!Array.isArray(selectedSessions) || selectedSessions.length < 1 || selectedSessions.length > 9) throw new Error('Open players are required')
      const sessions = Object.freeze(selectedSessions.map(session => ({ ...session })))
      const controller = new AbortController()
      active = { controller, sessions }
      publish({ phase: 'starting', resetCount: 0 })
      try {
        return await run(sessions, controller.signal)
      } catch (error) {
        return publish({ phase: error.name === 'AbortError' ? 'stopped' : 'error', resetCount: lastStatus.resetCount, ...(lastStatus.foundSessionId ? { foundSessionId: lastStatus.foundSessionId } : {}), error: error.message })
      } finally {
        controller.abort()
        await release(sessions).catch(() => {})
        active = null
      }
    },
  }
}
