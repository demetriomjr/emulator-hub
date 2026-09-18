import { getCloudSave, getControlProfile, getEmulatorSnapshot, getPlayerLeaseLaunch, heartbeatPlayerLease, putCloudSave, putEmulatorSnapshot } from '../../packages/hub-client.js'
import { createCloudSaveSynchronizer } from '../../packages/cloud-save-sync.mjs'
import { createEmulatorGamepadInput } from '../../packages/gamepad-input.mjs'
import { createClientDiagnostics, getClientDiagnosticsOptions } from '../../packages/client-diagnostics.mjs'
import { getEmulatorAudioContext, installAudioResumeOnUserGesture } from '../../packages/mobile-audio-resume.mjs'
import { monitorEmulatorFrameProgress } from '../../packages/emulator-frame-progress.mjs'
import { instrumentEmulatorLifecycle } from '../../packages/emulator-lifecycle-diagnostics.mjs'

const parameters = new URLSearchParams(location.search)
const id = parameters.get('id')
const profileId = parameters.get('profileId')
const sessionId = parameters.get('sessionId')
const leaseGeneration = Number(parameters.get('leaseGeneration'))
const game = document.getElementById('game')
// The upstream `latest` channel keeps stable cores while receiving runtime
// fixes ahead of the pinned 4.2.3 release. This branch exercises it against
// the known iPhone WebKit rendering stall.
const dataUrl = 'https://cdn.emulatorjs.org/4.2.3/data/'
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
let savedSnapshot = null
let snapshotRevision = null
let launchDescriptor = null
let gamepadInput = null
let gamepadBindings = []
let cloudSaveSynchronizer = null
let cloudSaveInterval = null
let removeAudioResumeGesture = null
let stopFrameProgressMonitor = null
let stopLifecycleDiagnostics = null
let leaseHeartbeat = null
let leaseLost = false

function loseLease() {
  if (leaseLost) return
  leaseLost = true
  if (leaseHeartbeat) window.clearInterval(leaseHeartbeat)
  if (cloudSaveInterval) window.clearInterval(cloudSaveInterval)
  window.parent.postMessage({ type: 'emulator-hub:lease-lost', sessionId, profileId, gameId: id, generation: leaseGeneration }, location.origin)
}

function startLeaseHeartbeat() {
  if (!sessionId || !Number.isInteger(leaseGeneration)) return
  const renew = async () => {
    try { await heartbeatPlayerLease(sessionId, { profileId, gameId: id, generation: leaseGeneration }) } catch { loseLease() }
  }
  void renew()
  leaseHeartbeat = window.setInterval(() => void renew(), 5000)
}

async function hashSave(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('')
}

async function synchronizeCloudSave() {
  if (leaseLost || !cloudSaveSynchronizer || !window.EJS_emulator?.gameManager) return false
  return cloudSaveSynchronizer.sync(window.EJS_emulator.gameManager)
}

window.emulatorHubSyncSave = synchronizeCloudSave

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
  const manager = window.EJS_emulator?.gameManager
  if (leaseLost || !manager || !launchDescriptor) return false
  manager.saveSaveFiles?.()
  await synchronizeCloudSave()
  const save = manager.getSaveFile?.()
  const state = manager.getState?.()
  if (!state || !save) throw new Error('Emulator snapshot bytes are unavailable.')
  const accepted = await putEmulatorSnapshot(launchDescriptor.snapshotUrl, {
    metadata: { profileId, gameId: id, core: launchDescriptor.core, romSha256: launchDescriptor.romSha256, runtimeId: launchDescriptor.runtimeId },
    state: new Uint8Array(state), save: new Uint8Array(save),
  }, snapshotRevision, { sessionId, generation: leaseGeneration })
  snapshotRevision = accepted.revision
  savedSnapshot = { state: new Uint8Array(state), save: new Uint8Array(save) }
  return true
}

function loadEmulatorState() {
  if (!savedSnapshot) return false
  const manager = window.EJS_emulator?.gameManager
  if (!manager) return false
  manager.FS.writeFile(manager.getSaveFilePath(), savedSnapshot.save)
  manager.loadSaveFiles()
  manager.loadState(new Uint8Array(savedSnapshot.state))
  return true
}

