export const LAST_MACRO_ID_KEY = 'emulator-hub:last-macro-id'

export function createLastMacroAction({ storage, listMacros, getRunState, start, stop }) {
  let lookingUp = false
  const readId = () => { try { return storage?.getItem(LAST_MACRO_ID_KEY) } catch { return null } }
  return {
    remember(id) {
      if (typeof id !== 'string' || !id) return
      try { storage?.setItem(LAST_MACRO_ID_KEY, id) } catch { /* A blocked sessionStorage must not prevent a macro from running. */ }
    },
    async toggle() {
      const { phase, runId } = getRunState()
      if (runId) {
        if (phase !== 'stopping') await stop()
        return
      }
      if (lookingUp) return
      const id = readId()
      if (!id) return
      lookingUp = true
      try {
        const macros = await listMacros()
        if (getRunState().runId || readId() !== id) return
        const macro = macros.find(candidate => candidate.id === id)
        if (macro) await start(macro)
        else { try { storage?.removeItem(LAST_MACRO_ID_KEY) } catch { /* Ignore unavailable sessionStorage. */ } }
      } finally { lookingUp = false }
    },
  }
}
