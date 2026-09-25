import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { ConfigProvider, Select } from 'antd'
import { acquirePlayerLease, createProfile, deleteProfile as deleteProfileRequest, getControlProfile, getGames, getProfiles, getUserPreferences, releasePlayerLease, syncOddsResetCount, updateControlProfile, updateProfile, updateUserPreferences } from '../../packages/hub-client.js'
import { activeGamepadBindings, readGamepadBinding, readGamepadSnapshot } from '../../packages/gamepad-input.mjs'
import { createGamepadInputGate } from '../../packages/gamepad-input-gate.mjs'
import { deliverPlayerInteractionLock } from '../../packages/player-interaction-lock-delivery.mjs'
import { replaceCatalogProfile } from '../../packages/save-profile-catalog.mjs'
import { groupGamesByLayout } from '../../packages/hub-layout.mjs'
import { getProfilePickerPlacement } from '../../packages/profile-picker-placement.mjs'
import { createHubPerformanceRecorder } from '../../packages/emulator-performance-probe.mjs'
import { appendClientDiagnosticsParameters, createClientDiagnostics, getClientDiagnosticsOptions } from '../../packages/client-diagnostics.mjs'
import { createMultiSaveCloseCoordinator } from '../../packages/multi-save-close-coordinator.mjs'
import { isMobileLandscapeViewport, isNarrowPortraitViewport } from '../../packages/mobile-viewport.mjs'
import { shouldReloadForFrontendRevision } from '../../packages/frontend-revision.mjs'
import { readFastForwardSpeed } from '../../packages/fast-forward-preference.mjs'
import { createIndexedDbRecoveryStorage, createLocalRuntimeRecoveryStore } from '../../packages/local-runtime-recovery-store.mjs'
import { canReconcileLateSnapshotDelete, createSnapshotDeleteWatchdog, restorePromptAfterChoiceTimeout, restorePromptAfterDeleteTimeout } from '../../packages/snapshot-restore-routing.mjs'
import { createPlayerTriggerActions, playerTriggerActionOptions } from '../../packages/player-trigger-actions.mjs'
import { requestPlayerFrame } from '../../packages/player-frame-request.mjs'
import { findReachablePlayerOriginSlot, findTrustedPlayerFrame, frameOrigin, parsePlayerOriginPorts, playerOriginForSlot } from '../../packages/player-origin-topology.mjs'
import { respondToPlayerStorageRequest } from '../../packages/player-origin-storage-bridge.mjs'
import { getInstallationIdentity } from '../../packages/restore-candidate.mjs'
import { createOddsManipulatorSync } from '../../packages/odds-manipulator-sync.mjs'
import { describeRestoreCandidate } from './restore-candidate-view.mjs'
import { createSnapshotTelemetry } from '../../packages/snapshot-telemetry.mjs'
import hubLayout from './hub-layout.json'
import { ProfileEditor } from './profile-editor.jsx'
import './styles.css'

const PokemonHub = React.lazy(() => import('../../packages/pokemon-hub-ui.jsx'))

// The Hub document owns the session lifecycle: every full load/F5 gets a new ID.
// Player iframes receive that ID explicitly through their launch query string.
const clientDiagnosticsOptions = getClientDiagnosticsOptions(import.meta.env.VITE_DEBUG)
const hubPerformance = clientDiagnosticsOptions.enabled
  ? createHubPerformanceRecorder({ browser: window, getFrames: () => document.querySelectorAll('.player-grid iframe') })
  : null
const clientDiagnostics = clientDiagnosticsOptions.enabled
  ? createClientDiagnostics({ browser: window, source: 'hub', sessionId: clientDiagnosticsOptions.sessionId })
  : null

function readViewport() {
  return { width: window.innerWidth, height: window.innerHeight }
}

const gbaControls = Object.freeze({
  l: { id: '10', label: 'L' },
  r: { id: '11', label: 'R' },
  up: { id: '4', label: '↑' },
  down: { id: '5', label: '↓' },
  left: { id: '6', label: '←' },
  right: { id: '7', label: '→' },
  select: { id: '2', label: 'SELECT' },
  start: { id: '3', label: 'START' },
  b: { id: '0', label: 'B' },
  a: { id: '8', label: 'A' },
})
const triggerControls = Object.freeze({
  l2: { id: 'l2', label: 'L2' },
  r2: { id: 'r2', label: 'R2' },
})

const fastForwardSpeeds = Object.freeze([1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5])
const playerActionFailureMessages = Object.freeze({
  'manual-save': 'Não foi possível salvar o estado.',
  'manual-load': 'Não foi possível carregar o estado salvo.',
  'restore-state': 'Não foi possível restaurar o estado escolhido.',
  'game-save-load': 'Não foi possível carregar o save do jogo.',
  'game-save-missing': 'O save do jogo esperado para este perfil não foi encontrado.',
})
const MAX_PLAYER_INSTANCES = 6
let playerOriginPorts = []
try { playerOriginPorts = parsePlayerOriginPorts(window.location, import.meta.env.VITE_PLAYER_PORTS) }
catch (error) { console.warn('[player-origins] Invalid port configuration; using the Hub origin', { error: error.message }) }
const localRecoveryStorage = createIndexedDbRecoveryStorage()
const localRecoveryStore = createLocalRuntimeRecoveryStore({ storage: localRecoveryStorage })

function reportHubSnapshot(session, level, event, details = {}) {
  if (!session) return
  createSnapshotTelemetry({ browser: window, source: 'hub', sessionId: session.sessionId, gameId: session.gameId, profileId: session.profileId })[level](event, details)
}
const antTheme = {
  token: {
    colorPrimary: '#22b36f',
    colorInfo: '#22b36f',
    colorBgBase: '#08131a',
    colorBgContainer: '#10262a',
    colorText: '#e8f5ef',
    colorTextPlaceholder: '#98b9ad',
    colorBorder: '#397c67',
    borderRadius: 7,
  },
}

function configurePlayerFrame(frame, message) {
  if (frame) frame.contentWindow?.postMessage(message, frameOrigin(frame, window.location.origin))
}

function playerSelectPopupContainer(trigger) {
  return trigger.closest('.player-shell') ?? document.body
}

function playerFrameUrl(session) {
  const parameters = appendClientDiagnosticsParameters(new URLSearchParams({
    id: session.gameId,
    profileId: session.profileId,
    sessionId: session.sessionId,
    leaseGeneration: String(session.leaseGeneration),
    fastForward: session.initialFastForwardEnabled ? '1' : '0',
    fastForwardSpeed: String(session.initialFastForwardSpeed),
    muted: session.initialMuted ? '1' : '0',
    restoreRecovery: session.restoreRecovery ? '1' : '0',
    localRecoveryPrompt: session.localRecoveryPrompt ? '1' : '0',
    ...(session.localRecoveryPrompt?.candidateId ? { localRecoveryCandidateId: session.localRecoveryPrompt.candidateId } : {}),
  }), clientDiagnosticsOptions)
  if (playerOriginPorts.length === 0 || !Number.isInteger(session.playerOriginSlot)) return `/player.html?${parameters}`
  parameters.set('hubOrigin', window.location.origin)
  return `${playerOriginForSlot(window.location, session.playerOriginSlot, playerOriginPorts)}/player.html?${parameters}`
}

function ControlBinding({ control, profile, captureTarget, onCapture }) {
  const binding = profile.bindings[control.id]
  const isCapturingKeyboard = captureTarget?.id === control.id && captureTarget.kind === 'keyboard'
  const isCapturingGamepad = captureTarget?.id === control.id && captureTarget.kind === 'gamepad'

  return <div className={`gba-binding gba-binding-${control.id}`}>
    <strong>{control.label}</strong>
    <button type="button" className="binding-field" onClick={() => onCapture(control.id, 'keyboard')}>
      {isCapturingKeyboard ? 'Pressione uma tecla' : binding.keyboard}
    </button>
    <button type="button" className="binding-field" onClick={() => onCapture(control.id, 'gamepad')}>
      {isCapturingGamepad ? 'Pressione no joystick' : formatGamepadBinding(binding.gamepad)}
    </button>
  </div>
}

function TriggerBinding({ trigger, profile, captureTarget, onCapture }) {
  const captureId = `trigger:${trigger.id}`
  const isCapturing = captureTarget?.id === captureId && captureTarget.kind === 'gamepad'

  return <div className="trigger-binding">
    <strong>{trigger.label}</strong>
    <button type="button" className="binding-field" onClick={() => onCapture(captureId, 'gamepad')}>
      {isCapturing ? 'Pressione no joystick' : formatGamepadBinding(profile.triggerBindings[trigger.id])}
    </button>
  </div>
}

function SnapshotRestorePrompt({ request, onRestore, onContinue }) {
  const ready = Boolean(request.requestId)
  const [selectedCandidateId, setSelectedCandidateId] = useState(null)
  const candidates = request.candidates ?? []
  const selectedCandidateAvailable = candidates.some(candidate => candidate.candidateId === selectedCandidateId)
  return <div className="snapshot-restore-overlay" role="dialog" aria-modal="true" aria-labelledby={`snapshot-restore-title-${request.sessionId}`}>
    <div className="snapshot-restore-card">
      <h2 id={`snapshot-restore-title-${request.sessionId}`}>Estados disponíveis</h2>
      <p>Selecione um snapshot para carregar ou continue sem carregar.</p>
      <div className="snapshot-restore-list" role="group" aria-label="Snapshots disponíveis">
        {candidates.map(candidate => { const view = describeRestoreCandidate(candidate); return <button type="button" className={`snapshot-restore-candidate${selectedCandidateId === candidate.candidateId ? ' is-selected' : ''}`} key={candidate.candidateId} aria-pressed={selectedCandidateId === candidate.candidateId} disabled={!ready || request.resolving} onClick={() => setSelectedCandidateId(candidate.candidateId)}>
          <span className="snapshot-restore-candidate-title">{candidate.kind === 'local-recovery' ? 'Local' : 'Remoto'}</span>
          <span>{view.capture}</span>
        </button> })}
      </div>
      {request.choiceError && <p className="snapshot-restore-error" role="alert">{request.choiceError}</p>}
      <div className="snapshot-restore-actions">
        <button type="button" className="snapshot-restore-primary" disabled={!ready || !selectedCandidateAvailable || request.resolving} onClick={() => onRestore(selectedCandidateId)}>Carregar snapshot</button>
        <button type="button" className="snapshot-restore-secondary" disabled={!ready || request.resolving} onClick={onContinue}>Continuar sem carregar</button>
      </div>
    </div>
  </div>
}

function formatGamepadBinding(value) {
  const labels = {
    SELECT: 'Select',
    START: 'Start',
    LEFT_TOP_SHOULDER: 'L',
    RIGHT_TOP_SHOULDER: 'R',
    LEFT_BOTTOM_SHOULDER: 'L2',
    RIGHT_BOTTOM_SHOULDER: 'R2',
    LEFT_STICK: 'Clique no analógico esquerdo',
    RIGHT_STICK: 'Clique no analógico direito',
    DPAD_UP: 'Direcional ↑',
    DPAD_DOWN: 'Direcional ↓',
    DPAD_LEFT: 'Direcional ←',
    DPAD_RIGHT: 'Direcional →',
  }
  const axis = value.match(/^(LEFT|RIGHT)_STICK_([XY]):([+-]1)$/)
  if (axis) {
    const stick = axis[1] === 'LEFT' ? 'Analógico esquerdo' : 'Analógico direito'
    const direction = axis[2] === 'X' ? (axis[3] === '+1' ? 'direita' : 'esquerda') : (axis[3] === '+1' ? 'baixo' : 'cima')
    return `${stick} ${direction}`
  }
  if (/^BUTTON_\d+$/.test(value)) return `Botão ${value.slice(7)}`
  return labels[value] ?? value
}

