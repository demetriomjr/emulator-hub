import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRestoreRequest, resolveRestoreRequest } from './snapshot-restore-routing.mjs'

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
