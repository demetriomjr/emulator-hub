import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

const hub = await readFile(new URL('./src/main.jsx', import.meta.url), 'utf8')
const player = await readFile(new URL('./src/player.js', import.meta.url), 'utf8')

test('new player URL carries the saved mute state before EmulatorJS loads', () => {
  const begin = hub.indexOf('function playerFrameUrl(')
  const end = hub.indexOf('function ControlBinding(', begin)
  assert.ok(begin > 0 && end > begin)
  const makeUrl = runInNewContext(`${hub.slice(begin, end)}\nplayerFrameUrl`, {
    URLSearchParams,
    appendClientDiagnosticsParameters: parameters => parameters,
    clientDiagnosticsOptions: {},
    playerOriginPorts: [],
  })
  const url = makeUrl({ gameId: 'game', profileId: 'profile', sessionId: 'session', leaseGeneration: 1, initialMuted: true, initialFastForwardEnabled: false, initialFastForwardSpeed: 1.5 })
  assert.equal(new URL(url, 'https://hub.example').searchParams.get('muted'), '1')
})

test('newly loaded iframe receives the current mute toggle state', () => {
  const begin = hub.indexOf('  function configurePlayerFrameOnLoad(')
  const end = hub.indexOf('  function toggleOddsManipulator(', begin)
  assert.ok(begin > 0 && end > begin)
  const messages = []
  const configure = runInNewContext(`${hub.slice(begin, end)}\nconfigurePlayerFrameOnLoad`, {
    hubPerformance: null,
    fastForwardEnabled: false, fastForwardSpeed: 1.5, muted: true, oddsManipulatorEnabled: false,
    closeLockRef: { current: false }, profileInfoSessionId: null, sendPlayerInteractionLock() {},
    configurePlayerFrame(_frame, message) { messages.push({ ...message }) },
  })
  configure({ contentWindow: {} }, { sessionId: 'new' })
  assert.deepEqual(messages.find(message => message.type === 'emulator-hub:mute'), { type: 'emulator-hub:mute', muted: true })
})

test('hub preference, header, and player message paths use the same mute state', () => {
  assert.ok(hub.indexOf('className={`fast-forward-button mute-button') < hub.indexOf('aria-label="Fast Forward"'))
  assert.match(hub, /preferences\.muted/)
  assert.match(hub, /saveUserPreferences\(\{ muted: nextMuted \}\)/)
  assert.match(hub, /aria-pressed=\{muted\}/)
  assert.match(hub, /emulator-hub:mute/)
  assert.match(player, /parameters\.get\('muted'\) === '1'/)
  assert.match(player, /event\.data\?\.type === 'emulator-hub:mute'/)
  assert.match(player, /typeof event\.data\.muted !== 'boolean'/)
  assert.match(player, /audioMute\.attach\(window\.EJS_emulator\)/)
})

test('an older preference response cannot revert a newer mute click', async () => {
  const begin = hub.indexOf('  async function saveUserPreferences(')
  const end = hub.indexOf('  function toggleFastForward(', begin)
  assert.ok(begin > 0 && end > begin)
  let finishFirst
  const firstResponse = new Promise(resolve => { finishFirst = resolve })
  const mutedChanges = []
  const context = {
    preferenceWriteRef: { current: Promise.resolve() },
    muteRevisionRef: { current: 1 },
    confirmedPreferencesRef: { current: { fastForwardSpeed: 1.5, fastForwardEnabled: false, muted: false, triggerActions: { l2: 'none', r2: 'none' } } },
    updateUserPreferences: partial => partial.muted ? firstResponse : Promise.resolve({ preferences: { fastForwardSpeed: 1.5, fastForwardEnabled: false, muted: false, triggerActions: { l2: 'none', r2: 'none' } } }),
    setMuted: value => mutedChanges.push(value),
    setFastForwardSpeed() {}, setFastForwardEnabled() {}, setL2TriggerAction() {}, setR2TriggerAction() {}, setError() {},
    document: { cookie: '' },
  }
  const save = runInNewContext(`${hub.slice(begin, end)}\nsaveUserPreferences`, context)
  const first = save({ muted: true })
  context.muteRevisionRef.current = 2
  const second = save({ muted: false })
  finishFirst({ preferences: { fastForwardSpeed: 1.5, fastForwardEnabled: false, muted: true, triggerActions: { l2: 'none', r2: 'none' } } })
  await Promise.all([first, second])
  assert.deepEqual(mutedChanges, [false])
})
