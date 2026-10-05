import assert from 'node:assert/strict'
import { test } from 'node:test'

import { appendClientDiagnosticsParameters, createClientDiagnostics, getClientDiagnosticsOptions } from './client-diagnostics.mjs'

function createWindow(search = '') {
  const listeners = new Map()
  const consoleEvents = []
  return {
    location: { search, pathname: '/player.html', origin: 'https://hub.test' },
    navigator: { userAgent: 'Mozilla/5.0 (iPhone)' },
    innerWidth: 390,
    innerHeight: 844,
    addEventListener(type, listener) { listeners.set(type, listener) },
    removeEventListener(type) { listeners.delete(type) },
    emit(type, event) { listeners.get(type)?.(event) },
    fetch: async () => { throw new Error('offline') },
    console: { info: (...args) => consoleEvents.push(args), warn: (...args) => consoleEvents.push(args), error: (...args) => consoleEvents.push(args) },
    consoleEvents,
  }
}

test('live debugging switch suppresses diagnostics and console, and can resume', () => {
  const browser = createWindow(), reported = []
  const diagnostics = createClientDiagnostics({ browser, sessionId: 'live-switch', report: event => reported.push(event), enabled: false })
  diagnostics.capture({ kind: 'rng-reset', message: 'disabled' })
  assert.equal(reported.length, 0); assert.equal(browser.consoleEvents.length, 0)
  diagnostics.setEnabled(true)
  diagnostics.capture({ kind: 'rng-reset', message: 'enabled' })
  assert.equal(reported.length, 1)
  diagnostics.setEnabled(false)
  diagnostics.capture({ kind: 'rng-reset', message: 'disabled-again' })
  assert.equal(reported.length, 1)
  diagnostics.dispose()
})

test('basic production diagnostics stay enabled while verbose sampling requires VITE_DEBUG', () => {
  assert.deepEqual(getClientDiagnosticsOptions('1', '', () => 'generated'), { enabled: true, verbose: true, sessionId: 'generated' })
  assert.deepEqual(getClientDiagnosticsOptions('1', '?debugSession=shared-session', () => 'generated'), { enabled: true, verbose: true, sessionId: 'shared-session' })
  assert.deepEqual(getClientDiagnosticsOptions('0', '?debug=1', () => 'generated'), { enabled: true, verbose: false, sessionId: 'generated' })
  assert.deepEqual(getClientDiagnosticsOptions(undefined, '', () => 'generated'), { enabled: true, verbose: false, sessionId: 'generated' })
})

test('adds the shared debug session to a player URL only when diagnostics are enabled', () => {
  const enabled = new URLSearchParams({ id: 'pokemon-red', profileId: 'red' })
  appendClientDiagnosticsParameters(enabled, { enabled: true, sessionId: 'shared-session' })
  assert.equal(enabled.toString(), 'id=pokemon-red&profileId=red&debugSession=shared-session')

  const disabled = new URLSearchParams({ id: 'pokemon-red' })
  appendClientDiagnosticsParameters(disabled, { enabled: false, sessionId: null })
  assert.equal(disabled.toString(), 'id=pokemon-red')
})

test('reports uncaught and failed API events without wrapping the diagnostics request', async () => {
  const browser = createWindow()
  const reported = []
  const diagnostics = createClientDiagnostics({
    browser,
    sessionId: 'ios-session-1',
    report: async event => { reported.push(event) },
  })

  browser.emit('error', { error: new Error('EmulatorJS loader failed') })
  await assert.rejects(() => browser.fetch('/api/games'))
  await new Promise(resolve => setImmediate(resolve))

  assert.equal(diagnostics.enabled, true)
  assert.deepEqual(reported.map(event => ({ sessionId: event.sessionId, source: event.source, kind: event.kind, message: event.message, page: event.page, request: event.request })), [
    { sessionId: 'ios-session-1', source: 'player', kind: 'uncaught-error', message: 'EmulatorJS loader failed', page: '/player.html', request: undefined },
    { sessionId: 'ios-session-1', source: 'player', kind: 'network-error', message: 'offline', page: '/player.html', request: { method: 'GET', path: '/api/games' } },
  ])
  assert.equal(browser.consoleEvents.length, 2)
  diagnostics.dispose()
})

test('allows handled emulator startup failures to be reported explicitly', async () => {
  const browser = createWindow()
  const reported = []
  const diagnostics = createClientDiagnostics({ browser, sessionId: 'ios-session-2', report: async event => { reported.push(event) } })

  diagnostics.capture({ kind: 'emulator-failure', message: 'EmulatorJS loader could not be reached.' })
  await new Promise(resolve => setImmediate(resolve))

  assert.deepEqual(reported.map(event => ({ sessionId: event.sessionId, kind: event.kind, message: event.message })), [
    { sessionId: 'ios-session-2', kind: 'emulator-failure', message: 'EmulatorJS loader could not be reached.' },
  ])
  diagnostics.dispose()
})

test('attributes a rejected audio-resume permission to the browser API that rejected it', async () => {
  const browser = createWindow()
  const reported = []
  browser.AudioContext = class {
    resume() { return Promise.reject(new DOMException('Permission was denied', 'NotAllowedError')) }
  }
  const diagnostics = createClientDiagnostics({ browser, sessionId: 'ios-session-3', report: async event => { reported.push(event) } })

  await new browser.AudioContext().resume().catch(() => {})
  await new Promise(resolve => setImmediate(resolve))

  assert.deepEqual(reported.map(event => ({ kind: event.kind, message: event.message, name: event.name })), [
    { kind: 'emulator-failure', message: 'Permission denied at AudioContext.resume', name: 'NotAllowedError' },
  ])
  diagnostics.dispose()
})
test('synchronous console and reporter failures do not change API response or caller behavior', async () => {
  const browser = createWindow()
  browser.console.error = () => { throw new Error('console unavailable') }
  browser.fetch = async () => ({ ok: false, status: 503 })
  const diagnostics = createClientDiagnostics({ browser, sessionId: 'fail-open', report: () => { throw new Error('report unavailable') } })
  assert.doesNotThrow(() => diagnostics.capture({ kind: 'uncaught-error', message: 'test' }))
  assert.equal((await browser.fetch('/api/games')).status, 503)
  diagnostics.dispose()
})
