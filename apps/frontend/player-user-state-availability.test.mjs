import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

const playerSource = await readFile(new URL('./src/player.js', import.meta.url), 'utf8')
const hubSource = await readFile(new URL('./src/main.jsx', import.meta.url), 'utf8')

test('the Hub requests current state availability when a player frame loads', () => {
  const start = hubSource.indexOf('  function configurePlayerFrameOnLoad(frame, session) {')
  const end = hubSource.indexOf('  function toggleOddsManipulator()', start)
  assert.ok(start >= 0 && end > start)
  const messages = []
  const configurePlayerFrameOnLoad = runInNewContext(`${hubSource.slice(start, end)}\nconfigurePlayerFrameOnLoad`, {
    huntActiveRef: { current: false },
    macroCoordinatorRef: { current: { lost: async () => {} } },
    hubPerformance: null,
    sendPlayerInteractionLock() {},
    closeLockRef: { current: false },
    profileInfoSessionId: null,
    configurePlayerFrame(_frame, message) { messages.push(message) },
    fastForwardEnabled: false,
    fastForwardSpeed: 1.5,
    muted: false,
    crypto: { randomUUID: () => 'test-request' },
    oddsManipulatorEnabled: false,
  })
  configurePlayerFrameOnLoad({}, { sessionId: 'session-1' })
  assert.ok(messages.some(message => message.type === 'emulator-hub:user-state-availability-request' && message.sessionId === 'session-1'))
})

test('a player answers an availability request from its Hub with its current state', () => {
  const start = playerSource.indexOf("  if (event.data?.type === 'emulator-hub:user-state-availability-request')")
  const end = playerSource.indexOf("  if (event.data?.type === 'emulator-hub:save-state')", start)
  assert.ok(start >= 0 && end > start)
  const announceStart = playerSource.indexOf('function announceUserStateAvailability() {')
  const announceEnd = playerSource.indexOf('function reportPlayerActionFailure(', announceStart)
  assert.ok(announceStart >= 0 && announceEnd > announceStart)
  const messages = []
  const context = {
    sessionId: 'session-1',
    id: 'game-1',
    profileId: 'profile-1',
    hubOrigin: 'https://hub.example',
    userSnapshot: { state: new Uint8Array([7]) },
    window: { parent: { postMessage(message, origin) { messages.push({ message, origin }) } } },
  }
  const handle = runInNewContext(`${playerSource.slice(announceStart, announceEnd)}\nfunction handle(event) {\n${playerSource.slice(start, end)}\n}\nhandle`, context)
  handle({ data: { type: 'emulator-hub:user-state-availability-request', sessionId: 'session-1' } })
  handle({ data: { type: 'emulator-hub:user-state-availability-request', sessionId: 'other-session' } })
  assert.equal(messages.length, 1)
  assert.deepEqual({ ...messages[0].message }, { type: 'emulator-hub:user-state-availability', sessionId: 'session-1', gameId: 'game-1', profileId: 'profile-1', available: true })
  assert.equal(messages[0].origin, 'https://hub.example')
})

test('manual state is loadable locally while backend upload is still pending', async () => {
  const start = playerSource.indexOf('async function persistEmulatorState(')
  const end = playerSource.indexOf('function announceUserStateAvailability()', start)
  assert.ok(start >= 0 && end > start)
  let finishUpload
  const upload = new Promise(resolve => { finishUpload = resolve })
  const announcements = []
  const context = {
    window: { EJS_emulator: { gameManager: { getState() { return new Uint8Array([4, 5]) } } } },
    leaseLost: false, launchDescriptor: { core: 'gba', romSha256: 'a'.repeat(64), runtimeId: 'emulatorjs-4.2.3', snapshotUrl: '/snapshot' },
    performanceTimings: null, measureSynchronousOperation: (_timings, _name, operation) => operation(),
    cloudSaveSynchronizer: { getRevision() { return 1 } },
    profileId: 'profile-1', id: 'game-1', installationIdentity: { id: null },
    putEmulatorSnapshot: () => upload, snapshotUrlForKind: url => url,
    userSnapshotRevision: null, snapshotRevision: null, sessionId: 'session-1', leaseGeneration: 1,
    announceUserStateAvailability() { announcements.push(true) }, Uint8Array,
  }
  const capture = runInNewContext(`${playerSource.slice(start, end)}\npersistEmulatorState`, context)
  const saving = capture({ kind: 'user-state', reasonCode: 'user-request', promptOnLaunch: true })
  assert.deepEqual([...context.userSnapshot.state], [4, 5])
  assert.deepEqual(announcements, [true])
  finishUpload({ revision: 2, capturedAt: '2026-09-28T00:00:00.000Z' })
  assert.equal(await saving, true)
  context.window.EJS_emulator.gameManager.getState = () => new Uint8Array([8])
  context.putEmulatorSnapshot = async () => { throw new Error('offline') }
  await assert.rejects(capture({ kind: 'user-state', reasonCode: 'user-request', promptOnLaunch: true }), error => error.message === 'offline' && error.localStateCaptured === true)
  assert.deepEqual([...context.userSnapshot.state], [8])
  assert.deepEqual(announcements, [true, true])
})
