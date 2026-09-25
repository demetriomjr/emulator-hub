import { deleteEmulatorSnapshot, getCloudSave, getControlProfile, getEmulatorSnapshot, getPlayerLeaseLaunch, heartbeatPlayerLease, putCloudSave, putEmulatorSnapshot } from '../../packages/hub-client.js'
import { createCloudSaveSynchronizer } from '../../packages/cloud-save-sync.mjs'
import { observeEmulatorSaveFiles } from '../../packages/emulator-save-events.mjs'
import { startEmulatorSavePolling } from '../../packages/emulator-save-poller.mjs'
import { createEmulatorGamepadInput } from '../../packages/gamepad-input.mjs'
import { createClientDiagnostics, getClientDiagnosticsOptions } from '../../packages/client-diagnostics.mjs'
import { getEmulatorAudioContext, installAudioResumeOnUserGesture } from '../../packages/mobile-audio-resume.mjs'
import { monitorEmulatorFrameProgress } from '../../packages/emulator-frame-progress.mjs'
import { sampleEmulatedFps } from '../../packages/emulator-fps.mjs'
import { createPerformanceTimingCollector, measureSynchronousOperation } from '../../packages/emulator-performance-probe.mjs'
import { instrumentEmulatorLifecycle } from '../../packages/emulator-lifecycle-diagnostics.mjs'
import { createLocalRuntimeRecoveryStore } from '../../packages/local-runtime-recovery-store.mjs'
import { selectNewestPokemonGen3SaveCopy } from '../../packages/pokemon-gen3-save-validation.mjs'
import { validateSaveWithRetry } from '../../packages/emulator-save-validation-retry.mjs'
import { createRestoreRequest, routeRestoreChoiceResponse } from '../../packages/snapshot-restore-routing.mjs'
import { createSnapshotOfferPolicy } from '../../packages/snapshot-offer-policy.mjs'
import { createSnapshotTelemetry } from '../../packages/snapshot-telemetry.mjs'
import { getInstallationIdentity, localCandidateSummary, remoteCandidateSummary, snapshotMatchesLaunch, snapshotUrlForKind, sortRestoreCandidates } from '../../packages/restore-candidate.mjs'
import { softResetEmulator } from '../../packages/player-reset.mjs'
import { createOddsManipulatorClock } from '../../packages/odds-manipulator-clock.mjs'
import { createEmulatorAudioMute } from '../../packages/emulator-audio-mute.mjs'
import { createPlayerInteractionLock } from '../../packages/player-interaction-lock.mjs'
import { playerThreadFallbackUrl, selectPlayerThreadMode } from '../../packages/player-thread-policy.mjs'
import { createPlayerOriginStorageClient } from '../../packages/player-origin-storage-bridge.mjs'

const parameters = new URLSearchParams(location.search)
const suppliedHubOrigin = parameters.get('hubOrigin')
const hubOrigin = suppliedHubOrigin ?? location.origin
if (suppliedHubOrigin && (new URL(hubOrigin).origin !== hubOrigin || new URL(hubOrigin).hostname !== location.hostname || new URL(hubOrigin).protocol !== location.protocol)) throw new Error('Invalid Hub origin for player')
const id = parameters.get('id')
const profileId = parameters.get('profileId')
const sessionId = parameters.get('sessionId')
const leaseGeneration = Number(parameters.get('leaseGeneration'))
const restoreLocalRecovery = parameters.get('restoreRecovery') === '1'
const localRecoveryPrompt = parameters.get('localRecoveryPrompt') === '1'
const audioMute = createEmulatorAudioMute(parameters.get('muted') === '1')
let localRecoveryCandidateId = parameters.get('localRecoveryCandidateId')
const game = document.getElementById('game')
const playerLoading = document.createElement('div')
playerLoading.textContent = 'Carregando save...'
Object.assign(playerLoading.style, { position: 'fixed', inset: '0', zIndex: '9999', display: 'grid', placeItems: 'center', background: '#10141a', color: '#fff', font: '14px system-ui' })
document.body.append(playerLoading)
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
const clientDiagnosticsOptions = getClientDiagnosticsOptions(import.meta.env.VITE_DEBUG, location.search)
const performanceTimings = clientDiagnosticsOptions.enabled ? createPerformanceTimingCollector() : null
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
let userSnapshot = null
let userSnapshotRevision = null
let userSnapshotCapture = null
let installationIdentity = hubOrigin === location.origin ? getInstallationIdentity() : null
let offerPolicy = null
let runtimeReady = false
let closeRequested = false
let threadDecision = null
let threadGameStarted = false
let threadFallbackRequested = false
let threadStartupMonitor = null
let threadStartupTimeout = null
let lastInteractionLockRevision = -1
let fastForwardOverlayObserver = null
let lastGamepadBindings = new Set()
let launchDescriptor = null
let emulatorGameId = null
let gamepadInput = null
let gamepadBindings = []
const interactionLock = createPlayerInteractionLock({
  getEmulator: () => window.EJS_emulator,
  releaseGamepadInput: () => gamepadInput?.release(),
  canResume: () => runtimeReady && !closeRequested && !leaseLost,
})
window.emulatorHubSetInteractionLock = locked => interactionLock.setLocked(locked)
const blockLockedKeyboard = event => { interactionLock.blockKeyboard(event) }
window.addEventListener('keydown', blockLockedKeyboard, true)
window.addEventListener('keyup', blockLockedKeyboard, true)
let cloudSaveSynchronizer = null
let cloudSaveInterval = null
let cloudRecoveryDeleteTimer = null
let cloudRecoveryDeletion = null
let stopBatterySavePolling = null
let pendingSaveSync = Promise.resolve()
let snapshotCapture = null
let latestSaveBytes = null
let localRecoveryInterval = null
let localRecoveryDeleteTimer = null
let localRecoveryCapture = null
let localRecovery = null
let restoreCandidates = []
const originStorageClient = hubOrigin === location.origin ? null : createPlayerOriginStorageClient({ browser: window, parent: window.parent, hubOrigin, sessionId, profileId, gameId: id })
const localRecoveryStore = originStorageClient ? createLocalRuntimeRecoveryStore({ storage: originStorageClient.storage }) : createLocalRuntimeRecoveryStore()
const snapshotTelemetry = createSnapshotTelemetry({ browser: window, source: 'player', sessionId, gameId: id, profileId })
let removeAudioResumeGesture = null
let stopFrameProgressMonitor = null
let emulatedFpsTimer = null
let emulatedFpsOverlay = null
let stopLifecycleDiagnostics = null
let leaseHeartbeat = null
let leaseLost = false
const pendingRestoreRequests = new Map()
const settledRestoreRequests = new Map()
const oddsClock = createOddsManipulatorClock()
oddsClock.install()