window.addEventListener('message', event => {
  if (event.origin !== location.origin) return
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
  if (!sessionId || !Number.isInteger(leaseGeneration)) throw new Error('Missing active player lease')
  startLeaseHeartbeat()
  const [launch, controlProfile] = await Promise.all([getPlayerLeaseLaunch(sessionId, { profileId, gameId: id, generation: leaseGeneration }), getControlProfile()])
  if (!launch.romUrl || !launch.core) throw new Error('Incomplete launch configuration')
  launchDescriptor = launch
  cloudSaveSynchronizer = createCloudSaveSynchronizer({
    load: () => getCloudSave(launch.saveUrl, { sessionId, generation: leaseGeneration }),
    upload: (bytes, revision) => putCloudSave(launch.saveUrl, bytes, revision, { sessionId, generation: leaseGeneration }),
    hash: hashSave,
  })
  const [_, snapshot, romResponse] = await Promise.all([
    cloudSaveSynchronizer.load(),
    getEmulatorSnapshot(launch.snapshotUrl, { sessionId, generation: leaseGeneration }),
    fetch(launch.romUrl, { cache: 'no-store' }),
  ])
  if (!romResponse.ok) throw new Error(`ROM request failed (${romResponse.status})`)
  const romBytes = new Uint8Array(await romResponse.arrayBuffer())
  if (await hashSave(romBytes) !== launch.romSha256) throw new Error('ROM bytes did not match the launch descriptor.')
  if (snapshot && (snapshot.metadata.profileId !== profileId || snapshot.metadata.gameId !== id || snapshot.metadata.core !== launch.core || snapshot.metadata.romSha256 !== launch.romSha256 || snapshot.metadata.runtimeId !== launch.runtimeId)) throw new Error('Snapshot is incompatible with this launch.')
  savedSnapshot = snapshot ? { state: snapshot.state, save: snapshot.save } : null
  snapshotRevision = snapshot?.revision ?? null
  window.EJS_player = '#game'
  window.EJS_core = launch.core
  window.EJS_gameUrl = URL.createObjectURL(new Blob([romBytes]))
  window.EJS_gameName = launch.title
  window.EJS_gameID = launch.gameId
  window.EJS_defaultControls = { 0: controlProfile.bindings, 1: {}, 2: {}, 3: {} }
  // EmulatorJS only detects touch once during startup. Match the Hub's mobile
  // player breakpoint so Chrome's device viewport simulation is deterministic.
  const isMobilePlayerViewport = window.matchMedia('(max-width: 900px) and (max-height: 500px) and (orientation: landscape)').matches
  window.EJS_browserMode = isMobilePlayerViewport ? 'mobile' : undefined
  // Replace EmulatorJS's GBA touch layout with its normal gameplay controls.
  // The upstream default also adds Fast and Slow below Start/Select; speed is
  // already controlled by the Hub toolbar, so those duplicate touch buttons
  // are deliberately omitted.
  window.EJS_VirtualGamepadSettings = [
    { type: 'button', text: 'B', id: 'b', location: 'right', left: 10, top: 70, bold: true, input_value: 0 },
    { type: 'button', text: 'A', id: 'a', location: 'right', left: 81, top: 40, bold: true, input_value: 8 },
    { type: 'dpad', id: 'dpad', location: 'left', left: '50%', top: '50%', joystickInput: false, inputValues: [4, 5, 6, 7] },
    { type: 'button', text: 'Start', id: 'start', location: 'center', left: 60, fontSize: 15, block: true, input_value: 3 },
    { type: 'button', text: 'Select', id: 'select', location: 'center', left: -5, fontSize: 15, block: true, input_value: 2 },
    { type: 'button', text: 'L', id: 'l', location: 'left', left: 3, top: -90, bold: true, block: true, input_value: 10 },
    { type: 'button', text: 'R', id: 'r', location: 'right', right: 3, top: -90, bold: true, block: true, input_value: 11 },
  ]
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
    if (isMobilePlayerViewport) window.EJS_emulator?.changeSettingOption?.('virtual-gamepad', 'enabled')
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
    if (!loadEmulatorState()) cloudSaveSynchronizer.restore(window.EJS_emulator.gameManager)
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
  loseLease()
  clientDiagnostics?.capture({ kind: 'emulator-failure', message: error.message, name: error.name, stack: error.stack })
  game.textContent = error.message
})
