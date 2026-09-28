export function createMacroRunCoordinator({ request, onChange = () => {} }) {
  let state = { phase: 'idle', runId: null, macroId: null, error: '' }
  let active = null
  const publish = changes => { state = { ...state, ...changes }; onChange({ ...state }) }
  const stopParticipants = async run => Promise.allSettled(run.participants.map(participant => request(participant, 'stop', run.runId)))
  return {
    getState: () => ({ ...state }),
    async start(macro, participants) {
      if (active || !participants.length) throw new Error(active ? 'Uma macro já está ativa' : 'Nenhum player aberto')
      const run = { runId: crypto.randomUUID(), participants: [...participants], ended: new Set(), completed: false, stopRequested: false }
      active = run
      publish({ phase: 'preparing', runId: run.runId, macroId: macro.id, error: '' })
      try {
        const prepared = await Promise.allSettled(run.participants.map(participant => request(participant, 'prepare', run.runId, macro)))
        const failure = prepared.find(result => result.status === 'rejected')
        if (failure) throw failure.reason
        if (active !== run || run.stopRequested) return false
        publish({ phase: 'starting' })
        const started = await Promise.allSettled(run.participants.map(participant => request(participant, 'start', run.runId)))
        const startFailure = started.find(result => result.status === 'rejected')
        if (startFailure) throw startFailure.reason
        if (active !== run || run.stopRequested) return run.completed
        if (run.ended.size === run.participants.length) { active = null; publish({ phase: 'idle', runId: null, macroId: null }); return true }
        publish({ phase: 'running' })
        return true
      } catch (error) {
        const stopped = await stopParticipants(run)
        if (active === run) {
          const unconfirmed = stopped.find(result => result.status === 'rejected')
          if (unconfirmed) publish({ phase: 'running', error: `Falha ao iniciar: ${error.message}. Parada não confirmada: ${unconfirmed.reason.message}` })
          else { active = null; publish({ phase: 'failed', runId: null, macroId: null, error: error.message }) }
        }
        throw error
      }
    },
    async stop() {
      const run = active
      if (!run) return
      run.stopRequested = true
      publish({ phase: 'stopping' })
      const results = await stopParticipants(run)
      if (active !== run) return
      const failure = results.find(result => result.status === 'rejected')
      if (failure) { publish({ phase: 'running', error: 'Parada não confirmada: ' + failure.reason.message }); throw failure.reason }
      active = null
      publish({ phase: 'idle', runId: null, macroId: null, error: '' })
    },
    async lost(participant) {
      const run = active
      if (!run || !run.participants.includes(participant)) return
      run.participants = run.participants.filter(candidate => candidate !== participant)
      run.ended.delete(participant)
      if (!run.participants.length) { active = null; publish({ phase: 'failed', runId: null, macroId: null, error: 'Player da macro indisponível' }); return }
      await this.stop()
      if (!active && state.phase === 'idle') publish({ phase: 'failed', error: 'Player da macro indisponível' })
    },
    ended(participant, runId, outcome) {
      const run = active
      if (!run || run.runId !== runId || !run.participants.includes(participant)) return
      run.ended.add(participant)
      if (outcome === 'failed' || (outcome === 'stopped' && state.phase !== 'stopping')) {
        void this.stop().catch(() => {}).finally(() => {
          if (outcome === 'failed' && !active && state.phase === 'idle') publish({ phase: 'failed', error: 'A macro falhou em um player' })
        })
        return
      }
      if (run.ended.size === run.participants.length && state.phase !== 'stopping') {
        run.completed = true
        active = null
        publish({ phase: 'idle', runId: null, macroId: null, error: '' })
      }
    },
  }
}