function normalizeKeyboardKey(key) {
  const namedKeys = { ArrowUp: 'up arrow', ArrowDown: 'down arrow', ArrowLeft: 'left arrow', ArrowRight: 'right arrow', Enter: 'enter', ' ': 'space' }
  return namedKeys[key] ?? key.toLowerCase()
}

function setControlBinding(profile, id, kind, value) {
  if (id.startsWith('trigger:')) {
    const trigger = id.slice('trigger:'.length)
    return { ...profile, triggerBindings: { ...profile.triggerBindings, [trigger]: value } }
  }
  return {
    ...profile,
    bindings: {
      ...profile.bindings,
      [id]: { ...profile.bindings[id], [kind]: value },
    },
  }
}

function App() {
  const [games, setGames] = useState([])
  const [, setCatalogLoading] = useState(true)
  const [, setCatalogError] = useState('')
  const [activeSessions, setActiveSessions] = useState([])
  const activeSessionsRef = useRef(activeSessions)
  activeSessionsRef.current = activeSessions
  const [focusedSessionId, setFocusedSessionId] = useState(null)
  const selectedPlayerSessionId = activeSessions.some(session => session.sessionId === focusedSessionId) ? focusedSessionId : activeSessions[0]?.sessionId
  const [profileInfoSessionId, setProfileInfoSessionId] = useState(null)
  const [profileInfoName, setProfileInfoName] = useState('')
  const [profileInfoError, setProfileInfoError] = useState('')
  const [profileInfoBusy, setProfileInfoBusy] = useState(false)
  const [userStateAvailable, setUserStateAvailable] = useState({})
  const [playerActionErrors, setPlayerActionErrors] = useState({})
  const [instancePicker, setInstancePicker] = useState(false)
  const [controlPanelOpen, setControlPanelOpen] = useState(false)
  const [profileEditorOpen, setProfileEditorOpen] = useState(false)
  const [controlDraft, setControlDraft] = useState(null)
  const [controlError, setControlError] = useState('')
  const [controlSaving, setControlSaving] = useState(false)
  const [captureTarget, setCaptureTarget] = useState(null)
  const [pokemonHubOpen, setPokemonHubOpen] = useState(false)
  const [pokemonHubCloseSignal, setPokemonHubCloseSignal] = useState(0)
  const [fastForwardEnabled, setFastForwardEnabled] = useState(false)
  const [muted, setMuted] = useState(false)
  const [oddsManipulatorEnabled, setOddsManipulatorEnabled] = useState(false)
  const [fastForwardSpeed, setFastForwardSpeed] = useState(() => readFastForwardSpeed(document.cookie))
  const [l2TriggerAction, setL2TriggerAction] = useState('none')
  const [r2TriggerAction, setR2TriggerAction] = useState('none')
  const [triggerBindings, setTriggerBindings] = useState({
    l2: 'LEFT_BOTTOM_SHOULDER',
    r2: 'RIGHT_BOTTOM_SHOULDER',
  })
  const [profileGame, setProfileGame] = useState(null)
  const [profilePickerPlacement, setProfilePickerPlacement] = useState(null)
  const [profilePurpose, setProfilePurpose] = useState('launch')
  const [profiles, setProfiles] = useState([])
  const [profileName, setProfileName] = useState('')
  const [editingProfileId, setEditingProfileId] = useState(null)
  const [profileEditName, setProfileEditName] = useState('')
  const [creatingProfile, setCreatingProfile] = useState(false)
  const [profileError, setProfileError] = useState('')
  const [profileBusy, setProfileBusy] = useState(false)
  const [snapshotRestoreRequests, setSnapshotRestoreRequests] = useState({})
  const snapshotRestoreRequestsRef = useRef(snapshotRestoreRequests)
  const restoreChoiceTimersRef = useRef(new Map())
  const snapshotDeleteWatchdogRef = useRef(null)
  if (!snapshotDeleteWatchdogRef.current) snapshotDeleteWatchdogRef.current = createSnapshotDeleteWatchdog({
    onTimeout: pending => {
      const request = snapshotRestoreRequestsRef.current[pending.sessionId]
      reportHubSnapshot(request && { ...request, sessionId: pending.sessionId }, 'warn', 'candidate-delete-timeout', { candidateId: pending.candidateId, snapshotKind: pending.kind, reason: 'iframe-no-response' })
      const next = restorePromptAfterDeleteTimeout(snapshotRestoreRequestsRef.current, pending)
      snapshotRestoreRequestsRef.current = next
      setSnapshotRestoreRequests(next)
    },
  })
  useEffect(() => { snapshotRestoreRequestsRef.current = snapshotRestoreRequests }, [snapshotRestoreRequests])
  const [error, setError] = useState('')
  const [installHelpOpen, setInstallHelpOpen] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [saveCloseRows, setSaveCloseRows] = useState(null)
  const saveCloseCoordinatorRef = useRef(null)
  const closeBatchSessionIdsRef = useRef([])
  const [closeChooserOpen, setCloseChooserOpen] = useState(false)
  const [selectedCloseSessionIds, setSelectedCloseSessionIds] = useState(new Set())
  const closeLockRef = useRef(false)
  const closeLockRevisionRef = useRef(0)
  const globalGamepadGateRef = useRef(null)
  if (!globalGamepadGateRef.current) globalGamepadGateRef.current = createGamepadInputGate()
  const profileInfoLockSessionIdRef = useRef(null)
  const profileInfoGamepadGatesRef = useRef(new Map())
  const [viewport, setViewport] = useState(readViewport)
  const playerShellRef = useRef(null)
  const profilePickerRequestRef = useRef(0)
  const lastInstanceGameIdRef = useRef(null)
  const preferenceWriteRef = useRef(Promise.resolve())
  const muteRevisionRef = useRef(0)
  const fastForwardToggleRef = useRef(Promise.resolve())
  const confirmedPreferencesRef = useRef({ fastForwardSpeed, fastForwardEnabled: false, muted: false, triggerActions: { l2: 'none', r2: 'none' } })
  const oddsSyncRef = useRef(new Map())
  const oddsClockReadyRef = useRef(new Map())
  const oddsResetQueueRef = useRef(new Map())

  useEffect(() => {
    if (activeSessions.length === 0) lastInstanceGameIdRef.current = null
  }, [activeSessions.length])

  useEffect(() => {
    const live = new Set(activeSessions.map(session => session.sessionId))
    for (const sessionId of profileInfoGamepadGatesRef.current.keys()) if (!live.has(sessionId)) profileInfoGamepadGatesRef.current.delete(sessionId)
    if (profileInfoSessionId && !activeSessions.some(session => session.sessionId === profileInfoSessionId)) setProfileInfoSessionId(null)
  }, [activeSessions, profileInfoSessionId])

  function setPlayerInteractionLocked(locked) {
    if (closeLockRef.current !== locked || profileInfoLockSessionIdRef.current !== profileInfoSessionId) closeLockRevisionRef.current += 1
    if (locked && !closeLockRef.current) globalGamepadGateRef.current.lock()
    else if (!locked && closeLockRef.current) {
      if (activeSessionsRef.current.length === 0) globalGamepadGateRef.current.reset()
      else globalGamepadGateRef.current.unlock(activeGamepadBindings(readGamepadSnapshot()))
    }
    else if (!locked && activeSessionsRef.current.length === 0) globalGamepadGateRef.current.reset()
    closeLockRef.current = locked
    profileInfoLockSessionIdRef.current = profileInfoSessionId
    for (const frame of document.querySelectorAll('.player-grid iframe')) {
      const frameLocked = locked || frame.closest('.player-cell')?.dataset.sessionId === profileInfoSessionId
      sendPlayerInteractionLock(frame, frameLocked)
      if (frameLocked) configurePlayerFrame(frame, { type: 'emulator-hub:gamepad', bindings: [] })
    }
  }

  function sendPlayerInteractionLock(frame, locked) {
    const sessionId = frame.closest('.player-cell')?.dataset.sessionId
    if (!sessionId) return
    const revision = closeLockRevisionRef.current
    const isCurrent = () => frame.isConnected !== false && frame.closest('.player-cell')?.dataset.sessionId === sessionId && closeLockRevisionRef.current === revision
    void deliverPlayerInteractionLock({ revision, isCurrent, send: () => requestPlayerFrame({ frame, browser: window, sessionId, type: 'emulator-hub:interaction-lock', replyType: 'emulator-hub:interaction-lock-applied', details: { locked, revision }, timeoutMs: 1000 }) })
      .catch(error => reportHubSnapshot(activeSessionsRef.current.find(session => session.sessionId === sessionId), 'warn', 'interaction-lock-unconfirmed', { reason: error.message }))
  }

  useLayoutEffect(() => {
    setPlayerInteractionLocked(closeChooserOpen || saveCloseRows !== null)
  }, [closeChooserOpen, saveCloseRows !== null, activeSessions.length, profileInfoSessionId])

  useEffect(() => {
    if (!closeChooserOpen) return
    const live = new Set(activeSessions.map(session => session.sessionId))
    setSelectedCloseSessionIds(current => {
      const next = new Set([...current].filter(sessionId => live.has(sessionId)))
      return next.size === current.size ? current : next
    })
    if (live.size === 0) setCloseChooserOpen(false)
  }, [activeSessions, closeChooserOpen])

  useEffect(() => {
    let active = true
    const muteRevision = muteRevisionRef.current
    getUserPreferences().then(({ preferences, initialized }) => {
      if (!active) return
      const speed = initialized ? preferences.fastForwardSpeed : readFastForwardSpeed(document.cookie)
      const enabled = initialized ? preferences.fastForwardEnabled : false
      setFastForwardSpeed(speed)
      setFastForwardEnabled(enabled)
      if (muteRevision === muteRevisionRef.current) setMuted(preferences.muted)
      setL2TriggerAction(preferences.triggerActions.l2)
      setR2TriggerAction(preferences.triggerActions.r2)
      confirmedPreferencesRef.current = { fastForwardSpeed: speed, fastForwardEnabled: enabled, muted: muteRevision === muteRevisionRef.current ? preferences.muted : confirmedPreferencesRef.current.muted, triggerActions: { ...preferences.triggerActions } }
      if (!initialized && /(?:^|;\s*)emulator_hub_fast_forward_speed=/.test(document.cookie)) void saveUserPreferences({ fastForwardSpeed: speed, initializeIfAbsent: true })
      else if (initialized) document.cookie = 'emulator_hub_fast_forward_speed=; Path=/; Max-Age=0; SameSite=Lax'
    }).catch(() => {})
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    getControlProfile().then(profile => {
      if (active) setTriggerBindings(profile.triggerBindings)
    }).catch(() => {})
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    setCatalogLoading(true)
    getGames()
      .then(catalog => {
        if (!active) return
        setGames(catalog)
        setCatalogError('')
      })
      .catch(cause => {
        if (!active) return
        setCatalogError(cause.message)
        setError(cause.message)
      })
      .finally(() => { if (active) setCatalogLoading(false) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    const updateViewport = () => setViewport(readViewport())
    window.addEventListener('resize', updateViewport)
    window.addEventListener('orientationchange', updateViewport)
    window.visualViewport?.addEventListener('resize', updateViewport)
    return () => {
      window.removeEventListener('resize', updateViewport)
      window.removeEventListener('orientationchange', updateViewport)
      window.visualViewport?.removeEventListener('resize', updateViewport)
    }
  }, [])

  useEffect(() => {
    const receive = event => {
      const trustedFrame = findTrustedPlayerFrame(event, document.querySelectorAll('.player-cell iframe'), window.location.origin)
      if (!trustedFrame) return
      if (event.data?.type === 'emulator-hub:local-storage-request') {
        const session = activeSessionsRef.current.find(candidate => trustedFrame.closest('.player-cell')?.dataset.sessionId === candidate.sessionId)
        if (session) void respondToPlayerStorageRequest(event, { frame: trustedFrame, session, storage: localRecoveryStorage, installationIdentity: event.data.operation === 'installation-identity' ? getInstallationIdentity() : null, origin: event.origin })
        return
      }
      if (event.data?.type === 'emulator-hub:snapshot-restore-request') {
        if (typeof event.data.requestId !== 'string' || event.data.kind !== 'candidate-list' || !Array.isArray(event.data.candidates) || event.data.candidates.length === 0) return
        const frame = [...document.querySelectorAll('.player-cell iframe')].find(candidate => candidate.contentWindow === event.source)
        const session = activeSessions.find(candidate => frame?.closest('.player-cell')?.dataset.sessionId === candidate.sessionId)
        if (!session) return
        if (event.data.sessionId !== session.sessionId || event.data.gameId !== session.gameId || event.data.profileId !== session.profileId) return
        clearRestoreChoiceTimer(session.sessionId)
        setSnapshotRestoreRequests(current => ({ ...current, [session.sessionId]: {
          sessionId: session.sessionId,
          gameId: session.gameId,
          profileId: session.profileId,
          requestId: event.data.requestId,
          candidates: event.data.candidates,
          candidateId: null,
        } }))
        return
      }
      if (event.data?.type === 'emulator-hub:user-state-availability') {
        const frame = [...document.querySelectorAll('.player-cell iframe')].find(candidate => candidate.contentWindow === event.source)
        const session = activeSessions.find(candidate => frame?.closest('.player-cell')?.dataset.sessionId === candidate.sessionId)
        if (!session || event.data.sessionId !== session.sessionId || event.data.gameId !== session.gameId || event.data.profileId !== session.profileId || typeof event.data.available !== 'boolean') return
        setUserStateAvailable(current => ({ ...current, [session.sessionId]: event.data.available }))
        return
      }
      if (event.data?.type === 'emulator-hub:player-action-failed') {
        const frame = [...document.querySelectorAll('.player-cell iframe')].find(candidate => candidate.contentWindow === event.source)
        const session = activeSessions.find(candidate => frame?.closest('.player-cell')?.dataset.sessionId === candidate.sessionId)
        if (!session || event.data.sessionId !== session.sessionId || event.data.gameId !== session.gameId || event.data.profileId !== session.profileId) return
        const message = playerActionFailureMessages[event.data.action]
        if (!message) return
        setPlayerActionErrors(current => ({ ...current, [session.sessionId]: [...(current[session.sessionId] ?? []), message].slice(-3) }))
        return
      }
      if (event.data?.type === 'emulator-hub:player-focused') {
        const frame = [...document.querySelectorAll('.player-cell iframe')].find(candidate => candidate.contentWindow === event.source)
        const session = activeSessions.find(candidate => frame?.closest('.player-cell')?.dataset.sessionId === candidate.sessionId)
        if (session && event.data.sessionId === session.sessionId && event.data.gameId === session.gameId && event.data.profileId === session.profileId) setFocusedSessionId(session.sessionId)
        return
      }
      if (event.data?.type === 'emulator-hub:snapshot-restore-settled' || event.data?.type === 'emulator-hub:snapshot-restore-stale') {
        const frame = [...document.querySelectorAll('.player-cell iframe')].find(candidate => candidate.contentWindow === event.source)
        const session = activeSessions.find(candidate => frame?.closest('.player-cell')?.dataset.sessionId === candidate.sessionId)
        if (!session || event.data.sessionId !== session.sessionId || event.data.gameId !== session.gameId || event.data.profileId !== session.profileId) return
        const timer = restoreChoiceTimersRef.current.get(session.sessionId)
        const request = snapshotRestoreRequestsRef.current[session.sessionId]
        if (!timer || !request || timer.requestId !== event.data.requestId || timer.choiceAttemptId !== event.data.choiceAttemptId || request.selectedCandidateId !== event.data.candidateId || (event.data.type === 'emulator-hub:snapshot-restore-stale' && !Array.isArray(event.data.candidates))) return
        if (event.data.type === 'emulator-hub:snapshot-restore-settled' && event.data.appliedCandidateId !== request.selectedCandidateId) return
        window.clearTimeout(timer.timer)
        restoreChoiceTimersRef.current.delete(session.sessionId)
        if (event.data.type === 'emulator-hub:snapshot-restore-settled') {
          const next = { ...snapshotRestoreRequestsRef.current }; delete next[session.sessionId]; snapshotRestoreRequestsRef.current = next
          setSnapshotRestoreRequests(current => { const updated = { ...current }; delete updated[session.sessionId]; return updated })
        } else {
          reportHubSnapshot(session, 'warn', 'restore-choice-stale', { candidateId: request.selectedCandidateId, reason: 'candidate-changed' })
          const updated = { ...request, candidates: event.data.candidates, choiceError: 'O estado escolhido mudou ou foi excluído antes da restauração. Feche o emulador e abra novamente para escolher.' }
          snapshotRestoreRequestsRef.current = { ...snapshotRestoreRequestsRef.current, [session.sessionId]: updated }
          setSnapshotRestoreRequests(current => ({ ...current, [session.sessionId]: updated }))
        }
        return
      }
      if (event.data?.type === 'emulator-hub:snapshot-candidate-delete-result') {
        if (typeof event.data.requestId !== 'string' || typeof event.data.restoreRequestId !== 'string') return
        const frame = [...document.querySelectorAll('.player-cell iframe')].find(candidate => candidate.contentWindow === event.source)
        const session = activeSessions.find(candidate => frame?.closest('.player-cell')?.dataset.sessionId === candidate.sessionId)
        if (!session || event.data.sessionId !== session.sessionId || event.data.gameId !== session.gameId || event.data.profileId !== session.profileId) return
        const settled = snapshotDeleteWatchdogRef.current.settle(event.data)
        const request = snapshotRestoreRequestsRef.current[session.sessionId]
        if (!request || request.requestId !== event.data.restoreRequestId) return
        const late = !settled && canReconcileLateSnapshotDelete(request, event.data)
        if (!late && (!settled || request.deleteRequestId !== event.data.requestId)) return
        if (event.data.ok) {
          const candidates = request.candidates.filter(candidate => candidate.candidateId !== event.data.candidateId)
          if (candidates.length === 0) respondToRestore(session.sessionId, request.requestId, null, true)
          else {
            const updated = { ...request, candidates, deleting: false, deleteRequestId: null, timedOutDeleteRequestId: null, candidateId: null, deleteError: null }
            snapshotRestoreRequestsRef.current = { ...snapshotRestoreRequestsRef.current, [session.sessionId]: updated }
            setSnapshotRestoreRequests(current => ({ ...current, [session.sessionId]: updated }))
          }
          return
        }
        const updated = {
          ...request,
          deleting: false,
          deleteRequestId: null,
          timedOutDeleteRequestId: null,
          candidateId: null,
          candidates: event.data.currentCandidate ? request.candidates.map(candidate => candidate.candidateId === event.data.candidateId ? event.data.currentCandidate : candidate) : request.candidates,
          deleteError: event.data.error || 'Não foi possível excluir este estado. Ele continua disponível.',
        }
        snapshotRestoreRequestsRef.current = { ...snapshotRestoreRequestsRef.current, [session.sessionId]: updated }
        setSnapshotRestoreRequests(current => ({ ...current, [session.sessionId]: updated }))
        return
      }
      if (event.data?.type === 'emulator-hub:odds-manipulator-ready') {
        if (!event.data.sessionId || !event.data.accepted) return
        const sessionIndex = activeSessions.findIndex(candidate => candidate.sessionId === event.data.sessionId)
        const frame = sessionIndex === -1 ? null : document.querySelectorAll('.player-grid iframe')[sessionIndex]
        if (!frame || event.source !== frame.contentWindow) return
        oddsClockReadyRef.current.set(event.data.sessionId, { oddsResetCount: event.data.oddsResetCount, virtualTimestamp: event.data.virtualTimestamp })
        return
      }
      if (event.data?.type !== 'emulator-hub:lease-lost') return
      if (!event.data.unavailable && event.data.sessionId && event.data.profileId && event.data.gameId && Number.isInteger(event.data.generation)) {
        void releasePlayerLease(event.data.sessionId, { profileId: event.data.profileId, gameId: event.data.gameId, generation: event.data.generation, preserveRecovery: true }).catch(() => {})
      }
      oddsSyncRef.current.get(event.data.sessionId)?.stop()
      oddsSyncRef.current.delete(event.data.sessionId)
      snapshotDeleteWatchdogRef.current.cancel(event.data.sessionId)
      clearRestoreChoiceTimer(event.data.sessionId)
      setActiveSessions(current => current.filter(session => session.sessionId !== event.data.sessionId))
      setSnapshotRestoreRequests(current => { const next = { ...current }; delete next[event.data.sessionId]; return next })
      setError('A sessão do emulador foi substituída ou expirou.')
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [activeSessions])

  useEffect(() => () => {
    snapshotDeleteWatchdogRef.current?.clear()
    for (const pending of restoreChoiceTimersRef.current.values()) window.clearTimeout(pending.timer)
    restoreChoiceTimersRef.current.clear()
  }, [])

  useEffect(() => {
    const live = new Set(activeSessions.map(session => session.sessionId))
    for (const sessionId of restoreChoiceTimersRef.current.keys()) if (!live.has(sessionId)) clearRestoreChoiceTimer(sessionId)
  }, [activeSessions])

  useEffect(() => {
    if (!profileGame) return undefined
    let active = true
    const refreshProfiles = async () => {
      try {
        const currentProfiles = await getProfiles(profileGame.id)
        if (!active) return
        setProfiles(currentProfiles)
        updateCachedProfiles(profileGame.id, () => currentProfiles)
      } catch {
        // Keep the last known list visible if a background refresh fails.
      }
    }
    const interval = window.setInterval(refreshProfiles, 3_000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [profileGame])

  useEffect(() => {
    let active = true
    let revision = null
    const checkFrontendRevision = async () => {
      if (document.visibilityState === 'hidden') return
      try {
        const response = await fetch('/', { method: 'HEAD', cache: 'no-store' })
        const nextRevision = response.headers.get('etag')
        if (!active || !nextRevision) return
        if (shouldReloadForFrontendRevision(revision, nextRevision)) {
          window.location.reload()
          return
        }
        revision = nextRevision
      } catch {
        // A temporary offline state must not disrupt an active game.
      }
    }
    void checkFrontendRevision()
    document.addEventListener('visibilitychange', checkFrontendRevision)
    return () => {
      active = false
      document.removeEventListener('visibilitychange', checkFrontendRevision)
    }
  }, [])

  useEffect(() => {
    if (!activeSessions.length && !profileGame && !instancePicker && !controlPanelOpen && !profileEditorOpen && !pokemonHubOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const syncFullscreen = () => setFullscreen(document.fullscreenElement === playerShellRef.current)
    const onKeyDown = event => {
      if (event.key === 'Escape' && closeChooserOpen) {
        cancelCloseChooser()
      } else if (event.key === 'Escape' && !document.fullscreenElement) {
        if (controlPanelOpen) {
          setControlPanelOpen(false)
          setCaptureTarget(null)
        } else if (profileEditorOpen) return
        else if (pokemonHubOpen) setPokemonHubCloseSignal(current => current + 1)
        else if (profileGame) {
          setProfileGame(null)
          setInstancePicker(false)
          setProfilePickerPlacement(null)
          setCreatingProfile(false)
        }
        else if (instancePicker) setInstancePicker(false)
        else if (!saveCloseCoordinatorRef.current) void closePlayer()
      }
    }
    document.addEventListener('fullscreenchange', syncFullscreen)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('fullscreenchange', syncFullscreen)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [activeSessions.length, controlPanelOpen, profileEditorOpen, instancePicker, profileGame, pokemonHubOpen, closeChooserOpen])

  useEffect(() => {
    if (!captureTarget) return
    if (captureTarget.kind === 'keyboard') {
      const captureKeyboard = event => {
        event.preventDefault()
        setControlDraft(current => setControlBinding(current, captureTarget.id, 'keyboard', normalizeKeyboardKey(event.key)))
        setCaptureTarget(null)
      }
      document.addEventListener('keydown', captureKeyboard)
      return () => document.removeEventListener('keydown', captureKeyboard)
    }

    let interval
    let previousSnapshot = captureTarget.baseline
    const captureStartsAt = performance.now() + 150
    const captureGamepad = () => {
      const snapshot = readGamepadSnapshot()
      const value = performance.now() >= captureStartsAt
        ? readGamepadBinding(previousSnapshot, snapshot)
        : null
      if (value) {
        setControlDraft(current => setControlBinding(current, captureTarget.id, 'gamepad', value))
        setCaptureTarget(null)
        return
      }
      previousSnapshot = snapshot
    }
    interval = window.setInterval(captureGamepad, 16)
    return () => window.clearInterval(interval)
  }, [captureTarget])

  useEffect(() => {
    if (!activeSessions.length) return
    const triggerActions = createPlayerTriggerActions({ dispatch: message => {
      if (message === 'emulator-hub:reset' || message === 'emulator-hub:soft-reset') dispatchReset(message)
      else broadcastPlayerMessage(message)
    }, toggleFastForward: () => { void toggleFastForwardFromFirstFrame() } })
    const broadcast = bindings => {
      for (const frame of document.querySelectorAll('.player-grid iframe')) {
        const sessionId = frame.closest('.player-cell')?.dataset.sessionId
        const gate = profileInfoGamepadGatesRef.current.get(sessionId)
        const frameBindings = sessionId === profileInfoSessionId ? [] : gate ? gate.filter(bindings) : bindings
        configurePlayerFrame(frame, { type: 'emulator-hub:gamepad', bindings: frameBindings })
      }
    }
    // Poll the parent document so changing window focus does not silence
    // controllers. A full snapshot also reaches newly loaded frames.
    const poll = () => {
      const startedAt = hubPerformance ? performance.now() : 0
      const observedBindings = activeGamepadBindings(readGamepadSnapshot())
      const globallyAllowed = globalGamepadGateRef.current.filter(observedBindings)
      const bindings = controlPanelOpen || profileGame || instancePicker || closeLockRef.current ? [] : globallyAllowed
      const selectedGate = profileInfoGamepadGatesRef.current.get(selectedPlayerSessionId)
      const actionBindings = selectedPlayerSessionId === profileInfoSessionId ? [] : selectedGate ? selectedGate.filter(bindings) : bindings
      triggerActions.update(actionBindings, { l2: l2TriggerAction, r2: r2TriggerAction }, triggerBindings)
      broadcast(bindings)
      hubPerformance?.recordGamepad(performance.now() - startedAt)
    }
    poll()
    const interval = window.setInterval(poll, 16)
    document.addEventListener('visibilitychange', poll)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', poll)
      for (const frame of document.querySelectorAll('.player-grid iframe')) configurePlayerFrame(frame, { type: 'emulator-hub:gamepad', bindings: [] })
    }
  }, [activeSessions.length, controlPanelOpen, profileGame, instancePicker, l2TriggerAction, r2TriggerAction, triggerBindings, oddsManipulatorEnabled, profileInfoSessionId, selectedPlayerSessionId])

  useEffect(() => {
    const message = { type: 'emulator-hub:fast-forward', enabled: fastForwardEnabled, speed: fastForwardSpeed }
    const frames = [...document.querySelectorAll('.player-grid iframe')]
    for (const [index, frame] of frames.entries()) {
      configurePlayerFrame(frame, message)
      configurePlayerFrame(frame, { type: 'emulator-hub:mute', muted })
      const session = activeSessions[index]
      if (session && oddsManipulatorEnabled) void configureOddsClock(frame, session, session.oddsResetCount ?? 0, (session.oddsResetCount ?? 0) * 60_000)
      else if (session) configurePlayerFrame(frame, { type: 'emulator-hub:odds-manipulator-configure', enabled: false })
    }
  }, [activeSessions, fastForwardEnabled, fastForwardSpeed, muted, oddsManipulatorEnabled])

  async function saveUserPreferences(partial) {
    const muteRevision = muteRevisionRef.current
    preferenceWriteRef.current = preferenceWriteRef.current.catch(() => {}).then(async () => {
      const result = await updateUserPreferences(partial)
      setFastForwardSpeed(result.preferences.fastForwardSpeed)
      setFastForwardEnabled(result.preferences.fastForwardEnabled)
      if (muteRevision === muteRevisionRef.current) setMuted(result.preferences.muted)
      setL2TriggerAction(result.preferences.triggerActions.l2)
      setR2TriggerAction(result.preferences.triggerActions.r2)
      confirmedPreferencesRef.current = { fastForwardSpeed: result.preferences.fastForwardSpeed, fastForwardEnabled: result.preferences.fastForwardEnabled, muted: result.preferences.muted, triggerActions: { ...result.preferences.triggerActions } }
      document.cookie = 'emulator_hub_fast_forward_speed=; Path=/; Max-Age=0; SameSite=Lax'
      return result
    }).catch(cause => {
      const confirmed = confirmedPreferencesRef.current
      setFastForwardSpeed(confirmed.fastForwardSpeed)
      setFastForwardEnabled(confirmed.fastForwardEnabled)
      if (muteRevision === muteRevisionRef.current) setMuted(confirmed.muted)
      setL2TriggerAction(confirmed.triggerActions.l2)
      setR2TriggerAction(confirmed.triggerActions.r2)
      setError(cause.message)
      throw cause
    })
    return preferenceWriteRef.current
  }

  function toggleFastForward() {
    const enabled = !fastForwardEnabled
    setFastForwardEnabled(enabled)
    void saveUserPreferences({ fastForwardEnabled: enabled })
  }

  function toggleFastForwardFromFirstFrame() {
    fastForwardToggleRef.current = fastForwardToggleRef.current.then(() => new Promise(resolve => {
      const frame = document.querySelector('.player-grid iframe')
      if (!frame?.contentWindow) { resolve(); return }
      const requestId = `${Date.now()}-${Math.random()}`
      const finish = () => { window.clearTimeout(timeout); window.removeEventListener('message', receive); resolve() }
      const receive = event => {
        if (event.origin !== frameOrigin(frame, window.location.origin) || event.source !== frame.contentWindow || event.data?.type !== 'emulator-hub:fast-forward-state' || event.data.requestId !== requestId || typeof event.data.enabled !== 'boolean') return
        if (document.querySelector('.player-grid iframe') !== frame) { finish(); return }
        const enabled = !event.data.enabled
        setFastForwardEnabled(enabled)
        void saveUserPreferences({ fastForwardEnabled: enabled })
        const message = { type: 'emulator-hub:fast-forward', enabled, speed: fastForwardSpeed }
        for (const activeFrame of document.querySelectorAll('.player-grid iframe')) configurePlayerFrame(activeFrame, message)
        finish()
      }
      const timeout = window.setTimeout(finish, 1000)
      window.addEventListener('message', receive)
      configurePlayerFrame(frame, { type: 'emulator-hub:get-fast-forward-state', requestId })
    })).catch(() => {})
    return fastForwardToggleRef.current
  }

  async function toggleFullscreen() {
    if (isMobileLandscape) return
    try {
      if (document.fullscreenElement === playerShellRef.current) await document.exitFullscreen()
      else await playerShellRef.current.requestFullscreen()
    } catch (cause) {
      setError(cause.message)
    }
  }

  function dispatchReset(type) {
    const frames = [...document.querySelectorAll('.player-grid iframe')]
    activeSessionsRef.current.forEach((session, index) => {
      const frame = frames[index]
      if (!frame) return
      if (!oddsManipulatorEnabled) {
        configurePlayerFrame(frame, { type })
        return
      }
      const nextCount = (session.oddsResetCount ?? 0) + 1
      const nextTimestamp = nextCount * 60_000
      session.oddsResetCount = nextCount
      const run = async () => {
        const configured = await configureOddsClock(frame, session, nextCount, nextTimestamp)
        if (!configured) {
          clientDiagnostics?.capture({ kind: 'odds-manipulator', message: 'odds.reset.clock-not-ready', gameId: session.gameId, profileId: session.profileId, sessionId: session.sessionId, resetType: type, oddsResetCount: nextCount, virtualTimestamp: nextTimestamp })
          return
        }
        const diagnostic = { kind: 'odds-manipulator', message: 'odds.reset.applied', gameId: session.gameId, profileId: session.profileId, sessionId: session.sessionId, resetType: type, oddsResetCount: nextCount, virtualTimestamp: nextTimestamp }
        clientDiagnostics?.capture(diagnostic)
        console.info('[odds-manipulator]', diagnostic)
        configurePlayerFrame(frame, { type, oddsResetCount: nextCount, virtualTimestamp: nextTimestamp })
        oddsSyncRef.current.get(session.sessionId)?.markDirty(nextCount)
      }
      const queued = (oddsResetQueueRef.current.get(session.sessionId) ?? Promise.resolve()).catch(() => {}).then(run)
      oddsResetQueueRef.current.set(session.sessionId, queued)
    })
    setActiveSessions(current => current.map(session => ({ ...session })))
  }

  function configureOddsClock(frame, session, oddsResetCount, virtualTimestamp) {
    const ready = oddsClockReadyRef.current.get(session.sessionId)
    if (ready?.oddsResetCount === oddsResetCount && ready.virtualTimestamp === virtualTimestamp) return Promise.resolve(true)
    return new Promise(resolve => {
      const requestId = crypto.randomUUID()
      let settled = false
      const finish = result => {
        if (settled) return
        settled = true
        window.clearTimeout(timeout)
        window.removeEventListener('message', receive)
        if (result) oddsClockReadyRef.current.set(session.sessionId, { oddsResetCount, virtualTimestamp })
        resolve(result)
      }
      const receive = event => {
        if (event.origin !== frameOrigin(frame, window.location.origin) || event.source !== frame.contentWindow || event.data?.type !== 'emulator-hub:odds-manipulator-ready' || event.data.requestId !== requestId) return
        finish(event.data.accepted === true && event.data.oddsResetCount === oddsResetCount && event.data.virtualTimestamp === virtualTimestamp)
      }
      const timeout = window.setTimeout(() => finish(false), 2_000)
      window.addEventListener('message', receive)
      configurePlayerFrame(frame, { type: 'emulator-hub:odds-manipulator-configure', enabled: true, sessionId: session.sessionId, requestId, oddsResetCount, virtualTimestamp })
    })
  }

  function toggleMute() {
    const nextMuted = !muted
    muteRevisionRef.current += 1
    setMuted(nextMuted)
    void saveUserPreferences({ muted: nextMuted }).catch(() => {})
  }

  function configurePlayerFrameOnLoad(frame, session) {
    hubPerformance?.frameLoaded(session.sessionId)
    sendPlayerInteractionLock(frame, closeLockRef.current || profileInfoSessionId === session.sessionId)
    configurePlayerFrame(frame, { type: 'emulator-hub:fast-forward', enabled: fastForwardEnabled, speed: fastForwardSpeed })
    configurePlayerFrame(frame, { type: 'emulator-hub:mute', muted })
    if (oddsManipulatorEnabled) void configureOddsClock(frame, session, session.oddsResetCount ?? 0, (session.oddsResetCount ?? 0) * 60_000)
  }

  function toggleOddsManipulator() {
    const enabled = !oddsManipulatorEnabled
    setOddsManipulatorEnabled(enabled)
    clientDiagnostics?.capture({ kind: 'odds-manipulator', message: enabled ? 'odds.toggle.enabled' : 'odds.toggle.disabled', activeProfiles: activeSessions.map(session => ({ gameId: session.gameId, profileId: session.profileId, oddsResetCount: session.oddsResetCount ?? 0 })) })
    const frames = [...document.querySelectorAll('.player-grid iframe')]
    activeSessions.forEach((session, index) => {
      const frame = frames[index]
      if (!frame) return
      if (enabled) {
        void configureOddsClock(frame, session, session.oddsResetCount ?? 0, (session.oddsResetCount ?? 0) * 60_000)
      } else {
        oddsClockReadyRef.current.delete(session.sessionId)
        void oddsSyncRef.current.get(session.sessionId)?.flush()
        configurePlayerFrame(frame, { type: 'emulator-hub:odds-manipulator-configure', enabled: false })
      }
    })
  }

  function disableOddsManipulator() {
    setOddsManipulatorEnabled(false)
    const frames = [...document.querySelectorAll('.player-grid iframe')]
    activeSessions.forEach((session, index) => {
      oddsClockReadyRef.current.delete(session.sessionId)
      void oddsSyncRef.current.get(session.sessionId)?.flush()
      configurePlayerFrame(frames[index], { type: 'emulator-hub:odds-manipulator-configure', enabled: false })
    })
  }

  function cancelCloseChooser() {
    setCloseChooserOpen(false)
    setSelectedCloseSessionIds(new Set())
  }

  function closePlayer() {
    if (saveCloseCoordinatorRef.current || closeChooserOpen || activeSessions.length === 0) return
    if (activeSessions.length > 1) {
      setPlayerInteractionLocked(true)
      setSelectedCloseSessionIds(new Set(activeSessions.map(session => session.sessionId)))
      setCloseChooserOpen(true)
      return
    }
    void closeSessions([activeSessions[0].sessionId])
  }

  async function closeSessions(sessionIds) {
    if (saveCloseCoordinatorRef.current) return
    const selected = activeSessionsRef.current.filter(session => sessionIds.includes(session.sessionId))
    if (selected.length === 0) return
    setPlayerInteractionLocked(true)
    const preferenceSync = selected.length === activeSessionsRef.current.length
      ? saveUserPreferences({ fastForwardSpeed, fastForwardEnabled, muted, triggerActions: { l2: l2TriggerAction, r2: r2TriggerAction } }).catch(() => {})
      : Promise.resolve()
    closeBatchSessionIdsRef.current = selected.map(session => session.sessionId)
    const tasks = selected.map(session => ({
      id: `${session.gameId}:${session.profileId}`,
      label: `${session.gameTitle ?? session.gameId} | ${session.profileName ?? session.profileId}`,
      run: async () => {
        const frame = [...document.querySelectorAll('.player-cell')].find(cell => cell.dataset.sessionId === session.sessionId)?.querySelector('iframe')
        if (!frame) throw new Error('iframe do emulador não encontrado')
        await oddsSyncRef.current.get(session.sessionId)?.flush()
        const closeResult = await flushPlayerSave(frame)
        if (!closeResult.preserveRecovery) {
          try { await clearPlayerRecovery(frame) }
          catch (error) { reportHubSnapshot(session, 'warn', 'local-recovery-delete-failed', { snapshotKind: 'local-recovery', phase: 'close', code: error.code, error: error.message }) }
        }
        await releasePlayerLease(session.sessionId, { profileId: session.profileId, gameId: session.gameId, generation: session.leaseGeneration, preserveRecovery: closeResult.preserveRecovery })
        oddsSyncRef.current.get(session.sessionId)?.stop()
        oddsSyncRef.current.delete(session.sessionId)
      },
    }))
    const coordinator = createMultiSaveCloseCoordinator({ tasks, onUpdate: rows => setSaveCloseRows(rows) })
    saveCloseCoordinatorRef.current = coordinator
    const result = await coordinator.run()
    await preferenceSync
    if (result.every(row => row.status === 'saved')) await finishSelectedPlayerClose()
    return
  }

  async function retryFailedSaves() {
    const coordinator = saveCloseCoordinatorRef.current
    if (!coordinator) return
    const result = await coordinator.retryFailed()
    if (result.every(row => row.status === 'saved')) await finishSelectedPlayerClose()
  }

  async function finishSelectedPlayerClose() {
    const closing = new Set(closeBatchSessionIdsRef.current)
    const remaining = activeSessionsRef.current.filter(session => !closing.has(session.sessionId))
    for (const sessionId of closing) {
      snapshotDeleteWatchdogRef.current.cancel(sessionId)
      clearRestoreChoiceTimer(sessionId)
      oddsSyncRef.current.get(sessionId)?.stop()
      oddsSyncRef.current.delete(sessionId)
      oddsClockReadyRef.current.delete(sessionId)
      oddsResetQueueRef.current.delete(sessionId)
    }
    const removeClosed = current => Object.fromEntries(Object.entries(current).filter(([sessionId]) => !closing.has(sessionId)))
    setSnapshotRestoreRequests(removeClosed)
    snapshotRestoreRequestsRef.current = removeClosed(snapshotRestoreRequestsRef.current)
    setUserStateAvailable(removeClosed)
    setPlayerActionErrors(removeClosed)
    setFocusedSessionId(current => remaining.some(session => session.sessionId === current) ? current : remaining[0]?.sessionId ?? null)
    setCloseChooserOpen(false)
    setSelectedCloseSessionIds(new Set())
    closeBatchSessionIdsRef.current = []
    if (remaining.length > 0) {
      setActiveSessions(current => current.filter(session => !closing.has(session.sessionId)))
      setSaveCloseRows(null)
      saveCloseCoordinatorRef.current = null
      return
    }
    try {
      if (document.fullscreenElement === playerShellRef.current) await document.exitFullscreen()
    } catch {
      // The player still needs to close if the browser rejects leaving fullscreen.
    }
    setActiveSessions([])
    setOddsManipulatorEnabled(false)
    setFullscreen(false)
    setSaveCloseRows(null)
    saveCloseCoordinatorRef.current = null
  }

  function flushPlayerSave(frame) {
    const sessionId = frame.closest('.player-cell')?.dataset.sessionId
    return requestPlayerFrame({ frame, browser: window, sessionId, type: 'emulator-hub:close-player', replyType: 'emulator-hub:save-synced' })
      .then(result => ({ preserveRecovery: result.preserveRecovery === true }), error => { error.transient = true; throw error })
  }

  function clearPlayerRecovery(frame) {
    const sessionId = frame.closest('.player-cell')?.dataset.sessionId
    return requestPlayerFrame({ frame, browser: window, sessionId, type: 'emulator-hub:clear-local-recovery', replyType: 'emulator-hub:local-recovery-cleared', timeoutMs: 5000 })
  }

  async function openProfilePicker(game, purpose = 'launch', anchor = null) {
    const request = ++profilePickerRequestRef.current
    setError('')
    setProfileError('')
    setProfileName('')
    setEditingProfileId(null)
    setCreatingProfile(false)
    setProfilePurpose(purpose)
    setProfilePickerPlacement(getProfilePickerPlacement(anchor, { width: window.innerWidth, height: window.innerHeight }))
    setProfileGame(game)
    setProfiles(game.profiles ?? [])
    try {
      const currentProfiles = await getProfiles(game.id)
      if (request !== profilePickerRequestRef.current) return
      setProfiles(currentProfiles)
      updateCachedProfiles(game.id, () => currentProfiles)
    } catch (cause) {
      if (request !== profilePickerRequestRef.current) return
      setProfileError(cause.message)
    }
  }

  function updateCachedProfiles(gameId, transform) {
    setGames(current => current.map(game => game.id === gameId
      ? { ...game, profiles: transform(game.profiles ?? []) }
      : game))
  }

  async function launchWithProfile(profile) {
    if (profilePurpose === 'add-instance' && activeSessions.length >= MAX_PLAYER_INSTANCES) return
    const game = profileGame
    let candidate = null
    try { candidate = await localRecoveryStore.get(profile.id, game.id) } catch {}
    if (candidate) {
      return startPlayerWithProfile(profile, false, { reason: candidate.reason, candidateId: candidate.candidateId })
    }
    return startPlayerWithProfile(profile, false)
  }

  async function startPlayerWithProfile(profile, restoreRecovery, localRecoveryPrompt = null) {
    setError('')
    setProfileError('')
    setProfileBusy(true)
    try {
      const game = profileGame
      const sessionId = crypto.randomUUID()
      let playerOriginSlot = null
      if (playerOriginPorts.length > 0) {
        playerOriginSlot = await findReachablePlayerOriginSlot(activeSessions, window.location, playerOriginPorts)
        if (playerOriginSlot === null) console.warn('[player-origins] No player port responded; using the Hub origin')
      }
      const lease = await acquirePlayerLease(game.id, profile.id, sessionId)
      if (activeSessions.length === 0) disableOddsManipulator()
      if (profilePurpose !== 'add-instance' || activeSessions.length + 1 >= MAX_PLAYER_INSTANCES) {
        setProfileGame(null)
        setInstancePicker(false)
        setProfilePickerPlacement(null)
      }
      const session = {
        gameId: game.id,
        gameTitle: game.title,
        profileId: profile.id,
        profileName: profile.name,
        oddsResetCount: profile.oddsResetCount ?? 0,
        sessionId,
        leaseGeneration: lease.leaseGeneration,
        initialFastForwardEnabled: fastForwardEnabled,
        initialFastForwardSpeed: fastForwardSpeed,
        initialMuted: muted,
        restoreRecovery,
        localRecoveryPrompt,
        ...(playerOriginSlot !== null ? { playerOriginSlot } : {}),
      }
      oddsSyncRef.current.set(sessionId, createOddsManipulatorSync({
        send: count => syncOddsResetCount(game.id, profile.id, count),
        onError: cause => console.warn('[odds-manipulator] sync failed', { gameId: game.id, profileId: profile.id, error: cause.message }),
        onEvent: (event, context) => clientDiagnostics?.capture({ kind: 'odds-manipulator', message: event, gameId: game.id, profileId: profile.id, sessionId, ...context }),
      }))
      if (profilePurpose === 'add-instance') {
        setActiveSessions(current => current.length >= MAX_PLAYER_INSTANCES ? current : [...current, session])
      } else {
        setActiveSessions([session])
      }
      setFocusedSessionId(sessionId)
    } catch (cause) {
      setProfileError(cause.message)
    } finally {
      setProfileBusy(false)
    }
  }

  function respondToRestore(sessionId, requestId, candidateId, force = false) {
    snapshotDeleteWatchdogRef.current.cancel(sessionId)
    const cell = [...document.querySelectorAll('.player-cell')].find(candidate => candidate.dataset.sessionId === sessionId)
    const session = activeSessions.find(candidate => candidate.sessionId === sessionId)
    const request = snapshotRestoreRequestsRef.current[sessionId]
    const frame = cell?.querySelector('iframe')
    if (!session || !frame?.contentWindow || request?.requestId !== requestId || (request.deleting && !force) || request.resolving) return
    const choiceAttemptId = crypto.randomUUID()
    const updated = { ...request, deleting: false, resolving: true, selectedCandidateId: candidateId, choiceAttemptId, deleteRequestId: null, choiceError: null }
    snapshotRestoreRequestsRef.current = { ...snapshotRestoreRequestsRef.current, [sessionId]: updated }
    setSnapshotRestoreRequests(current => ({ ...current, [sessionId]: updated }))
    const prior = restoreChoiceTimersRef.current.get(sessionId)
    if (prior) window.clearTimeout(prior.timer)
    const choiceMessage = { type: 'emulator-hub:snapshot-restore-response', requestId, choiceAttemptId, sessionId, gameId: session.gameId, profileId: session.profileId, candidateId }
    const retryChoice = () => {
      const pending = restoreChoiceTimersRef.current.get(sessionId)
      const request = snapshotRestoreRequestsRef.current[sessionId]
      if (pending?.choiceAttemptId !== choiceAttemptId || !request?.resolving || request.requestId !== requestId || request.selectedCandidateId !== candidateId) return
      if (!request.choiceError) reportHubSnapshot(session, 'warn', 'restore-ack-timeout', { candidateId: candidateId ?? undefined, reason: 'iframe-no-response' })
      const next = restorePromptAfterChoiceTimeout(snapshotRestoreRequestsRef.current, { sessionId, requestId, candidateId, choiceAttemptId })
      snapshotRestoreRequestsRef.current = next
      setSnapshotRestoreRequests(next)
      configurePlayerFrame(frame, choiceMessage)
      pending.timer = window.setTimeout(retryChoice, 8_000)
    }
    const timer = window.setTimeout(retryChoice, 8_000)
    restoreChoiceTimersRef.current.set(sessionId, { requestId, choiceAttemptId, timer })
    configurePlayerFrame(frame, choiceMessage)
  }

  function clearRestoreChoiceTimer(sessionId) {
    const pending = restoreChoiceTimersRef.current.get(sessionId)
    if (pending) window.clearTimeout(pending.timer)
    restoreChoiceTimersRef.current.delete(sessionId)
  }

  async function submitProfile(event) {
    event.preventDefault()
    setProfileError('')
    setProfileBusy(true)
    try {
      const profile = await createProfile(profileGame.id, profileName)
      setProfiles(current => [...current, profile])
      updateCachedProfiles(profileGame.id, current => [...current, profile])
      await launchWithProfile(profile)
    } catch (cause) {
      setProfileError(cause.message)
      setProfileBusy(false)
    }
  }

  async function removeProfile(profile) {
    if (!window.confirm(`Excluir o perfil "${profile.name}"?`)) return

    setProfileError('')
    setProfileBusy(true)
    try {
      await deleteProfileRequest(profileGame.id, profile.id)
      setProfiles(current => current.filter(candidate => candidate.id !== profile.id))
      updateCachedProfiles(profileGame.id, current => current.filter(candidate => candidate.id !== profile.id))
    } catch (cause) {
      setProfileError(cause.message)
    } finally {
      setProfileBusy(false)
    }
  }

  function startEditingProfile(profile) {
    setProfileError('')
    setProfileEditName(profile.name)
    setEditingProfileId(profile.id)
  }

  async function submitProfileEdit(event, profile) {
    event.preventDefault()
    setProfileError('')
    setProfileBusy(true)
    try {
      const updated = await updateProfile(profileGame.id, profile.id, profileEditName)
      setProfiles(current => current.map(candidate => candidate.id === updated.id ? updated : candidate))
      updateCachedProfiles(profileGame.id, current => replaceCatalogProfile(current, updated))
      setEditingProfileId(null)
    } catch (cause) {
      setProfileError(cause.message)
    } finally {
      setProfileBusy(false)
    }
  }

  function handleGlobalProfileSaved(gameId, updated) {
    updateCachedProfiles(gameId, current => replaceCatalogProfile(current, updated))
    if (profileGame?.id === gameId) setProfiles(current => replaceCatalogProfile(current, updated))
    setActiveSessions(current => current.map(session => session.gameId === gameId && session.profileId === updated.id
      ? { ...session, profileName: updated.name }
      : session))
  }

  function openProfileInfo() {
    const session = activeSessions.find(candidate => candidate.sessionId === focusedSessionId) ?? activeSessions[0]
    if (!session) return
    if (profileInfoSessionId && profileInfoSessionId !== session.sessionId) {
      profileInfoGamepadGatesRef.current.get(profileInfoSessionId)?.unlock(activeGamepadBindings(readGamepadSnapshot()))
    }
    setProfileInfoName(session.profileName ?? '')
    setProfileInfoError('')
    let gate = profileInfoGamepadGatesRef.current.get(session.sessionId)
    if (!gate) {
      gate = createGamepadInputGate()
      profileInfoGamepadGatesRef.current.set(session.sessionId, gate)
    }
    gate.lock()
    setProfileInfoSessionId(session.sessionId)
  }

  function closeProfileInfo() {
    if (profileInfoBusy) return
    profileInfoGamepadGatesRef.current.get(profileInfoSessionId)?.unlock(activeGamepadBindings(readGamepadSnapshot()))
    setProfileInfoSessionId(null)
    setProfileInfoError('')
  }

  async function submitProfileInfo(event) {
    event.preventDefault()
    if (profileInfoBusy) return
    const session = activeSessions.find(candidate => candidate.sessionId === profileInfoSessionId)
    if (!session) return
    setProfileInfoError('')
    setProfileInfoBusy(true)
    try {
      const updated = await updateProfile(session.gameId, session.profileId, profileInfoName)
      setActiveSessions(current => current.map(candidate => candidate.sessionId === session.sessionId ? { ...candidate, profileName: updated.name } : candidate))
      setProfiles(current => current.map(candidate => candidate.id === updated.id ? updated : candidate))
      updateCachedProfiles(session.gameId, current => replaceCatalogProfile(current, updated))
      profileInfoGamepadGatesRef.current.get(session.sessionId)?.unlock(activeGamepadBindings(readGamepadSnapshot()))
      setProfileInfoSessionId(null)
    } catch (cause) {
      setProfileInfoError(cause.message)
    } finally {
      setProfileInfoBusy(false)
    }
  }

  function openInstancePicker() {
    if (isMobileLandscape || activeSessions.length >= MAX_PLAYER_INSTANCES) return
    setError('')
    setInstancePicker(true)
    const readyGames = gameSections.flatMap(section => section.games).filter(game => game.status === 'ready')
    const selectedGame = readyGames.find(game => game.id === lastInstanceGameIdRef.current) ?? readyGames[0]
    if (selectedGame) openProfilePicker(selectedGame, 'add-instance')
    else {
      setInstancePicker(false)
      setError('Não há ROMs prontas para adicionar.')
    }
  }

  async function openControlPanel() {
    setControlError('')
    setCaptureTarget(null)
    setControlPanelOpen(true)
    try {
      const profile = await getControlProfile()
      setControlDraft(structuredClone(profile))
      setTriggerBindings(profile.triggerBindings)
    } catch (cause) {
      setControlError(cause.message)
    }
  }

  function startControlCapture(id, kind) {
    setControlError('')
    setCaptureTarget({ id, kind, baseline: kind === 'gamepad' ? readGamepadSnapshot() : [] })
  }

  async function saveControlProfile() {
    setControlError('')
    setControlSaving(true)
    try {
      const profile = await updateControlProfile(controlDraft)
      setControlDraft(structuredClone(profile))
      setTriggerBindings(profile.triggerBindings)
      broadcastPlayerMessage('emulator-hub:control-profile', { bindings: profile.bindings })
      setCaptureTarget(null)
      setControlPanelOpen(false)
    } catch (cause) {
      setControlError(cause.message)
    } finally {
      setControlSaving(false)
    }
  }

  function chooseInstanceGame(game) {
    lastInstanceGameIdRef.current = game.id
    openProfilePicker(game, 'add-instance')
  }

  function broadcastPlayerMessage(type, payload = {}) {
    for (const frame of document.querySelectorAll('.player-grid iframe')) {
      configurePlayerFrame(frame, { type, ...payload })
    }
  }

  function sendSelectedPlayerMessage(type) {
    const sessionId = activeSessions.some(session => session.sessionId === focusedSessionId) ? focusedSessionId : activeSessions[0]?.sessionId
    if (!sessionId) return
    setPlayerActionErrors(current => { const next = { ...current }; delete next[sessionId]; return next })
    const frame = [...document.querySelectorAll('.player-cell')].find(cell => cell.dataset.sessionId === sessionId)?.querySelector('iframe')
    configurePlayerFrame(frame, { type, sessionId })
  }

  const activeProfileIds = new Set(activeSessions.map(session => `${session.gameId}:${session.profileId}`))
  const gameSections = groupGamesByLayout(games, hubLayout)
  const isStandalone = window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true
  const isNarrowPortrait = isNarrowPortraitViewport(viewport)
  const isMobileLandscape = isMobileLandscapeViewport(viewport)
  const renderLayer = content => fullscreen && playerShellRef.current
    ? createPortal(content, playerShellRef.current)
    : content

  return <main className="hub">
    <div className="hub-layout" inert={activeSessions.length || profileGame || instancePicker || controlPanelOpen || profileEditorOpen || pokemonHubOpen ? true : undefined}>
      <aside className="hub-sidebar" aria-label="Ações globais">
        <button className="hub-sidebar-action" type="button" aria-label="Configurar controles" title="Configurar controles" onClick={openControlPanel}>
          <svg viewBox="0 0 24 24" className="control-configuration-icon" aria-hidden="true">
            <path d="M7.1 8.5h9.8c1.5 0 2.8 1 3.2 2.45l1.08 4.15a2.35 2.35 0 0 1-4.08 2.1l-1.55-1.7H8.4l-1.55 1.7a2.35 2.35 0 0 1-4.08-2.1l1.08-4.15A3.3 3.3 0 0 1 7.1 8.5Z" />
            <path d="M7.3 11.15v3.1M5.75 12.7h3.1M16.35 11.8h.01M18.25 13.65h.01" />
          </svg>
        </button>
        <button className="hub-sidebar-action" type="button" aria-label="Editar perfis" title="Editar perfis" onClick={() => setProfileEditorOpen(true)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.5" /><path d="M5 20v-1.5A5.5 5.5 0 0 1 10.5 13h3A5.5 5.5 0 0 1 19 18.5V20Z" /></svg>
        </button>
        {!isStandalone && <button className="hub-sidebar-action hub-sidebar-install" type="button" aria-label="Instalar no iPhone" title="Instalar no iPhone" onClick={() => setInstallHelpOpen(true)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11M8 10l4 4 4-4M5 17v3h14v-3" /></svg>
        </button>}
      </aside>
      <section className="hub-content">
        <section className="hub-section hub-section-internal" aria-labelledby="internal-applications-heading">
          <header className="hub-section-header"><h2 id="internal-applications-heading">Aplicações internas</h2></header>
          <div className="boxes">
          <button className="box pokemon-hub-card" type="button" aria-label="Abrir Pokémon Hub" onClick={() => setPokemonHubOpen(true)}>
            <div className="cover">
              <img className="cover-image" src="/pokemon-hub-icon.png" alt="Pokémon Hub" />
            </div>
          </button>
          </div>
        </section>
        {gameSections.map(section => <section className="hub-section hub-section-games" key={section.id} aria-labelledby={`${section.id}-heading`}>
          <header className="hub-section-header"><h2 id={`${section.id}-heading`}>{section.title}</h2></header>
          <div className="boxes">
          {section.games.map(game => <button
            className="box"
            key={game.id}
            type="button"
            aria-label={`Iniciar ${game.title}`}
            disabled={game.status !== 'ready'}
            onClick={event => {
              const card = event.currentTarget.getBoundingClientRect()
              openProfilePicker(game, 'launch', { left: card.left, top: card.top, bottom: card.bottom })
            }}
          >
            <div className="cover">
              {game.coverUrl && <img className="cover-image" src={game.coverUrl} alt={`Capa de ${game.title}`} />}
            </div>
            {game.language && <div className="title"><small>{game.language}</small></div>}
          </button>)}
          </div>
        </section>)}
        {error && <p className="error" role="alert">{error}</p>}
      </section>
    </div>
    {profileEditorOpen && <ProfileEditor games={games} onCatalog={setGames} onSaved={handleGlobalProfileSaved} onClose={() => setProfileEditorOpen(false)} />}
    {controlPanelOpen && renderLayer(<div className="profile-overlay" role="dialog" aria-modal="true" aria-label="Configurar controles">
      <div className="profile-panel control-panel">
        <header className="profile-header">
          <h2>Controles</h2>
          <button className="dialog-close" type="button" aria-label="Fechar controles" onClick={() => { setControlPanelOpen(false); setCaptureTarget(null) }}>×</button>
        </header>
        <div className="profile-body">
          {controlDraft && <>
            <div className="gba-layout" aria-label="Layout de controle Game Boy Advance">
              <div className="gba-shoulders">
                <ControlBinding control={gbaControls.l} profile={controlDraft} captureTarget={captureTarget} onCapture={startControlCapture} />
                <ControlBinding control={gbaControls.r} profile={controlDraft} captureTarget={captureTarget} onCapture={startControlCapture} />
              </div>
              <div className="gba-main-controls">
                <div className="gba-dpad">
                  <ControlBinding control={gbaControls.up} profile={controlDraft} captureTarget={captureTarget} onCapture={startControlCapture} />
                  <ControlBinding control={gbaControls.left} profile={controlDraft} captureTarget={captureTarget} onCapture={startControlCapture} />
                  <ControlBinding control={gbaControls.right} profile={controlDraft} captureTarget={captureTarget} onCapture={startControlCapture} />
                  <ControlBinding control={gbaControls.down} profile={controlDraft} captureTarget={captureTarget} onCapture={startControlCapture} />
                </div>
                <div className="gba-center-controls">
                  <ControlBinding control={gbaControls.select} profile={controlDraft} captureTarget={captureTarget} onCapture={startControlCapture} />
                  <ControlBinding control={gbaControls.start} profile={controlDraft} captureTarget={captureTarget} onCapture={startControlCapture} />
                </div>
                <div className="gba-action-controls">
                  <ControlBinding control={gbaControls.b} profile={controlDraft} captureTarget={captureTarget} onCapture={startControlCapture} />
                  <ControlBinding control={gbaControls.a} profile={controlDraft} captureTarget={captureTarget} onCapture={startControlCapture} />
                </div>
              </div>
            </div>
            <div className="trigger-bindings" aria-label="Atalhos de ação">
              <TriggerBinding trigger={triggerControls.l2} profile={controlDraft} captureTarget={captureTarget} onCapture={startControlCapture} />
              <TriggerBinding trigger={triggerControls.r2} profile={controlDraft} captureTarget={captureTarget} onCapture={startControlCapture} />
            </div>
            <button className="control-save" type="button" disabled={controlSaving || Boolean(captureTarget)} onClick={saveControlProfile}>{controlSaving ? 'Salvando...' : 'Salvar controles'}</button>
          </>}
          {controlError && <p className="profile-error" role="alert">{controlError}</p>}
        </div>
      </div>
    </div>)}
    {pokemonHubOpen && renderLayer(<React.Suspense fallback={<div className="pokemon-workspace" role="status">Carregando workspace...</div>}><PokemonHub onClose={() => setPokemonHubOpen(false)} closeSignal={pokemonHubCloseSignal} /></React.Suspense>)}
    {profileGame && renderLayer(<div className={`profile-overlay${profilePickerPlacement ? ' profile-picker-overlay' : ''} profile-picker-mobile`} role="dialog" aria-modal="true" aria-label="Selecionar perfil">
      <div className={`profile-panel${profilePickerPlacement ? ' profile-picker-panel' : ''}${profilePurpose === 'add-instance' ? ' instance-picker-panel' : ''}`} style={profilePurpose === 'add-instance' ? { '--instance-picker-width': `${Math.max(560, gameSections.flatMap(section => section.games).filter(game => game.status === 'ready').length * 108 + 44)}px` } : profilePickerPlacement ? profilePickerPlacement : undefined}>
        <header className="profile-header">
          <h2>{profilePurpose === 'add-instance' ? 'Adicionar emulador' : profileGame.title}</h2>
          <button className={`dialog-close${profilePurpose === 'add-instance' ? ' instance-picker-close' : ''}`} type="button" aria-label={profilePurpose === 'add-instance' ? 'Fechar' : 'Fechar seleção de perfil'} onClick={() => { setProfileGame(null); setProfilePickerPlacement(null); setInstancePicker(false); setCreatingProfile(false) }}>{profilePurpose === 'add-instance' ? 'Fechar' : '×'}</button>
        </header>
        <div className={`profile-body${profilePurpose === 'add-instance' ? ' instance-picker-body' : ''}`}>
          {profilePurpose === 'add-instance' && <div className="instance-rom-strip" aria-label="ROMs disponíveis">
            {gameSections.flatMap(section => section.games).filter(game => game.status === 'ready').map(game => <button className={`instance-rom-tile${profileGame.id === game.id ? ' is-selected' : ''}`} key={game.id} type="button" aria-label={`Selecionar ${game.title}`} aria-pressed={profileGame.id === game.id} onClick={() => chooseInstanceGame(game)}>
              <span className="instance-rom-cover">{game.coverUrl ? <img src={game.coverUrl} alt={`Capa de ${game.title}`} /> : <span>{game.title}</span>}</span>
            </button>)}
          </div>}
          <div className="profile-picker-content">
          <div className="profile-picker-profiles">
          {profiles.length > 0 && <div className="profile-list">
            {profiles.map(profile => {
              const isRunning = activeProfileIds.has(`${profileGame.id}:${profile.id}`)
              const isLeased = isRunning || profile.leaseActive === true
              const isEditing = editingProfileId === profile.id
              return <div className="profile-row" key={profile.id}>
              {isEditing
                ? <form className="profile-edit-form" onSubmit={event => submitProfileEdit(event, profile)}>
                  <input aria-label={`Novo nome para ${profile.name}`} value={profileEditName} onChange={event => setProfileEditName(event.target.value)} maxLength="32" required disabled={profileBusy} autoFocus />
                  <button type="submit" aria-label={`Salvar nome de ${profile.name}`} disabled={profileBusy}>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l4 4L19 6" /></svg>
                  </button>
                </form>
                : <button className="profile-select" type="button" aria-label={isLeased ? `${profile.name} em execução` : profile.name} disabled={profileBusy || isLeased} onClick={() => launchWithProfile(profile)}>
                  <span>{profile.name}</span>
                  {isLeased && <svg className="profile-running" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 1-6.4 2.7M4 3v5h5" /></svg>}
                </button>}
              <button className="profile-edit" type="button" aria-label={`Editar perfil ${profile.name}`} disabled={profileBusy || isEditing || isLeased} onClick={() => startEditingProfile(profile)}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l11-11-4-4L4 16v4M13 7l4 4" /></svg>
              </button>
              <button className="profile-delete" type="button" aria-label={`Excluir perfil ${profile.name}`} disabled={profileBusy || isEditing || isLeased} onClick={() => removeProfile(profile)}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" /></svg>
              </button>
            </div>})}
          </div>}
          </div>
          <div className="profile-picker-create">
          {!creatingProfile && <button className="profile-add" type="button" aria-label="Criar novo perfil" onClick={() => setCreatingProfile(true)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          </button>}
          {creatingProfile && <form className="profile-create" onSubmit={submitProfile}>
            <input id="profile-name" aria-label="Nome do novo perfil" placeholder="Nome do perfil" value={profileName} onChange={event => setProfileName(event.target.value)} maxLength="32" required disabled={profileBusy} autoFocus />
            <button type="submit" disabled={profileBusy}>{profileBusy ? '...' : 'Criar'}</button>
          </form>}
          {profileError && <p className="profile-error" role="alert">{profileError}</p>}
          </div>
          </div>
        </div>
      </div>
    </div>)}
    {isNarrowPortrait && renderLayer(<div className="mobile-rotate-overlay" role="status" aria-live="assertive">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7a3 3 0 0 1 3 3v4M17 21h-7a3 3 0 0 1-3-3v-4M17 3l3 3-3 3M7 21l-3-3 3-3" /></svg>
      <strong>Gire o aparelho</strong>
      <span>A experiência de jogo funciona melhor na horizontal.</span>
    </div>)}
    {installHelpOpen && renderLayer(<div className="mobile-install-overlay" role="dialog" aria-modal="true" aria-labelledby="mobile-install-title">
      <div className="mobile-install-panel">
        <button className="dialog-close" type="button" aria-label="Fechar instruções de instalação" onClick={() => setInstallHelpOpen(false)}>×</button>
        <h2 id="mobile-install-title">Instalar no iPhone</h2>
        <p>No Chrome, toque em <strong>Compartilhar</strong> e depois em <strong>Adicionar à Tela de Início</strong>.</p>
        <p>Depois, abra o ícone “Emulator Hub” pela Tela de Início.</p>
      </div>
    </div>)}
    {activeSessions.length > 0 && <div className="player-overlay" role="dialog" aria-modal="true" aria-label="Emulator">
      <div className={`player-shell player-shell-${activeSessions.length}`} ref={playerShellRef}>
        <header className="player-header" inert={closeChooserOpen || saveCloseRows !== null ? true : undefined}>
          <div className="player-global-controls">
            <div className="fast-forward-control">
              <button className={`fast-forward-button mute-button${muted ? ' is-active' : ''}`} type="button" aria-label={muted ? 'Desmutar áudio' : 'Mutar áudio'} title={muted ? 'Desmutar áudio' : 'Mutar áudio'} aria-pressed={muted} onClick={toggleMute}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4Z" /><path d={muted ? 'M17 9l5 6m0-6-5 6' : 'M16 9a4 4 0 0 1 0 6m2-9a8 8 0 0 1 0 12'} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
              </button>
              <button className={`fast-forward-button${fastForwardEnabled ? ' is-active' : ''}`} type="button" aria-label="Fast Forward" title="Fast Forward" aria-pressed={fastForwardEnabled} onClick={toggleFastForward}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5v14l7-7-7-7Zm8 0v14l7-7-7-7Z" /></svg>
              </button>
              <Select className="player-header-select player-speed-select" aria-label="Velocidade do Fast Forward" title="Velocidade do Fast Forward" value={fastForwardSpeed} options={fastForwardSpeeds.map(speed => ({ value: speed, label: `${speed}×` }))} getPopupContainer={playerSelectPopupContainer} popupMatchSelectWidth={false} onChange={speed => { setFastForwardSpeed(speed); void saveUserPreferences({ fastForwardSpeed: speed }) }} />
            </div>
            <span className="player-header-separator" aria-hidden="true" />
            <div className="player-header-group">
              <button className="player-control-button" type="button" aria-label="Salvar estado" title="Salvar estado" disabled={Boolean(snapshotRestoreRequests[selectedPlayerSessionId])} onClick={() => sendSelectedPlayerMessage('emulator-hub:save-state')}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h12l2 2v14H5zM8 4v6h8V4M8 20v-6h8v6" /></svg>
              </button>
              <button className="player-control-button" type="button" aria-label="Carregar estado" title="Carregar estado" disabled={!userStateAvailable[selectedPlayerSessionId] || Boolean(snapshotRestoreRequests[selectedPlayerSessionId])} onClick={() => sendSelectedPlayerMessage('emulator-hub:load-state')}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0L7 9m5-5 5 5M5 14v5h14v-5" /></svg>
              </button>
            </div>
            <span className="player-header-separator" aria-hidden="true" />
            <div className="player-header-group">
              <button className="player-control-button" type="button" aria-label="Soft Reset" title="Soft Reset" onClick={() => dispatchReset('emulator-hub:soft-reset')}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 1-2.3-5.7M20 4v7h-7" /></svg>
              </button>
              <button className="player-control-button global-reset-button" type="button" aria-label="Hard Reset" title="Hard Reset" onClick={() => dispatchReset('emulator-hub:reset')}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v8M6.4 6.4a8 8 0 1 0 11.2 0" /></svg>
              </button>
            </div>
            <span className="player-header-separator" aria-hidden="true" />
            <div className="player-header-group">
              <label className="trigger-action-control">L2
                <Select className="player-header-select player-trigger-select" aria-label="Ação do L2" title="Ação do L2" value={l2TriggerAction} options={playerTriggerActionOptions} getPopupContainer={playerSelectPopupContainer} popupMatchSelectWidth={false} onChange={action => { setL2TriggerAction(action); void saveUserPreferences({ triggerActions: { l2: action } }) }} />
              </label>
              <label className="trigger-action-control">R2
                <Select className="player-header-select player-trigger-select" aria-label="Ação do R2" title="Ação do R2" value={r2TriggerAction} options={playerTriggerActionOptions} getPopupContainer={playerSelectPopupContainer} popupMatchSelectWidth={false} onChange={action => { setR2TriggerAction(action); void saveUserPreferences({ triggerActions: { r2: action } }) }} />
              </label>
            </div>
            <span className="player-header-separator" aria-hidden="true" />
            <button className="player-control-button" type="button" aria-label="Configurar controles" title="Configurar controles" onClick={openControlPanel}>
              <svg viewBox="0 0 24 24" className="control-configuration-icon" aria-hidden="true">
                <path d="M7.1 8.5h9.8c1.5 0 2.8 1 3.2 2.45l1.08 4.15a2.35 2.35 0 0 1-4.08 2.1l-1.55-1.7H8.4l-1.55 1.7a2.35 2.35 0 0 1-4.08-2.1l1.08-4.15A3.3 3.3 0 0 1 7.1 8.5Z" />
                <path d="M7.3 11.15v3.1M5.75 12.7h3.1M16.35 11.8h.01M18.25 13.65h.01" />
              </svg>
            </button>
            <button className={`player-control-button${oddsManipulatorEnabled ? ' is-active' : ''}`} type="button" aria-label="Manipulador de odds" title="Manipulador de odds" aria-pressed={oddsManipulatorEnabled} onClick={toggleOddsManipulator}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M5 8.5h14M5 15.5h14M8 5.5v14M16 5.5v14" /></svg>
            </button>
            <button className="player-control-button" type="button" aria-label="Informações do perfil" title="Informações do perfil" disabled={closeChooserOpen || saveCloseRows !== null || profileInfoSessionId !== null} onClick={openProfileInfo}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 10.5v6M12 7.5h.01" /></svg>
            </button>
          </div>
          <div className="player-actions">
            {!isMobileLandscape && <>
              <button type="button" aria-label="Adicionar instância" title="Adicionar instância" disabled={activeSessions.length >= MAX_PLAYER_INSTANCES} onClick={openInstancePicker}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
              </button>
              <button type="button" aria-label={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'} title={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'} onClick={toggleFullscreen}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d={fullscreen ? 'M4 9h5V4M20 9h-5V4M4 15h5v5M20 15h-5v5' : 'M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5'} /></svg>
              </button>
            </>}
            <button type="button" aria-label="Fechar emulador" title="Fechar emulador" onClick={closePlayer}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5l14 14M19 5L5 19" /></svg>
            </button>
          </div>
        </header>
        <div className={`player-panel player-panel-${activeSessions.length}`} inert={closeChooserOpen || saveCloseRows !== null ? true : undefined}>
          <div className="player-grid">
            {activeSessions.map(session => <div className="player-cell" data-session-id={session.sessionId} key={`${session.gameId}:${session.profileId}`} onPointerDown={() => setFocusedSessionId(session.sessionId)}>
              <iframe src={playerFrameUrl(session)} title="EmulatorJS" allow="fullscreen; gamepad" inert={profileInfoSessionId === session.sessionId ? true : undefined} onLoad={event => configurePlayerFrameOnLoad(event.currentTarget, session)} />
              {profileInfoSessionId === session.sessionId && <div className="profile-info-overlay" role="dialog" aria-modal="true" aria-labelledby={`profile-info-title-${session.sessionId}`}>
                <form className="profile-info-card" onSubmit={submitProfileInfo}>
                  <h2 id={`profile-info-title-${session.sessionId}`}>Informações do perfil</h2>
                  <label htmlFor={`profile-info-name-${session.sessionId}`}>Nome</label>
                  <input id={`profile-info-name-${session.sessionId}`} value={profileInfoName} onChange={event => setProfileInfoName(event.target.value)} maxLength="32" required disabled={profileInfoBusy} autoFocus />
                  {profileInfoError && <p role="alert">{profileInfoError}</p>}
                  <div className="profile-info-actions">
                    <button type="button" onClick={closeProfileInfo} disabled={profileInfoBusy}>Fechar</button>
                    <button type="submit" disabled={profileInfoBusy}>{profileInfoBusy ? 'Salvando...' : 'Salvar'}</button>
                  </div>
                </form>
              </div>}
              {snapshotRestoreRequests[session.sessionId] && <SnapshotRestorePrompt key={snapshotRestoreRequests[session.sessionId].requestId ?? 'pending'} request={snapshotRestoreRequests[session.sessionId]} onRestore={candidateId => snapshotRestoreRequests[session.sessionId].requestId && respondToRestore(session.sessionId, snapshotRestoreRequests[session.sessionId].requestId, candidateId)} onContinue={() => snapshotRestoreRequests[session.sessionId].requestId && respondToRestore(session.sessionId, snapshotRestoreRequests[session.sessionId].requestId, null)} />}
              {playerActionErrors[session.sessionId]?.length > 0 && <div className="player-action-errors" role="alert">{playerActionErrors[session.sessionId].map((message, index) => <p key={`${index}:${message}`}>{message}</p>)}</div>}
            </div>)}
          </div>
        </div>
      </div>
    </div>}
    {closeChooserOpen && !saveCloseRows && renderLayer(<div className="close-chooser-overlay" role="dialog" aria-modal="true" aria-labelledby="close-chooser-title">
      <div className="close-chooser-panel">
        <h2 id="close-chooser-title">Fechar emuladores</h2>
        <button type="button" className="close-chooser-all" autoFocus onClick={() => setSelectedCloseSessionIds(selectedCloseSessionIds.size === activeSessions.length ? new Set() : new Set(activeSessions.map(session => session.sessionId)))}>
          {selectedCloseSessionIds.size === activeSessions.length ? 'Desselecionar tudo' : 'Selecionar tudo'}
        </button>
        <ul className="close-chooser-list">
          {activeSessions.map(session => <li key={session.sessionId}><label>
            <input type="checkbox" checked={selectedCloseSessionIds.has(session.sessionId)} onChange={() => setSelectedCloseSessionIds(current => { const next = new Set(current); if (next.has(session.sessionId)) next.delete(session.sessionId); else next.add(session.sessionId); return next })} />
            <span>{session.gameTitle ?? session.gameId} | {session.profileName ?? session.profileId}</span>
          </label></li>)}
        </ul>
        <div className="close-chooser-actions">
          <button type="button" onClick={cancelCloseChooser}>Cancelar</button>
          <button type="button" disabled={selectedCloseSessionIds.size === 0} onClick={() => { const ids = [...selectedCloseSessionIds]; setCloseChooserOpen(false); void closeSessions(ids) }}>Confirmar</button>
        </div>
      </div>
    </div>)}
    {saveCloseRows && renderLayer(<div className="save-close-overlay" role="dialog" aria-modal="true" aria-labelledby="save-close-title">
      <div className="save-close-panel">
        <h2 id="save-close-title">Salvando jogos</h2>
        <p role="status" aria-live="polite">Aguarde a confirmação de cada save antes de fechar.</p>
        <ul className="save-close-list">
          {saveCloseRows.map(row => <li key={row.id} className={`save-close-row save-close-${row.status}`}>
            <span>{row.label}</span>
            <strong>{row.status === 'saved' ? 'Salvo' : row.status === 'processing' ? 'Processando' : row.status === 'retrying' ? `Falhou — reenviando (${row.attempt})` : row.status === 'failed' ? 'Falhou — aguardando reenvio' : 'Aguardando'}</strong>
          </li>)}
        </ul>
        {saveCloseRows.some(row => row.status === 'failed') && <button type="button" className="save-close-retry" onClick={retryFailedSaves} disabled={saveCloseRows.some(row => row.status === 'processing' || row.status === 'retrying')}>Reenviar falhos</button>}
      </div>
    </div>)}
  </main>
}


createRoot(document.getElementById('root')).render(<ConfigProvider theme={antTheme}><App /></ConfigProvider>)
