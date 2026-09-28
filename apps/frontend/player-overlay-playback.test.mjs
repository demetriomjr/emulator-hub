import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

const hub = await readFile(new URL('./src/main.jsx', import.meta.url), 'utf8')
const player = await readFile(new URL('./src/player.js', import.meta.url), 'utf8')
const css = await readFile(new URL('./src/styles.css', import.meta.url), 'utf8')

test('overlay visibility follows pointer hover rather than retained button focus', () => {
  assert.match(css, /\.player-cell:hover \.player-cell-controls\s*\{[^}]*opacity:\s*1/)
  assert.doesNotMatch(css, /\.player-cell-controls:focus-within/)
})

test('player reports its actual paused status after a playback command', () => {
  const start = player.indexOf("  if (event.data?.type === 'emulator-hub:set-playback')")
  const end = player.indexOf("  if (event.data?.type === 'emulator-hub:close-player')", start)
  assert.ok(start >= 0 && end > start)
  const messages = []
  const emulator = { gameManager: {}, paused: false }
  const handle = runInNewContext(`function handle(event) {\n${player.slice(start, end)}\n}\nhandle`, {
    shinyHuntPlayer: null,
    stopMacro() {},
    window: { EJS_emulator: emulator },
    applyPlayerPlayback(_emulator, action) { emulator.paused = action === 'pause'; return true },
    runtimeReady: true,
    interactionLock: { isLocked() { return false } },
    announcePlaybackState() { messages.push(emulator.paused) },
  })
  handle({ data: { type: 'emulator-hub:set-playback', action: 'pause' } })
  handle({ data: { type: 'emulator-hub:set-playback', action: 'play' } })
  assert.deepEqual(messages, [true, false])
})

test('both playback buttons render Play or Pause from the session status', () => {
  assert.match(hub, /playerPaused\[activeSessions\[0\]\?\.sessionId\]/)
  assert.match(hub, /playerPaused\[session\.sessionId\]/)
})

test('Hub accepts paused status only from the matching player session', () => {
  const start = hub.indexOf("      if (event.data?.type === 'emulator-hub:playback-state')")
  const end = hub.indexOf("      if (event.data?.type === 'emulator-hub:player-action-failed')", start)
  assert.ok(start >= 0 && end > start)
  let status = {}
  const receive = runInNewContext(`function receive(event) {\n${hub.slice(start, end)}\n}\nreceive`, {
    trustedFrame: { closest() { return { dataset: { sessionId: 'session-1' } } } },
    activeSessions: [{ sessionId: 'session-1' }],
    setPlayerPaused(update) { status = update(status) },
  })
  receive({ data: { type: 'emulator-hub:playback-state', sessionId: 'other', ok: true, paused: true } })
  assert.deepEqual(status, {})
  receive({ data: { type: 'emulator-hub:playback-state', sessionId: 'session-1', ok: true, paused: true } })
  assert.deepEqual({ ...status }, { 'session-1': true })
  receive({ data: { type: 'emulator-hub:playback-state', sessionId: 'session-1', ok: true, paused: false } })
  assert.deepEqual({ ...status }, { 'session-1': false })
})
