import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

const source = await readFile(new URL('./src/player.js', import.meta.url), 'utf8')
const closeSource = source.slice(source.indexOf('async function closeEmulator()'), source.indexOf('window.emulatorHubClose'))

function closeHarness({ ready, deleteFails = false }) {
  const actions = []
  const pendingRestoreRequests = new Map([['choice', { resolve(value) { actions.push(['choice-resolved', value]) } }]])
  const context = {
    Uint8Array,
    runtimeReady: ready,
    closeRequested: false,
    pendingRestoreRequests,
    restoreCandidates: [{ candidateId: 'remote:7' }],
    window: {
      clearTimeout(id) { actions.push(['clear-timeout', id]) },
      clearInterval(id) { actions.push(['clear-interval', id]) },
      EJS_emulator: { gameManager: { getSaveFile() { actions.push('read-final-save'); return new Uint8Array([3]) } } },
    },
    cloudSaveInterval: 1,
    cloudRecoveryDeleteTimer: null,
    cloudRecoveryDeletion: null,
    localRecoveryInterval: 2,
    localRecoveryDeleteTimer: null,
    stopBatterySavePolling() { actions.push('stop-polling') },
    localRecoveryCapture: null,
    pendingSaveSync: Promise.resolve(),
    latestSaveBytes: null,
    async queueCloudSave() { actions.push('upload-save') },
    snapshotCapture: null,
    userSnapshotCapture: null,
    offerPolicy: { shouldPromptAtClose() { throw new Error('close must not use save revision to retain automatic recovery') } },
    cloudSaveSynchronizer: { getRevision() { return 1 } },
    snapshotRevision: 7,
    launchDescriptor: { snapshotUrl: '/snapshot' },
    sessionId: 'session',
    leaseGeneration: 1,
    async deleteEmulatorSnapshot() { actions.push('delete-cloud') },
    async saveEmulatorState() { actions.push('write-cloud') },
    console: { warn(...args) { actions.push(['warn', ...args]) } },
    snapshotTelemetry: {
      info(event, details) { actions.push(['telemetry-info', event, details]) },
      warn(event, details) { actions.push(['telemetry-warn', event, details]) },
      error(event, details) { actions.push(['telemetry-error', event, details]) },
    },
  }
  if (deleteFails) context.deleteEmulatorSnapshot = async () => { actions.push('delete-cloud'); throw new Error('delete unavailable') }
  return { close: runInNewContext(`${closeSource}\ncloseEmulator`, context), context, actions }
}

test('closing before the restore choice preserves candidates and does not flush an unselected runtime', async () => {
  const { close, context, actions } = closeHarness({ ready: false })
  assert.equal((await close()).preserveRecovery, true)
  assert.equal(actions[0][0], 'choice-resolved')
  assert.equal(actions[0][1].candidateId, null)
  assert.equal(actions[0][1].explicit, false)
  assert.equal(context.pendingRestoreRequests.size, 0)
})

test('normal close flushes the game save and deletes automatic cloud recovery', async () => {
  const { close, actions } = closeHarness({ ready: true })
  assert.equal((await close()).preserveRecovery, false)
  assert.ok(actions.includes('read-final-save'))
  assert.ok(actions.includes('upload-save'))
  assert.equal(actions.includes('write-cloud'), false)
  assert.equal(actions.includes('delete-cloud'), true)
  assert.ok(actions.some(action => Array.isArray(action) && action[0] === 'telemetry-info' && action[1] === 'close-completed'))
})

test('normal close never creates another cloud recovery snapshot', async () => {
  const { close, actions } = closeHarness({ ready: true })
  assert.equal((await close()).preserveRecovery, false)
  assert.ok(actions.includes('upload-save'))
  assert.ok(actions.includes('delete-cloud'))
  assert.equal(actions.includes('write-cloud'), false)
})

test('normal close cancels a pending local recovery discard', async () => {
  const { close, context, actions } = closeHarness({ ready: true })
  context.localRecoveryDeleteTimer = 3
  await close()
  assert.ok(actions.some(action => Array.isArray(action) && action[0] === 'clear-timeout' && action[1] === 3))
})

test('automatic cloud deletion failure does not turn a successful save flush into a failed close', async () => {
  const { close, actions } = closeHarness({ ready: true, deleteFails: true })
  assert.equal((await close()).preserveRecovery, false)
  assert.ok(actions.includes('upload-save'))
  assert.ok(actions.includes('delete-cloud'))
  assert.ok(actions.some(action => Array.isArray(action) && action[0] === 'telemetry-warn' && action[1] === 'cloud-recovery-delete-failed'))
})

test('automatic local capture failure does not block final game save synchronization', async () => {
  const { close, context, actions } = closeHarness({ ready: true })
  context.localRecoveryCapture = Promise.reject(new Error('indexeddb unavailable'))
  assert.equal((await close()).preserveRecovery, false)
  assert.ok(actions.includes('upload-save'))
})

test('normal close waits for an in-flight scheduled deletion before retrying cleanup', async () => {
  const { close, context, actions } = closeHarness({ ready: true })
  let finishDelete
  context.cloudRecoveryDeletion = new Promise(resolve => { finishDelete = resolve })
  const closing = close()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(actions.includes('delete-cloud'), false)
  context.snapshotRevision = null
  finishDelete()
  await closing
  assert.equal(actions.includes('delete-cloud'), false)
})

test('the parent preserves local and remote candidates when the iframe closes before play', async () => {
  const hub = await readFile(new URL('./src/main.jsx', import.meta.url), 'utf8')
  assert.match(hub, /const closeResult = await flushPlayerSave\(frame\)/)
  assert.match(hub, /if \(!closeResult\.preserveRecovery\) \{[\s\S]*?await clearPlayerRecovery\(frame\)[\s\S]*?catch/)
  assert.match(hub, /releasePlayerLease\(session\.sessionId, \{[^}]*preserveRecovery: closeResult\.preserveRecovery/)
  assert.match(hub, /releasePlayerLease\(event\.data\.sessionId, \{[^}]*preserveRecovery: true/)
  assert.match(hub, /result => finish\(null, result\)/)
  assert.match(hub, /event\.data\.preserveRecovery/)
})

test('the parent close transport returns the preservation decision through direct and message paths', async () => {
  const hub = await readFile(new URL('./src/main.jsx', import.meta.url), 'utf8')
  const flushSource = hub.slice(hub.indexOf('function flushPlayerSave(frame)'), hub.indexOf('function clearPlayerRecovery(frame)'))
  const directWindow = { location: { origin: 'https://hub.test' }, clearTimeout() {}, removeEventListener() {} }
  const direct = runInNewContext(`${flushSource}\nflushPlayerSave`, { window: directWindow })
  assert.equal((await direct({ contentWindow: { emulatorHubClose: async () => ({ preserveRecovery: true }) } })).preserveRecovery, true)

  let listener
  const fallbackWindow = {
    location: { origin: 'https://hub.test' },
    setTimeout() { return 1 }, clearTimeout() {},
    addEventListener(name, callback) { assert.equal(name, 'message'); listener = callback },
    removeEventListener() { listener = null },
  }
  const fallback = runInNewContext(`${flushSource}\nflushPlayerSave`, { window: fallbackWindow })
  const contentWindow = { postMessage(message) { queueMicrotask(() => listener({ origin: 'https://hub.test', source: contentWindow, data: { type: 'emulator-hub:save-synced', requestId: message.requestId, ok: true, preserveRecovery: true } })) } }
  assert.equal((await fallback({ contentWindow })).preserveRecovery, true)
})
