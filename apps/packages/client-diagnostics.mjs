import { frontendEventEndpoint } from './frontend-events.mjs'
import { getFrontendEventTransport } from './frontend-event-transport.mjs'
export const clientDiagnosticEndpoint = frontendEventEndpoint

export function getClientDiagnosticsOptions(debugValue, search = '', createSessionId = defaultSessionId) {
  const parameters = new URLSearchParams(search)
  const verbose = String(debugValue ?? '').trim() === '1'
  const supplied = parameters.get('debugSession')
  return { enabled: true, verbose, sessionId: isSessionId(supplied) ? supplied : createSessionId() }
}

export function appendClientDiagnosticsParameters(parameters, options) {
  if (!options?.enabled) return parameters
  parameters.set('debugSession', options.sessionId)
  return parameters
}

export function createClientDiagnostics({ browser = window, source = 'player', sessionId, report, enabled = true } = {}) {
  if (!isSessionId(sessionId)) throw new TypeError('A client diagnostic session ID is required.')
  const originalFetch = browser.fetch?.bind(browser)
  const transport = report ? null : getFrontendEventTransport(browser)
  transport?.setEnabled(enabled)
  const send = report ?? (event => transport.send(event))
  const common = () => ({ sessionId, source, page: browser.location.pathname, userAgent: browser.navigator?.userAgent ?? '', viewport: { width: browser.innerWidth, height: browser.innerHeight } })
  const capture = event => {
    if (!enabled) return
    const record = { ...common(), ...event }
    const output = event.kind === 'uncaught-error' || event.kind === 'unhandled-rejection' || event.kind === 'network-error' ? 'error' : event.message?.includes('rejected') || event.message?.includes('failed') ? 'warn' : 'info'
    try { browser.console?.[output]?.('[client-diagnostics]', record) } catch {}
    try { void Promise.resolve(send(record)).catch(() => {}) } catch {}
  }
  const onError = event => {
    const error = event.error ?? event
    capture(errorEvent('uncaught-error', error))
  }
  const onUnhandledRejection = event => capture(errorEvent('unhandled-rejection', event.reason))
  const wrappedFetch = originalFetch && (async (input, init) => {
    if (!enabled) return originalFetch(input, init)
    const request = requestDetails(input, init, browser.location.origin)
    try {
      const response = await originalFetch(input, init)
      if (request && !response.ok) capture({ kind: 'network-error', message: `Request failed (${response.status})`, request: { ...request, status: response.status } })
      return response
    } catch (error) {
      if (request) capture({ kind: 'network-error', message: errorMessage(error), request })
      throw error
    }
  })

  browser.addEventListener('error', onError)
  browser.addEventListener('unhandledrejection', onUnhandledRejection)
  if (wrappedFetch) browser.fetch = wrappedFetch
  const restorePermissionDiagnostics = instrumentPermissionRejections(browser, capture)
  return {
    get enabled() { return enabled },
    setEnabled(value) { enabled = value === true; transport?.setEnabled(enabled) },
    sessionId,
    capture,
    dispose() {
      enabled = false; transport?.setEnabled(false)
      browser.removeEventListener('error', onError)
      browser.removeEventListener('unhandledrejection', onUnhandledRejection)
      if (browser.fetch === wrappedFetch) browser.fetch = originalFetch
      restorePermissionDiagnostics()
    },
  }
}

function instrumentPermissionRejections(browser, capture) {
  const restores = [
    wrapPromiseMethod(browser.AudioContext?.prototype, 'resume', 'AudioContext.resume', capture),
    ...(browser.webkitAudioContext !== browser.AudioContext ? [wrapPromiseMethod(browser.webkitAudioContext?.prototype, 'resume', 'webkitAudioContext.resume', capture)] : []),
    wrapPromiseMethod(browser.navigator?.wakeLock, 'request', 'navigator.wakeLock.request', capture),
    wrapPromiseMethod(browser.screen?.orientation, 'lock', 'screen.orientation.lock', capture),
    wrapPromiseMethod(browser.navigator?.mediaDevices, 'getUserMedia', 'navigator.mediaDevices.getUserMedia', capture),
  ]
  return () => restores.forEach(restore => restore?.())
}

function wrapPromiseMethod(target, method, label, capture) {
  const original = target?.[method]
  if (typeof original !== 'function') return null
  const wrapped = function (...args) {
    const result = original.apply(this, args)
    Promise.resolve(result).catch(error => capture({
      kind: 'emulator-failure',
      message: `Permission denied at ${label}`,
      ...(typeof error?.name === 'string' ? { name: error.name } : {}),
      ...(typeof error?.stack === 'string' ? { stack: error.stack } : {}),
    }))
    return result
  }
  try {
    target[method] = wrapped
  } catch {
    return null
  }
  return () => { if (target[method] === wrapped) target[method] = original }
}

function requestDetails(input, init, origin) {
  const rawUrl = typeof input === 'string' ? input : input?.url
  if (!rawUrl) return null
  let url
  try { url = new URL(rawUrl, origin) } catch { return null }
  if (url.origin !== origin || url.pathname === clientDiagnosticEndpoint || !url.pathname.startsWith('/api/')) return null
  return { method: String(init?.method ?? input?.method ?? 'GET').toUpperCase(), path: url.pathname }
}

function errorEvent(kind, error) {
  return {
    kind,
    message: errorMessage(error).slice(0, 512),
    ...(typeof error?.name === 'string' ? { name: error.name.slice(0, 128) } : {}),
    ...(typeof error?.stack === 'string' ? { stack: error.stack.slice(0, 2048) } : {}),
  }
}

function errorMessage(error) {
  if (typeof error?.message === 'string') return error.message
  if (typeof error === 'string') return error
  return String(error ?? 'Unknown client error')
}

function isSessionId(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) }
function defaultSessionId() { return globalThis.crypto?.randomUUID?.().replaceAll('-', '') ?? `${Date.now()}${Math.random()}`.replace('.', '') }
