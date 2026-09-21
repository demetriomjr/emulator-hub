import { getCloudSave, getControlProfile, getEmulatorSnapshot, getPlayerLeaseLaunch, heartbeatPlayerLease, putCloudSave, putEmulatorSnapshot } from '../../packages/hub-client.js'
import { createCloudSaveSynchronizer } from '../../packages/cloud-save-sync.mjs'
import { observeEmulatorSaveFiles } from '../../packages/emulator-save-events.mjs'
import { restoreSnapshotState } from '../../packages/emulator-snapshot-restore.mjs'
import { createEmulatorGamepadInput } from '../../packages/gamepad-input.mjs'
import { createClientDiagnostics, getClientDiagnosticsOptions } from '../../packages/client-diagnostics.mjs'
import { getEmulatorAudioContext, installAudioResumeOnUserGesture } from '../../packages/mobile-audio-resume.mjs'
import { monitorEmulatorFrameProgress } from '../../packages/emulator-frame-progress.mjs'
import { instrumentEmulatorLifecycle } from '../../packages/emulator-lifecycle-diagnostics.mjs'
import { createLocalRuntimeRecoveryStore } from '../../packages/local-runtime-recovery-store.mjs'

const parameters = new URLSearchParams(location.search)
const id = parameters.get('id')
const profileId = parameters.get('profileId')
const sessionId = parameters.get('sessionId')
const leaseGeneration = Number(parameters.get('leaseGeneration'))
const restoreLocalRecovery = parameters.get('restoreRecovery') === '1'
const game = document.getElementById('game')
const isMobilePlayerViewport = window.matchMedia('(max-width: 900px) and (max-height: 500px) and (orientation: landscape)').matches
const mobileGamepadLayout = Object.freeze([
  { id: 'dpad', x: 133, y: 263, size: 195, shape: 'zone' },
  { id: 'a', x: 775, y: 248, size: 91, shape: 'round' },
  { id: 'b', x: 672, y: 323, size: 91, shape: 'round' },
  { id: 'start', x: 494, y: 313, size: 95, shape: 'block' },
  { id: 'select', x: 350, y: 313, size: 89, shape: 'block' },
  { id: 'l', x: 121, y: 48, size: 150, shape: 'block' },
  { id: 'r', x: 723, y: 48, size: 150, shape: 'block' },
])
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
let pendingSaveSync = Promise.resolve()
let snapshotCapture = null
let latestSaveBytes = null
let localRecoveryInterval = null
let localRecoveryCapture = null
let preserveLocalRecovery = false
let localRecovery = null
const localRecoveryStore = createLocalRuntimeRecoveryStore()
let removeAudioResumeGesture = null
let stopFrameProgressMonitor = null
let stopLifecycleDiagnostics = null
let leaseHeartbeat = null
let leaseLost = false

