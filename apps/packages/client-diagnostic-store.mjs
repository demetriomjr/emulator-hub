const sources = new Set(['hub', 'player'])
const kinds = new Set(['uncaught-error', 'unhandled-rejection', 'network-error', 'emulator-failure', 'emulator-frame-stall', 'emulator-lifecycle'])
const maximumMessageLength = 512
const maximumStackLength = 2_048
const maximumUserAgentLength = 512

export function createClientDiagnosticStore({ capacity = 200, now = () => new Date().toISOString() } = {}) {
  if (!Number.isInteger(capacity) || capacity < 1) throw new TypeError('Diagnostic capacity must be a positive integer.')
  const events = []

  return {
    append(input) {
      const event = normalizeClientDiagnostic(input, now)
      events.unshift(event)
      events.splice(capacity)
      return clone(event)
    },
    list({ sessionId } = {}) {
      return events
        .filter(event => sessionId === undefined || event.sessionId === sessionId)
        .map(clone)
    },
  }
}

export function normalizeClientDiagnostic(input, now = () => new Date().toISOString()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalidDiagnostic()
  const sessionId = requiredString(input.sessionId, 128)
  const source = requiredString(input.source, 16)
  const kind = requiredString(input.kind, 32)
  if (!safeSessionId(sessionId) || !sources.has(source) || !kinds.has(kind)) throw invalidDiagnostic()

  const event = { at: now(), sessionId, source, kind }
  addString(event, 'message', input.message, maximumMessageLength)
  addString(event, 'name', input.name, 128)
  addString(event, 'stack', input.stack, maximumStackLength)
  addPath(event, 'page', input.page)
  addString(event, 'userAgent', input.userAgent, maximumUserAgentLength)
  addViewport(event, input.viewport)
  addRequest(event, input.request)
  return event
}

function addString(target, key, value, maximumLength) {
  if (value === undefined) return
  if (typeof value !== 'string' || value.length > maximumLength) throw invalidDiagnostic()
  target[key] = value
}

function addPath(target, key, value) {
  if (value === undefined) return
  if (typeof value !== 'string' || value.length > 512) throw invalidDiagnostic()
  let pathname
  try { pathname = new URL(value, 'https://emulator-hub.invalid').pathname } catch { throw invalidDiagnostic() }
  if (!pathname.startsWith('/')) throw invalidDiagnostic()
  target[key] = pathname
}

function addViewport(target, value) {
  if (value === undefined) return
  if (!value || typeof value !== 'object' || !validDimension(value.width) || !validDimension(value.height)) throw invalidDiagnostic()
  target.viewport = { width: value.width, height: value.height }
}

function addRequest(target, value) {
  if (value === undefined) return
  if (!value || typeof value !== 'object' || typeof value.method !== 'string' || !/^[A-Z]{3,10}$/.test(value.method)) throw invalidDiagnostic()
  const request = { method: value.method }
  if (value.status !== undefined) {
    if (!Number.isInteger(value.status) || value.status < 100 || value.status > 599) throw invalidDiagnostic()
    request.status = value.status
  }
  addPath(request, 'path', value.path ?? value.url)
  if (!request.path) throw invalidDiagnostic()
  target.request = request
}

function requiredString(value, maximumLength) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximumLength) throw invalidDiagnostic()
  return value
}

function validDimension(value) { return Number.isInteger(value) && value >= 0 && value <= 16_384 }
function safeSessionId(value) { return /^[A-Za-z0-9_-]+$/.test(value) }
function invalidDiagnostic() { return Object.assign(new Error('Client diagnostic is invalid.'), { code: 'CLIENT_DIAGNOSTIC_INVALID' }) }
function clone(event) { return structuredClone(event) }
