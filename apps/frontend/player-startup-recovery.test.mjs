import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { measureSynchronousOperation } from '../packages/emulator-performance-probe.mjs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

const source = await readFile(new URL('./src/player.js', import.meta.url), 'utf8')
const begin = source.indexOf("    if (restoreCandidates.length) snapshotTelemetry.info('candidates-offered'")
const end = source.indexOf('    watchBatterySaveChanges()', begin)
assert.ok(begin > 0 && end > begin)
const restoreStartup = `async function restoreStartup() {\n${source.slice(begin, end)}\n}\nrestoreStartup`

function harness({ selection, localRecoveryPrompt = false, localRecovery = null, cloudRecovery = null, getLocal = async () => localRecovery, restart = () => {}, loadState = () => {}, restoreSave = async () => true } = {}) {
  const actions = []
  const telemetryEvents = []
  const context = {
    closeRequested: false,
    interactionLock: { isLocked: () => false, apply() {} },
    runtimeReady: false,
    setPlayerReady() {},
    startEmulatedFpsOverlay() {},
    restoreCandidates: [
      ...(selection === 'local' || localRecoveryPrompt ? [{ candidateId: 'local-1', kind: 'local-recovery' }] : []),
      ...(cloudRecovery ? [{ candidateId: 'remote:4', kind: 'cloud-recovery' }] : []),
    ],
    restoreLocalRecovery: false,
    localRecoveryPrompt,
    localRecoveryCandidateId: localRecovery?.candidateId ?? null,
    localRecovery,
    requestRestoreChoice: async () => ({ candidateId: selection === 'local' ? 'local-1' : selection === 'cloud' ? 'remote:4' : null, explicit: true }),
    localRecoveryStore: {
      get: getLocal,
      async deleteIfMatches() { actions.push('delete-local'); return true },
    },
    profileId: 'profile', id: 'game',
    launchDescriptor: { core: 'gba', romSha256: 'rom', runtimeId: 'runtime' },
    window: { EJS_emulator: { pause() {}, play() {}, gameManager: {
      loadState() { actions.push('load-state'); return loadState() },
      restart() { actions.push('restart'); return restart() },
      getSaveFile() { actions.push('read-runtime-save'); return new Uint8Array([2]) },
    } } },
    cloudSaveSynchronizer: { getRevision() { return 2 }, async restore() { actions.push('restore-save'); return restoreSave() }, ignoreRuntimeStateSave(bytes) { actions.push(`ignore-runtime:${bytes[0]}`) } },
    reportPlayerActionFailure(action) { actions.push(`failed:${action}`) },
    offerPolicy: { recordRuntimeRestore() { actions.push('record-restore') } },
    scheduleCloudRecoveryDeleteAfterChoice() { actions.push('schedule-cloud-delete') },
    scheduleLocalRecoveryDeleteAfterChoice() { actions.push('schedule-local-delete') },
    startLocalRecoveryCapture() {},
    savedSnapshot: cloudRecovery,
    userSnapshot: null,
    installationIdentity: { comparisonId: null },
    remoteCandidateSummary: snapshot => ({ candidateId: `remote:${snapshot.revision}` }),
    snapshotMatchesLaunch: () => true,
    Uint8Array,
    snapshotTelemetry: {
      info(event, details) { telemetryEvents.push({ level: 'info', event, details }) },
      warn(event, details) { telemetryEvents.push({ level: 'warn', event, details }) },
      error(event, details) { telemetryEvents.push({ level: 'error', event, details }) },
    },
  }
  return { context, actions, telemetryEvents, run: runInNewContext(restoreStartup, context) }
}

test('startup reports the offered candidates, selected state and canonical save decision once', async () => {
  const cloudRecovery = { revision: 4, metadata: { saveRevision: 2 }, state: new Uint8Array([9]) }
  const { telemetryEvents, run } = harness({ selection: 'cloud', cloudRecovery })
  await run()
  assert.deepEqual(telemetryEvents.map(({ event }) => event), ['candidates-offered', 'restore-choice', 'restore-applied', 'canonical-save-loaded'])
  assert.deepEqual({ ...telemetryEvents[0].details }, { candidateCount: 1, saveRevision: 2 })
  assert.deepEqual({ ...telemetryEvents[1].details }, { candidateId: 'remote:4', snapshotKind: 'cloud-recovery', revision: 4, reason: 'user-selected' })
})

