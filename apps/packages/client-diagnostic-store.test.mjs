import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createClientDiagnosticStore } from './client-diagnostic-store.mjs'

test('keeps an allowlisted, newest-first bounded diagnostic backlog', () => {
  const store = createClientDiagnosticStore({ capacity: 2, now: () => '2026-09-18T00:00:00.000Z' })

  const accepted = store.append({
    sessionId: 'ios-session-1', source: 'player', kind: 'uncaught-error',
    message: 'loader failed', name: 'Error', stack: 'Error: loader failed\n  at start',
    page: '/player.html?profileId=secret', userAgent: 'Mobile Safari',
    viewport: { width: 390, height: 844 }, request: { method: 'GET', status: 503, url: '/api/games?token=secret' },
    ignored: 'must not persist',
  })
  store.append({ sessionId: 'ios-session-2', source: 'hub', kind: 'network-error', message: 'catalog failed' })
  store.append({ sessionId: 'ios-session-1', source: 'hub', kind: 'unhandled-rejection', message: 'promise failed' })

  assert.deepEqual(accepted, {
    at: '2026-09-18T00:00:00.000Z', sessionId: 'ios-session-1', source: 'player', kind: 'uncaught-error',
    message: 'loader failed', name: 'Error', stack: 'Error: loader failed\n  at start',
    page: '/player.html', userAgent: 'Mobile Safari', viewport: { width: 390, height: 844 }, request: { method: 'GET', status: 503, path: '/api/games' },
  })
  assert.deepEqual(store.list(), [{
    at: '2026-09-18T00:00:00.000Z', sessionId: 'ios-session-1', source: 'hub', kind: 'unhandled-rejection', message: 'promise failed',
  }, {
    at: '2026-09-18T00:00:00.000Z', sessionId: 'ios-session-2', source: 'hub', kind: 'network-error', message: 'catalog failed',
  }])
  assert.deepEqual(store.list({ sessionId: 'ios-session-1' }), [{
    at: '2026-09-18T00:00:00.000Z', sessionId: 'ios-session-1', source: 'hub', kind: 'unhandled-rejection', message: 'promise failed',
  }])
})

test('rejects diagnostics outside the narrow public contract', () => {
  const store = createClientDiagnosticStore()

  assert.throws(() => store.append({ sessionId: 'x', source: 'unknown', kind: 'error' }), { code: 'CLIENT_DIAGNOSTIC_INVALID' })
  assert.throws(() => store.append({ sessionId: 'x', source: 'hub', kind: 'error', message: 'x'.repeat(513) }), { code: 'CLIENT_DIAGNOSTIC_INVALID' })
})

test('stores allowlisted snapshot decisions without accepting state or save contents', () => {
  const store = createClientDiagnosticStore({ now: () => '2026-09-24T00:00:00.000Z' })
  assert.deepEqual(store.append({
    sessionId: 'session-1', source: 'player', kind: 'snapshot-flow', level: 'warn', message: 'restore-choice',
    gameId: 'game', profileId: 'profile', snapshotKind: 'cloud-recovery', candidateId: 'remote:3',
    revision: 3, saveRevision: 2, candidateCount: 2, reason: 'user-selected', phase: 'startup',
    code: 'LOAD_FAILED', error: 'invalid state', status: 409,
    state: [1, 2], save: [3, 4], originInstallationId: 'secret',
  }), {
    at: '2026-09-24T00:00:00.000Z', sessionId: 'session-1', source: 'player', kind: 'snapshot-flow', level: 'warn', message: 'restore-choice',
    gameId: 'game', profileId: 'profile', snapshotKind: 'cloud-recovery', candidateId: 'remote:3',
    revision: 3, saveRevision: 2, candidateCount: 2, reason: 'user-selected', phase: 'startup',
    code: 'LOAD_FAILED', error: 'invalid state', status: 409,
  })
  assert.throws(() => store.append({ sessionId: 'session-1', source: 'player', kind: 'snapshot-flow', message: 'x', snapshotKind: 'wrong' }), { code: 'CLIENT_DIAGNOSTIC_INVALID' })
})
