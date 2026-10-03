import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { Button, ConfigProvider, Input, Select } from 'antd'
import { AudioMutedOutlined, CloseOutlined, FastForwardOutlined, FullscreenExitOutlined, FullscreenOutlined, InfoCircleOutlined, NumberOutlined, PlusOutlined, PoweroffOutlined, RedoOutlined, SaveOutlined, SearchOutlined, SoundOutlined, ThunderboltOutlined, UploadOutlined } from '@ant-design/icons'
import { acquirePlayerLease, createProfile, deleteProfile as deleteProfileRequest, getControlProfile, getGames, getProfiles, getUserPreferences, listMacros, releasePlayerLease, saveMacro as saveMacroRequest, syncOddsResetCount, updateControlProfile, updateProfile, updateUserPreferences } from '../../packages/hub-client.js'
import { createMacro, migrateMacro, normalizeKeyboardKey, validateMacro } from '../../packages/input-macro-simulator.mjs'
import { createMacroRunCoordinator } from '../../packages/macro-run-coordinator.mjs'
import { createLastMacroAction } from '../../packages/last-macro-action.mjs'
import { activeGamepadBindings, readGamepadBinding, readGamepadSnapshot } from '../../packages/gamepad-input.mjs'
import { createGamepadInputGate } from '../../packages/gamepad-input-gate.mjs'
import { deliverPlayerInteractionLock } from '../../packages/player-interaction-lock-delivery.mjs'
import { replaceCatalogProfile } from '../../packages/save-profile-catalog.mjs'
import { formatGameProfileLabel, getGameProfileNumber, orderGameProfiles } from '../../packages/save-profile-display.mjs'
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
import { createShinyHuntController } from '../../packages/shiny-hunt-controller.mjs'
import { hoennStarterChoices } from '../../packages/shiny-hunt-start-sequence.mjs'
import { createGlobalPlaybackToggle, createPlayerPlaybackToggle, requestPlayerPlaybackState, selectPlayingSessions } from '../../packages/player-playback.mjs'
import { saveRunningProfileNames } from '../../packages/running-profile-editor.mjs'
import { findReachablePlayerOriginSlot, findTrustedPlayerFrame, frameOrigin, parsePlayerOriginPorts, playerOriginForSlot } from '../../packages/player-origin-topology.mjs'
import { respondToPlayerStorageRequest } from '../../packages/player-origin-storage-bridge.mjs'
import { getInstallationIdentity } from '../../packages/restore-candidate.mjs'
import { createOddsManipulatorSync } from '../../packages/odds-manipulator-sync.mjs'
import { describeRestoreCandidate } from './restore-candidate-view.mjs'
import { createSnapshotTelemetry } from '../../packages/snapshot-telemetry.mjs'
import hubLayout from './hub-layout.json'
import { ProfileEditor } from './profile-editor.jsx'
import { HuntStarterPicker } from './hunt-starter-picker.jsx'
import './styles.css'

const PokemonHub = React.lazy(() => import('../../packages/pokemon-hub-ui.jsx'))
const MacroEditor = React.lazy(() => import('../../packages/input-macro-simulator-ui.jsx'))

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
  'manual-save-backup': 'Estado salvo neste emulador, mas a cópia no servidor falhou.',
  'manual-load': 'Não foi possível carregar o estado salvo.',
  'restore-state': 'Não foi possível restaurar o estado escolhido.',
  'game-save-load': 'Não foi possível carregar o save do jogo.',
  'game-save-missing': 'O save do jogo esperado para este perfil não foi encontrado.',
})
const huntErrorMessages = Object.freeze({
  'unsupported-rom': 'Esta ROM não é compatível com a leitura de encontros da caça.',
  'enemy-already-created': 'O encontro começou antes do próximo comando; a caça foi parada para preservar o Pokémon.',
  'state-unavailable': 'Não foi possível ler o estado deste emulador.',
  'unsupported-starter': 'Caça de iniciais requer uma ROM compatível de Ruby, Sapphire, Emerald, FireRed ou LeafGreen.',
  'invalid-starter-choice': 'Escolha a Poké Bola de Hoenn e use soft reset para caçar iniciais.',
  'starter-already-owned': 'Salve antes de escolher o inicial, em frente à bolsa ou à Poké Bola desejada.',
  'input-frame-timeout': 'O emulador não processou o toque direcional; a caça foi parada.',
  'input-frame-unavailable': 'Não foi possível confirmar o toque direcional neste emulador.',
})
const MAX_PLAYER_INSTANCES = 9
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

function playerFrameForSession(sessionId) {
  return [...document.querySelectorAll('.player-cell iframe')].find(frame => frame.closest('.player-cell')?.dataset.sessionId === sessionId)
}

const toggleGlobalPlayback = createGlobalPlaybackToggle({
  getFrames: () => [...document.querySelectorAll('.player-grid iframe')],
  send: configurePlayerFrame,
  getOrigin: frame => frameOrigin(frame, window.location.origin),
  hostWindow: window,
})

const togglePlayerPlayback = createPlayerPlaybackToggle({
  getFrame: playerFrameForSession,
  getState: (sessionId, frame) => requestPlayerPlaybackState({ frame, browser: window, sessionId }),
  send: configurePlayerFrame,
})

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