test('failed selected state reports a structured failure without logging state bytes', async () => {
  const cloudRecovery = { revision: 4, metadata: { saveRevision: 1 }, state: new Uint8Array([9]) }
  const { telemetryEvents, run } = harness({ selection: 'cloud', cloudRecovery, loadState: () => { throw new Error('invalid state') } })
  await run()
  assert.deepEqual(telemetryEvents.filter(({ event }) => event === 'restore-load-failed').map(({ level, details }) => [level, details.snapshotKind, details.candidateId, details.error]), [
    ['error', 'cloud-recovery', 'remote:4', 'invalid state'],
  ])
  assert.ok(telemetryEvents.every(({ details }) => !('state' in details)))
})

test('Close during the local read does not apply the selected state', async () => {
  let finishRead
  const candidate = { candidateId: 'local-1', core: 'gba', romSha256: 'rom', runtimeId: 'runtime', state: new Uint8Array([1]) }
  const { context, actions, run } = harness({ selection: 'local', localRecovery: candidate, getLocal: () => new Promise(resolve => { finishRead = resolve }) })
  const startup = run()
  await new Promise(resolve => setImmediate(resolve))
  context.closeRequested = true
  finishRead(candidate)
  await startup
  assert.deepEqual(actions, [])
})

test('explicit Continue schedules deletion of the previously offered local recovery after readiness', async () => {
  const candidate = { candidateId: 'local-1', core: 'gba', romSha256: 'rom', runtimeId: 'runtime', state: new Uint8Array([1]) }
  const { actions, run } = harness({ selection: null, localRecoveryPrompt: true, localRecovery: candidate })
  await run()
  assert.deepEqual(actions, ['restart', 'restore-save', 'schedule-local-delete'])
})

test('local recovery deletion waits ten seconds and targets only the offered candidate', async () => {
  const begin = source.indexOf('function scheduleLocalRecoveryDeleteAfterChoice(')
  const end = source.indexOf('function scheduleCloudRecoveryDeleteAfterChoice(', begin)
  assert.ok(begin > 0 && end > begin)
  const actions = []
  let delayed
  const context = {
    runtimeReady: true, closeRequested: false, leaseLost: false, localRecoveryDeleteTimer: null,
    localRecoveryStore: { async deleteIfMatches(profile, game, candidateId) { actions.push(['delete', profile, game, candidateId]); return true } },
    profileId: 'profile', id: 'game',
    snapshotTelemetry: { info() {}, warn() {} },
    startLocalRecoveryCapture() { actions.push(['start-local-capture']) },
    window: { setTimeout(callback, delay) { delayed = { callback, delay }; return 1 }, clearTimeout() {} },
  }
  const schedule = runInNewContext(`${source.slice(begin, end)}\nscheduleLocalRecoveryDeleteAfterChoice`, context)
  schedule('local-1')
  assert.equal(delayed.delay, 10_000)
  assert.deepEqual(actions, [])
  await delayed.callback()
  assert.deepEqual(actions, [['delete', 'profile', 'game', 'local-1'], ['start-local-capture']])
})

test('a pending restore choice keeps startup blocked until the player responds', async () => {
  const candidate = { candidateId: 'local-1', core: 'gba', romSha256: 'rom', runtimeId: 'runtime', state: new Uint8Array([1]) }
  const { context, actions, run } = harness({ selection: null, localRecoveryPrompt: true, localRecovery: candidate })
  let respond
  context.requestRestoreChoice = () => new Promise(resolve => { respond = resolve })
  const startup = run()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(actions, [])
  assert.equal(context.runtimeReady, false)
  respond({ candidateId: null, explicit: true })
  await startup
  assert.deepEqual(actions, ['restart', 'restore-save', 'schedule-local-delete'])
})

