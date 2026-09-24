import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canReconcileLateSnapshotDelete, createRestoreRequest, createSnapshotDeleteWatchdog, resolveRestoreRequest, routeRestoreChoiceResponse, restorePromptAfterChoiceTimeout, restorePromptAfterDeleteTimeout } from './snapshot-restore-routing.mjs'

test('creates a scoped restore request with a stable request id', () => {
  const request = createRestoreRequest({ requestId: 'req-1', kind: 'cloud-snapshot', gameId: 'emerald', profileId: 'p1', sessionId: 'session-1' })
  assert.deepEqual(request, {
    type: 'emulator-hub:snapshot-restore-request',
    requestId: 'req-1',
    kind: 'cloud-snapshot',
    gameId: 'emerald',
    profileId: 'p1',
    sessionId: 'session-1',
  })
})

test('resolves only the matching pending request and ignores duplicates', () => {
  const pending = new Map([
    ['req-1', { sessionId: 'session-a', gameId: 'emerald', profileId: 'p1' }],
    ['req-2', { sessionId: 'session-b', gameId: 'ruby', profileId: 'p2' }],
  ])
  assert.deepEqual(resolveRestoreRequest(pending, { requestId: 'req-2', sessionId: 'session-b', gameId: 'ruby', profileId: 'p2', restore: false }), { sessionId: 'session-b', gameId: 'ruby', profileId: 'p2', restore: false })
  assert.equal(pending.has('req-2'), false)
  assert.equal(resolveRestoreRequest(pending, { requestId: 'req-2', sessionId: 'session-b', gameId: 'ruby', profileId: 'p2', restore: true }), null)
  assert.equal(pending.has('req-1'), true)
})

test('rejects a response with a different session or profile identity', () => {
  const pending = new Map([['req-1', { sessionId: 'session-a', gameId: 'ruby', profileId: 'profile-1' }]])
  assert.equal(resolveRestoreRequest(pending, { requestId: 'req-1', sessionId: 'session-b', gameId: 'ruby', profileId: 'profile-1', restore: false }), null)
  assert.equal(resolveRestoreRequest(pending, { requestId: 'req-1', sessionId: 'session-a', gameId: 'ruby', profileId: 'profile-2', restore: false }), null)
  assert.equal(pending.has('req-1'), true)
})

test('delete watchdog restores the previous prompt after no iframe response and ignores a late result', () => {
  const timers = new Map()
  let nextTimer = 0
  let prompts = { sessionA: { requestId: 'restore-1', candidateId: 'remote:2', kind: 'cloud-snapshot', deleting: true, deleteRequestId: 'delete-1' } }
  const watchdog = createSnapshotDeleteWatchdog({
    timeoutMs: 8_000,
    schedule(callback, milliseconds) { assert.equal(milliseconds, 8_000); const id = ++nextTimer; timers.set(id, callback); return id },
    cancel(id) { timers.delete(id) },
    onTimeout: pending => { prompts = restorePromptAfterDeleteTimeout(prompts, pending) },
  })
  const identity = { sessionId: 'sessionA', requestId: 'delete-1', restoreRequestId: 'restore-1', candidateId: 'remote:2', kind: 'cloud-snapshot' }
  assert.equal(watchdog.begin(identity), true)
  timers.get(1)()
  assert.equal(prompts.sessionA.deleting, false)
  assert.equal(prompts.sessionA.deleteRequestId, null)
  assert.equal(prompts.sessionA.timedOutDeleteRequestId, 'delete-1')
  assert.equal(prompts.sessionA.requestId, 'restore-1')
  assert.equal(prompts.sessionA.candidateId, 'remote:2')
  assert.match(prompts.sessionA.deleteError, /sem resposta/i)
  assert.equal(watchdog.settle(identity), null)
})

test('delete watchdog accepts only the pending session, prompt and candidate', () => {
  const timers = new Map()
  let nextTimer = 0
  const watchdog = createSnapshotDeleteWatchdog({
    onTimeout() { assert.fail('settled delete must not expire') },
    schedule(callback) { const id = ++nextTimer; timers.set(id, callback); return id },
    cancel(id) { timers.delete(id) },
  })
  const identity = { sessionId: 'sessionA', requestId: 'delete-1', restoreRequestId: 'restore-1', candidateId: 'remote:2', kind: 'cloud-snapshot' }
  assert.equal(watchdog.begin(identity), true)
  assert.equal(watchdog.begin({ ...identity, requestId: 'delete-2' }), false)
  assert.equal(watchdog.settle({ ...identity, candidateId: 'remote:3' }), null)
  assert.equal(watchdog.settle({ ...identity, sessionId: 'sessionB' }), null)
  assert.deepEqual(watchdog.settle(identity), identity)
  assert.equal(timers.size, 0)
})

test('an expired delete cannot reset a newer restore candidate', () => {
  const prompts = { sessionA: { requestId: 'restore-2', candidateId: 'remote:8', deleting: true, deleteRequestId: 'delete-2' } }
  const previous = restorePromptAfterDeleteTimeout(prompts, { sessionId: 'sessionA', requestId: 'delete-1', restoreRequestId: 'restore-1', candidateId: 'remote:7' })
  assert.equal(previous, prompts)
})