function loseLease() {
  if (leaseLost) return
  leaseLost = true
  snapshotTelemetry.warn('lease-lost', { reason: 'heartbeat-or-session-fenced' })
  if (cloudRecoveryDeleteTimer) window.clearTimeout(cloudRecoveryDeleteTimer)
  cloudRecoveryDeleteTimer = null
  if (localRecoveryDeleteTimer) window.clearTimeout(localRecoveryDeleteTimer)
  localRecoveryDeleteTimer = null
  if (leaseHeartbeat) window.clearInterval(leaseHeartbeat)
  if (cloudSaveInterval) window.clearInterval(cloudSaveInterval)
  stopBatterySavePolling?.()
  stopBatterySavePolling = null
  if (localRecoveryInterval) window.clearInterval(localRecoveryInterval)
  void Promise.resolve(localRecoveryCapture).catch(() => {}).finally(() => localRecoveryStore.markRuntimeBreak(profileId, id)).finally(() => window.parent.postMessage({ type: 'emulator-hub:lease-lost', unavailable: true, sessionId, profileId, gameId: id, generation: leaseGeneration }, hubOrigin))
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

function createEmulatorGameId(gameId, profileId) {
  return `emulator-hub-${encodeURIComponent(gameId)}--profile-${encodeURIComponent(profileId)}`
}

function requestRestoreChoice(candidates) {
  const requestId = `${sessionId}:candidates:${Date.now()}:${Math.random()}`
  return new Promise(resolve => {
    pendingRestoreRequests.set(requestId, { resolve, sessionId, gameId: id, profileId, candidates })
    window.parent.postMessage(createRestoreRequest({ requestId, kind: 'candidate-list', candidates, gameId: id, profileId, sessionId }), hubOrigin)
  })
}

function logSavePipeline(event, context = {}) {
  if (event === 'save.front.runtime-state-ignored') {
    snapshotTelemetry.info('runtime-state-save-ignored', { reason: 'matches-restored-state' }, { once: true })
    return
  }
  if (event === 'save.front.runtime-state-unverified') {
    snapshotTelemetry.warn('runtime-save-sync-blocked', { reason: 'state-save-unverified' }, { repeating: true })
    return
  }
  if (event.endsWith('-failed') || event.includes('rejected')) {
    const level = event.includes('rejected') ? 'warn' : 'error'
    snapshotTelemetry[level](event.replace('save.front.', 'save-'), { phase: context.stage ?? undefined, code: context.code ?? undefined, error: context.error ?? undefined, status: context.status ?? undefined }, { repeating: event === 'save.front.sync-failed' || event === 'save.front.validation-rejected' })
    return
  }
  if (['save.front.bytes-observed', 'save.front.bytes-hashed', 'save.front.sync-started', 'save.front.put-started', 'save.front.get-started', 'save.front.validation-accepted', 'save.front.deduplicated', 'save.front.sync-skipped', 'save.front.bytes-ignored', 'save.front.restore-started', 'save.front.put-response'].includes(event)) return
  const record = { timestamp: new Date().toISOString(), event, gameId: id, profileId, emulatorGameId, ...context }
  const output = event.endsWith('failed') ? console.error : context.ok === false || event.includes('rejected') ? console.warn : console.info
  output.call(console, '[save-pipeline]', record)
}

function setPlayerLoading(message) {
  playerLoading.textContent = message
  playerLoading.style.display = 'grid'
}

function setPlayerReady() {
  playerLoading.style.display = 'none'
}

function startEmulatedFpsOverlay() {
  if (!clientDiagnosticsOptions.enabled || emulatedFpsTimer) return
  const overlay = document.createElement('output')
  overlay.className = 'emulator-fps-overlay'
  overlay.setAttribute('aria-label', 'FPS emulados deste emulador')
  document.body.append(overlay)
  emulatedFpsOverlay = overlay
  let previous = null
  const update = () => {
    let frame
    try { frame = window.EJS_emulator?.gameManager?.getFrameNum?.() } catch { frame = undefined }
    const sample = sampleEmulatedFps(previous, frame, performance.now())
    previous = sample.baseline
    const target = fastForwardRequest.enabled ? fastForwardRequest.speed : 1
    const targetText = launchDescriptor?.core === 'gba' ? ` · alvo ${target}×` : ''
    overlay.textContent = sample.fps === null
      ? `— FPS${targetText}`
      : `${Math.round(sample.fps)} FPS${sample.speed !== null && launchDescriptor?.core === 'gba' ? ` · real ${sample.speed.toFixed(1).replace('.', ',')}×` : ''}${targetText}`
    if (sample.fps !== null && sample.speed !== null) {
      window.parent.postMessage({ type: 'emulator-hub:performance-sample', sessionId, timestamp: performance.timeOrigin + performance.now(), fps: sample.fps, speed: sample.speed, target, threaded: threadDecision?.enabled === true, isolated: window.crossOriginIsolated === true, timings: performanceTimings.drain() }, hubOrigin)
    }
  }
  update()
  emulatedFpsTimer = window.setInterval(update, 1000)
}

function stopEmulatedFpsOverlay() {
  if (emulatedFpsTimer) window.clearInterval(emulatedFpsTimer)
  emulatedFpsTimer = null
  emulatedFpsOverlay?.remove()
  emulatedFpsOverlay = null
}

async function queueCloudSave(bytes, { onUncertain = () => {} } = {}) {
  if (leaseLost || !cloudSaveSynchronizer || !(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    onUncertain()
    logSavePipeline('save.front.bytes-ignored', { reason: leaseLost ? 'lease-lost' : !cloudSaveSynchronizer ? 'synchronizer-unavailable' : 'invalid-or-empty-payload', sizeBytes: bytes?.byteLength ?? 0 })
    return Promise.resolve(false)
  }
  const traceId = crypto.randomUUID()
  let saveBytes = bytes
  if (launchDescriptor?.saveAdapter === 'gen3-gba-v1') {
    const validated = await validateSaveWithRetry(saveBytes, {
      validate: selectNewestPokemonGen3SaveCopy,
      readCurrent: () => window.EJS_emulator?.gameManager?.getSaveFile?.(false),
      wait: milliseconds => new Promise(resolve => window.setTimeout(resolve, milliseconds)),
      onAttempt: async ({ attempt, bytes: attemptedBytes, valid, validation, error }) => {
        const context = { traceId, attempt, sizeBytes: attemptedBytes?.byteLength ?? 0 }
        if (attemptedBytes instanceof Uint8Array && attemptedBytes.byteLength > 0) context.sha256 = await hashSave(attemptedBytes)
        if (valid) {
          logSavePipeline('save.front.validation-accepted', { ...context, saveIndex: validation.saveIndex, copyOffset: validation.copyOffset })
        } else {
          logSavePipeline('save.front.validation-rejected', { ...context, code: error?.code ?? null, error: error?.message ?? String(error) })
        }
      },
    })
    if (!validated) { onUncertain(); return false }
    saveBytes = validated.bytes
  }
  const copy = new Uint8Array(saveBytes)
  latestSaveBytes = copy
  logSavePipeline('save.front.bytes-observed', { traceId, sizeBytes: copy.byteLength })
  const upload = pendingSaveSync.then(() => cloudSaveSynchronizer.syncBytes(copy, traceId))
  pendingSaveSync = upload.catch(() => {})
  return upload
}

function watchBatterySaveChanges() {
  const emulator = window.EJS_emulator
  if (!emulator?.on || emulator.__hubSaveWatcher) return
  emulator.__hubSaveWatcher = true
  observeEmulatorSaveFiles(emulator, bytes => {
    const token = offerPolicy?.beginLiveSave()
    return queueCloudSave(bytes, { onUncertain: () => offerPolicy?.recordSaveUncertainty() }).then(changed => {
      if (changed && token) offerPolicy.confirmLiveSave(token, cloudSaveSynchronizer.getRevision())
      return changed
    }).catch(error => {
      offerPolicy?.recordSaveUncertainty()
      throw error
    })
  })
  stopBatterySavePolling = startEmulatorSavePolling(emulator, performanceTimings ? { onPoll: duration => performanceTimings.record('saveSaveFiles', duration) } : undefined)
}

async function captureLocalRecovery() {
  if (leaseLost || closeRequested || !runtimeReady || interactionLock.isLocked() || localRecoveryCapture || !launchDescriptor) return localRecoveryCapture
  const manager = window.EJS_emulator?.gameManager
  if (!manager) {
    snapshotTelemetry.warn('automatic-capture-unavailable', { snapshotKind: 'local-recovery', reason: 'manager-unavailable' }, { repeating: true })
    return false
  }
  localRecoveryCapture = (async () => {
    const state = measureSynchronousOperation(performanceTimings, 'getState.local', () => manager.getState?.())
    if (!state) {
      snapshotTelemetry.warn('automatic-capture-unavailable', { snapshotKind: 'local-recovery', reason: 'state-bytes-unavailable' }, { repeating: true })
      return false
    }
    if (leaseLost) return false
    const stateCopy = measureSynchronousOperation(performanceTimings, 'copyState.local', () => new Uint8Array(state))
    await localRecoveryStore.put({ profileId, gameId: id, core: launchDescriptor.core, romSha256: launchDescriptor.romSha256, runtimeId: launchDescriptor.runtimeId, ...(launchDescriptor.patchSha256 ? { patchSha256: launchDescriptor.patchSha256 } : {}), ...(launchDescriptor.runtimeStateInvalidatedAtRevision ? { runtimeStateInvalidatedAtRevision: launchDescriptor.runtimeStateInvalidatedAtRevision } : {}), state: stateCopy })
    return true
  })().finally(() => { localRecoveryCapture = null })
  return localRecoveryCapture
}

async function clearLocalRecovery() {
  if (localRecoveryDeleteTimer) window.clearTimeout(localRecoveryDeleteTimer)
  localRecoveryDeleteTimer = null
  if (localRecoveryInterval) window.clearInterval(localRecoveryInterval)
  await localRecoveryStore.clear(profileId, id)
}

window.emulatorHubClearLocalRecovery = clearLocalRecovery

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
  if (!fastForwardOverlayObserver) {
    fastForwardOverlayObserver = new MutationObserver(hideFastForwardOverlay)
    fastForwardOverlayObserver.observe(game, { childList: true, characterData: true, subtree: true })
  }
}

function stopThreadStartupMonitor() {
  if (threadStartupMonitor) window.clearInterval(threadStartupMonitor)
  if (threadStartupTimeout) window.clearTimeout(threadStartupTimeout)
  threadStartupMonitor = null
  threadStartupTimeout = null
}

function fallBackFromThreadedCore(reason) {
  if (!threadDecision?.enabled || threadGameStarted || closeRequested || threadFallbackRequested) return false
  const next = playerThreadFallbackUrl(location.href)
  if (!next) return false
  threadFallbackRequested = true
  stopThreadStartupMonitor()
  console.warn('[emulator-threads] threaded core failed before game start; retrying ordinary core', { reason, core: launchDescriptor?.core, sessionId })
  window.location.replace(next)
  return true
}

function monitorThreadedCoreStartup() {
  if (!threadDecision?.enabled) return
  threadStartupMonitor = window.setInterval(() => {
    if (window.EJS_emulator?.failedToStart) fallBackFromThreadedCore('core-start-failed')
  }, 250)
  threadStartupTimeout = window.setTimeout(() => fallBackFromThreadedCore('startup-timeout'), 45000)
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

async function saveEmulatorState({ kind = 'cloud-recovery', reasonCode = 'periodic-recovery', promptOnLaunch = true } = {}) {
  if (leaseLost || closeRequested || !runtimeReady || (kind === 'cloud-recovery' && interactionLock.isLocked())) return false
  if (kind === 'user-state') {
    if (userSnapshotCapture) return userSnapshotCapture
    userSnapshotCapture = persistEmulatorState({ kind, reasonCode: 'user-request', promptOnLaunch: true }).finally(() => { userSnapshotCapture = null })
    return userSnapshotCapture
  }
  if (snapshotCapture) return snapshotCapture
  snapshotCapture = persistEmulatorState({ kind, reasonCode, promptOnLaunch }).finally(() => { snapshotCapture = null })
  return snapshotCapture
}

async function persistEmulatorState({ kind, reasonCode, promptOnLaunch }) {
  const manager = window.EJS_emulator?.gameManager
  if (leaseLost || !launchDescriptor) return false
  if (!manager) {
    if (kind === 'cloud-recovery') snapshotTelemetry.warn('automatic-capture-unavailable', { snapshotKind: kind, reason: 'manager-unavailable' }, { repeating: true })
    return false
  }
  const state = measureSynchronousOperation(performanceTimings, `getState.${kind}`, () => manager.getState?.())
  if (!state) throw new Error('Emulator snapshot bytes are unavailable.')
  const metadata = { profileId, gameId: id, core: launchDescriptor.core, romSha256: launchDescriptor.romSha256, runtimeId: launchDescriptor.runtimeId, saveRevision: cloudSaveSynchronizer.getRevision(), promptOnLaunch, kind, reasonCode, ...(installationIdentity.id ? { originInstallationId: installationIdentity.id } : {}), ...(launchDescriptor.patchSha256 ? { patchSha256: launchDescriptor.patchSha256 } : {}) }
  const uploadState = measureSynchronousOperation(performanceTimings, `copyState.${kind}`, () => new Uint8Array(state))
  const accepted = await putEmulatorSnapshot(snapshotUrlForKind(launchDescriptor.snapshotUrl, kind), {
    metadata,
    state: uploadState,
  }, kind === 'user-state' ? userSnapshotRevision : snapshotRevision, { sessionId, generation: leaseGeneration })
  const captured = { state: measureSynchronousOperation(performanceTimings, `copyState.${kind}`, () => new Uint8Array(state)), metadata: { ...metadata, capturedAt: accepted.capturedAt }, revision: accepted.revision }
  if (kind === 'user-state') {
    userSnapshotRevision = accepted.revision
    userSnapshot = captured
    announceUserStateAvailability()
  } else {
    snapshotRevision = accepted.revision
    savedSnapshot = captured
  }
  return true
}

function announceUserStateAvailability() {
  window.parent.postMessage({ type: 'emulator-hub:user-state-availability', sessionId, gameId: id, profileId, available: Boolean(userSnapshot) }, hubOrigin)
}

function reportPlayerActionFailure(action) {
  window.parent.postMessage({ type: 'emulator-hub:player-action-failed', sessionId, gameId: id, profileId, action }, hubOrigin)
}

async function deleteRestoreCandidate(message) {
  const pending = pendingRestoreRequests.get(message.restoreRequestId)
  if (!pending?.candidates?.some(candidate => candidate.kind === message.kind && candidate.candidateId === message.candidateId)) return
  let currentCandidate = null
  let candidateGone = false
  let targetRevision = null
  try {
    if (message.kind === 'local-recovery') {
      if (!localRecoveryCandidateId || message.candidateId !== localRecoveryCandidateId) throw Object.assign(new Error('Este estado local mudou e foi mantido.'), { code: 'LOCAL_RECOVERY_CHANGED' })
      const deleted = await localRecoveryStore.deleteIfMatches(profileId, id, message.candidateId)
      if (!deleted) {
        const current = await localRecoveryStore.get(profileId, id)
        if (!current) candidateGone = true
        else {
          localRecoveryCandidateId = current.candidateId
          currentCandidate = localCandidateSummary(current, { currentSaveRevision: cloudSaveSynchronizer.getRevision() })
          pending.candidates = pending.candidates.map(candidate => candidate.candidateId === message.candidateId ? currentCandidate : candidate)
          restoreCandidates = pending.candidates
          throw Object.assign(new Error('Este estado local mudou. A lista foi atualizada; confirme a exclusão do estado atual.'), { code: 'LOCAL_RECOVERY_CHANGED' })
        }
      }
      localRecovery = null
    } else if (message.kind === 'cloud-recovery' || message.kind === 'user-state') {
      const manual = message.kind === 'user-state'
      const stored = manual ? userSnapshot : savedSnapshot
      targetRevision = stored?.revision ?? null
      const expectedCandidateId = Number.isInteger(stored?.revision) ? `${manual ? 'user' : 'remote'}:${stored.revision}` : null
      if (!expectedCandidateId || message.candidateId !== expectedCandidateId) throw Object.assign(new Error('Este snapshot mudou e foi mantido.'), { code: 'SNAPSHOT_STALE' })
      try {
        await deleteEmulatorSnapshot(snapshotUrlForKind(launchDescriptor.snapshotUrl, message.kind), stored.revision, { sessionId, generation: leaseGeneration })
      } catch (error) {
        if (error.status !== 412) throw error
        const current = await getEmulatorSnapshot(snapshotUrlForKind(launchDescriptor.snapshotUrl, message.kind), { sessionId, generation: leaseGeneration })
        if (current) {
          if (manual) { userSnapshot = current; userSnapshotRevision = current.revision }
          else { savedSnapshot = current; snapshotRevision = current.revision }
          currentCandidate = remoteCandidateSummary(current, { currentSaveRevision: cloudSaveSynchronizer.getRevision(), installationId: installationIdentity.comparisonId })
          pending.candidates = pending.candidates.map(candidate => candidate.candidateId === message.candidateId ? currentCandidate : candidate)
          restoreCandidates = pending.candidates
          throw Object.assign(new Error('O snapshot foi atualizado. Confirme a exclusão do estado atual.'), { code: 'SNAPSHOT_STALE' })
        }
        candidateGone = true
      }
      if (manual) { userSnapshot = null; userSnapshotRevision = null; announceUserStateAvailability() }
      else { savedSnapshot = null; snapshotRevision = null }
    } else return
    pending.candidates = pending.candidates.filter(candidate => candidate.candidateId !== message.candidateId)
    restoreCandidates = pending.candidates
    snapshotTelemetry.info('candidate-deleted', { snapshotKind: message.kind, candidateId: message.candidateId, revision: targetRevision, reason: 'user-request' })
    window.parent.postMessage({ type: 'emulator-hub:snapshot-candidate-delete-result', requestId: message.requestId, restoreRequestId: message.restoreRequestId, candidateId: message.candidateId, kind: message.kind, sessionId, gameId: id, profileId, ok: true }, hubOrigin)
  } catch (error) {
    if (candidateGone) {
      pending.candidates = pending.candidates.filter(candidate => candidate.candidateId !== message.candidateId)
      restoreCandidates = pending.candidates
    }
    snapshotTelemetry[candidateGone ? 'info' : 'warn'](candidateGone ? 'candidate-already-gone' : 'candidate-delete-failed', { snapshotKind: message.kind, candidateId: message.candidateId, revision: targetRevision, code: error.code, error: error.message, status: error.status })
    window.parent.postMessage({ type: 'emulator-hub:snapshot-candidate-delete-result', requestId: message.requestId, restoreRequestId: message.restoreRequestId, candidateId: message.candidateId, currentCandidate, candidateGone, kind: message.kind, sessionId, gameId: id, profileId, ok: candidateGone, error: error.message, code: error.code ?? null }, hubOrigin)
  }
}

function startLocalRecoveryCapture() {
  if (closeRequested || leaseLost || localRecoveryInterval) return
  localRecoveryInterval = window.setInterval(() => void captureLocalRecovery().catch(error => snapshotTelemetry.warn('automatic-capture-failed', { snapshotKind: 'local-recovery', code: error.code, error: error.message }, { repeating: true })), 10_000)
  void captureLocalRecovery().catch(error => snapshotTelemetry.warn('automatic-capture-failed', { snapshotKind: 'local-recovery', code: error.code, error: error.message }, { repeating: true }))
}

function scheduleLocalRecoveryDeleteAfterChoice(candidateId) {
  if (!candidateId) return
  if (localRecoveryDeleteTimer) window.clearTimeout(localRecoveryDeleteTimer)
  localRecoveryDeleteTimer = window.setTimeout(async () => {
    localRecoveryDeleteTimer = null
    if (!runtimeReady || closeRequested || leaseLost) return
    try {
      const deleted = await localRecoveryStore.deleteIfMatches(profileId, id, candidateId)
      snapshotTelemetry[deleted ? 'info' : 'warn'](deleted ? 'local-recovery-deleted' : 'local-recovery-changed', { snapshotKind: 'local-recovery', candidateId, reason: 'choice-consumed' })
    } catch (error) {
      snapshotTelemetry.warn('local-recovery-delete-failed', { snapshotKind: 'local-recovery', candidateId, phase: 'choice-consumed', code: error.code, error: error.message })
    }
    startLocalRecoveryCapture()
  }, 10_000)
}

function scheduleCloudRecoveryDeleteAfterChoice(revision) {
  if (!Number.isInteger(revision) || snapshotRevision !== revision) return
  if (cloudRecoveryDeleteTimer) window.clearTimeout(cloudRecoveryDeleteTimer)
  snapshotTelemetry.info('cloud-delete-scheduled', { snapshotKind: 'cloud-recovery', revision, reason: 'choice-consumed' })
  cloudRecoveryDeleteTimer = window.setTimeout(async () => {
    cloudRecoveryDeleteTimer = null
    if (!runtimeReady || closeRequested || leaseLost || snapshotRevision !== revision) return
    const deletion = (async () => {
      try {
        await deleteEmulatorSnapshot(launchDescriptor.snapshotUrl, revision, { sessionId, generation: leaseGeneration })
        if (snapshotRevision === revision) {
          savedSnapshot = null
          snapshotRevision = null
        }
        snapshotTelemetry.info('cloud-recovery-deleted', { snapshotKind: 'cloud-recovery', revision, reason: 'choice-consumed' })
      } catch (error) {
        snapshotTelemetry.warn('cloud-recovery-delete-failed', { snapshotKind: 'cloud-recovery', revision, phase: 'choice-consumed', code: error.code, error: error.message, status: error.status })
      }
    })()
    cloudRecoveryDeletion = deletion
    try { await deletion } finally { if (cloudRecoveryDeletion === deletion) cloudRecoveryDeletion = null }
  }, 10_000)
}

async function closeEmulator() {
  stopThreadStartupMonitor()
  stopEmulatedFpsOverlay()
  if (cloudRecoveryDeleteTimer) window.clearTimeout(cloudRecoveryDeleteTimer)
  cloudRecoveryDeleteTimer = null
  if (localRecoveryDeleteTimer) window.clearTimeout(localRecoveryDeleteTimer)
  localRecoveryDeleteTimer = null
  if (!runtimeReady) {
    closeRequested = true
    for (const pending of pendingRestoreRequests.values()) {
      pending.resolve({ candidateId: null, explicit: false })
    }
    pendingRestoreRequests.clear()
    snapshotTelemetry.info('close-preserved-recovery', { reason: 'startup-unresolved', candidateCount: restoreCandidates.length })
    return { preserveRecovery: true }
  }
  closeRequested = true
  if (cloudSaveInterval) window.clearInterval(cloudSaveInterval)
  if (localRecoveryInterval) window.clearInterval(localRecoveryInterval)
  stopBatterySavePolling?.()
  stopBatterySavePolling = null
  if (localRecoveryCapture) await localRecoveryCapture.catch(error => snapshotTelemetry.warn('automatic-capture-failed', { snapshotKind: 'local-recovery', phase: 'close', code: error.code, error: error.message }, { repeating: true }))
  await pendingSaveSync
  const finalSaveBytes = window.EJS_emulator?.gameManager?.getSaveFile?.()
  if (finalSaveBytes instanceof Uint8Array && finalSaveBytes.byteLength > 0) await queueCloudSave(finalSaveBytes)
  else if (latestSaveBytes) await queueCloudSave(latestSaveBytes)
  await pendingSaveSync
  if (snapshotCapture) await snapshotCapture.catch(() => {})
  if (userSnapshotCapture) await userSnapshotCapture.catch(() => {})
  if (cloudRecoveryDeletion) await cloudRecoveryDeletion
  if (snapshotRevision !== null) {
    const revision = snapshotRevision
    try {
      await deleteEmulatorSnapshot(launchDescriptor.snapshotUrl, snapshotRevision, { sessionId, generation: leaseGeneration })
      savedSnapshot = null
      snapshotRevision = null
      snapshotTelemetry.info('cloud-recovery-deleted', { snapshotKind: 'cloud-recovery', revision, reason: 'normal-close' })
    } catch (error) {
      snapshotTelemetry.warn('cloud-recovery-delete-failed', { snapshotKind: 'cloud-recovery', revision, phase: 'close', code: error.code, error: error.message, status: error.status })
    }
  }
  snapshotTelemetry.info('close-completed', { reason: 'normal-close', saveRevision: cloudSaveSynchronizer.getRevision() })
  return { preserveRecovery: false }
}

window.emulatorHubClose = closeEmulator

function loadEmulatorState() {
  if (!userSnapshot || !snapshotMatchesLaunch(userSnapshot, launchDescriptor)) return false
  const manager = window.EJS_emulator?.gameManager
  if (!manager) return false
  let loaded = true
  try { manager.loadState(new Uint8Array(userSnapshot.state)) }
  catch (error) { console.error('[emulator-snapshot] manual state load failed', error); loaded = false }
  try { cloudSaveSynchronizer.ignoreRuntimeStateSave(manager.getSaveFile?.()) }
  catch (error) {
    cloudSaveSynchronizer.blockRuntimeSaveSync()
    console.error('[emulator-snapshot] runtime save bytes could not be inspected after state load', error)
    loaded = false
  }
  if (!loaded) return false
  offerPolicy?.recordRuntimeRestore()
  return true
}

window.addEventListener('message', event => {
  if (event.origin !== hubOrigin) return
  const isClosePlayerMessage = event.data?.type === 'emulator-hub:close-player'
  if (!isClosePlayerMessage && event.source !== window.parent) return
  if (event.data?.type === 'emulator-hub:interaction-lock') {
    if (typeof event.data.locked !== 'boolean' || !Number.isInteger(event.data.revision) || typeof event.data.requestId !== 'string' || event.data.sessionId !== sessionId) return
    if (event.data.revision > lastInteractionLockRevision) {
      lastInteractionLockRevision = event.data.revision
      interactionLock.setLocked(event.data.locked)
    }
    window.parent.postMessage({ type: 'emulator-hub:interaction-lock-applied', requestId: event.data.requestId, sessionId, revision: lastInteractionLockRevision, ok: true }, hubOrigin)
    return
  }
  if (event.data?.type === 'emulator-hub:gamepad') {
    if (!Array.isArray(event.data.bindings) || !event.data.bindings.every(value => typeof value === 'string')) return
    if (interactionLock.isLocked()) { gamepadInput?.release(); return }
    if (gamepadInput && event.data.bindings.some(binding => !lastGamepadBindings.has(binding))) offerPolicy?.recordInput()
    lastGamepadBindings = new Set(event.data.bindings)
    gamepadBindings = event.data.bindings
    gamepadInput?.update(gamepadBindings)
    return
  }
  if (event.data?.type === 'emulator-hub:snapshot-restore-response') {
    const choice = routeRestoreChoiceResponse(pendingRestoreRequests, settledRestoreRequests, event.data)
    if (!choice) return
    const reply = { requestId: event.data.requestId, choiceAttemptId: event.data.choiceAttemptId, candidateId: event.data.candidateId, sessionId, gameId: id, profileId }
    if (choice.status === 'stale') {
      window.parent.postMessage({ type: 'emulator-hub:snapshot-restore-stale', ...reply, candidates: choice.candidates }, hubOrigin)
      return
    }
    window.parent.postMessage({ type: 'emulator-hub:snapshot-restore-settled', ...reply, appliedCandidateId: choice.appliedCandidateId }, hubOrigin)
    if (settledRestoreRequests.size > 32) settledRestoreRequests.delete(settledRestoreRequests.keys().next().value)
    if (choice.request) {
      choice.request.resolve({ candidateId: choice.request.candidateId, explicit: true })
    }
    return
  }
  if (event.data?.type === 'emulator-hub:snapshot-candidate-delete') {
    if (typeof event.data.requestId !== 'string' || typeof event.data.restoreRequestId !== 'string' || typeof event.data.candidateId !== 'string') return
    if (event.data.sessionId !== sessionId || event.data.gameId !== id || event.data.profileId !== profileId) return
    void deleteRestoreCandidate(event.data)
    return
  }
  if (event.data?.type === 'emulator-hub:control-profile') {
    const bindings = event.data.bindings
    if (!bindings || typeof bindings !== 'object' || !Object.values(bindings).every(binding => binding && typeof binding.gamepad === 'string')) return
    gamepadInput?.setBindings(bindings)
    return
  }
  if (event.data?.type === 'emulator-hub:odds-manipulator-configure') {
    const accepted = oddsClock.configure(event.data)
    clientDiagnostics?.capture({ kind: 'odds-manipulator', message: accepted ? 'odds.clock.configured' : 'odds.clock.configuration-rejected', enabled: event.data.enabled === true, oddsResetCount: event.data.oddsResetCount ?? null, virtualTimestamp: event.data.virtualTimestamp ?? null, dateNow: Date.now() })
    event.source?.postMessage({
      type: 'emulator-hub:odds-manipulator-ready',
      requestId: event.data.requestId ?? null,
      sessionId: event.data.sessionId ?? null,
      accepted,
      enabled: event.data.enabled === true,
      oddsResetCount: accepted ? event.data.oddsResetCount ?? 0 : null,
      virtualTimestamp: accepted ? event.data.virtualTimestamp ?? 0 : null,
      dateNow: Date.now(),
    }, event.origin)
    return
  }
  if (event.data?.type === 'emulator-hub:reset') {
    if (event.data.oddsResetCount !== undefined || event.data.virtualTimestamp !== undefined) {
      const accepted = oddsClock.configure({ enabled: true, oddsResetCount: event.data.oddsResetCount, virtualTimestamp: event.data.virtualTimestamp })
      clientDiagnostics?.capture({ kind: 'odds-manipulator', message: accepted ? 'odds.hard-reset.clock-applied' : 'odds.hard-reset.clock-rejected', oddsResetCount: event.data.oddsResetCount ?? null, virtualTimestamp: event.data.virtualTimestamp ?? null, dateNow: Date.now(), managerReady: Boolean(window.EJS_emulator?.gameManager) })
    }
    window.EJS_emulator?.gameManager?.restart()
    return
  }
  if (event.data?.type === 'emulator-hub:soft-reset') {
    if (event.data.oddsResetCount !== undefined || event.data.virtualTimestamp !== undefined) {
      const accepted = oddsClock.configure({ enabled: true, oddsResetCount: event.data.oddsResetCount, virtualTimestamp: event.data.virtualTimestamp })
      clientDiagnostics?.capture({ kind: 'odds-manipulator', message: accepted ? 'odds.soft-reset.clock-applied' : 'odds.soft-reset.clock-rejected', oddsResetCount: event.data.oddsResetCount ?? null, virtualTimestamp: event.data.virtualTimestamp ?? null, dateNow: Date.now(), managerReady: Boolean(window.EJS_emulator?.gameManager) })
    }
    void softResetEmulator(window.EJS_emulator?.gameManager)
    return
  }
  if (event.data?.type === 'emulator-hub:save-state') {
    offerPolicy?.recordManualStateSave()
    void saveEmulatorState({ kind: 'user-state', reasonCode: 'user-request' }).then(
      saved => {
        if (saved) snapshotTelemetry.info('user-state-saved', { snapshotKind: 'user-state', revision: userSnapshotRevision, saveRevision: cloudSaveSynchronizer?.getRevision() })
        else { snapshotTelemetry.warn('user-state-save-unavailable', { snapshotKind: 'user-state' }); reportPlayerActionFailure('manual-save') }
      },
      error => { snapshotTelemetry.error('user-state-save-failed', { snapshotKind: 'user-state', code: error.code, error: error.message, status: error.status }); reportPlayerActionFailure('manual-save') },
    )
    return
  }
  if (event.data?.type === 'emulator-hub:load-state') {
    if (loadEmulatorState()) snapshotTelemetry.info('user-state-loaded', { snapshotKind: 'user-state', revision: userSnapshotRevision })
    else { snapshotTelemetry.warn('user-state-load-unavailable', { snapshotKind: 'user-state', revision: userSnapshotRevision }); reportPlayerActionFailure('manual-load') }
    return
  }
  if (event.data?.type === 'emulator-hub:fast-forward') {
    const speed = Number(event.data.speed)
    if (!Number.isFinite(speed) || speed < 1.5 || speed > 5 || (speed * 2) % 1 !== 0) return
    fastForwardRequest = { enabled: event.data.enabled === true, speed }
    applyFastForward()
    return
  }
  if (event.data?.type === 'emulator-hub:mute') {
    if (typeof event.data.muted !== 'boolean') return
    audioMute.setMuted(event.data.muted)
    return
  }
  if (event.data?.type === 'emulator-hub:get-fast-forward-state') {
    if (typeof event.data.requestId !== 'string') return
    window.parent.postMessage({ type: 'emulator-hub:fast-forward-state', requestId: event.data.requestId, enabled: fastForwardRequest.enabled }, hubOrigin)
    return
  }
  if (event.data?.type === 'emulator-hub:close-player') {
    if (typeof event.data.requestId !== 'string' || event.data.sessionId !== sessionId) return
    closeEmulator().then(
      result => window.parent.postMessage({ type: 'emulator-hub:save-synced', requestId: event.data.requestId, sessionId, ok: true, preserveRecovery: result.preserveRecovery }, hubOrigin),
      error => window.parent.postMessage({ type: 'emulator-hub:save-synced', requestId: event.data.requestId, sessionId, ok: false, error: error.message }, hubOrigin),
    )
    return
  }
  if (event.data?.type === 'emulator-hub:clear-local-recovery') {
    if (typeof event.data.requestId !== 'string' || event.data.sessionId !== sessionId) return
    void clearLocalRecovery().then(
      () => window.parent.postMessage({ type: 'emulator-hub:local-recovery-cleared', requestId: event.data.requestId, sessionId, ok: true }, hubOrigin),
      error => window.parent.postMessage({ type: 'emulator-hub:local-recovery-cleared', requestId: event.data.requestId, sessionId, ok: false, error: error.message }, hubOrigin),
    )
  }
})

async function start() {
  if (!id || !profileId) throw new Error('Missing game or profile ID')
  if (!sessionId || !Number.isInteger(leaseGeneration)) throw new Error('Missing active player lease')
  if (originStorageClient) installationIdentity = await originStorageClient.getInstallationIdentity()
  startLeaseHeartbeat()
  const [launch, controlProfile] = await Promise.all([getPlayerLeaseLaunch(sessionId, { profileId, gameId: id, generation: leaseGeneration }), getControlProfile()])
  if (!launch.romUrl || !launch.core) throw new Error('Incomplete launch configuration')
  launchDescriptor = launch
  emulatorGameId = createEmulatorGameId(launch.gameId, profileId)
  if (restoreLocalRecovery || localRecoveryPrompt) {
    const candidate = await localRecoveryStore.getForLaunch(profileId, id, launch.runtimeStateInvalidatedAtRevision)
    if (restoreLocalRecovery && !candidate) throw new Error('Local recovery is no longer available.')
    if (candidate && candidate.core === launch.core && candidate.romSha256 === launch.romSha256 && candidate.runtimeId === launch.runtimeId && candidate.patchSha256 === launch.patchSha256) localRecovery = candidate
    else if (restoreLocalRecovery) throw new Error('Local recovery is incompatible with this launch.')
  }
  cloudSaveSynchronizer = createCloudSaveSynchronizer({
    load: () => {
      const traceId = crypto.randomUUID()
      logSavePipeline('save.front.get-started', { traceId, profileId, gameId: id })
      return getCloudSave(launch.saveUrl, { sessionId, generation: leaseGeneration }, traceId, logSavePipeline).catch(error => {
        reportPlayerActionFailure('game-save-load')
        throw error
      })
    },
    upload: (bytes, revision, traceId) => putCloudSave(launch.saveUrl, bytes, revision, { sessionId, generation: leaseGeneration }, traceId, logSavePipeline),
    hash: hashSave,
    logger: logSavePipeline,
  })
  if (Boolean(launch.patchUrl) !== Boolean(launch.patchSha256)) throw new Error('Incomplete patch configuration.')
  const [, receivedSnapshot, receivedUserSnapshot, romResponse, initialPatchResponse] = await Promise.all([
    cloudSaveSynchronizer.load(),
    getEmulatorSnapshot(launch.snapshotUrl, { sessionId, generation: leaseGeneration }),
    getEmulatorSnapshot(snapshotUrlForKind(launch.snapshotUrl, 'user-state'), { sessionId, generation: leaseGeneration }),
    fetch(launch.romUrl, { cache: 'no-store' }),
    launch.patchUrl ? fetch(launch.patchUrl, { cache: 'no-store' }).catch(error => ({ ok: false, status: 0, error })) : Promise.resolve(null),
  ])
  if (!romResponse.ok) throw new Error(`ROM request failed (${romResponse.status})`)
  const romBytes = new Uint8Array(await romResponse.arrayBuffer())
  if (await hashSave(romBytes) !== launch.romSha256) throw new Error('ROM bytes did not match the launch descriptor.')
  let patchBytes = null
  const patchResponse = initialPatchResponse
  if (patchResponse) {
    if (patchResponse.ok) {
      try {
        const candidatePatchBytes = new Uint8Array(await patchResponse.arrayBuffer())
        if (await hashSave(candidatePatchBytes) === launch.patchSha256) patchBytes = candidatePatchBytes
        else console.warn('[game-patch] patch bytes did not match launch descriptor; starting without patch')
      } catch (error) {
        console.warn('[game-patch]', { event: 'patch-read-failed', gameId: id, error: error.message })
      }
    } else console.warn('[game-patch]', { event: 'patch-fetch-failed', status: patchResponse.status, gameId: id, error: patchResponse.error?.message })
    if (!patchBytes) {
      launch.patchUrl = undefined
      launch.patchSha256 = undefined
    }
  }
  let snapshot = receivedSnapshot
  let snapshotCompatible = snapshot && snapshot.metadata.profileId === profileId && snapshot.metadata.gameId === id && snapshotMatchesLaunch(snapshot, launch)
  const userCompatible = receivedUserSnapshot && receivedUserSnapshot.metadata.profileId === profileId && receivedUserSnapshot.metadata.gameId === id && snapshotMatchesLaunch(receivedUserSnapshot, launch)
  if (snapshot && !snapshotCompatible) {
    console.warn('[emulator-snapshot] stored snapshot is incompatible with this launch; starting without it')
    snapshotTelemetry.warn('candidate-incompatible', { snapshotKind: 'cloud-recovery', revision: snapshot.revision, reason: 'launch-mismatch' })
  }
  if (receivedUserSnapshot && !userCompatible) snapshotTelemetry.warn('candidate-incompatible', { snapshotKind: 'user-state', revision: receivedUserSnapshot.revision, reason: 'launch-mismatch' })
  savedSnapshot = snapshotCompatible ? snapshot : null
  snapshotRevision = snapshot?.revision ?? null
  userSnapshot = userCompatible ? receivedUserSnapshot : null
  userSnapshotRevision = receivedUserSnapshot?.revision ?? null
  announceUserStateAvailability()
  offerPolicy = createSnapshotOfferPolicy()
  threadDecision = selectPlayerThreadMode({ core: launch.core, protocol: location.protocol, crossOriginIsolated: window.crossOriginIsolated === true, sharedArrayBufferAvailable: typeof window.SharedArrayBuffer === 'function', retryWithoutThreads: parameters.get('threadFallback') === '1', mode: 'ordinary' })
  window.EJS_threads = threadDecision.enabled
  console.info('[emulator-threads] core mode selected', { core: launch.core, threaded: threadDecision.enabled, reason: threadDecision.reason, sessionId })
  window.EJS_player = '#game'
  window.EJS_core = launch.core
  window.EJS_gameUrl = URL.createObjectURL(new Blob([romBytes]))
  if (patchBytes) window.EJS_gamePatchUrl = URL.createObjectURL(new Blob([patchBytes]))
  window.EJS_gameName = launch.title
  window.EJS_gameID = emulatorGameId
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
    interactionLock.apply()
    stopLifecycleDiagnostics?.()
    audioMute.attach(window.EJS_emulator)
    audioMute.apply()
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
  window.EJS_onGameStart = async () => {
    threadGameStarted = true
    stopThreadStartupMonitor()
    if (closeRequested || threadFallbackRequested) return
    setPlayerLoading('Carregando save...')
    audioMute.attach(window.EJS_emulator)
    audioMute.apply()
    // EJS_ready fires before EmulatorJS creates its gameManager. Reapply here
    // because earlier setting changes can be ignored during loader startup.
    applyFastForward()
    clientDiagnostics?.capture({ kind: 'emulator-lifecycle', message: 'EmulatorJS game start callback' })
    removeAudioResumeGesture?.()
    removeAudioResumeGesture = installAudioResumeOnUserGesture({
      element: game,
      getAudioContext: () => getEmulatorAudioContext(window.EJS_emulator),
    })
    gamepadInput = createEmulatorGamepadInput(window.EJS_emulator, controlProfile.bindings)
    interactionLock.apply()
    if (!interactionLock.isLocked()) {
      if (gamepadBindings.length > 0) offerPolicy.recordInput()
      gamepadInput.update(gamepadBindings)
    }
    const focusPlayer = () => window.parent.postMessage({ type: 'emulator-hub:player-focused', sessionId, gameId: id, profileId }, hubOrigin)
    window.addEventListener('keydown', event => { if (event.isTrusted) { offerPolicy.recordInput(); focusPlayer() } }, { capture: true })
    game.addEventListener('pointerdown', event => { if (event.isTrusted) { offerPolicy.recordInput(); focusPlayer() } }, { capture: true })
    game.addEventListener('touchstart', event => { if (event.isTrusted) { offerPolicy.recordInput(); focusPlayer() } }, { capture: true, passive: true })
    restoreCandidates = sortRestoreCandidates([
      ...(localRecoveryPrompt && localRecovery?.candidateId === localRecoveryCandidateId ? [localCandidateSummary(localRecovery, { currentSaveRevision: cloudSaveSynchronizer.getRevision() })] : []),
      ...(savedSnapshot ? [remoteCandidateSummary(savedSnapshot, { currentSaveRevision: cloudSaveSynchronizer.getRevision(), installationId: installationIdentity.comparisonId })] : []),
      ...(userSnapshot ? [remoteCandidateSummary(userSnapshot, { currentSaveRevision: cloudSaveSynchronizer.getRevision(), installationId: installationIdentity.comparisonId })] : []),
    ])
    if (restoreCandidates.length) snapshotTelemetry.info('candidates-offered', { candidateCount: restoreCandidates.length, saveRevision: cloudSaveSynchronizer.getRevision() })
    if (restoreCandidates.length) window.EJS_emulator.pause()
    const restoreChoice = restoreCandidates.length ? await requestRestoreChoice(restoreCandidates) : null
    if (closeRequested) return
    const selectedCandidateId = restoreChoice?.candidateId ?? (restoreLocalRecovery ? localRecovery?.candidateId : null)
    let restoredRuntimeState = false
    const selected = restoreCandidates.find(candidate => candidate.candidateId === selectedCandidateId)
    const selectedRevision = selected?.kind === 'user-state' ? userSnapshot?.revision : selected?.kind === 'cloud-recovery' ? savedSnapshot?.revision : undefined
    if (restoreChoice?.explicit) snapshotTelemetry.info('restore-choice', { candidateId: selectedCandidateId ?? undefined, snapshotKind: selected?.kind, revision: selectedRevision, reason: selectedCandidateId ? 'user-selected' : 'continue' })
    let restoreError = null
    try {
      if (selected?.kind === 'local-recovery' || (restoreLocalRecovery && selectedCandidateId === localRecovery?.candidateId)) {
        const current = await localRecoveryStore.get(profileId, id)
        if (closeRequested) return
        if (current?.candidateId === selectedCandidateId && current.core === launchDescriptor.core && current.romSha256 === launchDescriptor.romSha256 && current.runtimeId === launchDescriptor.runtimeId && current.patchSha256 === launchDescriptor.patchSha256) {
          window.EJS_emulator.gameManager.loadState(new Uint8Array(current.state))
          restoredRuntimeState = true
          if (closeRequested) return
        }
      } else if (selected && (selected.kind === 'cloud-recovery' || selected.kind === 'user-state')) {
        const current = selected.kind === 'user-state' ? userSnapshot : savedSnapshot
        if (current && remoteCandidateSummary(current, { currentSaveRevision: cloudSaveSynchronizer.getRevision(), installationId: installationIdentity.comparisonId }).candidateId === selectedCandidateId && snapshotMatchesLaunch(current, launchDescriptor)) {
          window.EJS_emulator.gameManager.loadState(new Uint8Array(current.state))
          restoredRuntimeState = true
        }
      }
    } catch (error) {
      restoreError = error
      console.error('[emulator-snapshot] selected state could not be loaded', error)
    }
    if (selectedCandidateId && restoredRuntimeState) snapshotTelemetry.info('restore-applied', { candidateId: selectedCandidateId, snapshotKind: selected?.kind, revision: selectedRevision })
    if (selectedCandidateId && !restoredRuntimeState) {
      snapshotTelemetry.error('restore-load-failed', { candidateId: selectedCandidateId, snapshotKind: selected?.kind, code: restoreError?.code ?? 'STATE_UNAVAILABLE', error: restoreError?.message ?? 'Selected state was unavailable or incompatible.' })
      reportPlayerActionFailure('restore-state')
    }
    try {
      if (!restoredRuntimeState) {
        await Promise.resolve(window.EJS_emulator.gameManager.restart?.())
        if (closeRequested) return
      }
      const saveLoaded = await cloudSaveSynchronizer.restore(window.EJS_emulator.gameManager)
      if (selectedCandidateId) snapshotTelemetry[saveLoaded ? 'info' : 'warn'](saveLoaded ? 'canonical-save-loaded' : 'canonical-save-missing', { candidateId: selectedCandidateId, snapshotKind: selected?.kind, saveRevision: cloudSaveSynchronizer.getRevision() })
      if (saveLoaded === false && selectedCandidateId) {
        cloudSaveSynchronizer.ignoreRuntimeStateSave(window.EJS_emulator.gameManager.getSaveFile?.())
      }
      if (saveLoaded === false && Math.max(savedSnapshot?.metadata?.saveRevision ?? 0, userSnapshot?.metadata?.saveRevision ?? 0) > 0) reportPlayerActionFailure('game-save-missing')
    } catch (error) {
      console.error('[save-pipeline] canonical game save could not be loaded', error)
      reportPlayerActionFailure('game-save-load')
      return
    }
    if (restoredRuntimeState) offerPolicy.recordRuntimeRestore()
    if (closeRequested) return
    setPlayerReady()
    runtimeReady = true
    startEmulatedFpsOverlay()
    if (restoreCandidates.length && !interactionLock.isLocked()) window.EJS_emulator.play()
    interactionLock.apply()
    if (restoreChoice?.explicit && localRecoveryPrompt && localRecoveryCandidateId) scheduleLocalRecoveryDeleteAfterChoice(localRecoveryCandidateId)
    else startLocalRecoveryCapture()
    if (restoreChoice?.explicit && savedSnapshot && (!selectedCandidateId || restoredRuntimeState)) scheduleCloudRecoveryDeleteAfterChoice(savedSnapshot.revision)
    watchBatterySaveChanges()
    cloudSaveInterval = window.setInterval(() => saveEmulatorState({ reasonCode: 'periodic-recovery' }).catch(error => snapshotTelemetry.error('automatic-capture-failed', { snapshotKind: 'cloud-recovery', code: error.code, error: error.message, status: error.status }, { repeating: true })), 15000)
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
    if (fallBackFromThreadedCore('loader-unavailable')) return
    const message = 'EmulatorJS loader could not be reached.'
    clientDiagnostics?.capture({ kind: 'emulator-failure', message })
    game.textContent = message
  }
  document.body.appendChild(loader)
  monitorThreadedCoreStartup()
}

start().catch(error => {
  snapshotTelemetry.error('startup-failed', { phase: 'initialization', code: error.code, error: error.message, status: error.status })
  loseLease()
  clientDiagnostics?.capture({ kind: 'emulator-failure', message: error.message, name: error.name, stack: error.stack })
  game.textContent = error.message
})