function loseLease() {
  if (leaseLost) return
  leaseLost = true
  preserveLocalRecovery = true
  if (leaseHeartbeat) window.clearInterval(leaseHeartbeat)
  if (cloudSaveInterval) window.clearInterval(cloudSaveInterval)
  if (localRecoveryInterval) window.clearInterval(localRecoveryInterval)
  void Promise.resolve(localRecoveryCapture).catch(() => {}).finally(() => localRecoveryStore.markRuntimeBreak(profileId, id)).finally(() => window.parent.postMessage({ type: 'emulator-hub:lease-lost', unavailable: true, sessionId, profileId, gameId: id, generation: leaseGeneration }, location.origin))
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

function queueCloudSave(bytes) {
  if (leaseLost || !cloudSaveSynchronizer || !(bytes instanceof Uint8Array) || bytes.byteLength === 0) return Promise.resolve(false)
  const copy = new Uint8Array(bytes)
  latestSaveBytes = copy
  const upload = pendingSaveSync.then(() => cloudSaveSynchronizer.syncBytes(copy))
  pendingSaveSync = upload.catch(() => {})
  return upload
}

function watchBatterySaveChanges() {
  const emulator = window.EJS_emulator
  if (!emulator?.on || emulator.__hubSaveWatcher) return
  emulator.__hubSaveWatcher = true
  observeEmulatorSaveFiles(emulator, queueCloudSave)
}

async function captureLocalRecovery() {
  if (leaseLost || localRecoveryCapture || !launchDescriptor) return localRecoveryCapture
  const manager = window.EJS_emulator?.gameManager
  if (!manager) return false
  localRecoveryCapture = (async () => {
    const state = manager.getState?.()
    if (!state) return false
    if (leaseLost) return false
    await localRecoveryStore.put({ profileId, gameId: id, core: launchDescriptor.core, romSha256: launchDescriptor.romSha256, runtimeId: launchDescriptor.runtimeId, ...(launchDescriptor.patchSha256 ? { patchSha256: launchDescriptor.patchSha256 } : {}), state: new Uint8Array(state) })
    return true
  })().finally(() => { localRecoveryCapture = null })
  return localRecoveryCapture
}

async function clearLocalRecovery() {
  preserveLocalRecovery = false
  if (localRecoveryInterval) window.clearInterval(localRecoveryInterval)
  await localRecoveryStore.clear(profileId, id)
}

window.emulatorHubClearLocalRecovery = clearLocalRecovery
window.addEventListener('pagehide', () => { if (!preserveLocalRecovery) void clearLocalRecovery().catch(() => {}) })

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

function resizeMobileDpad(element, size) {
  const nipple = element.querySelector('.nipple')
  const back = nipple?.querySelector('.back')
  const front = nipple?.querySelector('.front')
  if (!nipple || !back || !front) return

  const collection = window.nipplejs?.factory?.collections?.find(({ options }) => options.zone === element)
  if (collection?.options) collection.options.size = size
  collection?.forEach((instance) => { instance.options.size = size })

  back.style.width = `${size}px`
  back.style.height = `${size}px`
  back.style.marginLeft = `${-size / 2}px`
  back.style.marginTop = `${-size / 2}px`
  front.style.width = `${size / 2}px`
  front.style.height = `${size / 2}px`
  front.style.marginLeft = `${-size / 4}px`
  front.style.marginTop = `${-size / 4}px`
}

function installMaxRangeDpadInput(element) {
  if (element.dataset.mobileDpadInputConfigured || !window.PointerEvent) return
  const front = element.querySelector('.nipple .front')
  if (!front) return
  let activePointerId = null
  const clearInputs = () => {
    for (const input of [4, 5, 6, 7]) window.EJS_emulator?.gameManager?.simulateInput(0, input, 0)
  }
  const release = () => {
    clearInputs()
    front.style.transform = 'translate(0px, 0px)'
  }
  const stopNativeZone = (event) => {
    if (event.cancelable) event.preventDefault()
    event.stopImmediatePropagation()
  }
  const start = (event) => {
    stopNativeZone(event)
    activePointerId = event.pointerId
    element.setPointerCapture?.(event.pointerId)
    release()
  }
  const move = (event) => {
    if (event.pointerId !== activePointerId) return
    stopNativeZone(event)
    const bounds = element.getBoundingClientRect()
    const maxDistance = Math.min(bounds.width, bounds.height) / 2
    const triggerDistance = maxDistance * 0.88
    const dx = event.clientX - bounds.left - bounds.width / 2
    const dy = event.clientY - bounds.top - bounds.height / 2
    const distance = Math.hypot(dx, dy)
    const ratio = Math.min(distance, maxDistance) / Math.max(distance, 1)
    front.style.transform = `translate(${dx * ratio}px, ${dy * ratio}px)`
    if (distance < triggerDistance) return clearInputs()
    const degree = (Math.atan2(-dy, dx) * 180 / Math.PI + 360) % 360
    const manager = window.EJS_emulator?.gameManager
    manager?.simulateInput(0, 4, degree >= 30 && degree < 150 ? 1 : 0)
    manager?.simulateInput(0, 5, degree >= 210 && degree < 330 ? 1 : 0)
    manager?.simulateInput(0, 6, degree >= 120 && degree < 240 ? 1 : 0)
    manager?.simulateInput(0, 7, degree >= 300 || degree < 60 ? 1 : 0)
  }
  const end = (event) => {
    if (event.pointerId !== activePointerId) return
    stopNativeZone(event)
    activePointerId = null
    release()
  }
  element.addEventListener('pointerdown', start, { capture: true, passive: false })
  element.addEventListener('pointermove', move, { capture: true, passive: false })
  element.addEventListener('pointerup', end, { capture: true, passive: false })
  element.addEventListener('pointercancel', end, { capture: true, passive: false })
  element.dataset.mobileDpadInputConfigured = 'true'
}

function applyMobileGamepadLayout() {
  if (!isMobilePlayerViewport) return
  const bounds = game.getBoundingClientRect()
  const scaleX = bounds.width / 844
  const scaleY = bounds.height / 390
  const scale = Math.min(scaleX, scaleY)
  for (const control of mobileGamepadLayout) {
    const element = game.querySelector(`.b_${control.id}`)
    if (!element) continue
    const width = control.size * scale
    const height = control.shape === 'block' ? 31 * scale : width
    element.style.setProperty('position', 'fixed', 'important')
    element.style.setProperty('left', `${bounds.left + control.x * scaleX}px`, 'important')
    element.style.setProperty('top', `${bounds.top + control.y * scaleY}px`, 'important')
    element.style.setProperty('width', `${width}px`, 'important')
    element.style.setProperty('height', `${height}px`, 'important')
    element.style.setProperty('line-height', `${height}px`, 'important')
    element.style.setProperty('margin', '0', 'important')
    element.style.setProperty('transform', 'translate(-50%, -50%)', 'important')
    element.style.setProperty('z-index', '2', 'important')
    if (control.id === 'l') element.textContent = 'L'
    if (control.id === 'r') element.textContent = 'R'
    if (control.shape === 'zone') {
      resizeMobileDpad(element, width)
      installMaxRangeDpadInput(element)
    }
  }
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
  if (snapshotCapture) return snapshotCapture
  snapshotCapture = persistEmulatorState().finally(() => { snapshotCapture = null })
  return snapshotCapture
}

async function persistEmulatorState() {
  const manager = window.EJS_emulator?.gameManager
  if (leaseLost || !manager || !launchDescriptor) return false
  const state = manager.getState?.()
  if (!state) throw new Error('Emulator snapshot bytes are unavailable.')
  const accepted = await putEmulatorSnapshot(launchDescriptor.snapshotUrl, {
    metadata: { profileId, gameId: id, core: launchDescriptor.core, romSha256: launchDescriptor.romSha256, runtimeId: launchDescriptor.runtimeId, saveRevision: cloudSaveSynchronizer.getRevision(), ...(launchDescriptor.patchSha256 ? { patchSha256: launchDescriptor.patchSha256 } : {}) },
    state: new Uint8Array(state),
  }, snapshotRevision, { sessionId, generation: leaseGeneration })
  snapshotRevision = accepted.revision
  savedSnapshot = { state: new Uint8Array(state), saveRevision: cloudSaveSynchronizer.getRevision() }
  return true
}

async function closeEmulator() {
  if (cloudSaveInterval) window.clearInterval(cloudSaveInterval)
  if (localRecoveryInterval) window.clearInterval(localRecoveryInterval)
  if (localRecoveryCapture) await localRecoveryCapture
  await pendingSaveSync
  if (latestSaveBytes) await queueCloudSave(latestSaveBytes)
  await pendingSaveSync
  if (snapshotCapture) await snapshotCapture.catch(() => {})
  await saveEmulatorState()
}

window.emulatorHubClose = closeEmulator

function loadEmulatorState() {
  if (!savedSnapshot) return false
  const manager = window.EJS_emulator?.gameManager
  if (!manager) return false
  manager.loadState(new Uint8Array(savedSnapshot.state))
  return true
}

window.addEventListener('message', event => {
  if (event.origin !== location.origin) return
  const isClosePlayerMessage = event.data?.type === 'emulator-hub:close-player'
  if (!isClosePlayerMessage && event.source !== window.parent) return
  if (event.data?.type === 'emulator-hub:gamepad') {
    if (!Array.isArray(event.data.bindings) || !event.data.bindings.every(value => typeof value === 'string')) return
    gamepadBindings = event.data.bindings
    gamepadInput?.update(gamepadBindings)
    return
  }
  if (event.data?.type === 'emulator-hub:control-profile') {
    const bindings = event.data.bindings
    if (!bindings || typeof bindings !== 'object' || !Object.values(bindings).every(binding => binding && typeof binding.gamepad === 'string')) return
    gamepadInput?.setBindings(bindings)
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
  if (event.data?.type === 'emulator-hub:close-player') {
    closeEmulator().then(
      () => window.parent.postMessage({ type: 'emulator-hub:save-synced', requestId: event.data.requestId, ok: true }, location.origin),
      error => window.parent.postMessage({ type: 'emulator-hub:save-synced', requestId: event.data.requestId, ok: false, error: error.message }, location.origin),
    )
  }
  if (event.data?.type === 'emulator-hub:clear-local-recovery') void clearLocalRecovery()
})

async function start() {
  if (!id || !profileId) throw new Error('Missing game or profile ID')
  if (!sessionId || !Number.isInteger(leaseGeneration)) throw new Error('Missing active player lease')
  startLeaseHeartbeat()
  const [launch, controlProfile] = await Promise.all([getPlayerLeaseLaunch(sessionId, { profileId, gameId: id, generation: leaseGeneration }), getControlProfile()])
  if (!launch.romUrl || !launch.core) throw new Error('Incomplete launch configuration')
  launchDescriptor = launch
  if (restoreLocalRecovery) {
    const candidate = await localRecoveryStore.get(profileId, id)
    if (!candidate) throw new Error('Local recovery is no longer available.')
    if (candidate.core !== launch.core || candidate.romSha256 !== launch.romSha256 || candidate.runtimeId !== launch.runtimeId || candidate.patchSha256 !== launch.patchSha256) throw new Error('Local recovery is incompatible with this launch.')
    localRecovery = candidate
  }
  cloudSaveSynchronizer = createCloudSaveSynchronizer({
    load: () => getCloudSave(launch.saveUrl, { sessionId, generation: leaseGeneration }),
    upload: (bytes, revision) => putCloudSave(launch.saveUrl, bytes, revision, { sessionId, generation: leaseGeneration }),
    hash: hashSave,
  })
  if (Boolean(launch.patchUrl) !== Boolean(launch.patchSha256)) throw new Error('Incomplete patch configuration.')
  const [_, snapshot, romResponse, patchResponse] = await Promise.all([
    cloudSaveSynchronizer.load(),
    getEmulatorSnapshot(launch.snapshotUrl, { sessionId, generation: leaseGeneration }),
    fetch(launch.romUrl, { cache: 'no-store' }),
    launch.patchUrl ? fetch(launch.patchUrl, { cache: 'no-store' }) : Promise.resolve(null),
  ])
  if (!romResponse.ok) throw new Error(`ROM request failed (${romResponse.status})`)
  const romBytes = new Uint8Array(await romResponse.arrayBuffer())
  if (await hashSave(romBytes) !== launch.romSha256) throw new Error('ROM bytes did not match the launch descriptor.')
  let patchBytes = null
  if (patchResponse) {
    if (!patchResponse.ok) throw new Error(`Patch request failed (${patchResponse.status})`)
    patchBytes = new Uint8Array(await patchResponse.arrayBuffer())
    if (await hashSave(patchBytes) !== launch.patchSha256) throw new Error('Patch bytes did not match the launch descriptor.')
  }
  if (snapshot && (snapshot.metadata.profileId !== profileId || snapshot.metadata.gameId !== id || snapshot.metadata.core !== launch.core || snapshot.metadata.romSha256 !== launch.romSha256 || snapshot.metadata.runtimeId !== launch.runtimeId || snapshot.metadata.patchSha256 !== launch.patchSha256)) throw new Error('Snapshot is incompatible with this launch.')
  savedSnapshot = snapshot ? { state: snapshot.state, saveRevision: snapshot.metadata.saveRevision } : null
  snapshotRevision = snapshot?.revision ?? null
  window.EJS_player = '#game'
  window.EJS_core = launch.core
  window.EJS_gameUrl = URL.createObjectURL(new Blob([romBytes]))
  if (patchBytes) window.EJS_gamePatchUrl = URL.createObjectURL(new Blob([patchBytes]))
  window.EJS_gameName = launch.title
  window.EJS_gameID = launch.gameId
  window.EJS_defaultControls = { 0: controlProfile.bindings, 1: {}, 2: {}, 3: {} }
  // EmulatorJS only detects touch once during startup. Match the Hub's mobile
  // player breakpoint so Chrome's device viewport simulation is deterministic.
  window.EJS_browserMode = isMobilePlayerViewport ? 'mobile' : undefined
  // Replace EmulatorJS's GBA touch layout with the approved Hub mobile layout.
  // The upstream default also adds Fast and Slow below Start/Select; speed is
  // already controlled by the Hub toolbar, so those duplicate touch buttons
  // are deliberately omitted.
  window.EJS_VirtualGamepadSettings = [
    { type: 'button', text: 'B', id: 'b', location: 'right', left: 10, top: 70, bold: true, input_value: 0 },
    { type: 'button', text: 'A', id: 'a', location: 'right', left: 81, top: 40, bold: true, input_value: 8 },
    { type: 'zone', id: 'dpad', location: 'left', left: '50%', top: '50%', joystickInput: false, inputValues: [4, 5, 6, 7] },
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
    if (isMobilePlayerViewport) {
      applyMobileGamepadLayout()
      window.addEventListener('resize', applyMobileGamepadLayout)
    }
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
    if (localRecovery) {
      window.EJS_emulator.gameManager.loadState(new Uint8Array(localRecovery.state))
    } else if (!restoreSnapshotState(savedSnapshot, window.EJS_emulator.gameManager, () => window.confirm('Há um snapshot deste perfil. Deseja restaurá-lo?'))) {
      cloudSaveSynchronizer.restore(window.EJS_emulator.gameManager)
    }
    watchBatterySaveChanges()
    cloudSaveInterval = window.setInterval(() => saveEmulatorState().catch(() => {}), 15000)
    localRecoveryInterval = window.setInterval(() => void captureLocalRecovery(), 2_500)
    void captureLocalRecovery()
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
