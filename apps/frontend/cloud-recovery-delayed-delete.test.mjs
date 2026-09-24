import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

const source = await readFile(new URL('./src/player.js', import.meta.url), 'utf8')
const begin = source.indexOf('function scheduleCloudRecoveryDeleteAfterChoice(')
const end = source.indexOf('async function closeEmulator()', begin)
assert.ok(begin > 0 && end > begin)
const scheduleSource = `${source.slice(begin, end)}\nscheduleCloudRecoveryDeleteAfterChoice`

function harness() {
  const actions = []
  let timer
  const context = {
    window: { setTimeout(callback, delay) { timer = { callback, delay }; return 7 }, clearTimeout() { timer = null } },
    runtimeReady: true, closeRequested: false, leaseLost: false,
    cloudRecoveryDeleteTimer: null,
    cloudRecoveryDeletion: null,
    snapshotRevision: 4,
    savedSnapshot: { revision: 4 },
    launchDescriptor: { snapshotUrl: '/snapshot' },
    sessionId: 'session', leaseGeneration: 1,
    async deleteEmulatorSnapshot(url, revision) { actions.push(['delete', url, revision]) },
    snapshotTelemetry: { info(event, details) { actions.push(['telemetry-info', event, details]) }, warn(event, details) { actions.push(['telemetry-warn', event, details]) } },
  }
  return { context, actions, getTimer: () => timer, schedule: runInNewContext(scheduleSource, context) }
}

test('chosen session deletes its prior cloud only ten seconds after runtime readiness', async () => {
  const { context, actions, getTimer, schedule } = harness()
  schedule(4)
  assert.equal(getTimer().delay, 10_000)
  assert.deepEqual(actions.filter(action => action[0] === 'delete'), [])
  await getTimer().callback()
  assert.deepEqual(actions.filter(action => action[0] === 'delete'), [['delete', '/snapshot', 4]])
  assert.equal(context.snapshotRevision, null)
  assert.ok(actions.some(action => action[0] === 'telemetry-info' && action[1] === 'cloud-recovery-deleted'))
})

test('a replaced cloud candidate is not deleted by its old scheduled timer', async () => {
  const { context, actions, getTimer, schedule } = harness()
  schedule(4)
  context.snapshotRevision = 5
  await getTimer().callback()
  assert.deepEqual(actions.filter(action => action[0] === 'delete'), [])
})

test('the scheduled delete remains awaitable while its request is in flight', async () => {
  const { context, getTimer, schedule } = harness()
  let finishDelete
  context.deleteEmulatorSnapshot = () => new Promise(resolve => { finishDelete = resolve })
  schedule(4)
  const deleting = getTimer().callback()
  assert.equal(typeof context.cloudRecoveryDeletion?.then, 'function')
  finishDelete(true)
  await deleting
  assert.equal(context.cloudRecoveryDeletion, null)
})
