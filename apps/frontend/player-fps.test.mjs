import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { sampleEmulatedFps } from '../packages/emulator-fps.mjs'

const player = await readFile(new URL('./src/player.js', import.meta.url), 'utf8')
const html = await readFile(new URL('./player.html', import.meta.url), 'utf8')
const begin = player.indexOf('function startEmulatedFpsOverlay()')
const end = player.indexOf('async function queueCloudSave(', begin)
const source = player.slice(begin, end)

function harness(enabled) {
  let frame = 100
  let now = 100
  let update
  let reads = 0
  let removed = false
  let intervalStarted = false
  const sent = []
  const overlay = { textContent: '', setAttribute() {}, remove() { removed = true } }
  const context = {
    clientDiagnosticsOptions: { enabled },
    emulatedFpsTimer: null, emulatedFpsOverlay: null,
    fastForwardRequest: { enabled: true, speed: 5 },
    launchDescriptor: { core: 'gba' },
    sampleEmulatedFps,
    performanceTimings: { drain: () => ({ 'getState.local': { count: 1, totalMs: 4, maxMs: 4 } }) },
    threadDecision: { enabled: true },
    sessionId: 's1',
    hubOrigin: 'https://hub.example',
    performance: { timeOrigin: 100_000, now: () => now },
    document: { createElement(tag) { assert.equal(tag, 'output'); return overlay }, body: { append() {} } },
    window: {
      crossOriginIsolated: true,
      parent: { postMessage(message) { sent.push(message) } },
      EJS_emulator: { gameManager: { getFrameNum() { reads += 1; return frame } } },
      setInterval(callback, milliseconds) { assert.equal(milliseconds, 1000); intervalStarted = true; update = callback; return 1 },
      clearInterval(id) { assert.equal(id, 1) },
    },
  }
  const runtime = runInNewContext(`${source}\n({ startEmulatedFpsOverlay, stopEmulatedFpsOverlay })`, context)
  return {
    ...runtime, overlay,
    advance(nextFrame, nextNow) { frame = nextFrame; now = nextNow; update() },
    get reads() { return reads },
    get intervalStarted() { return intervalStarted },
    get removed() { return removed },
    sent,
  }
}

test('VITE_DEBUG=1 shows each player measured emulated FPS and achieved versus requested speed', () => {
  const playerA = harness(true)
  const playerB = harness(true)
  playerA.startEmulatedFpsOverlay()
  playerB.startEmulatedFpsOverlay()
  playerA.advance(399, 1100)
  playerB.advance(220, 1100)
  assert.match(playerA.overlay.textContent, /299 FPS · real 5,0× · alvo 5×/)
  assert.match(playerB.overlay.textContent, /120 FPS · real 2,0× · alvo 5×/)
  assert.equal(playerA.sent.at(-1).type, 'emulator-hub:performance-sample')
  assert.equal(playerA.sent.at(-1).sessionId, 's1')
  assert.ok(playerA.sent.at(-1).speed > 4.9)
  assert.equal(playerA.sent.at(-1).timings['getState.local'].totalMs, 4)
  assert.match(html, /\.emulator-fps-overlay\{[^}]*pointer-events:none/)
  assert.ok(player.indexOf('runtimeReady = true') < player.indexOf('startEmulatedFpsOverlay()', player.indexOf('runtimeReady = true')))
  playerA.stopEmulatedFpsOverlay()
  assert.equal(playerA.removed, true)
})

test('without VITE_DEBUG=1 the player does not sample frames or add an overlay', () => {
  const runtime = harness(false)
  runtime.startEmulatedFpsOverlay()
  assert.equal(runtime.reads, 0)
  assert.equal(runtime.intervalStarted, false)
  assert.equal(runtime.overlay.textContent, '')
})
