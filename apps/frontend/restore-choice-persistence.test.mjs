import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { restorePromptAfterChoiceTimeout } from '../packages/snapshot-restore-routing.mjs'

const source = await readFile(new URL('./src/main.jsx', import.meta.url), 'utf8')
const begin = source.indexOf('  function respondToRestore(')
const end = source.indexOf('  function clearRestoreChoiceTimer(', begin)
assert.ok(begin >= 0 && end > begin)
const respondSource = `${source.slice(begin, end)}\nrespondToRestore`

test('a delayed acknowledgement keeps the first choice and retries only that choice', () => {
  const posted = []
  const telemetry = []
  const timers = new Map()
  let nextTimer = 0
  const frame = { contentWindow: { postMessage(message) { posted.push(message) } } }
  const cell = { dataset: { sessionId: 'session' }, querySelector: () => frame }
  const requests = { session: { requestId: 'choice', candidates: [{ candidateId: 'A' }, { candidateId: 'B' }] } }
  const context = {
    snapshotDeleteWatchdogRef: { current: { cancel() {} } },
    document: { querySelectorAll: () => [cell] },
    activeSessions: [{ sessionId: 'session', gameId: 'game', profileId: 'profile' }],
    snapshotRestoreRequestsRef: { current: requests },
    setSnapshotRestoreRequests(update) { context.snapshotRestoreRequestsRef.current = typeof update === 'function' ? update(context.snapshotRestoreRequestsRef.current) : update },
    restoreChoiceTimersRef: { current: new Map() },
    crypto: { randomUUID: () => 'attempt-1' },
    restorePromptAfterChoiceTimeout,
    reportHubSnapshot(session, level, event, details) { telemetry.push({ session, level, event, details }) },
    configurePlayerFrame(_frame, message) { posted.push(message) },
    window: {
      location: { origin: 'https://hub.test' },
      setTimeout(callback) { const timer = ++nextTimer; timers.set(timer, callback); return timer },
      clearTimeout(timer) { timers.delete(timer) },
    },
  }
  const respond = runInNewContext(respondSource, context)
  respond('session', 'choice', 'A')
  respond('session', 'choice', 'B')
  assert.deepEqual(posted.map(message => message.candidateId), ['A'])
  const onTimeout = timers.get(1)
  timers.delete(1)
  onTimeout()
  assert.deepEqual(posted.map(message => message.candidateId), ['A', 'A'])
  assert.equal(context.snapshotRestoreRequestsRef.current.session.selectedCandidateId, 'A')
  assert.equal(context.snapshotRestoreRequestsRef.current.session.resolving, true)
  assert.equal(timers.size, 1)
  assert.deepEqual(telemetry.map(({ level, event }) => [level, event]), [['warn', 'restore-ack-timeout']])
})
