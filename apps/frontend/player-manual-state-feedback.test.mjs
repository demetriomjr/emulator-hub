import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

const source = await readFile(new URL('./src/player.js', import.meta.url), 'utf8')
const begin = source.indexOf("  if (event.data?.type === 'emulator-hub:save-state')")
const end = source.indexOf("  if (event.data?.type === 'emulator-hub:fast-forward')", begin)
assert.ok(begin >= 0 && end > begin)
const actionSource = `async function handle(event) {\n${source.slice(begin, end)}\n}\nhandle`

function harness({ save = async () => true, load = () => true } = {}) {
  const failures = []
  const telemetry = []
  const handle = runInNewContext(actionSource, {
    offerPolicy: { recordManualStateSave() {} },
    saveEmulatorState: save,
    loadEmulatorState: load,
    userSnapshotRevision: 3,
    cloudSaveSynchronizer: { getRevision() { return 2 } },
    reportPlayerActionFailure(action) { failures.push(action) },
    snapshotTelemetry: { info: (event, details) => telemetry.push(['info', event, details]), warn: (event, details) => telemetry.push(['warn', event, details]), error: (event, details) => telemetry.push(['error', event, details]) },
  })
  return { handle, failures, telemetry }
}

test('manual state actions emit one decision or failure per explicit user action', async () => {
  const successful = harness()
  await successful.handle({ data: { type: 'emulator-hub:save-state' } })
  await successful.handle({ data: { type: 'emulator-hub:load-state' } })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(successful.telemetry.map(([level, event]) => [level, event]), [['info', 'user-state-saved'], ['info', 'user-state-loaded']])

  const failed = harness({ save: async () => { throw new Error('offline') }, load: () => false })
  await failed.handle({ data: { type: 'emulator-hub:save-state' } })
  await failed.handle({ data: { type: 'emulator-hub:load-state' } })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(failed.telemetry.map(([level, event]) => [level, event]), [['error', 'user-state-save-failed'], ['warn', 'user-state-load-unavailable']])
})

test('a failed manual Save state is reported to the player', async () => {
  const { handle, failures } = harness({ save: async () => { throw new Error('offline') } })
  await handle({ data: { type: 'emulator-hub:save-state' } })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(failures, ['manual-save'])
})

test('a manual Load state with no available state is reported to the player', async () => {
  const { handle, failures } = harness({ load: () => false })
  await handle({ data: { type: 'emulator-hub:load-state' } })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(failures, ['manual-load'])
})

test('successful manual Save and Load state produce no failure alert', async () => {
  const { handle, failures } = harness()
  await handle({ data: { type: 'emulator-hub:save-state' } })
  await handle({ data: { type: 'emulator-hub:load-state' } })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(failures, [])
})

test('manual Load state observes the runtime save baseline without uploading or restoring the canonical save', () => {
  const start = source.indexOf('function loadEmulatorState()')
  const end = source.indexOf("window.addEventListener('message'", start)
  assert.ok(start >= 0 && end > start)
  const actions = []
  const load = runInNewContext(`${source.slice(start, end)}\nloadEmulatorState`, {
    userSnapshot: { state: new Uint8Array([3]) },
    launchDescriptor: {},
    snapshotMatchesLaunch: () => true,
    window: { EJS_emulator: { gameManager: {
      loadState() { actions.push('load-state') },
      getSaveFile() { actions.push('read-runtime-save'); return new Uint8Array([2]) },
    } } },
    cloudSaveSynchronizer: {
      ignoreRuntimeStateSave(bytes) { actions.push(`ignore-runtime:${bytes[0]}`) },
      restore() { actions.push('restore-save') }, sync() { actions.push('sync-save') },
    },
    offerPolicy: { recordRuntimeRestore() { actions.push('record-restore') } },
    Uint8Array,
  })
  assert.equal(load(), true)
  assert.deepEqual(actions, ['load-state', 'read-runtime-save', 'ignore-runtime:2', 'record-restore'])
})

test('a partial runtime-state load failure still excludes its save bytes from upload', () => {
  const start = source.indexOf('function loadEmulatorState()')
  const end = source.indexOf("window.addEventListener('message'", start)
  const actions = []
  const load = runInNewContext(`${source.slice(start, end)}\nloadEmulatorState`, {
    userSnapshot: { state: new Uint8Array([3]) }, launchDescriptor: {},
    snapshotMatchesLaunch: () => true,
    window: { EJS_emulator: { gameManager: {
      loadState() { actions.push('load-state'); throw new Error('partial load') },
      getSaveFile() { actions.push('read-runtime-save'); return new Uint8Array([2]) },
    } } },
    cloudSaveSynchronizer: { ignoreRuntimeStateSave(bytes) { actions.push(`ignore-runtime:${bytes[0]}`) } },
    Uint8Array,
  })
  assert.equal(load(), false)
  assert.deepEqual(actions, ['load-state', 'read-runtime-save', 'ignore-runtime:2'])
})
