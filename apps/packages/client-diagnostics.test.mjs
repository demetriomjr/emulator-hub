import assert from 'node:assert/strict'
import { test } from 'node:test'

import { appendClientDiagnosticsParameters, createClientDiagnostics, getClientDiagnosticsOptions } from './client-diagnostics.mjs'

function createWindow(search = '?debug=1') {
  const listeners = new Map()
  return {
    location: { search, pathname: '/player.html', origin: 'https://hub.test' },
    navigator: { userAgent: 'Mozilla/5.0 (iPhone)' },
    innerWidth: 390,
    innerHeight: 844,
    addEventListener(type, listener) { listeners.set(type, listener) },
    removeEventListener(type) { listeners.delete(type) },
    emit(type, event) { listeners.get(type)?.(event) },
    fetch: async () => { throw new Error('offline') },
  }
}

test('enables a stable diagnostic session only for debug URLs', () => {
  assert.deepEqual(getClientDiagnosticsOptions('?debug=1', () => 'generated'), { enabled: true, sessionId: 'generated' })
  assert.deepEqual(getClientDiagnosticsOptions('?debug=1&debugSession=shared-session', () => 'generated'), { enabled: true, sessionId: 'shared-session' })
  assert.deepEqual(getClientDiagnosticsOptions('?debug=0', () => 'generated'), { enabled: false, sessionId: null })
})

test('adds the shared debug session to a player URL only when diagnostics are enabled', () => {
  const enabled = new URLSearchParams({ id: 'pokemon-red', profileId: 'red' })
  appendClientDiagnosticsParameters(enabled, { enabled: true, sessionId: 'shared-session' })
  assert.equal(enabled.toString(), 'id=pokemon-red&profileId=red&debug=1&debugSession=shared-session')

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
