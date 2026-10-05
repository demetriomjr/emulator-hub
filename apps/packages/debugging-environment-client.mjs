export async function loadDebuggingEnvironment({ fetch = globalThis.fetch?.bind(globalThis) } = {}) {
  try {
    const response = await fetch('/api/debug/environment', { cache: 'no-store', signal: AbortSignal.timeout(3000) })
    const environment = response.ok ? await response.json() : null
    return { rngDebugLogging: environment?.rngDebugLogging === true }
  } catch { return { rngDebugLogging: false } }
}
