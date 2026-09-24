import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createContainerPipelineLogger, createSnapshotTelemetry } from './snapshot-telemetry.mjs'

test('forwards only bounded snapshot decisions and failures to container diagnostics', async () => {
  const requests = []
  const consoleEvents = []
  const browser = {
    location: { pathname: '/player.html' },
    fetch: async (url, options) => { requests.push({ url, options }); return { ok: true } },
    console: {
      info: (...args) => consoleEvents.push(['info', ...args]),
      warn: (...args) => consoleEvents.push(['warn', ...args]),
      error: (...args) => consoleEvents.push(['error', ...args]),
    },
  }
  const telemetry = createSnapshotTelemetry({ browser, source: 'player', sessionId: 'session-1', gameId: 'game', profileId: 'profile' })
  telemetry.info('restore-choice', { snapshotKind: 'cloud-recovery', candidateId: 'remote:3', revision: 3, saveRevision: 2, state: new Uint8Array([9]), save: new Uint8Array([4]) })
  telemetry.error('restore-load-failed', { snapshotKind: 'cloud-recovery', code: 'LOAD_FAILED', error: 'invalid state' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(requests.length, 2)
  assert.equal(requests[0].url, '/api/debug/client-events')
  assert.equal(requests[0].options.keepalive, true)
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    sessionId: 'session-1', source: 'player', kind: 'snapshot-flow', level: 'info', page: '/player.html', message: 'restore-choice',
    gameId: 'game', profileId: 'profile', snapshotKind: 'cloud-recovery', candidateId: 'remote:3', revision: 3, saveRevision: 2,
  })
  assert.equal(consoleEvents[1][0], 'error')
  assert.equal(JSON.parse(requests[1].options.body).code, 'LOAD_FAILED')
  assert.equal(JSON.parse(requests[1].options.body).level, 'error')
  assert.equal(JSON.parse(requests[1].options.body).error, 'invalid state')
})

test('suppresses repeated periodic failures without hiding a later recurrence', async () => {
  const requests = []
  let now = 0
  const telemetry = createSnapshotTelemetry({
    browser: { location: { pathname: '/player.html' }, fetch: async (_url, options) => { requests.push(JSON.parse(options.body)) }, console: { warn() {} } },
    source: 'player', sessionId: 'session-1', gameId: 'game', profileId: 'profile', now: () => now,
  })
  telemetry.warn('automatic-capture-failed', { snapshotKind: 'local-recovery', code: 'IDB_ERROR' }, { repeating: true })
  now = 1_000
  telemetry.warn('automatic-capture-failed', { snapshotKind: 'local-recovery', code: 'IDB_ERROR' }, { repeating: true })
  telemetry.warn('automatic-capture-failed', { snapshotKind: 'cloud-recovery', code: 'HTTP_500' }, { repeating: true })
  telemetry.warn('automatic-capture-failed', { snapshotKind: 'local-recovery', code: 'IDB_ERROR', reason: 'different-stage' }, { repeating: true })
  now = 61_000
  telemetry.warn('automatic-capture-failed', { snapshotKind: 'local-recovery', code: 'IDB_ERROR' }, { repeating: true })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(requests.map(request => [request.message, request.snapshotKind, request.code]), [
    ['automatic-capture-failed', 'local-recovery', 'IDB_ERROR'],
    ['automatic-capture-failed', 'cloud-recovery', 'HTTP_500'],
    ['automatic-capture-failed', 'local-recovery', 'IDB_ERROR'],
    ['automatic-capture-failed', 'local-recovery', 'IDB_ERROR'],
  ])
})

test('records a persistent runtime save suppression only once per session', async () => {
  const records = []
  const telemetry = createSnapshotTelemetry({
    browser: { location: { pathname: '/player.html' }, fetch: async (_url, options) => { records.push(JSON.parse(options.body)) }, console: { info() {} } },
    source: 'player', sessionId: 'session-1', gameId: 'game', profileId: 'profile', now: () => 120_000,
  })
  telemetry.info('runtime-state-save-ignored', { reason: 'matches-restored-state' }, { once: true })
  telemetry.info('runtime-state-save-ignored', { reason: 'matches-restored-state' }, { once: true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(records.length, 1)
})

test('telemetry transport and console failures cannot interrupt snapshot decisions', async () => {
  const telemetry = createSnapshotTelemetry({
    browser: {
      location: { pathname: '/player.html' },
      console: { info() { throw new Error('console unavailable') } },
      fetch: async () => { throw new Error('offline') },
    },
    source: 'player', sessionId: 'session-1', gameId: 'game', profileId: 'profile',
  })
  assert.doesNotThrow(() => telemetry.info('restore-choice', { snapshotKind: 'cloud-recovery' }))
  await new Promise(resolve => setImmediate(resolve))
})

test('container logger keeps save writes and snapshot decisions while limiting periodic failure noise', () => {
  const records = []
  let now = 0
  const output = { info: (_label, record) => records.push(record), warn: (_label, record) => records.push(record), error: (_label, record) => records.push(record) }
  const logger = createContainerPipelineLogger({ output, now: () => now })
  logger.info('save.backend.put-received', { profileId: 'profile', gameId: 'game' })
  logger.info('save.backend.persisted', { profileId: 'profile', gameId: 'game', revision: 2 })
  logger.info('snapshot.backend.candidate-available', { profileId: 'profile', gameId: 'game', kind: 'cloud-recovery', revision: 3 })
  logger.warn('snapshot.backend.put-rejected', { profileId: 'profile', gameId: 'game', kind: 'cloud-recovery', code: 'SNAPSHOT_FENCE_CONFLICT' })
  logger.warn('snapshot.backend.put-rejected', { profileId: 'profile', gameId: 'game', kind: 'cloud-recovery', code: 'SNAPSHOT_FENCE_CONFLICT' })
  logger.warn('snapshot.backend.put-rejected', { profileId: 'profile', gameId: 'game', kind: 'user-state', code: 'SNAPSHOT_FENCE_CONFLICT' })
  logger.warn('snapshot.backend.put-rejected', { profileId: 'profile', gameId: 'game', kind: 'user-state', code: 'SNAPSHOT_FENCE_CONFLICT' })
  now = 60_000
  logger.warn('snapshot.backend.put-rejected', { profileId: 'profile', gameId: 'game', kind: 'cloud-recovery', code: 'SNAPSHOT_FENCE_CONFLICT' })
  assert.deepEqual(records.map(record => [record.level, record.event]), [
    ['info', 'save.backend.persisted'],
    ['info', 'snapshot.backend.candidate-available'],
    ['warn', 'snapshot.backend.put-rejected'],
    ['warn', 'snapshot.backend.put-rejected'],
    ['warn', 'snapshot.backend.put-rejected'],
    ['warn', 'snapshot.backend.put-rejected'],
  ])
})
