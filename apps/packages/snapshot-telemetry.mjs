const endpoint = '/api/debug/client-events'
const repeatWindowMs = 60_000
const stringFields = new Set(['snapshotKind', 'candidateId', 'reason', 'phase', 'code', 'error'])
const integerFields = new Set(['revision', 'saveRevision', 'candidateCount', 'status'])

export function createSnapshotTelemetry({ browser = window, source, sessionId, gameId, profileId, now = Date.now } = {}) {
  const lastRepeat = new Map()
  const emit = (level, event, context = {}, { repeating = false, once = false } = {}) => {
    if (repeating || once) {
      const key = `${event}:${context.snapshotKind ?? ''}:${context.phase ?? ''}:${context.reason ?? ''}:${context.code ?? ''}`
      const previous = lastRepeat.get(key)
      const current = now()
      if (previous !== undefined && (once || current - previous < repeatWindowMs)) return
      lastRepeat.set(key, current)
    }
    const record = { sessionId, source, kind: 'snapshot-flow', level, page: browser.location?.pathname ?? '/', message: event, gameId, profileId }
    for (const [key, value] of Object.entries(context)) {
      if (stringFields.has(key) && typeof value === 'string') record[key] = value.slice(0, key === 'error' ? 512 : 256)
      else if (integerFields.has(key) && Number.isSafeInteger(value) && value >= 0) record[key] = value
    }
    try { browser.console?.[level]?.('[snapshot-flow]', record) } catch {}
    void Promise.resolve().then(() => browser.fetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(record), keepalive: true,
    })).catch(() => {})
  }
  return {
    info(event, context, options) { emit('info', event, context, options) },
    warn(event, context, options) { emit('warn', event, context, options) },
    error(event, context, options) { emit('error', event, context, options) },
  }
}

export function createContainerPipelineLogger({ output = console, now = Date.now } = {}) {
  const repeated = new Map()
  const emit = (level, event, context = {}) => {
    if (level === 'info' && event.startsWith('save.backend.') && !['save.backend.persisted', 'save.backend.adopted'].includes(event)) return
    if (level !== 'info' && context.kind === 'cloud-recovery' && ['snapshot.backend.put-rejected', 'snapshot.backend.lease-rejected'].includes(event)) {
      const key = `${event}:${context.profileId}:${context.gameId}:${context.code ?? ''}:${context.reason ?? ''}`
      const current = now()
      const previous = repeated.get(key)
      if (previous !== undefined && current - previous < repeatWindowMs) return
      repeated.set(key, current)
      if (repeated.size > 512) for (const [candidate, at] of repeated) if (current - at >= repeatWindowMs) repeated.delete(candidate)
      if (repeated.size > 512) repeated.delete(repeated.keys().next().value)
    }
    try { output[level]('[save-pipeline]', { timestamp: new Date().toISOString(), level, event, ...context }) } catch {}
  }
  return {
    info(event, context) { emit('info', event, context) },
    warn(event, context) { emit('warn', event, context) },
    error(event, context) { emit('error', event, context) },
  }
}
