import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

const hub = await readFile(new URL('./src/main.jsx', import.meta.url), 'utf8')
const begin = hub.indexOf('  function cancelCloseChooser()')
const end = hub.indexOf('  function flushPlayerSave(', begin)
assert.ok(begin > 0 && end > begin)
const closeSource = `${hub.slice(begin, end)}\n({ closePlayer, closeSessions, finishSelectedPlayerClose })`

function harness(sessions, { preferenceFailure = false } = {}) {
  const calls = []
  const frames = sessions.map(session => ({ sessionId: session.sessionId, contentWindow: {} })).reverse()
  let tasks = []
  const context = {
    activeSessions: sessions,
    activeSessionsRef: { current: sessions },
    closeChooserOpen: false,
    saveCloseCoordinatorRef: { current: null },
    closeBatchSessionIdsRef: { current: [] },
    setPlayerInteractionLocked: locked => calls.push(['lock', locked]),
    setSelectedCloseSessionIds(value) { context.selected = value },
    setCloseChooserOpen(value) { context.closeChooserOpen = value },
    setSaveCloseRows() {},
    selected: new Set(),
    document: {
      querySelectorAll: () => frames.map(frame => ({ dataset: { sessionId: frame.sessionId }, querySelector: () => frame })),
      fullscreenElement: null,
    },
    playerShellRef: { current: null },
    oddsSyncRef: { current: new Map(sessions.map(session => [session.sessionId, { flush: async () => {}, stop: () => calls.push(['stop', session.sessionId]) }])) },
    oddsClockReadyRef: { current: new Map() }, oddsResetQueueRef: { current: new Map() },
    fastForwardSpeed: 5, fastForwardEnabled: true, muted: true, l2TriggerAction: 'save-state', r2TriggerAction: 'soft-reset',
    saveUserPreferences: async partial => {
      calls.push(['preferences', JSON.parse(JSON.stringify(partial))])
      if (preferenceFailure) throw new Error('Preference write failed')
    },
    flushPlayerSave: async frame => { calls.push(['flush', frame.sessionId]); return { preserveRecovery: false } },
    clearPlayerRecovery: async frame => calls.push(['clear-recovery', frame.sessionId]),
    releasePlayerLease: async sessionId => calls.push(['release', sessionId]),
    createMultiSaveCloseCoordinator({ tasks: selectedTasks }) {
      tasks = selectedTasks
      return { run: async () => selectedTasks.map(() => ({ status: 'failed' })) }
    },
    snapshotDeleteWatchdogRef: { current: { cancel() {} } },
    clearRestoreChoiceTimer() {},
    setSnapshotRestoreRequests() {}, snapshotRestoreRequestsRef: { current: {} },
    setUserStateAvailable() {}, setPlayerActionErrors() {},
    setFocusedSessionId(value) { context.focusUpdate = value },
    setActiveSessions(value) { context.activeSessions = typeof value === 'function' ? value(context.activeSessions) : value; context.activeSessionsRef.current = context.activeSessions },
    setOddsManipulatorEnabled(value) { calls.push(['odds', value]) },
    setFullscreen() {},
    window: {},
    Set, Object,
  }
  const api = runInNewContext(closeSource, context)
  return { api, calls, context, getTasks: () => tasks }
}

const sessions = [
  { sessionId: 'a', gameId: 'rom-a', gameTitle: 'ROM A', profileId: 'profile-a', profileName: 'Perfil A' },
  { sessionId: 'b', gameId: 'rom-b', gameTitle: 'ROM B', profileId: 'profile-b', profileName: 'Perfil B' },
]

test('one emulator closes directly; multiple emulators open with all selected', () => {
  const one = harness(sessions.slice(0, 1))
  one.api.closePlayer()
  assert.deepEqual(one.context.closeBatchSessionIdsRef.current, ['a'])
  const many = harness(sessions)
  many.api.closePlayer()
  assert.equal(many.context.closeChooserOpen, true)
  assert.deepEqual([...many.context.selected], ['a', 'b'])
  assert.equal(many.getTasks().length, 0)
})

test('selected close uses session identity after the frame order changes', async () => {
  const { api, calls, getTasks } = harness(sessions)
  await api.closeSessions(['b'])
  assert.equal(getTasks().length, 1)
  assert.equal(getTasks()[0].label, 'ROM B | Perfil B')
  await getTasks()[0].run()
  assert.deepEqual(calls.filter(call => call[0] === 'flush' || call[0] === 'release'), [['flush', 'b'], ['release', 'b']])
})

test('partial completion keeps survivor and global odds state', async () => {
  const { api, calls, context } = harness(sessions)
  context.closeBatchSessionIdsRef.current = ['b']
  await api.finishSelectedPlayerClose()
  assert.deepEqual(context.activeSessions.map(session => session.sessionId), ['a'])
  assert.equal(calls.some(call => call[0] === 'odds'), false)
  assert.equal(context.focusUpdate('b'), 'a')
})

test('closing every emulator confirms the visible header preferences while partial close does not', async () => {
  const partial = harness(sessions)
  await partial.api.closeSessions(['a'])
  assert.equal(partial.calls.some(call => call[0] === 'preferences'), false)

  const whole = harness(sessions)
  await whole.api.closeSessions(['a', 'b'])
  assert.deepEqual(whole.calls.find(call => call[0] === 'preferences'), ['preferences', {
    fastForwardSpeed: 5,
    fastForwardEnabled: true,
    muted: true,
    triggerActions: { l2: 'save-state', r2: 'soft-reset' },
  }])
})

test('a failed final preference write does not prevent game save and lease release', async () => {
  const { api, calls, getTasks } = harness(sessions, { preferenceFailure: true })
  await api.closeSessions(['a', 'b'])
  await Promise.all(getTasks().map(task => task.run()))
  assert.deepEqual(calls.filter(call => call[0] === 'flush' || call[0] === 'release'), [
    ['flush', 'a'], ['flush', 'b'], ['release', 'a'], ['release', 'b'],
  ])
})