test('a late delete result can reconcile only its original idle chooser', () => {
  const request = { requestId: 'restore-1', candidateId: 'remote:2', timedOutDeleteRequestId: 'delete-1', candidates: [{ candidateId: 'remote:2', kind: 'cloud-recovery' }] }
  const reply = { restoreRequestId: 'restore-1', requestId: 'delete-1', candidateId: 'remote:2', kind: 'cloud-recovery' }
  assert.equal(canReconcileLateSnapshotDelete(request, reply), true)
  assert.equal(canReconcileLateSnapshotDelete({ ...request, deleting: true }, reply), false)
  assert.equal(canReconcileLateSnapshotDelete({ ...request, resolving: true }, reply), false)
  assert.equal(canReconcileLateSnapshotDelete({ ...request, timedOutDeleteRequestId: null }, reply), false)
  assert.equal(canReconcileLateSnapshotDelete(request, { ...reply, kind: 'user-state' }), false)
  assert.equal(canReconcileLateSnapshotDelete(request, { ...reply, requestId: 'delete-2' }), false)
})

test('routes one chooser response to a current candidate in the originating session', () => {
  const candidates = [{ candidateId: 'user:2', kind: 'user-state', reasonCode: 'user-request', capturedAt: '2026-09-24T12:00:00.000Z', captureClock: 'server', origin: 'unknown' }]
  const request = createRestoreRequest({ requestId: 'choice-1', kind: 'candidate-list', gameId: 'g', profileId: 'p', sessionId: 's', candidates })
  assert.deepEqual(request.candidates, candidates)
  assert.equal('state' in request.candidates[0], false)
  const pending = new Map([['choice-1', { sessionId: 's', gameId: 'g', profileId: 'p', candidates }]])
  assert.equal(resolveRestoreRequest(pending, { requestId: 'choice-1', sessionId: 'wrong', gameId: 'g', profileId: 'p', candidateId: 'user:2' }), null)
  assert.equal(resolveRestoreRequest(pending, { requestId: 'choice-1', sessionId: 's', gameId: 'g', profileId: 'p', candidateId: 'user:99' }), null)
  assert.equal(resolveRestoreRequest(pending, { requestId: 'choice-1', sessionId: 's', gameId: 'g', profileId: 'p', candidateId: 'user:2' }).candidateId, 'user:2')
})

test('chooser messages strip state bytes and unapproved nested metadata', () => {
  const candidate = { candidateId: 'user:1', kind: 'user-state', reasonCode: 'user-request', capturedAt: '2026-09-24T12:00:00.000Z', captureClock: 'server', origin: 'unknown', state: new Uint8Array([7]), gameTime: { kind: 'save-sequence', value: 3, adapterId: 'gen3-gba-v1', state: new Uint8Array([8]) } }
  const request = createRestoreRequest({ requestId: 'choice', kind: 'candidate-list', gameId: 'g', profileId: 'p', sessionId: 's', candidates: [candidate] })
  assert.equal('state' in request.candidates[0], false)
  assert.equal('state' in request.candidates[0].gameTime, false)
})

test('missing restore acknowledgement keeps the original choice locked', () => {
  const candidates = [{ candidateId: 'user:1', kind: 'user-state' }]
  const prompts = { sessionA: { requestId: 'choice-1', candidates, resolving: true, selectedCandidateId: 'user:1', choiceAttemptId: 'attempt-1' } }
  const restored = restorePromptAfterChoiceTimeout(prompts, { sessionId: 'sessionA', requestId: 'choice-1', candidateId: 'user:1', choiceAttemptId: 'attempt-1' })
  assert.equal(restored.sessionA.resolving, true)
  assert.equal(restored.sessionA.selectedCandidateId, 'user:1')
  assert.equal(restored.sessionA.choiceAttemptId, 'attempt-1')
  assert.deepEqual(restored.sessionA.candidates, candidates)
  assert.match(restored.sessionA.choiceError, /Aguardando confirmação/)
  assert.equal(restorePromptAfterChoiceTimeout(restored, { sessionId: 'sessionA', requestId: 'other', candidateId: 'user:1', choiceAttemptId: 'attempt-1' }), restored)
})

test('a late deletion yields a refreshed chooser and a subsequent choice settles', () => {
  const current = [{ candidateId: 'user:3', kind: 'user-state' }]
  const pending = new Map([['choice-1', { sessionId: 's', gameId: 'g', profileId: 'p', candidates: current }]])
  const settled = new Map()
  const original = { requestId: 'choice-1', choiceAttemptId: 'attempt-1', candidateId: 'user:2', sessionId: 's', gameId: 'g', profileId: 'p' }
  assert.deepEqual(routeRestoreChoiceResponse(pending, settled, original), { status: 'stale', candidates: current })
  assert.equal(pending.has('choice-1'), true)
  const retry = { ...original, candidateId: 'user:3', choiceAttemptId: 'attempt-2' }
  const routed = routeRestoreChoiceResponse(pending, settled, retry)
  assert.equal(routed.status, 'settled')
  assert.equal(routed.request.candidateId, 'user:3')
  assert.equal(pending.has('choice-1'), false)
  assert.deepEqual(routeRestoreChoiceResponse(pending, settled, retry), { status: 'settled', appliedCandidateId: 'user:3' })
  assert.equal(routeRestoreChoiceResponse(pending, settled, { ...retry, sessionId: 'other' }), null)
})

test('an empty refreshed chooser can continue through the in-game save', () => {
  const pending = new Map([['choice-1', { sessionId: 's', gameId: 'g', profileId: 'p', candidates: [] }]])
  const settled = new Map()
  const message = { requestId: 'choice-1', choiceAttemptId: 'attempt-1', candidateId: 'remote:1', sessionId: 's', gameId: 'g', profileId: 'p' }
  assert.deepEqual(routeRestoreChoiceResponse(pending, settled, message), { status: 'stale', candidates: [] })
  assert.equal(routeRestoreChoiceResponse(pending, settled, { ...message, choiceAttemptId: 'attempt-2', candidateId: null }).status, 'settled')
})
