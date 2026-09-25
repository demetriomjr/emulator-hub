import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

const hub = await readFile(new URL('./src/main.jsx', import.meta.url), 'utf8')
const launchStart = hub.indexOf('  async function startPlayerWithProfile(')
const launchEnd = hub.indexOf('  function respondToRestore(', launchStart)
assert.ok(launchStart > 0 && launchEnd > launchStart)

function launchHarness(existingSessions, purpose) {
  const actions = []
  const context = {
    activeSessions: existingSessions,
    profilePurpose: purpose,
    profileGame: { id: 'game-2' },
    fastForwardEnabled: false, fastForwardSpeed: 1.5, muted: false,
    playerOriginPorts: [],
    MAX_PLAYER_INSTANCES: 6,
    crypto: { randomUUID: () => 'session-2' },
    async acquirePlayerLease() { return { leaseGeneration: 1 } },
    disableOddsManipulator() { actions.push('disable-odds') },
    setError() {}, setProfileError() {}, setProfileBusy() {},
    setProfileGame() {}, setInstancePicker() {}, setProfilePickerPlacement() {},
    setActiveSessions(value) { actions.push('open-session'); context.activeSessions = typeof value === 'function' ? value(context.activeSessions) : value },
    setFocusedSessionId() {},
    oddsSyncRef: { current: new Map() },
    createOddsManipulatorSync: () => ({ stop() {} }),
    syncOddsResetCount() {},
    clientDiagnostics: null,
    console,
  }
  const launch = runInNewContext(`${hub.slice(launchStart, launchEnd)}\nstartPlayerWithProfile`, context)
  return { launch, actions, context }
}

test('opening the first emulator resets odds manipulation for the new wrapper', async () => {
  const { launch, actions, context } = launchHarness([], 'launch')
  await launch({ id: 'profile-2', oddsResetCount: 0 }, false)
  assert.deepEqual(actions, ['disable-odds', 'open-session'])
  assert.equal(context.activeSessions.length, 1)
})

test('adding an emulator preserves the wrapper odds state', async () => {
  const { launch, actions, context } = launchHarness([{ sessionId: 'session-1' }], 'add-instance')
  await launch({ id: 'profile-2', oddsResetCount: 0 }, false)
  assert.deepEqual(actions, ['open-session'])
  assert.equal(context.activeSessions.length, 2)
})

test('a newly loaded iframe receives the already enabled wrapper odds clock', () => {
  const begin = hub.indexOf('  function configurePlayerFrameOnLoad(')
  const end = hub.indexOf('  function toggleOddsManipulator(', begin)
  assert.ok(begin > 0 && end > begin)
  const actions = []
  const configure = runInNewContext(`${hub.slice(begin, end)}\nconfigurePlayerFrameOnLoad`, {
    hubPerformance: null,
    fastForwardEnabled: false, fastForwardSpeed: 1.5, muted: false, oddsManipulatorEnabled: true,
    closeLockRef: { current: false }, window: { location: { origin: 'http://localhost' } },
    sendPlayerInteractionLock() {},
    configurePlayerFrame: (frame, message) => actions.push(['frame', frame, { ...message }]),
    configureOddsClock: (frame, session, count, timestamp) => { actions.push(['odds', frame, session, count, timestamp]); return Promise.resolve(true) },
  })
  const frame = { contentWindow: { postMessage() {} } }
  const session = { sessionId: 'session-2', oddsResetCount: 3 }
  configure(frame, session)
  assert.deepEqual(actions, [
    ['frame', frame, { type: 'emulator-hub:fast-forward', enabled: false, speed: 1.5 }],
    ['frame', frame, { type: 'emulator-hub:mute', muted: false }],
    ['odds', frame, session, 3, 180_000],
  ])
})

test('closing the whole wrapper clears the odds toggle before a later first launch', async () => {
  const begin = hub.indexOf('  async function finishSelectedPlayerClose()')
  const end = hub.indexOf('  function flushPlayerSave(', begin)
  assert.ok(begin > 0 && end > begin)
  const actions = []
  const close = runInNewContext(`${hub.slice(begin, end)}\nfinishSelectedPlayerClose`, {
    document: { fullscreenElement: null }, playerShellRef: { current: null },
    activeSessions: [{ sessionId: 'session-1' }], closeBatchSessionIdsRef: { current: ['session-1'] },
    activeSessionsRef: { current: [{ sessionId: 'session-1' }] },
    snapshotDeleteWatchdogRef: { current: { cancel() {} } }, clearRestoreChoiceTimer() {},
    oddsSyncRef: { current: new Map() }, oddsClockReadyRef: { current: new Map() }, oddsResetQueueRef: { current: new Map() },
    setSnapshotRestoreRequests() {}, snapshotRestoreRequestsRef: { current: {} },
    setUserStateAvailable() {}, setPlayerActionErrors() {}, setFocusedSessionId() {},
    setCloseChooserOpen() {}, setSelectedCloseSessionIds() {}, Set, Object,
    setActiveSessions: sessions => actions.push(['sessions', sessions.length]),
    setOddsManipulatorEnabled: enabled => actions.push(['odds', enabled]),
    setFullscreen() {}, setSaveCloseRows() {},
    saveCloseCoordinatorRef: { current: {} },
  })
  await close()
  assert.deepEqual(actions, [['sessions', 0], ['odds', false]])
})
