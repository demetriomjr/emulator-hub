import { getCloudSave, getControlProfile, getLaunch, putCloudSave } from '../../packages/hub-client.js'
import { createCloudSaveSynchronizer } from '../../packages/cloud-save-sync.mjs'
import { createEmulatorGamepadInput } from '../../packages/gamepad-input.mjs'
import { createClientDiagnostics, getClientDiagnosticsOptions } from '../../packages/client-diagnostics.mjs'
import { getEmulatorAudioContext, installAudioResumeOnUserGesture } from '../../packages/mobile-audio-resume.mjs'
import { monitorEmulatorFrameProgress } from '../../packages/emulator-frame-progress.mjs'
import { instrumentEmulatorLifecycle } from '../../packages/emulator-lifecycle-diagnostics.mjs'

const parameters = new URLSearchParams(location.search)
const id = parameters.get('id')
const profileId = parameters.get('profileId')
const game = document.getElementById('game')
// The upstream `latest` channel keeps stable cores while receiving runtime
// fixes ahead of the pinned 4.2.3 release. This branch exercises it against
// the known iPhone WebKit rendering stall.
const dataUrl = 'https://cdn.emulatorjs.org/latest/data/'
const clientDiagnosticsOptions = getClientDiagnosticsOptions(location.search)
const clientDiagnostics = clientDiagnosticsOptions.enabled
  ? createClientDiagnostics({ browser: window, source: 'player', sessionId: clientDiagnosticsOptions.sessionId })
  : null
let fastForwardRequest = {
  enabled: parameters.get('fastForward') === '1',
  speed: Number(parameters.get('fastForwardSpeed')),
}

if (!Number.isFinite(fastForwardRequest.speed) || fastForwardRequest.speed < 1.5 || fastForwardRequest.speed > 5) {
  fastForwardRequest.speed = 1.5
}

let fastForwardRevision = 0
let savedState = null
let gamepadInput = null
let gamepadBindings = []
let cloudSaveSynchronizer = null
let cloudSaveInterval = null
let removeAudioResumeGesture = null
let stopFrameProgressMonitor = null
let stopLifecycleDiagnostics = null

async function hashSave(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('')
}

async function synchronizeCloudSave() {
  if (!cloudSaveSynchronizer || !window.EJS_emulator?.gameManager) return false
  return cloudSaveSynchronizer.sync(window.EJS_emulator.gameManager)
}

function hideContextMenuButton() {
  for (const button of game.querySelectorAll('button')) {
    if (button.textContent.trim() === 'Context Menu') button.style.display = 'none'
  }
}

function hideFastForwardOverlay() {
  for (const overlay of game.querySelectorAll('.ejs_message')) {
    if (/fast[-\s]?forward/i.test(overlay.textContent)) {
      // EmulatorJS styles this message with an author rule, so the hidden
      // attribute can be overridden. Force the overlay out of the layout.
      overlay.style.setProperty('display', 'none', 'important')
    } else {
      overlay.style.removeProperty('display')
    }
  }
}

function normalizeEmulatorChrome() {
  hideContextMenuButton()
  hideFastForwardOverlay()
}

const contextMenuObserver = new MutationObserver(normalizeEmulatorChrome)
contextMenuObserver.observe(game, { childList: true, characterData: true, subtree: true })

function applyFastForward() {
  const emulator = window.EJS_emulator
  if (!emulator?.changeSettingOption) return
  const revision = ++fastForwardRevision
  emulator.gameManager?.setVariable('notification_show_fast_forward', 'false')
  if (emulator.isFastForward) emulator.changeSettingOption('fastForward', 'disabled')
  emulator.changeSettingOption('ff-ratio', fastForwardRequest.speed.toFixed(1))
  if (fastForwardRequest.enabled) {
    window.setTimeout(() => {
      if (revision === fastForwardRevision) emulator.changeSettingOption('fastForward', 'enabled')
    }, 20)
  }
}

async function saveEmulatorState() {
  const state = await window.EJS_emulator?.gameManager?.getState?.()
  if (!state) return
  savedState = new Uint8Array(state)
}

function loadEmulatorState() {
  if (!savedState) return
  window.EJS_emulator?.gameManager?.loadState?.(new Uint8Array(savedState))
}