test('the emulation core remains paused while the restore chooser waits', async () => {
  const candidate = { candidateId: 'local-1', core: 'gba', romSha256: 'rom', runtimeId: 'runtime', state: new Uint8Array([1]) }
  const { context, actions, run } = harness({ localRecoveryPrompt: true, localRecovery: candidate })
  context.window.EJS_emulator.pause = () => actions.push('pause-core')
  context.window.EJS_emulator.play = () => actions.push('play-core')
  let respond
  context.requestRestoreChoice = () => new Promise(resolve => { respond = resolve })
  const startup = run()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(actions, ['pause-core'])
  respond({ candidateId: null, explicit: true })
  await startup
  assert.deepEqual(actions, ['pause-core', 'restart', 'restore-save', 'play-core', 'schedule-local-delete'])
})

test('closing an unanswered chooser never resumes the emulation core', async () => {
  const candidate = { candidateId: 'local-1', core: 'gba', romSha256: 'rom', runtimeId: 'runtime', state: new Uint8Array([1]) }
  const { context, actions, run } = harness({ localRecoveryPrompt: true, localRecovery: candidate })
  context.window.EJS_emulator.pause = () => actions.push('pause-core')
  context.window.EJS_emulator.play = () => actions.push('play-core')
  let respond
  context.requestRestoreChoice = () => new Promise(resolve => { respond = resolve })
  const startup = run()
  await new Promise(resolve => setImmediate(resolve))
  context.closeRequested = true
  respond({ candidateId: null, explicit: false })
  await startup
  assert.deepEqual(actions, ['pause-core'])
})

