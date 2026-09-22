import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRestoreRequest, resolveRestoreRequest } from './snapshot-restore-routing.mjs'

test('creates a scoped restore request with a stable request id', () => {
  const request = createRestoreRequest({ requestId: 'req-1', kind: 'cloud-snapshot', gameId: 'emerald', profileId: 'p1' })
  assert.deepEqual(request, {
    type: 'emulator-hub:snapshot-restore-request',
    requestId: 'req-1',
    kind: 'cloud-snapshot',
    gameId: 'emerald',
    profileId: 'p1',
  })
})

test('resolves only the matching pending request and ignores duplicates', () => {
  const pending = new Map([
    ['req-1', { sessionId: 'session-a' }],
    ['req-2', { sessionId: 'session-b' }],
  ])
  assert.deepEqual(resolveRestoreRequest(pending, { requestId: 'req-2', restore: false }), { sessionId: 'session-b', restore: false })
  assert.equal(pending.has('req-2'), false)
  assert.equal(resolveRestoreRequest(pending, { requestId: 'req-2', restore: true }), null)
  assert.equal(pending.has('req-1'), true)
})