function PlaybackGlyph({ paused, className }) {
  return <svg viewBox="0 0 24 24" className={className} aria-hidden="true"><path d={paused ? 'M3 2v20l19-10z' : 'M5 3h5v18H5zM14 3h5v18h-5z'} /></svg>
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
        {candidates.map(candidate => { const view = describeRestoreCandidate(candidate); return <Button htmlType="button" className={`snapshot-restore-candidate${selectedCandidateId === candidate.candidateId ? ' is-selected' : ''}`} key={candidate.candidateId} aria-pressed={selectedCandidateId === candidate.candidateId} disabled={!ready || request.resolving} onClick={() => setSelectedCandidateId(candidate.candidateId)}>
          <span className="snapshot-restore-candidate-title">{candidate.kind === 'local-recovery' ? 'Local' : 'Remoto'}</span>
          <span>{view.capture}</span>
        </Button> })}
      </div>
      {request.choiceError && <p className="snapshot-restore-error" role="alert">{request.choiceError}</p>}
      <div className="snapshot-restore-actions">
        <Button htmlType="button" className="snapshot-restore-primary" disabled={!ready || !selectedCandidateAvailable || request.resolving} onClick={() => onRestore(selectedCandidateId)}>Carregar snapshot</Button>
        <Button htmlType="button" className="snapshot-restore-secondary" disabled={!ready || request.resolving} onClick={onContinue}>Continuar sem carregar</Button>
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

  function getPlayerPlaybackState(sessionId) {
    const frame = playerFrameForSession(sessionId)
    return requestPlayerPlaybackState({ frame, browser: window, sessionId })
  }

  function getPlayingSessions() {
    return selectPlayingSessions(activeSessionsRef.current.map(session => ({ ...session })), session => getPlayerPlaybackState(session.sessionId))
  }
  const [profileInfoSessionId, setProfileInfoSessionId] = useState(null)
  const [profileInfoName, setProfileInfoName] = useState('')
  const [profileInfoError, setProfileInfoError] = useState('')
  const [profileInfoBusy, setProfileInfoBusy] = useState(false)
  const [multiProfileRows, setMultiProfileRows] = useState(null)
  const [multiProfileBusy, setMultiProfileBusy] = useState(false)
  const [multiProfileError, setMultiProfileError] = useState('')
  const [userStateAvailable, setUserStateAvailable] = useState({})
  const [playerPaused, setPlayerPaused] = useState({})
  const [playerActionErrors, setPlayerActionErrors] = useState({})
  const [instancePicker, setInstancePicker] = useState(false)
  const [controlPanelOpen, setControlPanelOpen] = useState(false)
  const [profileEditorOpen, setProfileEditorOpen] = useState(false)
  const [controlDraft, setControlDraft] = useState(null)
  const [controlError, setControlError] = useState('')
  const [controlSaving, setControlSaving] = useState(false)
  const [captureTarget, setCaptureTarget] = useState(null)
  const [macroModalOpen, setMacroModalOpen] = useState(false)
  const [macros, setMacros] = useState([])
  const [macroDraft, setMacroDraft] = useState(null)
  const [macroError, setMacroError] = useState('')
  const [macroSaving, setMacroSaving] = useState(false)
  const macroOperationPendingRef = useRef(false)
  const [macroWarnings, setMacroWarnings] = useState([])
  const [macroRunState, setMacroRunState] = useState({ phase: 'idle', runId: null, macroId: null, error: '' })
  const macroCoordinatorRef = useRef(null)
  if (!macroCoordinatorRef.current) macroCoordinatorRef.current = createMacroRunCoordinator({
    request: async (sessionId, phase, runId, macro) => {
      const frame = [...document.querySelectorAll('.player-cell iframe')].find(candidate => candidate.closest('.player-cell')?.dataset.sessionId === sessionId)
      if (!frame) throw new Error('Player da macro indisponível')
      const replyType = { prepare: 'emulator-hub:macro-prepared', start: 'emulator-hub:macro-started', stop: 'emulator-hub:macro-stopped' }[phase]
      const response = await requestPlayerFrame({ frame, browser: window, sessionId, type: `emulator-hub:macro-${phase}`, replyType, details: { runId, ...(macro ? { macro } : {}) }, timeoutMs: 5000 })
      if (response.runId !== runId) throw new Error('Resposta de macro pertence a outra execução')
      return response
    },
    onChange: setMacroRunState,
  })
  const lastMacroActionRef = useRef(null)
  if (!lastMacroActionRef.current) lastMacroActionRef.current = createLastMacroAction({
    storage: {
      getItem: key => window.sessionStorage.getItem(key),
      setItem: (key, value) => window.sessionStorage.setItem(key, value),
      removeItem: key => window.sessionStorage.removeItem(key),
    },
    listMacros,
    getRunState: () => macroCoordinatorRef.current.getState(),
    start: macro => runSavedMacro(macro),
    stop: () => stopMacro(),
  })
  const [pokemonHubOpen, setPokemonHubOpen] = useState(false)
  const [pokemonHubCloseSignal, setPokemonHubCloseSignal] = useState(0)
  const [fastForwardEnabled, setFastForwardEnabled] = useState(false)
  const [muted, setMuted] = useState(false)
  const [oddsManipulatorEnabled, setOddsManipulatorEnabled] = useState(false)
  const [huntStatus, setHuntStatus] = useState({ phase: 'idle', running: false, attemptCount: 0, completedSessionIds: [] })
  const [huntModalOpen, setHuntModalOpen] = useState(false)
  const [huntStarterPickerOpen, setHuntStarterPickerOpen] = useState(false)
  const [huntConfig, setHuntConfig] = useState({ resetMode: 'soft-reset', startMode: 'interact-a', stopMode: 'first-shiny' })
  const huntControllerRef = useRef(null)
  const huntActiveRef = useRef(false)
  const [huntHeaderStopRequested, setHuntHeaderStopRequested] = useState(false)
  const huntParticipantsRef = useRef('')
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
    if (multiProfileRows && multiProfileRows.some(row => !live.has(row.sessionId))) setMultiProfileRows(null)
  }, [activeSessions, profileInfoSessionId, multiProfileRows])

  useEffect(() => {
    if (huntActiveRef.current && activeSessions.map(session => session.sessionId).join('|') !== huntParticipantsRef.current) huntControllerRef.current?.stop()
  }, [activeSessions])

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
    setPlayerInteractionLocked(closeChooserOpen || saveCloseRows !== null || multiProfileRows !== null)
  }, [closeChooserOpen, saveCloseRows !== null, activeSessions.length, profileInfoSessionId, multiProfileRows !== null])

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
      if (event.data?.type === 'emulator-hub:macro-ended') {
        const participant = trustedFrame.closest('.player-cell')?.dataset.sessionId
        if (participant && event.data.sessionId === participant && typeof event.data.runId === 'string' && ['completed', 'stopped', 'failed'].includes(event.data.outcome)) macroCoordinatorRef.current.ended(participant, event.data.runId, event.data.outcome)
        return
      }
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
      if (event.data?.type === 'emulator-hub:playback-state') {
        const session = activeSessions.find(candidate => trustedFrame.closest('.player-cell')?.dataset.sessionId === candidate.sessionId)
        if (!session || event.data.sessionId !== session.sessionId || typeof event.data.paused !== 'boolean' || event.data.ok !== true) return
        setPlayerPaused(current => current[session.sessionId] === event.data.paused ? current : { ...current, [session.sessionId]: event.data.paused })
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
      void macroCoordinatorRef.current.lost(event.data.sessionId).catch(cause => setMacroError(cause.message))
      setActiveSessions(current => current.filter(session => session.sessionId !== event.data.sessionId))
      setSnapshotRestoreRequests(current => { const next = { ...current }; delete next[event.data.sessionId]; return next })
      setError('A sessão do emulador foi substituída ou expirou.')
    }
    window.addEventListener('message', receive)
    for (const session of activeSessions) configurePlayerFrame(playerFrameForSession(session.sessionId), { type: 'emulator-hub:user-state-availability-request', sessionId: session.sessionId })
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
      if (document.visibilityState === 'hidden' || huntActiveRef.current) return
      try {
        const response = await fetch('/', { method: 'HEAD', cache: 'no-store' })
        const nextRevision = response.headers.get('etag')
        if (!active || !nextRevision || huntActiveRef.current) return
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
    let current = true
    const whenSelectedPlaying = action => {
      if (!selectedPlayerSessionId) return
      void getPlayerPlaybackState(selectedPlayerSessionId).then(reply => {
        if (current && reply.paused === false && activeSessionsRef.current.some(session => session.sessionId === selectedPlayerSessionId)) action()
      }).catch(() => {})
    }
    const triggerActions = createPlayerTriggerActions({ dispatch: message => {
      whenSelectedPlaying(() => {
        if (message === 'emulator-hub:reset' || message === 'emulator-hub:soft-reset') dispatchReset(message)
        else broadcastPlayerMessage(message)
      })
    }, toggleFastForward: () => whenSelectedPlaying(() => { void toggleFastForwardFromFirstFrame() }), toggleLastMacro: () => whenSelectedPlaying(() => { void lastMacroActionRef.current.toggle().catch(cause => setMacroError(cause.message)) }) })
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
      const bindings = huntActiveRef.current || controlPanelOpen || profileGame || instancePicker || closeLockRef.current ? [] : globallyAllowed
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
      current = false
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
    if (huntActiveRef.current) return
    const enabled = !fastForwardEnabled
    setFastForwardEnabled(enabled)
    void saveUserPreferences({ fastForwardEnabled: enabled })
  }

  function toggleFastForwardFromFirstFrame() {
    if (huntActiveRef.current) return Promise.resolve()
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

  async function dispatchReset(type, targetSessionId = null) {
    if (huntActiveRef.current) return
    const candidates = activeSessionsRef.current.filter(session => targetSessionId === null || session.sessionId === targetSessionId)
    const sessions = await selectPlayingSessions(candidates, session => getPlayerPlaybackState(session.sessionId))
    if (huntActiveRef.current || !sessions.length) return
    if (targetSessionId === null) void stopMacro()
    const frames = [...document.querySelectorAll('.player-grid iframe')]
    sessions.forEach(session => {
      const frame = frames.find(candidate => candidate.closest('.player-cell')?.dataset.sessionId === session.sessionId)
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

  async function startShinyHunt() {
    if (huntActiveRef.current || activeSessionsRef.current.length === 0) return
    if (!await stopMacro()) return
    const participantKey = activeSessionsRef.current.map(session => session.sessionId).join('|')
    const sessions = await getPlayingSessions()
    if (!sessions.length || activeSessionsRef.current.map(session => session.sessionId).join('|') !== participantKey) return
    const huntId = crypto.randomUUID()
    const huntGameCodes = new Map()
    huntParticipantsRef.current = participantKey
    setHuntHeaderStopRequested(false)
    huntActiveRef.current = true
    setHuntStarterPickerOpen(false)
    setHuntModalOpen(false)
    globalGamepadGateRef.current.lock()
    const frameFor = session => [...document.querySelectorAll('.player-grid iframe')]
      .find(frame => frame.closest('.player-cell')?.dataset.sessionId === session.sessionId)
    const assertParticipants = () => {
      if (activeSessionsRef.current.map(session => session.sessionId).join('|') !== participantKey) throw new Error('A lista de players mudou durante a caça')
    }
    const requestHunt = async (session, type, cycleId, details = {}, timeoutMs = 5000) => {
      assertParticipants()
      const frame = frameFor(session)
      if (!frame) throw new Error('Player indisponível: ' + (session.profileName ?? session.sessionId))
      const reply = await requestPlayerFrame({ frame, browser: window, sessionId: session.sessionId, type: 'emulator-hub:hunt-' + type, replyType: 'emulator-hub:hunt-response', details: { huntId, ...(cycleId !== null ? { cycleId } : {}), ...details }, timeoutMs })
      if (reply.huntId !== huntId || (cycleId !== null && reply.cycleId !== cycleId)) throw new Error('Resposta antiga de um player')
      return reply
    }
    const recordHuntReset = (session, nextCount) => {
      if ((session.oddsResetCount ?? 0) >= nextCount) return
      session.oddsResetCount = nextCount
      const current = activeSessionsRef.current.find(candidate => candidate.sessionId === session.sessionId)
      if (current) current.oddsResetCount = nextCount
      oddsSyncRef.current.get(session.sessionId)?.markDirty(nextCount)
    }
    const ensureHuntOddsClock = async (session, count) => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (await configureOddsClock(frameFor(session), session, count, count * 60_000)) return true
        if (attempt < 2) await new Promise(resolve => window.setTimeout(resolve, 500))
      }
      return false
    }
    const controller = createShinyHuntController({
      getGameCode: session => huntGameCodes.get(session.sessionId),
      prepare: async selected => {
        assertParticipants()
        setOddsManipulatorEnabled(true)
        setFastForwardEnabled(true)
        setFastForwardSpeed(5)
        await saveUserPreferences({ fastForwardEnabled: true, fastForwardSpeed: 5 })
        for (const session of selected) configurePlayerFrame(frameFor(session), { type: 'emulator-hub:fast-forward', enabled: true, speed: 5 })
        await Promise.all(selected.map(async session => {
          const ready = await ensureHuntOddsClock(session, session.oddsResetCount ?? 0)
          if (!ready) throw new Error('Relógio do Odds Manipulator não confirmado: ' + (session.profileName ?? session.sessionId))
        }))
        await Promise.all(selected.map(async session => {
          const reply = await requestHunt(session, 'prepare', null, { ...huntConfig })
          huntGameCodes.set(session.sessionId, reply.gameCode)
        }))
      },
      reset: async (session, _signal, cycleId) => {
        const nextCount = (session.oddsResetCount ?? 0) + 1
        const ready = await ensureHuntOddsClock(session, nextCount)
        if (!ready) throw new Error('Relógio do Odds Manipulator não confirmado: ' + (session.profileName ?? session.sessionId))
        await requestHunt(session, 'reset', cycleId, { oddsResetCount: nextCount })
        recordHuntReset(session, nextCount)
      },
      confirmReset: async (session, _signal, cycleId) => {
        const reply = await requestHunt(session, 'confirm-reset', cycleId)
        if (reply.confirmed) recordHuntReset(session, (session.oddsResetCount ?? 0) + 1)
        return reply.confirmed === true
      },
      begin: (session, _signal, cycleId, details) => requestHunt(session, 'begin', cycleId, details),
      input: (session, button, down, _signal, cycleId, stage) => requestHunt(session, 'input', cycleId, { button, down, stage }, 2000),
      tap: (session, button, _signal, cycleId) => requestHunt(session, 'tap', cycleId, { button }, 2000),
      releaseInput: (session, _signal, cycleId) => requestHunt(session, 'release-input', cycleId, {}, 5000),
      inspect: async (session, _signal, cycleId) => {
        const reply = await requestHunt(session, 'inspect', cycleId, { configured: true }, 10000)
        return { status: reply.status, species: reply.species }
      },
      inspectPhase: async (session, _signal, cycleId) => {
        const reply = await requestHunt(session, 'phase', cycleId, {}, 10000)
        return { status: reply.status, cursor: reply.cursor }
      },
      saveState: (session, _signal, cycleId) => requestHunt(session, 'save', cycleId, { complete: huntConfig.stopMode === 'all-shiny' }, 30000),
      release: async selected => {
        for (const session of selected) configurePlayerFrame(frameFor(session), { type: 'emulator-hub:hunt-cancel', sessionId: session.sessionId, huntId })
      },
      onStatus: status => {
        setHuntStatus(status)
        if (status.phase === 'error') clientDiagnostics?.capture({ kind: 'shiny-hunt', message: 'hunt.failed', error: status.error, playerSessionId: status.failedSessionId, attemptCount: status.attemptCount, activeSessionIds: status.activeSessionIds })
        const running = status.running === true
        huntActiveRef.current = running
        if (!running) globalGamepadGateRef.current.unlock(activeGamepadBindings(readGamepadSnapshot()))
        if (status.phase === 'found' && status.foundSessionId) setFocusedSessionId(status.foundSessionId)
      },
    })
    huntControllerRef.current = controller
    void controller.start(sessions, { ...huntConfig }).finally(() => {
      huntControllerRef.current = null
      huntActiveRef.current = false
      globalGamepadGateRef.current.unlock(activeGamepadBindings(readGamepadSnapshot()))
    })
  }

  function stopShinyHunt() {
    huntControllerRef.current?.stop()
  }

  function handleHuntButtonClick() {
    if ((huntActiveRef.current || huntStatus.running) && !huntHeaderStopRequested) {
      setHuntHeaderStopRequested(true)
      stopShinyHunt()
      return
    }
    setHuntStarterPickerOpen(false)
    setHuntModalOpen(true)
  }

  function toggleMute() {
    const nextMuted = !muted
    muteRevisionRef.current += 1
    setMuted(nextMuted)
    void saveUserPreferences({ muted: nextMuted }).catch(() => {})
  }

  function configurePlayerFrameOnLoad(frame, session) {
    if (huntActiveRef.current) stopShinyHunt()
    void macroCoordinatorRef.current.lost(session.sessionId).catch(cause => setMacroError(cause.message))
    hubPerformance?.frameLoaded(session.sessionId)
    configurePlayerFrame(frame, { type: 'emulator-hub:user-state-availability-request', sessionId: session.sessionId })
    sendPlayerInteractionLock(frame, closeLockRef.current || profileInfoSessionId === session.sessionId)
    configurePlayerFrame(frame, { type: 'emulator-hub:fast-forward', enabled: fastForwardEnabled, speed: fastForwardSpeed })
    configurePlayerFrame(frame, { type: 'emulator-hub:mute', muted })
    configurePlayerFrame(frame, { type: 'emulator-hub:get-playback-state', requestId: crypto.randomUUID() })
    if (oddsManipulatorEnabled) void configureOddsClock(frame, session, session.oddsResetCount ?? 0, (session.oddsResetCount ?? 0) * 60_000)
  }

  function requestPlaybackStatus(sessionId) {
    configurePlayerFrame(playerFrameForSession(sessionId), { type: 'emulator-hub:get-playback-state', requestId: crypto.randomUUID() })
  }

  function toggleOddsManipulator() {
    if (huntActiveRef.current) return
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
    stopShinyHunt()
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
    void stopMacro()
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
        await releasePlayerLease(session.sessionId, { profileId: session.profileId, gameId: session.gameId, generation: session.leaseGeneration, preserveRecovery: closeResult.preserveRecovery, closeCompleted: true })
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
    setPlayerPaused(removeClosed)
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
      let candidate = null
      try { candidate = await localRecoveryStore.getForLaunch(profile.id, game.id, lease.runtimeStateInvalidatedAtRevision) } catch (error) { console.warn('[local-recovery] candidate lookup failed', error) }
      localRecoveryPrompt = candidate ? { reason: candidate.reason, candidateId: candidate.candidateId } : null
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

  function openProfileInfo(sessionId = null) {
    const session = activeSessions.find(candidate => candidate.sessionId === (sessionId ?? focusedSessionId)) ?? (sessionId === null ? activeSessions[0] : null)
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

  function openHeaderProfileInfo() {
    if (activeSessions.length < 2) { openProfileInfo(); return }
    setMultiProfileRows(activeSessions.map(session => {
      const game = games.find(candidate => candidate.id === session.gameId)
      return {
        sessionId: session.sessionId,
        gameId: session.gameId,
        profileId: session.profileId,
        gameTitle: session.gameTitle ?? game?.title ?? session.gameId,
        number: getGameProfileNumber({ id: session.profileId }, game?.profiles ?? []),
        name: session.profileName ?? '',
      }
    }))
    setMultiProfileError('')
  }

  function closeMultiProfileInfo() {
    if (multiProfileBusy) return
    setMultiProfileRows(null)
    setMultiProfileError('')
  }

  async function submitMultiProfileInfo(event) {
    event.preventDefault()
    if (multiProfileBusy || !multiProfileRows) return
    setMultiProfileBusy(true)
    setMultiProfileError('')
    try {
      const { saved, failed } = await saveRunningProfileNames(multiProfileRows, updateProfile)
      for (const { row, updated } of saved) handleGlobalProfileSaved(row.gameId, updated)
      if (failed.length) {
        setMultiProfileError(`Não foi possível salvar: ${failed.map(({ row }) => `${row.gameTitle} #${row.number ?? '?'}`).join(', ')}.`)
      } else setMultiProfileRows(null)
    } finally {
      setMultiProfileBusy(false)
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

  function sendPlayerMessage(type, sessionId, stopGlobalMacro = false) {
    if (!activeSessions.some(session => session.sessionId === sessionId)) return
    if (type === 'emulator-hub:load-state' && stopGlobalMacro) void stopMacro()
    setPlayerActionErrors(current => { const next = { ...current }; delete next[sessionId]; return next })
    configurePlayerFrame(playerFrameForSession(sessionId), { type, sessionId })
  }

  function sendSelectedPlayerMessage(type) {
    const sessionId = activeSessions.some(session => session.sessionId === focusedSessionId) ? focusedSessionId : activeSessions[0]?.sessionId
    if (!sessionId) return
    sendPlayerMessage(type, sessionId, true)
  }

  async function refreshMacros() {
    try {
      setMacros(await listMacros())
      setMacroError('')
    } catch (cause) {
      setMacroError(cause.message)
    }
  }

  function openMacroModal() {
    setMacroModalOpen(true)
    if (!macroCoordinatorRef.current.getState().runId) { setMacroDraft(null); setMacroWarnings([]) }
    void refreshMacros()
  }

  function handleMacroButtonClick() {
    const { phase, runId } = macroCoordinatorRef.current.getState()
    if (runId) {
      if (phase !== 'stopping') void stopMacro()
      return
    }
    openMacroModal()
  }

  function closeMacroModal() {
    setMacroModalOpen(false)
  }

  function selectMacro(macro) {
    try {
      const converted = migrateMacro(macro)
      setMacroDraft(converted.macro)
      setMacroWarnings(converted.warnings)
      setMacroError('')
    } catch (cause) { setMacroError(cause.message) }
  }

  async function runMacro() {
    if (huntActiveRef.current || macroOperationPendingRef.current || !macroDraft) return
    setMacroError('')
    macroOperationPendingRef.current = true
    setMacroSaving(true)
    try {
      const participants = (await getPlayingSessions()).map(session => session.sessionId)
      if (!participants.length) { setMacroError('Nenhum player em execução'); return }
      const saved = await persistMacro(macroDraft)
      const started = await macroCoordinatorRef.current.start(structuredClone(saved), participants)
      if (started) {
        lastMacroActionRef.current.remember(saved.id)
        setMacroModalOpen(false)
      }
    }
    catch (cause) { setMacroError(cause.message) }
    finally { macroOperationPendingRef.current = false; setMacroSaving(false) }
  }

  async function runSavedMacro(macro) {
    if (huntActiveRef.current || macroOperationPendingRef.current || macroCoordinatorRef.current.getState().runId) return
    if (macro.schemaVersion !== 2) { setMacroError('Abra esta macro no editor, revise e salve antes de executar.'); return }
    const validation = validateMacro(macro)
    if (!validation.valid) { setMacroError(validation.errors[0]); return }
    setMacroError('')
    macroOperationPendingRef.current = true
    setMacroSaving(true)
    try {
      const participants = (await getPlayingSessions()).map(session => session.sessionId)
      if (!participants.length) { setMacroError('Nenhum player em execução'); return }
      const started = await macroCoordinatorRef.current.start(structuredClone(macro), participants)
      if (started) {
        lastMacroActionRef.current.remember(macro.id)
        setMacroModalOpen(false)
      }
    } catch (cause) { setMacroError(cause.message) }
    finally { macroOperationPendingRef.current = false; setMacroSaving(false) }
  }

  async function stopMacro() {
    try { await macroCoordinatorRef.current.stop(); return true }
    catch (cause) { setMacroError(cause.message); return false }
  }

  async function persistMacro(draft) {
    const validation = validateMacro(draft)
    if (!validation.valid) throw new Error(validation.errors[0])
    const saved = await saveMacroRequest(draft)
    setMacroDraft(saved)
    setMacroWarnings([])
    setMacros(current => current.some(macro => macro.id === saved.id)
      ? current.map(macro => macro.id === saved.id ? saved : macro) : [...current, saved])
    return saved
  }

  async function saveMacro() {
    if (macroOperationPendingRef.current || !macroDraft) return
    macroOperationPendingRef.current = true
    setMacroSaving(true)
    setMacroError('')
    try { await persistMacro(macroDraft) }
    catch (cause) { setMacroError(cause.message) }
    finally { macroOperationPendingRef.current = false; setMacroSaving(false) }
  }

  const activeProfileIds = new Set(activeSessions.map(session => `${session.gameId}:${session.profileId}`))
  const huntRunning = huntStatus.running === true || huntActiveRef.current
  const huntHeaderStops = huntRunning && !huntHeaderStopRequested
  const huntFoundSession = activeSessions.find(session => session.sessionId === huntStatus.foundSessionId)
  const huntCount = huntStatus.attemptCount ?? huntStatus.resetCount ?? 0
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
    {macroModalOpen && renderLayer(<div className="profile-overlay" role="dialog" aria-modal="true" aria-label="Macros">
      <div className="profile-panel macro-panel">
        <header className="profile-header">
          <h2>Macros</h2>
          <button className="dialog-close" type="button" aria-label="Fechar macros" onClick={closeMacroModal}>×</button>
        </header>
        <div className="profile-body">
          {macroDraft
            ? <React.Suspense fallback={<p>Carregando editor...</p>}>
              <form className="macro-name-form" onSubmit={event => { event.preventDefault(); void saveMacro() }}>
                <input id="macro-name" aria-label="Nome da macro" placeholder="Nome da macro" value={macroDraft.name} onChange={event => setMacroDraft({ ...macroDraft, name: event.target.value })} maxLength="50" required disabled={macroSaving} />
                <MacroEditor macro={macroDraft} onChange={setMacroDraft} onSave={() => void saveMacro()} onCancel={() => { setMacroDraft(null); setMacroWarnings([]); setMacroError('') }} onStart={() => void runMacro()} onStop={() => void stopMacro()} runPhase={macroRunState.phase} disabled={macroSaving} error={macroRunState.error || macroError} warnings={macroWarnings} />
              </form>
            </React.Suspense>
            : <>
              <div className="profile-list">
                {macros.length === 0 && <p className="profile-empty">Nenhuma macro salva.</p>}
                {macros.map(macro => <div className="profile-row" key={macro.id}>
                    <button className="profile-select macro-run-button" type="button" aria-label={`Editar macro ${macro.name}`} onClick={() => selectMacro(macro)}>
                      <span>{macro.name}</span>
                    </button>
                    <button className="macro-play-button" type="button" aria-label={`Executar macro ${macro.name}`} title={`Executar ${macro.name}`} disabled={macroSaving || Boolean(macroRunState.runId) || huntRunning} onClick={() => void runSavedMacro(macro)}>
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
                    </button>
                  </div>)}
              </div>
              <div className="macro-actions-footer">
                <button className="profile-add" type="button" aria-label="Criar novo macro" onClick={() => { setMacroDraft(createMacro('Nova macro')); setMacroWarnings([]); setMacroError('') }}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
                  <span>Criar novo</span>
                </button>
                {macroError && <p className="profile-error" role="alert">{macroError}</p>}
              </div>
            </>}
        </div>
      </div>
    </div>)}
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
    {pokemonHubOpen && renderLayer(<React.Suspense fallback={<div className="pokemon-workspace" role="status">Carregando workspace...</div>}><PokemonHub onClose={() => setPokemonHubOpen(false)} closeSignal={pokemonHubCloseSignal} layout={hubLayout} /></React.Suspense>)}
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
            {orderGameProfiles(profiles).map(profile => {
              const isRunning = activeProfileIds.has(`${profileGame.id}:${profile.id}`)
              const isLeased = isRunning || profile.leaseActive === true
              const isEditing = editingProfileId === profile.id
              const displayName = formatGameProfileLabel(profile, profiles)
              return <div className="profile-row" key={profile.id}>
              {isEditing
                ? <form className="profile-edit-form" onSubmit={event => submitProfileEdit(event, profile)}>
                  <span className="profile-display-number">#{getGameProfileNumber(profile, profiles)}</span>
                  <input aria-label={`Novo nome para ${profile.name}`} value={profileEditName} onChange={event => setProfileEditName(event.target.value)} maxLength="32" required disabled={profileBusy} autoFocus />
                  <button type="submit" aria-label={`Salvar nome de ${profile.name}`} disabled={profileBusy}>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l4 4L19 6" /></svg>
                  </button>
                </form>
                : <button className="profile-select" type="button" aria-label={isLeased ? `${displayName} em execução` : displayName} disabled={profileBusy || isLeased} onClick={() => launchWithProfile(profile)}>
                  <span>{displayName}</span>
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
    {huntModalOpen && activeSessions.length > 0 && renderLayer(<div className="profile-overlay hunt-overlay" role="dialog" aria-modal="true" aria-labelledby="hunt-modal-title">
      <div className="profile-panel hunt-panel">
        <div className="profile-header"><h2 id="hunt-modal-title">Caça shiny</h2><button className="dialog-close" type="button" aria-label="Fechar configuração da caça" onClick={() => { setHuntStarterPickerOpen(false); setHuntModalOpen(false) }}>×</button></div>
        <div className="hunt-modal-body">
          <div className="hunt-binary-options">
            <fieldset className="hunt-choice-group" disabled={huntRunning}>
              <legend>1. Tipo de reset</legend>
              <div className="hunt-choice-options">
                <label><input type="radio" name="hunt-reset-mode" value="soft-reset" checked={huntConfig.resetMode === 'soft-reset'} onChange={() => setHuntConfig(current => ({ ...current, resetMode: 'soft-reset' }))} />Soft reset</label>
                <label><input type="radio" name="hunt-reset-mode" value="exit-encounter" disabled={huntConfig.startMode === 'hoenn-starter'} checked={huntConfig.resetMode === 'exit-encounter'} onChange={() => setHuntConfig(current => ({ ...current, resetMode: 'exit-encounter' }))} />Sair do encounter</label>
              </div>
            </fieldset>
            <fieldset className="hunt-choice-group" disabled={huntRunning}>
              <legend>3. Condição de parada</legend>
              <div className="hunt-choice-options">
                <label><input type="radio" name="hunt-stop-mode" value="first-shiny" checked={huntConfig.stopMode === 'first-shiny'} onChange={() => setHuntConfig(current => ({ ...current, stopMode: 'first-shiny' }))} />Apenas um shiny</label>
                <label><input type="radio" name="hunt-stop-mode" value="all-shiny" checked={huntConfig.stopMode === 'all-shiny'} onChange={() => setHuntConfig(current => ({ ...current, stopMode: 'all-shiny' }))} />Todos shiny</label>
              </div>
            </fieldset>
          </div>
          <fieldset className="hunt-choice-group" disabled={huntRunning}>
            <legend>2. Iniciar encounter</legend>
            <div className="hunt-choice-options hunt-start-options">
              <label><input type="radio" name="hunt-start-mode" value="interact-a" checked={huntConfig.startMode === 'interact-a'} onChange={() => setHuntConfig(current => ({ ...current, startMode: 'interact-a' }))} />Interação com A</label>
              <label><input type="radio" name="hunt-start-mode" value="walk-right" checked={huntConfig.startMode === 'walk-right'} onChange={() => setHuntConfig(current => ({ ...current, startMode: 'walk-right' }))} />Andar para a direita</label>
              <label><input type="radio" name="hunt-start-mode" value="walk-left" checked={huntConfig.startMode === 'walk-left'} onChange={() => setHuntConfig(current => ({ ...current, startMode: 'walk-left' }))} />Andar para a esquerda</label>
              <label><input type="radio" name="hunt-start-mode" value="walk-up" checked={huntConfig.startMode === 'walk-up'} onChange={() => setHuntConfig(current => ({ ...current, startMode: 'walk-up' }))} />Andar para cima</label>
              <label><input type="radio" name="hunt-start-mode" value="common" checked={huntConfig.startMode === 'common'} onChange={() => setHuntConfig(current => ({ ...current, startMode: 'common' }))} />Encounter comum</label>
              <label><input type="radio" name="hunt-start-mode" value="hoenn-starter" checked={huntConfig.startMode === 'hoenn-starter'} aria-haspopup="dialog" onClick={() => setHuntStarterPickerOpen(true)} onKeyDown={event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); event.currentTarget.click() } }} onChange={() => setHuntConfig(current => ({ ...current, startMode: 'hoenn-starter', resetMode: 'soft-reset' }))} />{`Iniciais (${hoennStarterChoices.find(choice => choice.value === huntConfig.starterPosition)?.name ?? 'por jogo'})`}</label>
            </div>
          </fieldset>
          {huntStarterPickerOpen && !huntRunning && <HuntStarterPicker selectedPosition={huntConfig.starterPosition} onSelect={starterPosition => { setHuntConfig(current => ({ ...current, starterPosition })); setHuntStarterPickerOpen(false) }} onClose={() => setHuntStarterPickerOpen(false)} />}
          {huntStatus.phase === 'error' && <p role="alert">{huntErrorMessages[huntStatus.error] ?? huntStatus.error}</p>}
          {huntStatus.phase === 'found' && <p role="status">Shiny encontrado.</p>}
          <button className="hunt-modal-action" type="button" disabled={!huntRunning && huntConfig.startMode === 'hoenn-starter' && !huntConfig.starterPosition} onClick={huntRunning ? stopShinyHunt : startShinyHunt}>{huntRunning ? 'Parar' : 'Iniciar'}</button>
        </div>
      </div>
    </div>)}
    {activeSessions.length > 0 && <div className="player-overlay" role="dialog" aria-modal="true" aria-label="Emulator">
      <div className={`player-shell player-shell-${activeSessions.length}`} ref={playerShellRef}>
        <header className="player-header" inert={closeChooserOpen || saveCloseRows !== null || multiProfileRows !== null ? true : undefined}>
          <div className="player-global-controls">
            <div className="fast-forward-control">
              <Button className="fast-forward-button" htmlType="button" icon={<PlaybackGlyph paused={playerPaused[activeSessions[0]?.sessionId]} className="player-play-pause-glyph" />} aria-label={playerPaused[activeSessions[0]?.sessionId] ? 'Reproduzir todos' : 'Pausar todos'} title={playerPaused[activeSessions[0]?.sessionId] ? 'Reproduzir todos' : 'Pausar todos'} disabled={huntRunning} onMouseEnter={() => activeSessions[0] && requestPlaybackStatus(activeSessions[0].sessionId)} onClick={() => void toggleGlobalPlayback()} />
              <Button className="player-control-button" htmlType="button" icon={<InfoCircleOutlined />} aria-label="Informações do perfil" title="Informações do perfil" disabled={huntRunning || closeChooserOpen || saveCloseRows !== null || profileInfoSessionId !== null || multiProfileRows !== null} onClick={openHeaderProfileInfo} />
              <Button className={`fast-forward-button mute-button${muted ? ' is-active' : ''}`} htmlType="button" icon={muted ? <AudioMutedOutlined /> : <SoundOutlined />} aria-label={muted ? 'Desmutar áudio' : 'Mutar áudio'} title={muted ? 'Desmutar áudio' : 'Mutar áudio'} aria-pressed={muted} onClick={toggleMute} />
              <Button className={`fast-forward-button${fastForwardEnabled ? ' is-active' : ''}`} htmlType="button" icon={<FastForwardOutlined />} aria-label="Fast Forward" title="Fast Forward" aria-pressed={fastForwardEnabled} disabled={huntRunning} onClick={toggleFastForward} />
              <Select className="player-header-select player-speed-select" aria-label="Velocidade do Fast Forward" title="Velocidade do Fast Forward" value={fastForwardSpeed} suffixIcon={null} disabled={huntRunning} options={fastForwardSpeeds.map(speed => ({ value: speed, label: `${speed}×` }))} getPopupContainer={playerSelectPopupContainer} popupMatchSelectWidth={false} onChange={speed => { setFastForwardSpeed(speed); void saveUserPreferences({ fastForwardSpeed: speed }) }} />
            </div>
            <span className="player-header-separator" aria-hidden="true" />
            <div className="player-header-group">
              <Button className="player-control-button" htmlType="button" icon={<SaveOutlined />} aria-label="Salvar estado" title="Salvar estado" disabled={huntRunning || Boolean(snapshotRestoreRequests[selectedPlayerSessionId])} onClick={() => sendSelectedPlayerMessage('emulator-hub:save-state')} />
              <Button className="player-control-button" htmlType="button" icon={<UploadOutlined />} aria-label="Carregar estado" title="Carregar estado" disabled={huntRunning || !userStateAvailable[selectedPlayerSessionId] || Boolean(snapshotRestoreRequests[selectedPlayerSessionId])} onClick={() => sendSelectedPlayerMessage('emulator-hub:load-state')} />
              <Button className="player-control-button" htmlType="button" icon={<RedoOutlined />} aria-label="Soft Reset" title="Soft Reset" disabled={huntRunning} onClick={() => dispatchReset('emulator-hub:soft-reset')} />
              <Button className="player-control-button global-reset-button" htmlType="button" icon={<PoweroffOutlined />} aria-label="Hard Reset" title="Hard Reset" disabled={huntRunning} onClick={() => dispatchReset('emulator-hub:reset')} />
            </div>
            <span className="player-header-separator" aria-hidden="true" />
            <div className="player-header-group">
              <label className="trigger-action-control">L2
                <Select className="player-header-select player-trigger-select" aria-label="Ação do L2" title="Ação do L2" value={l2TriggerAction} suffixIcon={null} disabled={huntRunning} options={playerTriggerActionOptions} getPopupContainer={playerSelectPopupContainer} popupMatchSelectWidth={false} onChange={action => { setL2TriggerAction(action); void saveUserPreferences({ triggerActions: { l2: action } }) }} />
              </label>
              <label className="trigger-action-control">R2
                <Select className="player-header-select player-trigger-select" aria-label="Ação do R2" title="Ação do R2" value={r2TriggerAction} suffixIcon={null} disabled={huntRunning} options={playerTriggerActionOptions} getPopupContainer={playerSelectPopupContainer} popupMatchSelectWidth={false} onChange={action => { setR2TriggerAction(action); void saveUserPreferences({ triggerActions: { r2: action } }) }} />
              </label>
            </div>
            <span className="player-header-separator" aria-hidden="true" />
            <Button className="player-control-button" htmlType="button" icon={<svg viewBox="0 0 24 24" className="control-configuration-icon" aria-hidden="true">
              <path d="M7.1 8.5h9.8c1.5 0 2.8 1 3.2 2.45l1.08 4.15a2.35 2.35 0 0 1-4.08 2.1l-1.55-1.7H8.4l-1.55 1.7a2.35 2.35 0 0 1-4.08-2.1l1.08-4.15A3.3 3.3 0 0 1 7.1 8.5Z" />
              <path d="M7.3 11.15v3.1M5.75 12.7h3.1M16.35 11.8h.01M18.25 13.65h.01" />
            </svg>} aria-label="Configurar controles" title="Configurar controles" disabled={huntRunning} onClick={openControlPanel} />
            <Button className={`player-control-button${oddsManipulatorEnabled ? ' is-active' : ''}`} htmlType="button" icon={<NumberOutlined />} aria-label="Manipulador de odds" title="Manipulador de odds" aria-pressed={oddsManipulatorEnabled} disabled={huntRunning} onClick={toggleOddsManipulator} />
            <Button className={`player-control-button hunt-button${huntRunning ? ' is-active' : ''}`} htmlType="button" icon={<SearchOutlined />} aria-label={huntHeaderStops ? `Parar caça shiny, ${huntCount} tentativas` : `Configurar caça shiny, ${huntCount} tentativas`} title={huntHeaderStops ? 'Parar caça shiny' : huntStatus.phase === 'error' ? `Caça interrompida: ${huntErrorMessages[huntStatus.error] ?? huntStatus.error}` : huntStatus.phase === 'found' ? huntStatus.foundSessionId ? `Shiny em ${huntFoundSession?.profileName ?? huntStatus.foundSessionId}` : 'Todos os shinies encontrados' : 'Configurar caça shiny'} aria-haspopup={huntHeaderStops ? undefined : 'dialog'} aria-expanded={huntHeaderStops ? undefined : huntModalOpen} onClick={handleHuntButtonClick}>{huntCount}</Button>
            <Button className={`player-control-button${macroRunState.runId ? ' is-active' : ''}`} htmlType="button" icon={<ThunderboltOutlined />} aria-label={macroRunState.runId ? 'Parar macro em execução' : 'Macros'} title={macroRunState.phase === 'stopping' ? 'Parando macro' : macroRunState.runId ? 'Parar macro em execução' : 'Macros'} aria-expanded={macroModalOpen} onClick={handleMacroButtonClick} />
          </div>
          <div className="player-actions">
            {!isMobileLandscape && <>
              <Button className="player-add-button" htmlType="button" icon={<PlusOutlined />} aria-label="Adicionar instância" title="Adicionar instância" disabled={huntRunning || activeSessions.length >= MAX_PLAYER_INSTANCES} onClick={openInstancePicker} />
              <Button htmlType="button" icon={fullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />} aria-label={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'} title={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'} onClick={toggleFullscreen} />
            </>}
            <Button className="player-close-button" htmlType="button" icon={<CloseOutlined />} aria-label="Fechar emulador" title="Fechar emulador" onClick={closePlayer} />
          </div>
        </header>
        <div className={`player-panel player-panel-${activeSessions.length}`} inert={huntRunning || closeChooserOpen || saveCloseRows !== null || multiProfileRows !== null ? true : undefined}>
          <div className="player-grid">
            {activeSessions.map(session => <div className={`player-cell${(huntStatus.completedSessionIds?.includes(session.sessionId) || huntStatus.foundSessionIds?.includes(session.sessionId) || huntStatus.phase === 'found' && huntStatus.foundSessionId === session.sessionId) ? ' hunt-found' : ''}`} data-session-id={session.sessionId} key={`${session.gameId}:${session.profileId}`} onPointerDown={() => setFocusedSessionId(session.sessionId)} onMouseEnter={() => requestPlaybackStatus(session.sessionId)}>
              <iframe src={playerFrameUrl(session)} title="EmulatorJS" allow="fullscreen; gamepad" inert={profileInfoSessionId === session.sessionId ? true : undefined} onLoad={event => configurePlayerFrameOnLoad(event.currentTarget, session)} />
              <div className="player-cell-controls" role="group" aria-label={`Controles de ${session.profileName ?? session.gameTitle ?? 'emulador'}`}>
                <Button className="player-cell-playback" htmlType="button" icon={<PlaybackGlyph paused={playerPaused[session.sessionId]} className="player-cell-play-icon" />} aria-label={playerPaused[session.sessionId] ? 'Reproduzir este emulador' : 'Pausar este emulador'} title={playerPaused[session.sessionId] ? 'Reproduzir' : 'Pausar'} disabled={huntRunning} onClick={() => void togglePlayerPlayback(session.sessionId)} />
                <div className="player-cell-secondary-controls">
                  <Button htmlType="button" icon={<RedoOutlined />} aria-label="Reset deste emulador" title="Reset" disabled={huntRunning} onClick={() => void dispatchReset('emulator-hub:reset', session.sessionId)} />
                  <Button htmlType="button" icon={<SaveOutlined />} aria-label="Salvar estado deste emulador" title="Save State" disabled={huntRunning || Boolean(snapshotRestoreRequests[session.sessionId])} onClick={() => sendPlayerMessage('emulator-hub:save-state', session.sessionId)} />
                  <Button htmlType="button" icon={<UploadOutlined />} aria-label="Carregar estado deste emulador" title="Load State" disabled={huntRunning || !userStateAvailable[session.sessionId] || Boolean(snapshotRestoreRequests[session.sessionId])} onClick={() => sendPlayerMessage('emulator-hub:load-state', session.sessionId)} />
                  <Button htmlType="button" icon={<InfoCircleOutlined />} aria-label="Informações deste perfil" title="Informações do perfil" disabled={huntRunning || profileInfoSessionId !== null} onClick={() => openProfileInfo(session.sessionId)} />
                </div>
              </div>
              {profileInfoSessionId === session.sessionId && <div className="profile-info-overlay" role="dialog" aria-modal="true" aria-labelledby={`profile-info-title-${session.sessionId}`}>
                <form className="profile-info-card" onSubmit={submitProfileInfo}>
                  <h2 id={`profile-info-title-${session.sessionId}`}>Informações do perfil</h2>
                  <label htmlFor={`profile-info-name-${session.sessionId}`}>Nome</label>
                  <Input id={`profile-info-name-${session.sessionId}`} value={profileInfoName} onChange={event => setProfileInfoName(event.target.value)} maxLength={32} required disabled={profileInfoBusy} autoFocus />
                  {profileInfoError && <p role="alert">{profileInfoError}</p>}
                  <div className="profile-info-actions">
                    <Button htmlType="button" onClick={closeProfileInfo} disabled={profileInfoBusy}>Fechar</Button>
                    <Button htmlType="submit" disabled={profileInfoBusy}>{profileInfoBusy ? 'Salvando...' : 'Salvar'}</Button>
                  </div>
                </form>
              </div>}
              {snapshotRestoreRequests[session.sessionId] && <SnapshotRestorePrompt key={snapshotRestoreRequests[session.sessionId].requestId ?? 'pending'} request={snapshotRestoreRequests[session.sessionId]} onRestore={candidateId => snapshotRestoreRequests[session.sessionId].requestId && respondToRestore(session.sessionId, snapshotRestoreRequests[session.sessionId].requestId, candidateId)} onContinue={() => snapshotRestoreRequests[session.sessionId].requestId && respondToRestore(session.sessionId, snapshotRestoreRequests[session.sessionId].requestId, null)} />}
              {playerActionErrors[session.sessionId]?.length > 0 && <div className="player-action-errors" role="alert">{playerActionErrors[session.sessionId].map((message, index) => <p key={`${index}:${message}`}>{message}</p>)}</div>}
            </div>)}
          </div>
        </div>
        {multiProfileRows && <div className="profile-info-multi-overlay" role="dialog" aria-modal="true" aria-labelledby="profile-info-multi-title">
          <form className="profile-info-multi-card" onSubmit={submitMultiProfileInfo}>
            <h2 id="profile-info-multi-title">Informações dos perfis</h2>
            <div className="profile-info-multi-list">
              {multiProfileRows.map((row, index) => <div className="profile-info-multi-row" key={row.sessionId}>
                <span className="profile-info-multi-game">{row.gameTitle}</span>
                <div className="profile-info-multi-save">
                  <span className="profile-info-multi-number">#{row.number ?? '?'}</span>
                  <span className="profile-info-multi-separator" aria-hidden="true">-</span>
                  <Input aria-label={`Nome do save ${row.gameTitle} #${row.number ?? '?'}`} value={row.name} onChange={event => setMultiProfileRows(current => current.map(candidate => candidate.sessionId === row.sessionId ? { ...candidate, name: event.target.value } : candidate))} maxLength={32} required disabled={multiProfileBusy} autoFocus={index === 0} />
                </div>
              </div>)}
            </div>
            {multiProfileError && <p className="profile-info-multi-error" role="alert">{multiProfileError}</p>}
            <div className="profile-info-actions">
              <Button htmlType="button" onClick={closeMultiProfileInfo} disabled={multiProfileBusy}>Fechar</Button>
              <Button htmlType="submit" disabled={multiProfileBusy}>{multiProfileBusy ? 'Salvando...' : 'Salvar'}</Button>
            </div>
          </form>
        </div>}
      </div>
    </div>}
    {closeChooserOpen && !saveCloseRows && renderLayer(<div className="close-chooser-overlay" role="dialog" aria-modal="true" aria-labelledby="close-chooser-title">
      <div className="close-chooser-panel">
        <h2 id="close-chooser-title">Fechar emuladores</h2>
        <button type="button" className="close-chooser-all" autoFocus onClick={() => setSelectedCloseSessionIds(selectedCloseSessionIds.size === activeSessions.length ? new Set() : new Set(activeSessions.map(session => session.sessionId)))}>
          {selectedCloseSessionIds.size === activeSessions.length ? 'Desselecionar tudo' : 'Selecionar tudo'}
        </button>
        <ul className="close-chooser-list">
          {activeSessions.map(session => {
            const game = games.find(candidate => candidate.id === session.gameId)
            const profileLabel = formatGameProfileLabel({ id: session.profileId, name: session.profileName ?? session.profileId }, game?.profiles ?? [])
            return <li key={session.sessionId}><label>
              <input type="checkbox" checked={selectedCloseSessionIds.has(session.sessionId)} onChange={() => setSelectedCloseSessionIds(current => { const next = new Set(current); if (next.has(session.sessionId)) next.delete(session.sessionId); else next.add(session.sessionId); return next })} />
              <span>{session.gameTitle ?? session.gameId} | {profileLabel}</span>
            </label></li>
          })}
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
