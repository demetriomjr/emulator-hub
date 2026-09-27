import { createMacroRunner, macroUsesKeyboardKey, validateMacro } from './input-macro-simulator.mjs'

export function createPlayerMacroController({ canRun, setPressed, release = () => {}, schedule = setTimeout, clear = clearTimeout, onEnded }) {
  let prepared = null
  let active = null
  const safeRelease = () => { try { release() } catch { /* The core may have closed. */ } }
  const clearPreparation = () => {
    if (prepared) clear(prepared.expiry)
    prepared = null
  }
  const cancel = () => {
    clearPreparation()
    active?.runner.stop()
    safeRelease()
  }
  return {
    prepare(runId, macro) {
      const validation = validateMacro(macro)
      const error = !canRun(macro) ? 'O player não está pronto para a macro'
        : active || prepared ? 'Já existe uma macro ativa neste player'
          : validation.errors[0]
      if (error) return { ok: false, error }
      const snapshot = structuredClone(macro)
      prepared = { runId, macro: snapshot, expiry: schedule(() => { if (prepared?.runId === runId) prepared = null }, 10000) }
      return { ok: true }
    },
    start(runId) {
      if (prepared?.runId !== runId || !canRun(prepared.macro)) return { ok: false, error: 'Preparo da macro expirou ou player indisponível' }
      const macro = prepared.macro
      clearPreparation()
      const runner = createMacroRunner({
        macro, setPressed, schedule, clear,
        onEnd: outcome => {
          if (active?.runId !== runId) return
          active = null
          safeRelease()
          onEnded(runId, outcome)
        },
      })
      active = { runId, runner, macro }
      try { runner.start(); return { ok: true } }
      catch (error) { active = null; safeRelease(); return { ok: false, error: error.message } }
    },
    stop(runId) {
      if (prepared?.runId === runId || active?.runId === runId) cancel()
      return { ok: true }
    },
    cancel,
    isRunning: () => active !== null,
    usesKeyboardKey: (key, bindings) => active !== null && macroUsesKeyboardKey(active.macro, key, bindings),
  }
}