window.addEventListener('message', event => {
  if (event.origin !== location.origin || event.source !== window.parent) return
  if (event.data?.type === 'emulator-hub:gamepad') {
    if (!Array.isArray(event.data.bindings) || !event.data.bindings.every(value => typeof value === 'string')) return
    gamepadBindings = event.data.bindings
    gamepadInput?.update(gamepadBindings)
    return
  }
  if (event.data?.type === 'emulator-hub:reset') {
    window.EJS_emulator?.gameManager?.restart()
    return
  }
  if (event.data?.type === 'emulator-hub:save-state') {
    saveEmulatorState().catch(() => {})
    return
  }
  if (event.data?.type === 'emulator-hub:load-state') {
    loadEmulatorState()
    return
  }
  if (event.data?.type === 'emulator-hub:fast-forward') {
    const speed = Number(event.data.speed)
    if (!Number.isFinite(speed) || speed < 1.5 || speed > 5 || (speed * 2) % 1 !== 0) return
    fastForwardRequest = { enabled: event.data.enabled === true, speed }
    applyFastForward()
    return
  }
  if (event.data?.type === 'emulator-hub:sync-save') {
    synchronizeCloudSave().then(
      () => window.parent.postMessage({ type: 'emulator-hub:save-synced', requestId: event.data.requestId, ok: true }, location.origin),
      error => window.parent.postMessage({ type: 'emulator-hub:save-synced', requestId: event.data.requestId, ok: false, error: error.message }, location.origin),
    )
  }
})

async function start() {
  if (!id || !profileId) throw new Error('Missing game or profile ID')
  const [launch, controlProfile] = await Promise.all([getLaunch(id, profileId), getControlProfile()])
  if (!launch.romUrl || !launch.core) throw new Error('Incomplete launch configuration')
  cloudSaveSynchronizer = createCloudSaveSynchronizer({
    load: () => getCloudSave(launch.saveUrl),
    upload: (bytes, revision) => putCloudSave(launch.saveUrl, bytes, revision),
    hash: hashSave,
  })
  await cloudSaveSynchronizer.load()
  window.EJS_player = '#game'
  window.EJS_core = launch.core
  window.EJS_gameUrl = launch.romUrl
  window.EJS_gameName = launch.title
  window.EJS_gameID = launch.gameId
  window.EJS_defaultControls = { 0: controlProfile.bindings, 1: {}, 2: {}, 3: {} }
  // Control bindings are managed by the hub backend. Do not let a stale
  // EmulatorJS per-game localStorage profile replace them during startup.
  window.EJS_disableLocalStorage = true
  window.EJS_pathtodata = dataUrl
  window.EJS_externalFiles = {
    '/home/web_user/.config/retroarch/retroarch.cfg': '/retroarch.cfg',
  }
  window.EJS_startOnLoaded = true
  window.EJS_Buttons = {
    fullscreen: false,
    saveState: false,
    loadState: false,
    gamepad: false,
    cheat: false,
    saveSavFiles: false,
    loadSavFiles: false,
    quickSave: false,
    quickLoad: false,
    cacheManager: false,
    contextMenu: false,
  }
  window.EJS_ready = () => {
    stopLifecycleDiagnostics?.()
    if (clientDiagnostics) {
      stopLifecycleDiagnostics = instrumentEmulatorLifecycle({
        emulator: window.EJS_emulator,
        report: clientDiagnostics.capture,
      })
    }
    normalizeEmulatorChrome()
    applyFastForward()
  }
  window.EJS_onGameStart = () => {
    clientDiagnostics?.capture({ kind: 'emulator-lifecycle', message: 'EmulatorJS game start callback' })
    removeAudioResumeGesture?.()
    removeAudioResumeGesture = installAudioResumeOnUserGesture({
      element: game,
      getAudioContext: () => getEmulatorAudioContext(window.EJS_emulator),
    })
    gamepadInput = createEmulatorGamepadInput(window.EJS_emulator, controlProfile.bindings)
    gamepadInput.update(gamepadBindings)
    cloudSaveSynchronizer.restore(window.EJS_emulator.gameManager)
    cloudSaveInterval = window.setInterval(() => synchronizeCloudSave().catch(() => {}), 15000)
    stopFrameProgressMonitor?.()
    if (clientDiagnostics) {
      stopFrameProgressMonitor = monitorEmulatorFrameProgress({
        getFrame: () => window.EJS_emulator?.gameManager?.getFrameNum?.(),
        report: clientDiagnostics.capture,
      })
    }
  }
  const loader = document.createElement('script')
  loader.src = `${dataUrl}loader.js`
  loader.onerror = () => {
    const message = 'EmulatorJS loader could not be reached.'
    clientDiagnostics?.capture({ kind: 'emulator-failure', message })
    game.textContent = message
  }
  document.body.appendChild(loader)
}

start().catch(error => {
  clientDiagnostics?.capture({ kind: 'emulator-failure', message: error.message, name: error.name, stack: error.stack })
  game.textContent = error.message
})
