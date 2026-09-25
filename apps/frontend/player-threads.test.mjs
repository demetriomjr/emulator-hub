import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { playerThreadFallbackUrl } from '../packages/player-thread-policy.mjs'

const player = await readFile(new URL('./src/player.js', import.meta.url), 'utf8')
const hub = await readFile(new URL('./src/main.jsx', import.meta.url), 'utf8')

test('a failed threaded core retries once in the same iframe and session before game start', () => {
  const begin = player.indexOf('function stopThreadStartupMonitor()')
  const end = player.indexOf('function resizeMobileDpad(', begin)
  const replacements = []
  const warnings = []
  let monitor
  const context = {
    threadDecision: { enabled: true }, threadGameStarted: false, threadFallbackRequested: false,
    closeRequested: false, threadStartupMonitor: null, threadStartupTimeout: null,
    playerThreadFallbackUrl, location: { href: 'https://hub.example/player.html?sessionId=s1&profileId=p1' },
    launchDescriptor: { core: 'gba' }, sessionId: 's1',
    window: {
      EJS_emulator: { failedToStart: true },
      location: { replace(url) { replacements.push(url) } },
      setInterval(fn) { monitor = fn; return 1 }, setTimeout() { return 2 },
      clearInterval() {}, clearTimeout() {},
    },
    console: { warn(...args) { warnings.push(args) } },
  }
  const testRuntime = runInNewContext(`${player.slice(begin, end)}\n({ monitorThreadedCoreStartup, fallBackFromThreadedCore })`, context)
  testRuntime.monitorThreadedCoreStartup()
  monitor()
  assert.equal(replacements.length, 1)
  assert.equal(new URL(replacements[0]).searchParams.get('sessionId'), 's1')
  assert.equal(new URL(replacements[0]).searchParams.get('threadFallback'), '1')
  assert.equal(testRuntime.fallBackFromThreadedCore('another-error'), false)
  assert.equal(warnings.length, 1)
})

test('a started game cannot be reloaded as a thread fallback', () => {
  const begin = player.indexOf('function stopThreadStartupMonitor()')
  const end = player.indexOf('function resizeMobileDpad(', begin)
  let replaced = false
  const context = {
    threadDecision: { enabled: true }, threadGameStarted: true, threadFallbackRequested: false,
    closeRequested: false, threadStartupMonitor: null, threadStartupTimeout: null,
    playerThreadFallbackUrl, location: { href: 'https://hub.example/player.html?sessionId=s1' },
    window: { location: { replace() { replaced = true } } },
  }
  const fallback = runInNewContext(`${player.slice(begin, end)}\nfallBackFromThreadedCore`, context)
  assert.equal(fallback('late-error'), false)
  assert.equal(replaced, false)
})

test('thread selection precedes EmulatorJS loader and leaves canonical save and state paths intact', () => {
  assert.ok(player.indexOf('window.EJS_threads = threadDecision.enabled') < player.indexOf('document.body.appendChild(loader)'))
  assert.ok(player.indexOf('threadGameStarted = true') < player.indexOf('const restoreChoice = restoreCandidates.length'))
  assert.match(player, /await cloudSaveSynchronizer\.restore\(window\.EJS_emulator\.gameManager\)/)
  assert.match(player, /window\.EJS_emulator\.gameManager\.loadState\(new Uint8Array\(current\.state\)\)/)
  assert.doesNotMatch(hub, /contentDocument|contentWindow\?\.emulatorHubClose|contentWindow\?\.emulatorHubClearLocalRecovery|contentWindow\?\.emulatorHubSetInteractionLock/)
})

test('player acknowledges lock, close and local recovery clear to its own session', async () => {
  const begin = player.indexOf("window.addEventListener('message', event => {")
  const end = player.indexOf('async function start()', begin)
  const sent = []
  let receive
  let locked = null
  let cleared = false
  const parent = { postMessage(message) { sent.push(message) } }
  const context = {
    hubOrigin: 'https://hub.example', sessionId: 's1', id: 'game', profileId: 'p1',
    lastInteractionLockRevision: -1,
    interactionLock: { setLocked(value) { locked = value } },
    closeEmulator: async () => ({ preserveRecovery: true }),
    clearLocalRecovery: async () => { cleared = true },
    window: { parent, addEventListener(_name, listener) { receive = listener } },
  }
  runInNewContext(player.slice(begin, end), context)
  const send = data => receive({ origin: 'https://hub.example', source: parent, data })
  send({ type: 'emulator-hub:interaction-lock', requestId: 'lock-1', sessionId: 's1', revision: 2, locked: true })
  assert.equal(locked, true)
  assert.equal(sent.at(-1).requestId, 'lock-1')
  send({ type: 'emulator-hub:interaction-lock', requestId: 'lock-old', sessionId: 's1', revision: 1, locked: false })
  assert.equal(locked, true)
  send({ type: 'emulator-hub:close-player', requestId: 'close-1', sessionId: 's1' })
  send({ type: 'emulator-hub:clear-local-recovery', requestId: 'clear-1', sessionId: 's1' })
  await Promise.resolve()
  assert.equal(cleared, true)
  assert.ok(sent.some(message => message.type === 'emulator-hub:save-synced' && message.requestId === 'close-1' && message.sessionId === 's1' && message.preserveRecovery === true))
  assert.ok(sent.some(message => message.type === 'emulator-hub:local-recovery-cleared' && message.requestId === 'clear-1' && message.sessionId === 's1' && message.ok === true))
})

test('parent waits for local recovery deletion acknowledgement before completing cleanup', async () => {
  const begin = hub.indexOf('function clearPlayerRecovery(frame)')
  const end = hub.indexOf('async function openProfilePicker(', begin)
  let complete
  let request
  const clear = runInNewContext(`${hub.slice(begin, end)}\nclearPlayerRecovery`, {
    window: {},
    requestPlayerFrame(value) { request = value; return new Promise(resolve => { complete = resolve }) },
  })
  const frame = { closest() { return { dataset: { sessionId: 's1' } } } }
  let finished = false
  const pending = clear(frame).then(() => { finished = true })
  await Promise.resolve()
  assert.equal(finished, false)
  assert.equal(request.sessionId, 's1')
  assert.equal(request.replyType, 'emulator-hub:local-recovery-cleared')
  complete({ ok: true })
  await pending
  assert.equal(finished, true)
})
