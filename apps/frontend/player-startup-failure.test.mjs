import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { createEmulatorAudioMute } from '../packages/emulator-audio-mute.mjs'

const player = await readFile(new URL('./src/player.js', import.meta.url), 'utf8')

function startup({ save = false, audioError = null } = {}) {
  const loading = { textContent: 'Carregando save...', style: { display: 'grid' } }
  const actions = []
  const manager = { restart() { actions.push('restart') } }
  const emulator = {
    Module: { AL: {} }, volume: 0.5, gameManager: manager,
    setVolume() { if (audioError) throw audioError; actions.push('audio') },
    pause() { actions.push('pause') },
  }
  const context = {
    window: { EJS_emulator: emulator, addEventListener() {}, setInterval() { return 1 } },
    console: { error() {}, warn() {} }, playerLoading: loading, runtimeReady: false,
    snapshotTelemetry: { error(event, details) { actions.push(`${event}:${details.phase}`) } },
    loseLease() { context.leaseLost = true; actions.push('lease-lost') },
    clientDiagnostics: null, closeRequested: false, threadFallbackRequested: false, leaseLost: false,
    threadGameStarted: false, stopThreadStartupMonitor() {},
    audioMute: createEmulatorAudioMute(false), applyFastForward() {}, isMobilePlayerViewport: false,
    removeAudioResumeGesture: null, installAudioResumeOnUserGesture() { return () => {} },
    game: { addEventListener() {} },
    createEmulatorGamepadInput() { return { update() {} } }, controlProfile: { bindings: {} }, gamepadBindings: [],
    interactionLock: { apply() {}, isLocked() { return false } },
    localRecoveryPrompt: false, savedSnapshot: null, userSnapshot: null,
    sortRestoreCandidates(value) { return value }, restoreLocalRecovery: false, localRecovery: null,
    cloudSaveSynchronizer: {
      getRevision() { return null },
      async restore() { actions.push('restore-save'); if (save instanceof Error) throw save; return save },
    },
    offerPolicy: { recordInput() {} }, reportPlayerActionFailure(value) { actions.push(value) },
    startEmulatedFpsOverlay() {}, announcePlaybackState() {},
    startLocalRecoveryCapture() { actions.push('start-recovery') },
    watchBatterySaveChanges() { actions.push('watch-save') }, stopFrameProgressMonitor: null,
  }
  const gateStart = player.indexOf('function setPlayerLoading(')
  const gateEnd = player.indexOf('function startEmulatedFpsOverlay(', gateStart)
  runInNewContext(player.slice(gateStart, gateEnd), context)
  const start = player.indexOf('  window.EJS_onGameStart = async () => {')
  const end = player.indexOf("  const loader = document.createElement('script')", start)
  runInNewContext(player.slice(start, end), context)
  return { context, loading, actions, start: () => context.window.EJS_onGameStart() }
}

for (const save of [false, true]) {
  test(`game start dismisses the loading gate with ${save ? 'an existing' : 'no'} backend save and no snapshot`, async () => {
    const current = startup({ save })
    await current.start()
    assert.equal(current.loading.style.display, 'none')
    assert.equal(current.context.runtimeReady, true)
    assert.ok(current.actions.indexOf('restore-save') < current.actions.indexOf('watch-save'))
    assert.ok(!current.actions.includes('lease-lost'))
  })
}

for (const phase of ['audio', 'save']) {
  test(`${phase} startup failure replaces the loading gate and prevents save polling`, async () => {
    const error = new Error(`Test ${phase} failure`)
    const current = startup(phase === 'audio' ? { audioError: error } : { save: error })
    await assert.doesNotReject(current.start())
    assert.equal(current.context.runtimeReady, false)
    assert.equal(current.context.leaseLost, true)
    assert.equal(current.loading.style.display, 'grid')
    assert.match(current.loading.textContent, /Não foi possível iniciar/)
    assert.ok(current.loading.textContent.includes(error.message))
    assert.ok(current.actions.includes('pause'))
    assert.ok(!current.actions.includes('watch-save'))
    assert.ok(!current.actions.includes('start-recovery'))
  })
}
