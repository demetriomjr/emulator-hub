import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

const source = await readFile(new URL('./src/player.js', import.meta.url), 'utf8')
const begin = source.indexOf('async function deleteRestoreCandidate(')
const end = source.indexOf('function scheduleCloudRecoveryDeleteAfterChoice(', begin)
const implementation = `${source.slice(begin, end)}\ndeleteRestoreCandidate`

function harness(deleteSnapshot) {
  const events = []
  const pendingRestoreRequests = new Map([['restore-1', { candidates: [{ candidateId: 'remote:4', kind: 'cloud-recovery' }] }]])
  const context = {
    pendingRestoreRequests,
    restoreCandidates: pendingRestoreRequests.get('restore-1').candidates,
    savedSnapshot: { revision: 4 }, userSnapshot: null, snapshotRevision: 4,
    launchDescriptor: { snapshotUrl: '/snapshot' }, sessionId: 'session', leaseGeneration: 1,
    profileId: 'profile', id: 'game',
    async deleteEmulatorSnapshot() { return deleteSnapshot() },
    snapshotUrlForKind: url => url,
    window: { parent: { postMessage(message) { events.push(['message', message]) } } },
    location: { origin: 'https://hub.test' },
    snapshotTelemetry: { info(event, details) { events.push(['info', event, details]) }, warn(event, details) { events.push(['warn', event, details]) } },
  }
  return { events, context, run: runInNewContext(implementation, context) }
}

const command = { restoreRequestId: 'restore-1', requestId: 'delete-1', candidateId: 'remote:4', kind: 'cloud-recovery' }

test('explicit candidate deletion records the chosen slot and revision only after success', async () => {
  const { run, events } = harness(() => true)
  await run(command)
  assert.deepEqual(events.filter(([type]) => type === 'info').map(([, event, details]) => [event, details.snapshotKind, details.revision]), [['candidate-deleted', 'cloud-recovery', 4]])
  assert.equal(events.find(([type]) => type === 'message')[1].ok, true)
})

test('explicit candidate deletion failure records its code while retaining the choice', async () => {
  const { run, events, context } = harness(() => { throw Object.assign(new Error('revision changed'), { code: 'SNAPSHOT_FENCE_CONFLICT', status: 409 }) })
  await run(command)
  assert.deepEqual(events.filter(([type]) => type === 'warn').map(([, event, details]) => [event, details.code, details.status]), [['candidate-delete-failed', 'SNAPSHOT_FENCE_CONFLICT', 409]])
  assert.equal(context.savedSnapshot.revision, 4)
  assert.equal(events.find(([type]) => type === 'message')[1].ok, false)
})