test('restore request has no deadline and resolves only from an explicit response', async () => {
  const begin = source.indexOf('function requestRestoreChoice(candidates)')
  const end = source.indexOf('function logSavePipeline(', begin)
  const messages = []
  const requests = new Map()
  const choose = runInNewContext(`${source.slice(begin, end)}\nrequestRestoreChoice`, {
    sessionId: 'session', id: 'game', profileId: 'profile', pendingRestoreRequests: requests,
    Date, Math, location: { origin: 'https://hub.test' },
    window: {
      setTimeout() { throw new Error('restore choice must not expire') },
      parent: { postMessage(message) { messages.push(message) } },
    },
    createRestoreRequest: data => data,
  })
  const result = choose([{ candidateId: 'local-1' }])
  assert.equal(requests.size, 1)
  assert.equal(messages.length, 1)
  assert.equal(requests.values().next().value.timeout, undefined)
  let settled = false
  void result.then(() => { settled = true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(settled, false)
  requests.values().next().value.resolve({ candidateId: 'local-1', explicit: true })
  assert.deepEqual(await result, { candidateId: 'local-1', explicit: true })
})

test('restoring local recovery schedules its source for deletion only after loading it', async () => {
  const candidate = { candidateId: 'local-1', core: 'gba', romSha256: 'rom', runtimeId: 'runtime', state: new Uint8Array([1]) }
  const { actions, run } = harness({ selection: 'local', localRecoveryPrompt: true, localRecovery: candidate })
  await run()
  assert.deepEqual(actions, ['load-state', 'restore-save', 'record-restore', 'schedule-local-delete'])
})

test('a resolved choice schedules cloud deletion after readiness even when local was restored', async () => {
  const candidate = { candidateId: 'local-1', core: 'gba', romSha256: 'rom', runtimeId: 'runtime', state: new Uint8Array([1]) }
  const { actions, run } = harness({ selection: 'local', localRecoveryPrompt: true, localRecovery: candidate, cloudRecovery: { revision: 4 } })
  await run()
  assert.deepEqual(actions, ['load-state', 'restore-save', 'record-restore', 'schedule-local-delete', 'schedule-cloud-delete'])
})

test('restoring a cloud snapshot still injects the separate canonical save', async () => {
  const cloudRecovery = { revision: 4, metadata: { saveRevision: 2 }, state: new Uint8Array([9]) }
  const { actions, run } = harness({ selection: 'cloud', cloudRecovery })
  await run()
  assert.deepEqual(actions, ['load-state', 'restore-save', 'record-restore', 'schedule-cloud-delete'])
})

test('a pending local cleanup does not block the chosen state or canonical save', async () => {
  const candidate = { candidateId: 'local-1', core: 'gba', romSha256: 'rom', runtimeId: 'runtime', state: new Uint8Array([1]) }
  const { context, actions, run } = harness({ selection: 'local', localRecoveryPrompt: true, localRecovery: candidate })
  context.localRecoveryStore.deleteIfMatches = async () => { throw new Error('storage unavailable') }
  await run()
  assert.deepEqual(actions, ['load-state', 'restore-save', 'record-restore', 'schedule-local-delete'])
  assert.equal(context.runtimeReady, true)
})

test('a failed selected snapshot alerts the player and still loads the canonical save', async () => {
  const candidate = { candidateId: 'local-1', core: 'gba', romSha256: 'rom', runtimeId: 'runtime', state: new Uint8Array([1]) }
  const { actions, run } = harness({ selection: 'local', localRecovery: candidate, loadState: () => { throw new Error('invalid state') } })
  await run()
  assert.deepEqual(actions, ['load-state', 'failed:restore-state', 'restart', 'restore-save'])
})

test('a canonical save load failure alerts the player and prevents startup capture', async () => {
  const { context, actions, run } = harness({ restoreSave: async () => { throw new Error('save load failed') } })
  await run()
  assert.deepEqual(actions, ['restart', 'restore-save', 'failed:game-save-load'])
  assert.equal(context.runtimeReady, false)
})

test('a missing canonical save known from snapshot metadata alerts the player', async () => {
  const cloudRecovery = { revision: 4, metadata: { saveRevision: 2 } }
  const { context, actions, run } = harness({ cloudRecovery, restoreSave: async () => false })
  await run()
  assert.deepEqual(actions, ['restart', 'restore-save', 'failed:game-save-missing', 'schedule-cloud-delete'])
  assert.equal(context.runtimeReady, true)
})

test('a restored cloud state without a canonical save cannot create a sav through polling', async () => {
  const cloudRecovery = { revision: 4, state: new Uint8Array([1]), metadata: { saveRevision: 0 } }
  const { actions, run } = harness({ selection: 'cloud', cloudRecovery, restoreSave: async () => false })
  await run()
  assert.deepEqual(actions, ['load-state', 'restore-save', 'read-runtime-save', 'ignore-runtime:2', 'record-restore', 'schedule-cloud-delete'])
})

test('a failed cloud restore keeps the cloud recovery instead of scheduling its deletion', async () => {
  const cloudRecovery = { revision: 4, state: new Uint8Array([1]), metadata: { saveRevision: 1 } }
  const { actions, run } = harness({ selection: 'cloud', cloudRecovery, loadState: () => { throw new Error('invalid state') } })
  await run()
  assert.deepEqual(actions, ['load-state', 'failed:restore-state', 'restart', 'restore-save'])
})

test('explicit Continue also schedules cloud deletion after readiness', async () => {
  const { actions, run } = harness({ cloudRecovery: { revision: 4 } })
  await run()
  assert.deepEqual(actions, ['restart', 'restore-save', 'schedule-cloud-delete'])
})

test('Close while restart is pending does not restore the canonical save afterward', async () => {
  let finishRestart
  const { context, actions, run } = harness({ restart: () => new Promise(resolve => { finishRestart = resolve }) })
  const startup = run()
  await new Promise(resolve => setImmediate(resolve))
  context.closeRequested = true
  finishRestart()
  await startup
  assert.deepEqual(actions, ['restart'])
})

test('automatic captures cannot replace old recovery before the runtime is ready', async () => {
  const captureBegin = source.indexOf('async function captureLocalRecovery()')
  const captureEnd = source.indexOf('async function clearLocalRecovery()', captureBegin)
  const saveBegin = source.indexOf('async function saveEmulatorState(')
  const saveEnd = source.indexOf('async function persistEmulatorState(', saveBegin)
  const actions = []
  const context = {
    leaseLost: false, closeRequested: false, runtimeReady: false,
    measureSynchronousOperation, performanceTimings: null,
    interactionLock: { isLocked: () => false },
    localRecoveryCapture: null, snapshotCapture: null, userSnapshotCapture: null,
    launchDescriptor: { core: 'gba', romSha256: 'rom', runtimeId: 'runtime' },
    window: { EJS_emulator: { gameManager: { getState() { actions.push('read-state'); return new Uint8Array([1]) } } } },
    localRecoveryStore: { async put() { actions.push('write-local') } },
    async persistEmulatorState() { actions.push('write-remote'); return true },
    profileId: 'profile', id: 'game', Uint8Array,
  }
  const capture = runInNewContext(`${source.slice(captureBegin, captureEnd)}\ncaptureLocalRecovery`, context)
  const save = runInNewContext(`${source.slice(saveBegin, saveEnd)}\nsaveEmulatorState`, context)
  assert.equal(await capture(), null)
  assert.equal(await save(), false)
  assert.deepEqual(actions, [])
  context.runtimeReady = true
  assert.equal(await capture(), true)
  assert.equal(await save(), true)
  assert.deepEqual(actions, ['read-state', 'write-local', 'write-remote'])
})

test('close interaction lock skips automatic local and cloud capture while runtime remains ready', async () => {
  const captureBegin = source.indexOf('async function captureLocalRecovery()')
  const captureEnd = source.indexOf('async function clearLocalRecovery()', captureBegin)
  const saveBegin = source.indexOf('async function saveEmulatorState(')
  const saveEnd = source.indexOf('async function persistEmulatorState(', saveBegin)
  const actions = []
  const context = {
    leaseLost: false, closeRequested: false, runtimeReady: true,
    interactionLock: { isLocked: () => true },
    localRecoveryCapture: null, snapshotCapture: null, userSnapshotCapture: null,
    launchDescriptor: { core: 'gba', romSha256: 'rom', runtimeId: 'runtime' },
    window: { EJS_emulator: { gameManager: { getState() { actions.push('read-state'); return new Uint8Array([1]) } } } },
    localRecoveryStore: { async put() { actions.push('write-local') } },
    async persistEmulatorState() { actions.push('write-cloud'); return true },
  }
  const capture = runInNewContext(`${source.slice(captureBegin, captureEnd)}\ncaptureLocalRecovery`, context)
  const save = runInNewContext(`${source.slice(saveBegin, saveEnd)}\nsaveEmulatorState`, context)
  assert.equal(await capture(), null)
  assert.equal(await save(), false)
  assert.deepEqual(actions, [])
})

test('missing state bytes in a ready runtime are reported as an automatic capture failure', async () => {
  const begin = source.indexOf('async function captureLocalRecovery()')
  const end = source.indexOf('async function clearLocalRecovery()', begin)
  const events = []
  const capture = runInNewContext(`${source.slice(begin, end)}\ncaptureLocalRecovery`, {
    leaseLost: false, closeRequested: false, runtimeReady: true, localRecoveryCapture: null,
    measureSynchronousOperation, performanceTimings: null,
    interactionLock: { isLocked: () => false },
    launchDescriptor: { core: 'gba', romSha256: 'rom', runtimeId: 'runtime' },
    window: { EJS_emulator: { gameManager: { getState: () => null } } },
    snapshotTelemetry: { warn(event, details) { events.push([event, details.reason]) } },
  })
  assert.equal(await capture(), false)
  assert.deepEqual(events, [['automatic-capture-unavailable', 'state-bytes-unavailable']])
})

test('periodic cloud capture reports a missing emulator manager without uploading a state', async () => {
  const begin = source.indexOf('async function persistEmulatorState(')
  const end = source.indexOf('function announceUserStateAvailability()', begin)
  const events = []
  const persist = runInNewContext(`${source.slice(begin, end)}\npersistEmulatorState`, {
    leaseLost: false, window: { EJS_emulator: {} }, launchDescriptor: { snapshotUrl: '/snapshot' },
    snapshotTelemetry: { warn(event, details) { events.push([event, details.reason]) } },
  })
  assert.equal(await persist({ kind: 'cloud-recovery', reasonCode: 'periodic-recovery', promptOnLaunch: true }), false)
  assert.deepEqual(events, [['automatic-capture-unavailable', 'manager-unavailable']])
})
