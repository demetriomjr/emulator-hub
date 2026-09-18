import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { DragDropProvider, DragOverlay, useDraggable, useDroppable } from '@dnd-kit/react'
import { PointerActivationConstraints, PointerSensor } from '@dnd-kit/dom'
import { Button, ConfigProvider, Form, Input, Modal, Popconfirm, Select } from 'antd'
import { CloseOutlined, DeleteOutlined, EditOutlined, FolderAddOutlined, InboxOutlined, LeftOutlined, PlusOutlined, RightOutlined } from '@ant-design/icons'
import { closePokemonHubSession, createPokemonHubProfile, createProfile, deletePokemonHubProfile, deleteProfile as deleteProfileRequest, getControlProfile, getGames, getLaunch, getPokemonHub, getPokemonHubProfiles, getSaveProfileLayout, heartbeatPokemonHubSession, openPokemonHubSession, renamePokemonHubProfile, syncPokemonHubSessionSnapshot, updateControlProfile, updateProfile } from '../../packages/hub-client.js'
import { activeGamepadBindings, readGamepadBinding, readGamepadSnapshot } from '../../packages/gamepad-input.mjs'
import { isPokemonHubDraggable, pokemonHubDragId } from '../../packages/pokemon-hub-drag-identity.mjs'
import { getPokemonHubColumnCount, getPokemonHubGridWidth, getPokemonHubVisibleSlotCount } from '../../packages/pokemon-hub-grid.mjs'
import { createPokemonHubHeartbeatMonitor } from '../../packages/pokemon-hub-heartbeat-monitor.mjs'
import { createPokemonHubRequestGate } from '../../packages/pokemon-hub-request-gate.mjs'
import { createPokemonHubSnapshotFlight } from '../../packages/pokemon-hub-snapshot-flight.mjs'
import { pokemonHubLocationKey } from '../../packages/pokemon-hub-location-key.mjs'
import { getNextSaveBoxIndex, getPreviousSaveBoxIndex, getSaveBoxSlotPosition, getSavePartySlotPosition } from '../../packages/pokemon-save-layout-grid.mjs'
import { getPokemonSlotSprite, hidePokemonSlotSprite } from '../../packages/pokemon-slot-sprite.mjs'
import { createGameSessionSourceSnapshot, snapshotToSaveLayout, visiblePokemonHubPanes } from '../../packages/pokemon-hub-session-view.mjs'
import { deriveSaveProfileCatalog, replaceCatalogProfile } from '../../packages/save-profile-catalog.mjs'
import { activePaneSourceKind, addWorkspacePane, choosePaneSource, createPokemonHubWorkspaceState, firstAvailableHubSource, firstAvailableSaveSource, hasAvailableSaveProfile, isCompletePaneSource, isPaneSourceAvailable, removeWorkspacePane } from '../../packages/pokemon-hub-workspace.mjs'
import { groupGamesByLayout } from '../../packages/hub-layout.mjs'
import { getProfilePickerPlacement } from '../../packages/profile-picker-placement.mjs'
import { appendClientDiagnosticsParameters, createClientDiagnostics, getClientDiagnosticsOptions } from '../../packages/client-diagnostics.mjs'
import { closePlayerAfterSaveAttempts } from '../../packages/player-close.mjs'
import { isNarrowPortraitViewport } from '../../packages/mobile-viewport.mjs'
import { shouldReloadForFrontendRevision } from '../../packages/frontend-revision.mjs'
import hubLayout from './hub-layout.json'
import './styles.css'

const clientDiagnosticsOptions = getClientDiagnosticsOptions(window.location.search)
if (clientDiagnosticsOptions.enabled) {
  createClientDiagnostics({ browser: window, source: 'hub', sessionId: clientDiagnosticsOptions.sessionId })
}

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

const fastForwardSpeeds = Object.freeze([1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5])
const configuredPlayerFrames = new WeakSet()
const pokemonHubDragSensors = [PointerSensor.configure({
  activationConstraints: [new PointerActivationConstraints.Distance({ value: 6 })],
})]
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
  frame.contentWindow?.postMessage(message, window.location.origin)
  const root = frame.contentDocument?.getElementById('game')
  if (!root || configuredPlayerFrames.has(frame)) return

  const hideFastForwardOverlay = () => {
    for (const overlay of root.querySelectorAll('.ejs_message')) {
      if (/fast[-\s]?forward/i.test(overlay.textContent)) {
        overlay.style.setProperty('display', 'none', 'important')
      } else {
        overlay.style.removeProperty('display')
      }
    }
  }

  const observer = new MutationObserver(hideFastForwardOverlay)
  observer.observe(root, { childList: true, characterData: true, subtree: true })
  hideFastForwardOverlay()
  configuredPlayerFrames.add(frame)
}

function playerFrameUrl(session) {
  const parameters = appendClientDiagnosticsParameters(new URLSearchParams({
    id: session.gameId,
    profileId: session.profileId,
    fastForward: session.initialFastForwardEnabled ? '1' : '0',
    fastForwardSpeed: String(session.initialFastForwardSpeed),
  }), clientDiagnosticsOptions)
  return `/player.html?${parameters}`
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
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [catalogError, setCatalogError] = useState('')
  const [activeSessions, setActiveSessions] = useState([])
  const [instancePicker, setInstancePicker] = useState(false)
  const [controlPanelOpen, setControlPanelOpen] = useState(false)
  const [controlDraft, setControlDraft] = useState(null)
  const [controlError, setControlError] = useState('')
  const [controlSaving, setControlSaving] = useState(false)
  const [captureTarget, setCaptureTarget] = useState(null)
  const [controlRevision, setControlRevision] = useState(0)
  const [pokemonHubOpen, setPokemonHubOpen] = useState(false)
  const [pokemonHubProfile, setPokemonHubProfile] = useState(null)
  const [pokemonHubData, setPokemonHubData] = useState(null)
  const [pokemonHubError, setPokemonHubError] = useState('')
  const [pokemonHubSnapshotStatus, setPokemonHubSnapshotStatus] = useState('')
  const [pokemonHubSelection, setPokemonHubSelection] = useState([])
  const [pokemonHubActiveDrag, setPokemonHubActiveDrag] = useState(null)
  const [pokemonHubBusy, setPokemonHubBusy] = useState(false)
  const [pokemonHubPanes, setPokemonHubPanes] = useState([null])
  const [pokemonHubBoxes, setPokemonHubBoxes] = useState({})
  const [pokemonHubProfiles, setPokemonHubProfiles] = useState([])
  const [pokemonHubProfilesLoading, setPokemonHubProfilesLoading] = useState(false)
  const [saveLayoutsBySource, setSaveLayoutsBySource] = useState({})
  const [pokemonHubSnapshots, setPokemonHubSnapshots] = useState({})
  const [saveLayoutsLoading, setSaveLayoutsLoading] = useState({})
  const [saveLayoutsError, setSaveLayoutsError] = useState({})
  const [pokemonHubProfileCreator, setPokemonHubProfileCreator] = useState(null)
  const [pokemonHubProfileName, setPokemonHubProfileName] = useState('')
  const [pokemonHubProfileRenaming, setPokemonHubProfileRenaming] = useState(null)
  const [pokemonHubProfileRenameName, setPokemonHubProfileRenameName] = useState('')
  const [fastForwardEnabled, setFastForwardEnabled] = useState(false)
  const [fastForwardSpeed, setFastForwardSpeed] = useState(1.5)
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
  const [error, setError] = useState('')
  const [installHelpOpen, setInstallHelpOpen] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [viewport, setViewport] = useState(readViewport)
  const playerShellRef = useRef(null)
  const pokemonHubSessionRef = useRef(null)
  const pokemonHubSessionOpeningRef = useRef(null)
  const pokemonHubSnapshotTimerRef = useRef(null)
  const pokemonHubPanesRef = useRef(pokemonHubPanes)
  const pokemonHubSnapshotsRef = useRef({})
  pokemonHubPanesRef.current = pokemonHubPanes
  const { profilesByGame: saveProfilesByGame, saveProfileGames } = deriveSaveProfileCatalog(games)

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
    if (!activeSessions.length && !profileGame && !instancePicker && !controlPanelOpen && !pokemonHubOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const syncFullscreen = () => setFullscreen(document.fullscreenElement === playerShellRef.current)
    const onKeyDown = event => {
      if (event.key === 'Escape' && !document.fullscreenElement) {
        if (controlPanelOpen) {
          setControlPanelOpen(false)
          setCaptureTarget(null)
        } else if (pokemonHubOpen) void closePokemonHub()
        else if (profileGame) {
          setProfileGame(null)
          setProfilePickerPlacement(null)
          setCreatingProfile(false)
        }
        else if (instancePicker) setInstancePicker(false)
        else setActiveSessions([])
      }
    }
    document.addEventListener('fullscreenchange', syncFullscreen)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('fullscreenchange', syncFullscreen)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [activeSessions.length, controlPanelOpen, instancePicker, profileGame, pokemonHubOpen])

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
    const broadcast = bindings => {
      for (const frame of document.querySelectorAll('.player-grid iframe')) {
        frame.contentWindow?.postMessage({ type: 'emulator-hub:gamepad', bindings }, window.location.origin)
      }
    }
    // Poll the parent document so header clicks and focus in another emulator
    // do not silence controllers. A full snapshot also reaches newly loaded frames.
    const poll = () => broadcast(controlPanelOpen || profileGame || instancePicker || document.hidden
      ? []
      : activeGamepadBindings(readGamepadSnapshot()))
    poll()
    const interval = window.setInterval(poll, 16)
    document.addEventListener('visibilitychange', poll)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', poll)
      broadcast([])
    }
  }, [activeSessions.length, controlPanelOpen, profileGame, instancePicker])

  useEffect(() => {
    const message = { type: 'emulator-hub:fast-forward', enabled: fastForwardEnabled, speed: fastForwardSpeed }
    for (const frame of document.querySelectorAll('.player-grid iframe')) {
      configurePlayerFrame(frame, message)
    }
  }, [activeSessions, fastForwardEnabled, fastForwardSpeed])

  useEffect(() => {
    if (!pokemonHubOpen) return
    const renew = async () => {
      const session = pokemonHubSessionRef.current
      if (!session || session.heartbeatInFlight) return
      session.heartbeatInFlight = true
      try {
        const result = await session.heartbeatMonitor.observe(async () => {
          const sentAt = performance.now()
          const renewal = await heartbeatPokemonHubSession(session.profileId, session.sessionId, ++session.heartbeatSequence)
          session.leaseSample = { serverNow: renewal.serverNow, expiresAt: renewal.expiresAt, sentAt, receivedAt: performance.now() }
        }, {
          waitUntilReady: session.requestGate.isInFlight()
            ? async () => await session.requestGate.waitForIdle() && pokemonHubSessionRef.current === session
            : undefined,
        })
        if (result.status === 'cancelled') return
        if (result.status === 'expired' && pokemonHubSessionRef.current === session) {
          console.error('[Pokemon Hub] session heartbeat expired locally', { code: result.error.code, failures: result.failures })
          endPokemonHubSessionLocally(result.error)
        }
      } finally {
        session.heartbeatInFlight = false
      }
    }
    const interval = window.setInterval(renew, 3_000)
    return () => window.clearInterval(interval)
  }, [pokemonHubOpen])

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement === playerShellRef.current) await document.exitFullscreen()
      else await playerShellRef.current.requestFullscreen()
    } catch (cause) {
      setError(cause.message)
    }
  }

  async function closePlayer() {
    const result = await closePlayerAfterSaveAttempts({
      saveAttempts: [...document.querySelectorAll('.player-grid iframe')].map(frame => flushPlayerSave(frame)),
      close: async () => {
        try {
          if (document.fullscreenElement === playerShellRef.current) await document.exitFullscreen()
        } catch {
          // The player still needs to close if the browser rejects leaving fullscreen.
        }
        setActiveSessions([])
        setFullscreen(false)
      },
    })
    if (result.failures.length > 0) setError('O emulador foi fechado, mas alguns saves não puderam ser sincronizados.')
  }

  function flushPlayerSave(frame) {
    return new Promise((resolve, reject) => {
      const requestId = `${Date.now()}-${Math.random()}`
      const timeout = window.setTimeout(() => finish(new Error('tempo esgotado')), 5000)
      const receive = event => {
        if (event.origin !== window.location.origin || event.source !== frame.contentWindow || event.data?.type !== 'emulator-hub:save-synced' || event.data.requestId !== requestId) return
        finish(event.data.ok ? null : new Error(event.data.error || 'upload falhou'))
      }
      const finish = error => {
        window.clearTimeout(timeout)
        window.removeEventListener('message', receive)
        if (error) reject(error)
        else resolve()
      }
      window.addEventListener('message', receive)
      frame.contentWindow?.postMessage({ type: 'emulator-hub:sync-save', requestId }, window.location.origin)
    })
  }

  async function openProfilePicker(game, purpose = 'launch', anchor = null) {
    setError('')
    setProfileError('')
    setProfileName('')
    setEditingProfileId(null)
    setCreatingProfile(false)
    setProfilePurpose(purpose)
    setProfilePickerPlacement(getProfilePickerPlacement(anchor, { width: window.innerWidth, height: window.innerHeight }))
    setProfileGame(game)
    setProfiles(game.profiles ?? [])
  }

  function updateCachedProfiles(gameId, transform) {
    setGames(current => current.map(game => game.id === gameId
      ? { ...game, profiles: transform(game.profiles ?? []) }
      : game))
  }

  async function launchWithProfile(profile) {
    setError('')
    setProfileError('')
    setProfileBusy(true)
    try {
      const game = profileGame
      await getLaunch(game.id, profile.id)
      setProfileGame(null)
      setProfilePickerPlacement(null)
      const session = {
        gameId: game.id,
        profileId: profile.id,
        initialFastForwardEnabled: fastForwardEnabled,
        initialFastForwardSpeed: fastForwardSpeed,
      }
      if (profilePurpose === 'add-instance') {
        setActiveSessions(current => [...current, session])
      } else {
        setActiveSessions([session])
      }
    } catch (cause) {
      setProfileError(cause.message)
    } finally {
      setProfileBusy(false)
    }
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

  function openInstancePicker() {
    setError('')
    setInstancePicker(true)
  }

  async function openControlPanel() {
    setControlError('')
    setCaptureTarget(null)
    setControlPanelOpen(true)
    try {
      const profile = await getControlProfile()
      setControlDraft(structuredClone(profile))
    } catch (cause) {
      setControlError(cause.message)
    }
  }

  async function openPokemonHub() {
    const workspace = createPokemonHubWorkspaceState()
    setPokemonHubError('')
    setPokemonHubData(null)
    setPokemonHubSelection([])
    setPokemonHubProfile(workspace.profile)
    setPokemonHubPanes(workspace.panes)
    setPokemonHubBoxes(workspace.boxes)
    setPokemonHubProfiles([])
    setSaveLayoutsBySource({})
    pokemonHubSnapshotsRef.current = {}
    setPokemonHubSnapshots({})
    pokemonHubSessionRef.current = null
    pokemonHubSessionOpeningRef.current = null
    if (pokemonHubSnapshotTimerRef.current !== null) window.clearTimeout(pokemonHubSnapshotTimerRef.current)
    pokemonHubSnapshotTimerRef.current = null
    setSaveLayoutsLoading({})
    setSaveLayoutsError({})
    setPokemonHubProfileCreator(null)
    setPokemonHubProfileRenaming(null)
    setPokemonHubProfileName('')
    setPokemonHubOpen(true)
    void loadPokemonHubProfiles()
  }

  async function loadPokemonHubProfiles() {
    setPokemonHubProfilesLoading(true)
    try {
      const response = await getPokemonHubProfiles()
      setPokemonHubProfiles(response.profiles)
    } catch (cause) { setPokemonHubError(cause.message) } finally { setPokemonHubProfilesLoading(false) }
  }

  async function loadSaveLayout(gameId, profileId) {
    const key = saveSourceKey(gameId, profileId)
    if (saveLayoutsBySource[key] || saveLayoutsLoading[key]) return
    setSaveLayoutsLoading(current => ({ ...current, [key]: true }))
    setSaveLayoutsError(current => ({ ...current, [key]: '' }))
    try {
      const layout = await getSaveProfileLayout(gameId, profileId)
      const sourceSnapshot = createGameSessionSourceSnapshot({ profileId, gameId, layout })
      commitSessionSnapshots({ ...pokemonHubSnapshotsRef.current, [key]: sourceSnapshot })
      setSaveLayoutsBySource(current => ({ ...current, [key]: snapshotToSaveLayout(sourceSnapshot, layout) }))
      return sourceSnapshot
    } catch (cause) {
      if (cause.code === 'SAVE_MISSING') setSaveLayoutsBySource(current => ({ ...current, [key]: { missing: true } }))
      else setSaveLayoutsError(current => ({ ...current, [key]: cause.message }))
      throw cause
    } finally { setSaveLayoutsLoading(current => ({ ...current, [key]: false })) }
  }

  async function ensurePokemonHubSession(profileId) {
    const current = pokemonHubSessionRef.current
    if (current?.profileId === profileId) return current
    if (current) throw new Error('The workspace session is already bound to another save profile.')
    const opening = pokemonHubSessionOpeningRef.current
    if (opening) {
      if (opening.profileId !== profileId) throw new Error('The workspace session is already bound to another save profile.')
      return opening.promise
    }
    const promise = openPokemonHubSession(profileId).then(opened => {
      const receivedAt = performance.now()
      const session = { profileId, sessionId: opened.sessionId, version: opened.snapshot.revision, heartbeatSequence: 0, heartbeatInFlight: false, heartbeatMonitor: createPokemonHubHeartbeatMonitor(), requestGate: createPokemonHubRequestGate(), leaseSample: { serverNow: opened.serverNow, expiresAt: opened.expiresAt, sentAt: receivedAt, receivedAt } }
      session.snapshotFlight = createPokemonHubSnapshotFlight({
        capture: () => createCanonicalPokemonHubSnapshot(session, pokemonHubPanesRef.current, pokemonHubSnapshotsRef.current),
        send: request => session.requestGate.run(() => syncPokemonHubSessionSnapshot(session.profileId, session.sessionId, request.snapshot, request.idempotencyKey)),
        onAccepted: snapshot => {
          if (pokemonHubSessionRef.current !== session) return
          session.version = snapshot.revision + 1
          setPokemonHubSnapshotStatus('Snapshot sincronizado.')
        },
        onCorrection: snapshot => {
          if (pokemonHubSessionRef.current !== session) return
          setPokemonHubSnapshotStatus('')
          applyCanonicalSessionSnapshot(snapshot)
          setPokemonHubError('The backend corrected the workspace snapshot.')
        },
        onFailure: cause => {
          if (pokemonHubSessionRef.current !== session) return
          setPokemonHubSnapshotStatus('')
          console.error('[Pokemon Hub] snapshot synchronization failed', { code: cause.code, message: cause.message })
          endPokemonHubSessionLocally(cause)
        },
      })
      pokemonHubSessionRef.current = session
      return session
    }).finally(() => { pokemonHubSessionOpeningRef.current = null })
    pokemonHubSessionOpeningRef.current = { profileId, promise }
    return promise
  }

  async function completePokemonHubDrag(event) {
    const source = event.operation.source?.data?.location
    const target = event.operation.target?.data?.location
    if (source && target) {
      await persistPokemonHubSessionMove(source, target)
      setPokemonHubActiveDrag(null)
      return
    }
    setPokemonHubActiveDrag(null)
  }

  async function persistPokemonHubSessionMove(source, target) {
    const profileId = source.kind === 'game' ? source.profileId : target.kind === 'game' ? target.profileId : pokemonHubSessionRef.current?.profileId
    if (!profileId) {
      setPokemonHubError('Load a save before moving a Pokémon in this workspace.')
      return
    }
    if ([source, target].some(location => location.kind === 'game' && location.profileId !== profileId)) {
      setPokemonHubError('All workspace sources must belong to the same save profile.')
      return
    }

    setPokemonHubError('')
    setPokemonHubSnapshotStatus('')
    try {
      const session = await ensurePokemonHubSession(profileId)
      const sourceSnapshot = await ensureHubSessionSource(profileId, source)
      const targetSnapshot = await ensureHubSessionSource(profileId, target)
      if (!sourceSnapshot?.sourceKey || !targetSnapshot?.sourceKey) throw new Error('The workspace source is not ready for movement.')
      const fromSlot = sessionSlot(source, saveLayoutsBySource)
      const toSlot = sessionSlot(target, saveLayoutsBySource)
      const pokemonInstanceId = sourceSnapshot.placements?.[fromSlot]?.pokemonInstanceId
      if (!pokemonInstanceId) throw new Error('The authoritative source slot is empty.')
      if (targetSnapshot.placements?.[toSlot]?.pokemonInstanceId && sourceSnapshot.sourceKey !== targetSnapshot.sourceKey) {
        setPokemonHubError('A Pokémon cannot replace an occupied slot in another source.')
        return
      }
      if (target.area === 'party' && !targetSnapshot.placements?.[toSlot]?.pokemonInstanceId) {
        const firstVacantPartySlot = targetSnapshot.placements.findIndex(placement => placement.location.area === 'party' && !placement.pokemonInstanceId)
        if (target.slot !== firstVacantPartySlot) {
          setPokemonHubError('A Pokémon can only enter the first empty Party slot.')
          return
        }
      }
      if (source.area === 'party' && target.area !== 'party' && sourceSnapshot.sourceKey !== targetSnapshot.sourceKey && sourceSnapshot.placements.filter(placement => placement.location.area === 'party' && placement.pokemonInstanceId).length === 1) {
        setPokemonHubError('A save Party must keep at least one Pokémon.')
        return
      }
      applyLocalSessionMove(sourceSnapshot, targetSnapshot, fromSlot, toSlot, pokemonInstanceId)
      schedulePokemonHubSnapshot()
      console.log('[Pokemon Hub] local snapshot marked dirty', { source, target })
    } catch (cause) {
      console.error('[Pokemon Hub] session move failed', { source, target, code: cause.code, message: cause.message })
      setPokemonHubError(cause.message)
    }
  }

  async function ensureHubSessionSource(profileId, location) {
    const key = location.kind === 'hub' ? `hub:${location.hubProfileId}` : saveSourceKey(location.gameId, location.profileId)
    if (pokemonHubSnapshotsRef.current[key]) return pokemonHubSnapshotsRef.current[key]
    if (location.kind === 'game') throw new Error('The source save is not loaded in this workspace.')
    const profile = pokemonHubProfiles.find(candidate => candidate.hubProfileId === location.hubProfileId)
    if (!profile) throw new Error('The Hub profile is not available.')
    const sourceSnapshot = createHubSessionSourceSnapshot({ profileId, hubProfileId: location.hubProfileId, source: sourceProjectionFromHubProfile(profile) })
    commitSessionSnapshots({ ...pokemonHubSnapshotsRef.current, [key]: sourceSnapshot })
    return sourceSnapshot
  }

  function applyLocalSessionMove(sourceSnapshot, targetSnapshot, fromSlot, toSlot, pokemonInstanceId) {
    const next = { ...pokemonHubSnapshotsRef.current }
    const swappedPokemonInstanceId = sourceSnapshot.sourceKey === targetSnapshot.sourceKey
      ? sourceSnapshot.placements[toSlot]?.pokemonInstanceId ?? null
      : null
    const movedPokemonDisplay = sourceSnapshot.pokemonDisplay?.[pokemonInstanceId]
    for (const [key, snapshot] of Object.entries(next)) {
      const placements = snapshot.placements?.map(placement => ({ ...placement }))
      if (!placements) continue
      if (snapshot.sourceKey === sourceSnapshot.sourceKey) placements[fromSlot].pokemonInstanceId = swappedPokemonInstanceId
      if (snapshot.sourceKey === targetSnapshot.sourceKey) placements[toSlot].pokemonInstanceId = pokemonInstanceId
      compactLocalParty(placements)
      next[key] = {
        ...snapshot,
        placements,
        pokemonDisplay: snapshot.sourceKey === targetSnapshot.sourceKey && movedPokemonDisplay
          ? { ...snapshot.pokemonDisplay, [pokemonInstanceId]: movedPokemonDisplay }
          : snapshot.pokemonDisplay,
      }
    }
    commitSessionSnapshots(next)
  }

  async function submitStructuralPokemonHubPaneChange(nextPanes, incomingSource, { retainBusy = false } = {}) {
    setPokemonHubBusy(true)
    setPokemonHubError('')
    setPokemonHubSnapshotStatus('')
    try {
      const profileId = incomingSource?.kind === 'game'
        ? incomingSource.profileId
        : pokemonHubSessionRef.current?.profileId ?? pokemonHubProfiles.find(profile => profile.hubProfileId === incomingSource?.hubProfileId)?.ownerProfileId
      if (!profileId) throw new Error('Open a game save before selecting this Hub profile.')
      if (!await flushPendingPokemonHubSnapshot()) throw new Error('The workspace snapshot could not be synchronized before changing a pane.')

      const nextSnapshots = { ...pokemonHubSnapshotsRef.current }
      let loadedSave = null
      if (incomingSource?.kind === 'game') {
        const layout = await getSaveProfileLayout(incomingSource.gameId, incomingSource.profileId)
        const key = saveSourceKey(incomingSource.gameId, incomingSource.profileId)
        const sourceSnapshot = createGameSessionSourceSnapshot({ profileId, gameId: incomingSource.gameId, layout })
        nextSnapshots[key] = sourceSnapshot
        loadedSave = { key, layout, sourceSnapshot }
      } else if (incomingSource?.kind === 'hub') {
        const profile = pokemonHubProfiles.find(candidate => candidate.hubProfileId === incomingSource.hubProfileId)
        if (!profile) throw new Error('The Hub profile is not available.')
        nextSnapshots[`hub:${incomingSource.hubProfileId}`] = createHubSessionSourceSnapshot({ profileId, hubProfileId: incomingSource.hubProfileId, source: sourceProjectionFromHubProfile(profile) })
      }
      const session = await ensurePokemonHubSession(profileId)
      const candidate = createCanonicalPokemonHubSnapshot(session, nextPanes, nextSnapshots)
      const correction = await session.requestGate.run(() => syncPokemonHubSessionSnapshot(session.profileId, session.sessionId, candidate, crypto.randomUUID()))
      if (correction) {
        applyCanonicalSessionSnapshot(correction)
        setPokemonHubError('The backend corrected the workspace snapshot.')
        return false
      }
      session.version = candidate.revision + 1
      setPokemonHubSnapshotStatus('Snapshot sincronizado.')
      setPokemonHubPanes(nextPanes)
      commitSessionSnapshots(nextSnapshots)
      if (loadedSave) setSaveLayoutsBySource(current => ({ ...current, [loadedSave.key]: snapshotToSaveLayout(loadedSave.sourceSnapshot, loadedSave.layout) }))
      setPokemonHubSelection([])
      setPokemonHubProfileCreator(null)
      return true
    } catch (cause) {
      console.error('[Pokemon Hub] structural snapshot failed', { code: cause.code, message: cause.message })
      setPokemonHubError(cause.message)
      return false
    } finally { if (!retainBusy) setPokemonHubBusy(false) }
  }

  function applyCanonicalSessionSnapshot(snapshot) {
    const session = pokemonHubSessionRef.current
    if (session) session.version = snapshot.revision
    const panes = visiblePokemonHubPanes(snapshot.panes, pokemonHubPanesRef.current.length, session?.profileId)
    const next = {}
    for (const pane of snapshot.panes.slice(0, pokemonHubPanes.length)) {
      if (pane === null) continue
      const key = pane.profile.type === 'hub-profile' ? `hub:${pane.profile.hubProfileId}` : saveSourceKey(pane.profile.gameId, session?.profileId)
      const existing = pokemonHubSnapshotsRef.current[key]
      if (!existing) continue
      const requested = canonicalPaneOccupancy(pane)
      next[key] = { ...existing, placements: existing.placements.map(placement => ({ ...placement, pokemonInstanceId: requested.get(pokemonHubLocationKey(placement.location)) ?? null })) }
    }
    setPokemonHubPanes(panes)
    commitSessionSnapshots(next)
    setPokemonHubSelection([])
  }

  function schedulePokemonHubSnapshot() {
    const session = pokemonHubSessionRef.current
    if (!session) return
    if (!session.snapshotFlight.markDirty()) return
    if (session.snapshotFlight.isInFlight()) return
    if (pokemonHubSnapshotTimerRef.current !== null) window.clearTimeout(pokemonHubSnapshotTimerRef.current)
    pokemonHubSnapshotTimerRef.current = window.setTimeout(() => {
      pokemonHubSnapshotTimerRef.current = null
      void flushPokemonHubSnapshot()
    }, snapshotDispatchDelay(session))
  }

  async function flushPokemonHubSnapshot() {
    const session = pokemonHubSessionRef.current
    return session ? session.snapshotFlight.flush() : true
  }

  async function flushPendingPokemonHubSnapshot() {
    const session = pokemonHubSessionRef.current
    return session ? session.snapshotFlight.drain() : true
  }

  function commitSessionSnapshots(next) {
    pokemonHubSnapshotsRef.current = next
    setPokemonHubSnapshots(next)
    projectSessionSnapshots(next)
  }

  function projectSessionSnapshots(snapshots) {
    setSaveLayoutsBySource(current => Object.fromEntries(Object.entries(current).map(([key, layout]) => {
      const snapshot = snapshots[key]
      return snapshot?.kind === 'game' && snapshot.layout ? [key, snapshotToSaveLayout(snapshot, snapshot.layout)] : [key, layout]
    })))
    setPokemonHubProfiles(current => current.map(profile => {
      const snapshot = snapshots[`hub:${profile.hubProfileId}`]
      return snapshot?.kind === 'hub' ? { ...profile, grid: { entries: projectHubEntries(snapshot) } } : profile
    }))
  }

  function selectPokemonHubPane(index, source) {
    const result = choosePaneSource(pokemonHubPanes, index, source || null)
    if (result.error) { setPokemonHubError(result.error); return }
    if (source && !isCompletePaneSource(source)) return
    void submitStructuralPokemonHubPaneChange(result.panes, source)
  }

  function addPokemonHubPane() {
    try {
      setPokemonHubPanes(current => addWorkspacePane(current))
      setPokemonHubSelection([])
      setPokemonHubError('')
    } catch (cause) { setPokemonHubError(cause.message) }
  }

  async function closePokemonHubPane(index) {
    try {
      await submitStructuralPokemonHubPaneChange(removeWorkspacePane(pokemonHubPanes, index), null)
    } catch (cause) { setPokemonHubError(cause.message) }
  }

  async function closePokemonHub() {
    setPokemonHubBusy(true)
    if (pokemonHubSnapshotTimerRef.current !== null) window.clearTimeout(pokemonHubSnapshotTimerRef.current)
    pokemonHubSnapshotTimerRef.current = null
    const session = pokemonHubSessionRef.current
    const finalSnapshot = session ? createCanonicalPokemonHubSnapshot(session, pokemonHubPanesRef.current, pokemonHubSnapshotsRef.current) : null
    pokemonHubSnapshotsRef.current = {}
    setPokemonHubSnapshots({})
    pokemonHubSessionRef.current = null
    pokemonHubSessionOpeningRef.current = null
    setPokemonHubOpen(false)
    setPokemonHubBusy(false)
    if (!session) return
    try {
      const correction = await closePokemonHubSession(session.profileId, session.sessionId, finalSnapshot, session.pendingCloseIdempotencyKey ??= crypto.randomUUID())
      if (correction) console.error('[Pokemon Hub] close snapshot corrected after local shutdown')
    } catch (cause) {
      console.error('[Pokemon Hub] remote close failed; heartbeat expiry will finalize the session', { code: cause.code, message: cause.message })
    }
  }

  function endPokemonHubSessionLocally(cause) {
    if (pokemonHubSnapshotTimerRef.current !== null) window.clearTimeout(pokemonHubSnapshotTimerRef.current)
    pokemonHubSnapshotTimerRef.current = null
    pokemonHubSnapshotsRef.current = {}
    setPokemonHubSnapshots({})
    pokemonHubSessionRef.current = null
    pokemonHubSessionOpeningRef.current = null
    setPokemonHubActiveDrag(null)
    setPokemonHubOpen(false)
    setPokemonHubError(cause.message)
  }

  function openPokemonHubProfileCreator(index) {
    setPokemonHubError('')
    setPokemonHubProfileCreator(index)
    setPokemonHubProfileName('')
  }

  async function createHubProfile(index) {
    setPokemonHubBusy(true)
    setPokemonHubError('')
    try {
      const profile = await createPokemonHubProfile({ name: pokemonHubProfileName })
      setPokemonHubProfiles(current => [...current, profile])
      setPokemonHubProfileCreator(null)
      selectPokemonHubPane(index, { kind: 'hub', hubProfileId: profile.hubProfileId })
    } catch (cause) { setPokemonHubError(cause.message) } finally { setPokemonHubBusy(false) }
  }

  function openPokemonHubProfileRenamer(profile) {
    setPokemonHubError('')
    setPokemonHubProfileRenaming(profile)
    setPokemonHubProfileRenameName(profile.name)
  }

  async function renameHubProfile() {
    if (!pokemonHubProfileRenaming) return
    setPokemonHubBusy(true)
    setPokemonHubError('')
    try {
      const renamed = await renamePokemonHubProfile(pokemonHubProfileRenaming.hubProfileId, pokemonHubProfileRenameName)
      setPokemonHubProfiles(current => current.map(profile => profile.hubProfileId === renamed.hubProfileId ? renamed : profile))
      setPokemonHubProfileRenaming(null)
    } catch (cause) { setPokemonHubError(cause.message) } finally { setPokemonHubBusy(false) }
  }

  async function deleteHubProfile(profile) {
    const discardOccupied = Object.keys(profile.grid.entries).length > 0
    setPokemonHubBusy(true)
    setPokemonHubError('')
    try {
      await deletePokemonHubProfile(profile.hubProfileId, { discardOccupied })
      setPokemonHubProfiles(current => current.filter(candidate => candidate.hubProfileId !== profile.hubProfileId))
      setPokemonHubPanes(current => current.map(source => source?.kind === 'hub' && source.hubProfileId === profile.hubProfileId ? null : source))
      setPokemonHubSelection([])
    } catch (cause) { setPokemonHubError(cause.message) } finally { setPokemonHubBusy(false) }
  }

  function selectPokemonHubLocation(location, pane) {
    setPokemonHubSelection(current => current.length === 1 && current[0].pane !== pane ? [...current, { ...location, pane }] : [{ ...location, pane }])
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
      setControlRevision(current => current + 1)
      setCaptureTarget(null)
      setControlPanelOpen(false)
    } catch (cause) {
      setControlError(cause.message)
    } finally {
      setControlSaving(false)
    }
  }

  function chooseInstanceGame(game) {
    setInstancePicker(false)
    openProfilePicker(game, 'add-instance')
  }

  function broadcastPlayerMessage(type) {
    for (const frame of document.querySelectorAll('.player-grid iframe')) {
      frame.contentWindow?.postMessage({ type }, window.location.origin)
    }
  }

  const activeProfileIds = new Set(activeSessions.map(session => session.profileId))
  const gameSections = groupGamesByLayout(games, hubLayout)
  const isStandalone = window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true
  const isNarrowPortrait = isNarrowPortraitViewport(viewport)

  return <main className="hub">
    <div className="hub-layout" inert={activeSessions.length || profileGame || instancePicker || controlPanelOpen || pokemonHubOpen ? true : undefined}>
      <aside className="hub-sidebar" aria-label="Ações globais">
        <button className="hub-sidebar-action" type="button" aria-label="Configurar controles" title="Configurar controles" onClick={openControlPanel}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 8h10M7 16h10M5 5h14v14H5zM9 8v8M15 8v8" /></svg>
        </button>
        {!isStandalone && <button className="hub-sidebar-action hub-sidebar-install" type="button" aria-label="Instalar no iPhone" title="Instalar no iPhone" onClick={() => setInstallHelpOpen(true)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11M8 10l4 4 4-4M5 17v3h14v-3" /></svg>
        </button>}
      </aside>
      <section className="hub-content">
        <section className="hub-section hub-section-internal" aria-labelledby="internal-applications-heading">
          <header className="hub-section-header"><h2 id="internal-applications-heading">Aplicações internas</h2></header>
          <div className="boxes">
          <div className="box pokemon-hub-card">
            <div className="cover">
              <button className="hub-button" type="button" aria-label="Abrir Pokémon Hub" onClick={openPokemonHub}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" /></svg>
              </button>
            </div>
            <div className="title"><small>Pokémon Hub</small></div>
          </div>
          </div>
        </section>
        {gameSections.map(section => <section className="hub-section hub-section-games" key={section.id} aria-labelledby={`${section.id}-heading`}>
          <header className="hub-section-header"><h2 id={`${section.id}-heading`}>{section.title}</h2></header>
          <div className="boxes">
          {section.games.map(game => <div className="box" key={game.id}>
            <div className="cover">
              {game.coverUrl && <img className="cover-image" src={game.coverUrl} alt={`Capa de ${game.title}`} />}
              <button
                className="play-button"
                aria-label={`Play ${game.title}`}
                disabled={game.status !== 'ready'}
                onClick={event => {
                  const playButton = event.currentTarget.getBoundingClientRect()
                  const card = event.currentTarget.closest('.box')?.getBoundingClientRect()
                  openProfilePicker(game, 'launch', { left: card?.left ?? playButton.left, top: playButton.top, bottom: playButton.bottom })
                }}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l13-7.5z" /></svg>
              </button>
            </div>
            {game.language && <div className="title"><small>{game.language}</small></div>}
          </div>)}
          </div>
        </section>)}
        {error && <p className="error" role="alert">{error}</p>}
      </section>
    </div>
    {controlPanelOpen && <div className="profile-overlay" role="dialog" aria-modal="true" aria-label="Configurar controles">
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
            <button className="control-save" type="button" disabled={controlSaving || Boolean(captureTarget)} onClick={saveControlProfile}>{controlSaving ? 'Salvando...' : 'Salvar controles'}</button>
          </>}
          {controlError && <p className="profile-error" role="alert">{controlError}</p>}
        </div>
      </div>
    </div>}
    {pokemonHubOpen && <DragDropProvider sensors={pokemonHubDragSensors} onDragStart={event => {
      const data = event.operation.source?.data
      setPokemonHubActiveDrag(data?.slot ? data : null)
    }} onDragEnd={completePokemonHubDrag} onDragCancel={() => setPokemonHubActiveDrag(null)}><div className="pokemon-workspace" role="dialog" aria-modal="true" aria-label="Pokémon Hub">
      <header className="pokemon-workspace-header">
        <Button className="dialog-close" type="text" aria-label="Fechar Pokémon Hub" icon={<CloseOutlined />} onClick={() => void closePokemonHub()} />
      </header>
      <div className={`pokemon-workspace-body pokemon-workspace-body-${pokemonHubPanes.length}`}>
        {pokemonHubPanes.map((source, index) => <PokemonHubPane key={index} side={index} panes={pokemonHubPanes} paneCount={pokemonHubPanes.length} source={source} data={pokemonHubData} hubProfiles={pokemonHubProfiles} profilesLoading={pokemonHubProfilesLoading} saveProfileGames={saveProfileGames} saveProfileGamesLoading={catalogLoading} saveProfileGamesError={catalogError} saveProfilesByGame={saveProfilesByGame} saveLayoutsBySource={saveLayoutsBySource} saveLayoutsLoading={saveLayoutsLoading} saveLayoutsError={saveLayoutsError} selected={pokemonHubSelection} selectedBox={pokemonHubBoxes[saveSourceKey(source?.gameId, source?.profileId)]} busy={pokemonHubBusy} onSourceChange={nextSource => selectPokemonHubPane(index, nextSource)} onCreate={() => openPokemonHubProfileCreator(index)} onAddPane={addPokemonHubPane} onClosePane={() => closePokemonHubPane(index)} onBoxChange={(gameId, profileId, box) => setPokemonHubBoxes(current => ({ ...current, [saveSourceKey(gameId, profileId)]: box }))} onSlotSelect={selectPokemonHubLocation} onRename={openPokemonHubProfileRenamer} onDelete={deleteHubProfile} />)}
      </div>
      {pokemonHubBusy && <div className="pokemon-workspace-stale" role="status" aria-label="Processando alteração do workspace"><span>Processando…</span></div>}
      <footer className="pokemon-workspace-footer">{pokemonHubSnapshotStatus && <p className="pokemon-hub-snapshot-status" role="status">{pokemonHubSnapshotStatus}</p>}{pokemonHubError && <p className="profile-error" role="alert">{pokemonHubError}</p>}</footer>
    </div><PokemonHubDragOverlay slot={pokemonHubActiveDrag?.slot} /></DragDropProvider>}
    <Modal
      className="pokemon-hub-profile-modal"
      title={<div className="pokemon-hub-profile-modal-title"><span className="pokemon-hub-profile-modal-title-icon"><FolderAddOutlined /></span><span><strong>Criar Perfil do Hub</strong><small>Defina o nome do perfil.</small></span></div>}
      open={pokemonHubProfileCreator !== null}
      width={400}
      classNames={{ container: 'pokemon-hub-profile-modal-container', header: 'pokemon-hub-profile-modal-header', body: 'pokemon-hub-profile-modal-body', close: 'pokemon-hub-profile-modal-close' }}
      onCancel={() => setPokemonHubProfileCreator(null)}
      footer={null}
      closable={!pokemonHubBusy}
      mask={{ closable: !pokemonHubBusy }}
      keyboard={!pokemonHubBusy}
      destroyOnHidden
    >
      <Form className="pokemon-hub-profile-create" layout="vertical" onFinish={() => createHubProfile(pokemonHubProfileCreator)}>
        <Form.Item label="Nome" required><Input aria-label="Nome do Perfil do Hub" placeholder="Nome do perfil" value={pokemonHubProfileName} onChange={event => setPokemonHubProfileName(event.target.value)} maxLength={26} disabled={pokemonHubBusy} autoFocus /></Form.Item>
        <Button className="pokemon-hub-profile-submit" type="primary" htmlType="submit" loading={pokemonHubBusy}>Criar perfil</Button>
      </Form>
    </Modal>
    <Modal
      className="pokemon-hub-profile-modal"
      title="Renomear Perfil do Hub"
      open={pokemonHubProfileRenaming !== null}
      width={400}
      classNames={{ container: 'pokemon-hub-profile-modal-container', header: 'pokemon-hub-profile-modal-header', body: 'pokemon-hub-profile-modal-body', close: 'pokemon-hub-profile-modal-close' }}
      onCancel={() => setPokemonHubProfileRenaming(null)}
      footer={null}
      closable={!pokemonHubBusy}
      mask={{ closable: !pokemonHubBusy }}
      keyboard={!pokemonHubBusy}
      destroyOnHidden
    >
      <Form className="pokemon-hub-profile-rename" layout="vertical" onFinish={renameHubProfile}>
        <Form.Item label="Nome" required><Input aria-label="Novo nome do Perfil do Hub" value={pokemonHubProfileRenameName} onChange={event => setPokemonHubProfileRenameName(event.target.value)} maxLength={26} disabled={pokemonHubBusy} autoFocus /></Form.Item>
        <div className="pokemon-hub-profile-rename-actions"><Button onClick={() => setPokemonHubProfileRenaming(null)} disabled={pokemonHubBusy}>Cancelar</Button><Button type="primary" htmlType="submit" loading={pokemonHubBusy}>Salvar nome</Button></div>
      </Form>
    </Modal>
    {instancePicker && <div className="profile-overlay" role="dialog" aria-modal="true" aria-label="Selecionar jogo">
      <div className="profile-panel">
        <header className="profile-header">
          <h2>Selecionar jogo</h2>
          <button className="dialog-close" type="button" aria-label="Fechar seleção de jogo" onClick={() => setInstancePicker(false)}>×</button>
        </header>
        <div className="profile-body">
          <div className="profile-list">
            {games.filter(game => game.status === 'ready').map(game => <div className="profile-row" key={game.id}>
              <button className="profile-select" type="button" onClick={() => chooseInstanceGame(game)}>{game.title}</button>
            </div>)}
          </div>
        </div>
      </div>
    </div>}
    {profileGame && <div className={`profile-overlay${profilePickerPlacement ? ' profile-picker-overlay' : ''}`} role="dialog" aria-modal="true" aria-label="Selecionar perfil">
      <div className={`profile-panel${profilePickerPlacement ? ' profile-picker-panel' : ''}`} style={profilePickerPlacement ?? undefined}>
        <header className="profile-header">
          <h2>{profileGame.title}</h2>
          <button className="dialog-close" type="button" aria-label="Fechar seleção de perfil" onClick={() => { setProfileGame(null); setProfilePickerPlacement(null); setCreatingProfile(false) }}>×</button>
        </header>
        <div className="profile-body">
          {profiles.length > 0 && <div className="profile-list">
            {profiles.map(profile => {
              const isRunning = activeProfileIds.has(profile.id)
              const isEditing = editingProfileId === profile.id
              return <div className="profile-row" key={profile.id}>
              {isEditing
                ? <form className="profile-edit-form" onSubmit={event => submitProfileEdit(event, profile)}>
                  <input aria-label={`Novo nome para ${profile.name}`} value={profileEditName} onChange={event => setProfileEditName(event.target.value)} maxLength="32" required disabled={profileBusy} autoFocus />
                  <button type="submit" aria-label={`Salvar nome de ${profile.name}`} disabled={profileBusy}>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l4 4L19 6" /></svg>
                  </button>
                </form>
                : <button className="profile-select" type="button" aria-label={isRunning ? `${profile.name} em execução` : profile.name} disabled={profileBusy || (isRunning && profilePurpose !== 'pokemon-hub')} onClick={() => launchWithProfile(profile)}>
                  <span>{profile.name}</span>
                  {isRunning && <svg className="profile-running" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 1-6.4 2.7M4 3v5h5" /></svg>}
                </button>}
              <button className="profile-edit" type="button" aria-label={`Editar perfil ${profile.name}`} disabled={profileBusy || isEditing || isRunning} onClick={() => startEditingProfile(profile)}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l11-11-4-4L4 16v4M13 7l4 4" /></svg>
              </button>
              <button className="profile-delete" type="button" aria-label={`Excluir perfil ${profile.name}`} disabled={profileBusy || isEditing || isRunning} onClick={() => removeProfile(profile)}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" /></svg>
              </button>
            </div>})}
          </div>}
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
    </div>}
    {isNarrowPortrait && <div className="mobile-rotate-overlay" role="status" aria-live="assertive">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7a3 3 0 0 1 3 3v4M17 21h-7a3 3 0 0 1-3-3v-4M17 3l3 3-3 3M7 21l-3-3 3-3" /></svg>
      <strong>Gire o aparelho</strong>
      <span>A experiência de jogo funciona melhor na horizontal.</span>
    </div>}
    {installHelpOpen && <div className="mobile-install-overlay" role="dialog" aria-modal="true" aria-labelledby="mobile-install-title">
      <div className="mobile-install-panel">
        <button className="dialog-close" type="button" aria-label="Fechar instruções de instalação" onClick={() => setInstallHelpOpen(false)}>×</button>
        <h2 id="mobile-install-title">Instalar no iPhone</h2>
        <p>No Chrome, toque em <strong>Compartilhar</strong> e depois em <strong>Adicionar à Tela de Início</strong>.</p>
        <p>Depois, abra o ícone “Emulator Hub” pela Tela de Início.</p>
      </div>
    </div>}
    {activeSessions.length > 0 && <div className="player-overlay" role="dialog" aria-modal="true" aria-label="Emulator">
      <div className={`player-shell player-shell-${activeSessions.length}`} ref={playerShellRef}>
        <header className="player-header">
          <div className="player-global-controls">
            <button className="player-control-button" type="button" aria-label="Configurar controles" onClick={openControlPanel}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 8h10M7 16h10M5 5h14v14H5zM9 8v8M15 8v8" /></svg>
            </button>
            <button className="player-control-button" type="button" aria-label="Salvar estado" title="Salvar estado" onClick={() => broadcastPlayerMessage('emulator-hub:save-state')}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h12l2 2v14H5zM8 4v6h8V4M8 20v-6h8v6" /></svg>
            </button>
            <button className="player-control-button" type="button" aria-label="Carregar estado" title="Carregar estado" onClick={() => broadcastPlayerMessage('emulator-hub:load-state')}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h8M5 5v8M5 5l5 5a7 7 0 1 1-1 9" /></svg>
            </button>
            <div className="fast-forward-control">
              <button className={`fast-forward-button${fastForwardEnabled ? ' is-active' : ''}`} type="button" aria-label="Avanço rápido" aria-pressed={fastForwardEnabled} onClick={() => setFastForwardEnabled(current => !current)}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5v14l7-7-7-7Zm8 0v14l7-7-7-7Z" /></svg>
              </button>
              <select aria-label="Velocidade do avanço rápido" value={fastForwardSpeed} onChange={event => setFastForwardSpeed(Number(event.target.value))}>
                {fastForwardSpeeds.map(speed => <option key={speed} value={speed}>{speed}×</option>)}
              </select>
              <button className="global-reset-button" type="button" aria-label="Resetar todos os emuladores" onClick={() => {
                for (const frame of document.querySelectorAll('.player-grid iframe')) {
                  frame.contentWindow?.postMessage({ type: 'emulator-hub:reset' }, window.location.origin)
                }
              }}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 1-2.3-5.7M20 4v7h-7" /></svg>
              </button>
            </div>
          </div>
          <div className="player-actions">
            <button type="button" aria-label="Adicionar instância" disabled={activeSessions.length >= 4} onClick={openInstancePicker}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            </button>
            <button type="button" aria-label={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'} onClick={toggleFullscreen}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d={fullscreen ? 'M4 9h5V4M20 9h-5V4M4 15h5v5M20 15h-5v5' : 'M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5'} /></svg>
            </button>
            <button type="button" aria-label="Fechar emulador" onClick={closePlayer}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5l14 14M19 5L5 19" /></svg>
            </button>
          </div>
        </header>
        <div className={`player-panel player-panel-${activeSessions.length}`}>
          <div className="player-grid">
            {activeSessions.map(session => <iframe
              key={`${session.gameId}:${session.profileId}:${controlRevision}`}
              src={playerFrameUrl(session)}
              title="EmulatorJS"
              allow="fullscreen; gamepad"
              onLoad={event => configurePlayerFrame(event.currentTarget, { type: 'emulator-hub:fast-forward', enabled: fastForwardEnabled, speed: fastForwardSpeed })}
            />)}
          </div>
        </div>
      </div>
    </div>}
  </main>
}

function PokemonHubPaneControls({ side, panes, source, hubProfiles, profilesLoading, saveProfileGames, saveProfileGamesLoading, saveProfileGamesError, saveProfilesByGame, busy, onSourceChange, onCreate }) {
  const [selectionDraft, setSelectionDraft] = useState(null)
  useEffect(() => { setSelectionDraft(null) }, [source?.gameId, source?.hubProfileId, source?.kind, source?.profileId])
  const availableHubProfiles = hubProfiles.filter(profile => isPaneSourceAvailable(panes, side, { kind: 'hub', hubProfileId: profile.hubProfileId }))
  const selectedSaveSource = selectionDraft?.kind === 'game' ? selectionDraft : (source?.kind === 'game' ? source : null)
  const selectedHubSource = selectionDraft?.kind === 'hub' ? selectionDraft : (source?.kind === 'hub' ? source : null)
  const activeSourceKind = activePaneSourceKind(source, selectionDraft)
  const selectedGameId = selectedSaveSource?.gameId ?? null
  const saveProfiles = selectedGameId ? saveProfilesByGame[selectedGameId] ?? [] : []
  const availableSaveProfileGames = saveProfileGames.filter(game => hasAvailableSaveProfile(panes, side, game.id, saveProfilesByGame[game.id]))
  const selectFirstHubProfile = () => {
    const nextSource = firstAvailableHubSource(panes, side, hubProfiles)
    if (!isCompletePaneSource(nextSource)) { setSelectionDraft(nextSource); return }
    setSelectionDraft(null)
    onSourceChange(nextSource)
  }
  const selectFirstSaveProfile = () => {
    const nextSource = firstAvailableSaveSource(panes, side, availableSaveProfileGames, saveProfilesByGame)
    if (!isCompletePaneSource(nextSource)) { setSelectionDraft(nextSource); return }
    setSelectionDraft(null)
    onSourceChange(nextSource)
  }
  return <div className="pokemon-pane-controls">
    <div className="pokemon-pane-source-toggle" role="group" aria-label="Tipo de perfil">
      <Button className={`pokemon-pane-source-button${activeSourceKind === 'hub' ? ' is-active' : ''}`} type="default" aria-label="Perfil do Hub" title="Perfil do Hub" icon={<InboxOutlined />} disabled={busy || profilesLoading} onClick={selectFirstHubProfile} />
      <Button className={`pokemon-pane-source-button${activeSourceKind === 'game' ? ' is-active' : ''}`} type="default" aria-label="Perfil de Save" title="Perfil de Save" icon={<GamepadIcon />} disabled={busy || saveProfileGamesLoading} onClick={selectFirstSaveProfile} />
    </div>
    {selectedSaveSource && <>
      <Select className="pokemon-pane-profile" classNames={{ popup: { root: 'pokemon-hub-select-popup' } }} aria-label="ROM com perfil" value={selectedGameId} placeholder={saveProfileGamesLoading ? 'Carregando ROMs...' : 'Escolher ROM...'} loading={saveProfileGamesLoading} disabled={busy || saveProfileGamesLoading} allowClear onChange={gameId => setSelectionDraft(gameId ? { kind: 'game', gameId } : { kind: 'game' })} options={availableSaveProfileGames.map(game => ({ value: game.id, label: game.title }))} />
      <Select className="pokemon-pane-profile" classNames={{ popup: { root: 'pokemon-hub-select-popup' } }} aria-label="Perfil de Save" value={selectedSaveSource.profileId} placeholder="Escolher perfil..." disabled={busy || !selectedGameId} allowClear onChange={profileId => {
        if (!profileId) { setSelectionDraft({ kind: 'game', gameId: selectedGameId }); return }
        setSelectionDraft(null)
        onSourceChange({ kind: 'game', gameId: selectedGameId, profileId })
      }} options={saveProfiles.filter(profile => isPaneSourceAvailable(panes, side, { kind: 'game', gameId: selectedGameId, profileId: profile.id })).map(profile => ({ value: profile.id, label: profile.name }))} />
      {saveProfileGamesError && <p className="pokemon-pane-note" role="alert">{saveProfileGamesError}</p>}
    </>}
    {activeSourceKind === 'hub' && <><Select className="pokemon-pane-profile" classNames={{ popup: { root: 'pokemon-hub-select-popup' } }} aria-label="Perfil do Hub" value={selectedHubSource?.hubProfileId} placeholder={profilesLoading ? 'Carregando perfis…' : 'Escolher perfil…'} loading={profilesLoading} disabled={busy} allowClear onClear={() => setSelectionDraft({ kind: 'hub' })} onChange={value => {
      if (!value) { setSelectionDraft({ kind: 'hub' }); return }
      setSelectionDraft(null)
      onSourceChange({ kind: 'hub', hubProfileId: value })
    }} options={availableHubProfiles.map(profile => ({ value: profile.hubProfileId, label: profile.name }))} /><Button className="pokemon-add-pane" type="default" aria-label="Criar Perfil do Hub" icon={<PlusOutlined />} disabled={busy} onClick={onCreate} /></>}
  </div>
}

function GamepadIcon() {
  return <svg className="gamepad-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7.1 8.5h9.8c1.5 0 2.8 1 3.2 2.45l1.08 4.15a2.35 2.35 0 0 1-4.08 2.1l-1.55-1.7H8.4l-1.55 1.7a2.35 2.35 0 0 1-4.08-2.1l1.08-4.15A3.3 3.3 0 0 1 7.1 8.5Z" /><path d="M7.3 11.15v3.1M5.75 12.7h3.1M16.35 11.8h.01M18.25 13.65h.01" /></svg>
}

function PokemonHubSlotGrid({ profile, entries, layoutVersion, side, title, selected, pokemonCount, busy, onSlotSelect, onRename, onDelete }) {
  const frameRef = useRef(null)
  const [columns, setColumns] = useState(5)

  useLayoutEffect(() => {
    const frame = frameRef.current
    if (!frame) return undefined
    const syncColumns = () => setColumns(current => {
      const next = getPokemonHubColumnCount(frame.clientWidth - 12)
      return current === next ? current : next
    })
    const observer = new ResizeObserver(syncColumns)
    observer.observe(frame)
    syncColumns()
    const animationFrame = requestAnimationFrame(syncColumns)
    return () => { observer.disconnect(); cancelAnimationFrame(animationFrame) }
  }, [layoutVersion])

  const visibleSlotCount = getPokemonHubVisibleSlotCount(entries, columns)
  const cardRowWidth = `${getPokemonHubGridWidth(columns)}px`
  const isSelected = location => selected.some(candidate => candidate.kind === location.kind && candidate.slot === location.slot)

  return <div className="pokemon-hub-profile-layout">
    <div className="pokemon-hub-profile-scroll" ref={frameRef}>
      <div className="pokemon-hub-profile-canvas">
        <header className="pokemon-hub-profile-summary" style={{ width: cardRowWidth }}>
          <p className="pokemon-hub-profile-count"><strong>{pokemonCount}</strong><span>Pokémon</span></p>
          <h3>{profile.name}</h3>
          <div className="pokemon-hub-profile-actions">
            <Button type="default" aria-label={`Renomear ${profile.name}`} icon={<EditOutlined />} disabled={busy} onClick={() => onRename(profile)} />
            <Popconfirm title={`Excluir ${profile.name}?`} description={pokemonCount > 0 ? `${pokemonCount} Pokémon serão perdidos permanentemente.` : 'O perfil vazio será removido.'} okText="Excluir" cancelText="Cancelar" okButtonProps={{ danger: true }} onConfirm={() => onDelete(profile)}>
              <Button type="default" danger aria-label={`Excluir ${profile.name}`} icon={<DeleteOutlined />} disabled={busy} />
            </Popconfirm>
          </div>
        </header>
        <div className="pokemon-workspace-grid pokemon-hub-profile-grid" style={{ gridTemplateColumns: `repeat(${columns}, var(--pokemon-slot-size))`, width: cardRowWidth }} aria-label={`${title} slots`}>
          {Array.from({ length: visibleSlotCount }, (_, slot) => {
            const entry = entries[slot] ?? null
            const location = { kind: 'hub', slot }
            const occupied = Boolean(entry)
            const slotProjection = { occupied, species: entry?.species, shiny: entry?.shiny }
            return <PokemonHubDragSlot key={slot} location={{ ...location, hubProfileId: profile.hubProfileId }} slot={slotProjection}><button className={`pokemon-hub-slot${occupied ? ' occupied' : ''}${isSelected(location) ? ' selected' : ''}`} type="button" aria-label={`${title}, posição ${slot + 1}, ${occupied ? 'ocupada' : 'vazia'}`} onClick={() => onSlotSelect(location, side)}><span className="pokemon-hub-slot-index">{slot + 1}</span>{occupied && <span className="pokemon-hub-slot-content">#{entry.species ?? '●'}</span>}<PokemonSlotSprite slot={slotProjection} /></button></PokemonHubDragSlot>
          })}
        </div>
      </div>
    </div>
  </div>
}

function PokemonHubPane({ side, panes, paneCount, source, data, hubProfiles, profilesLoading, saveProfileGames, saveProfileGamesLoading, saveProfileGamesError, saveProfilesByGame, saveLayoutsBySource, saveLayoutsLoading, saveLayoutsError, selected, selectedBox, busy, onSourceChange, onCreate, onAddPane, onClosePane, onBoxChange, onSlotSelect, onRename, onDelete }) {
  const games = data?.games ?? []
  const game = source?.kind === 'game' ? games.find(candidate => candidate.id === source.gameId) : null
  const hubProfile = source?.kind === 'hub' ? hubProfiles.find(candidate => candidate.hubProfileId === source.hubProfileId) : null
  const saveProfileGame = source?.kind === 'game' ? saveProfileGames.find(candidate => candidate.id === source.gameId) : null
  const saveProfile = source?.kind === 'game' && source.gameId ? (saveProfilesByGame[source.gameId] ?? []).find(candidate => candidate.id === source.profileId) : null
  const sourceKey = saveSourceKey(source?.gameId, source?.profileId)
  const saveLayout = saveLayoutsBySource[sourceKey]
  const boxIndex = game ? Math.min(selectedBox ?? 0, game.boxes.length - 1) : 0
  const gameSlots = game?.boxes[boxIndex]?.slots ?? []
  const title = hubProfile?.name ?? game?.title ?? ''
  const pokemonCount = hubProfile ? Object.keys(hubProfile.grid.entries).length : 0
  const canClose = paneCount > 1
  const canAdd = paneCount < 3 && side === paneCount - 1
  const isSelected = location => selected.some(candidate => candidate.kind === location.kind && candidate.gameId === location.gameId && candidate.box === location.box && candidate.slot === location.slot)
  const slotGrid = source && (hubProfile || game?.status === 'ready') && (hubProfile
    ? <PokemonHubSlotGrid profile={hubProfile} entries={hubProfile.grid.entries} layoutVersion={paneCount} side={side} title={title} selected={selected} pokemonCount={pokemonCount} busy={busy} onSlotSelect={onSlotSelect} onRename={onRename} onDelete={onDelete} />
    : <div className="pokemon-workspace-grid" aria-label={`${title} slots`}>
    {gameSlots.map((entry, slot) => {
      const location = source.kind === 'hub' ? { kind: 'hub', slot } : { kind: 'game', gameId: game.id, box: boxIndex, slot }
      const dragLocation = { kind: 'game', gameId: game.id, profileId: source.profileId, area: 'box', box: boxIndex, slot }
      const occupied = Boolean(entry.occupied)
      return <PokemonHubDragSlot key={slot} location={dragLocation} slot={entry}><button className={`pokemon-hub-slot${occupied ? ' occupied' : ''}${isSelected(location) ? ' selected' : ''}`} type="button" aria-label={`${title}, posição ${slot + 1}, ${occupied ? 'ocupada' : 'vazia'}`} onClick={() => onSlotSelect(location, side)}><span className="pokemon-hub-slot-index">{slot + 1}</span>{occupied && <span className="pokemon-hub-slot-content">#{entry.species ?? '●'}</span>}<PokemonSlotSprite slot={entry} /></button></PokemonHubDragSlot>
    })}
  </div>)
  return <section className="pokemon-workspace-pane" aria-label={`Painel ${side + 1} do Pokémon Hub`}>
    <header className="pokemon-pane-header">
      <PokemonHubPaneControls side={side} panes={panes} source={source} hubProfiles={hubProfiles} profilesLoading={profilesLoading} saveProfileGames={saveProfileGames} saveProfileGamesLoading={saveProfileGamesLoading} saveProfileGamesError={saveProfileGamesError} saveProfilesByGame={saveProfilesByGame} busy={busy} onSourceChange={onSourceChange} onCreate={onCreate} />
      <div className="pokemon-pane-actions">
        {canClose && <Button className="pokemon-pane-action pokemon-pane-close" type="default" aria-label="Fechar container" title="Fechar container" icon={<CloseOutlined />} disabled={busy} onClick={onClosePane} />}
        {canAdd && <Button className="pokemon-pane-action pokemon-pane-add" type="primary" aria-label="Abrir novo container" title="Abrir novo container" icon={<PlusOutlined />} disabled={busy} onClick={onAddPane} />}
      </div>
    </header>
    <div className="pokemon-pane-content">
      {saveLayoutsLoading[sourceKey] && <p className="pokemon-pane-note">Carregando Party e Boxes...</p>}
      {saveLayoutsError[sourceKey] && <p className="pokemon-pane-note" role="alert">{saveLayoutsError[sourceKey]}</p>}
      {saveLayout?.missing && <PokemonSaveLayoutMissing />}
      {saveLayout && !saveLayout.missing && <PokemonSaveLayout layout={saveLayout} gameId={source.gameId} profileId={source.profileId} selectedBox={selectedBox ?? 0} onBoxChange={onBoxChange} />}
      {game && <label className="pokemon-pane-source">Box do jogo
        <select value={boxIndex} onChange={event => onBoxChange(game.id, Number(event.target.value))}>
          {game.boxes.map((_box, index) => <option key={index} value={index}>Box {index + 1}</option>)}
        </select>
      </label>}
      {slotGrid}
      {game && game.status !== 'ready' && <p className="pokemon-pane-note">{game.status === 'active' ? 'Feche o jogo antes de usar o Hub.' : 'Este save ainda não está disponível.'}</p>}
    </div>
  </section>
}

function PokemonSaveLayout({ layout, gameId, profileId, selectedBox, onBoxChange }) {
  const boxIndex = Math.max(0, Math.min(selectedBox, layout.boxes.length - 1))
  const box = layout.boxes[boxIndex]
  return <div className="pokemon-save-layout">
    <section aria-label="Party"><div className="pokemon-save-party">{layout.party.map((slot, index) => <SaveSlot key={index} location={{ kind: 'game', gameId, profileId, area: 'party', slot: index }} slot={slot} position={getSavePartySlotPosition(index, layout.party.length)} label={`Party, posição ${index + 1}`} showPartyStrip />)}</div></section>
    <div className="pokemon-save-divider" />
    <section aria-label="Boxes"><div className="pokemon-save-box-nav"><Button aria-label="Box anterior" icon={<LeftOutlined />} onClick={() => onBoxChange(gameId, profileId, getPreviousSaveBoxIndex(boxIndex, layout.boxes.length))} /><h4>Box {boxIndex + 1} de {layout.boxes.length}</h4><Button aria-label="Próxima Box" icon={<RightOutlined />} onClick={() => onBoxChange(gameId, profileId, getNextSaveBoxIndex(boxIndex, layout.boxes.length))} /></div><div className="pokemon-save-box-grid">{box.slots.map((slot, index) => <SaveSlot key={index} location={{ kind: 'game', gameId, profileId, area: 'box', box: boxIndex, slot: index }} slot={slot} position={getSaveBoxSlotPosition(boxIndex, index, box.slots.length)} label={`Box ${boxIndex + 1}, posição ${index + 1}`} />)}</div></section>
  </div>
}

function PokemonSaveLayoutMissing() {
  return <div className="pokemon-save-layout-missing"><div className="pokemon-save-layout-missing-card"><InboxOutlined /><h3>Este perfil ainda não possui um save.</h3><p>Abra o jogo e salve uma partida para carregar Party e Boxes.</p></div></div>
}

function SaveSlot({ location, slot, position, label, showPartyStrip = false }) {
  return <PokemonHubDragSlot location={location} slot={slot}><div className={`pokemon-hub-slot${slot.occupied ? ' occupied' : ''}`} role="img" aria-label={`${label}, ${slot.occupied ? `ocupada${slot.species ? `, espécie ${slot.species}` : ''}` : 'vazia'}`}><span className="pokemon-hub-slot-index">{position}</span>{slot.occupied && <span className="pokemon-hub-slot-content">#{slot.species ?? '●'}</span>}<PokemonSlotSprite slot={slot} />{showPartyStrip && <span className="pokemon-save-party-strip">Party</span>}</div></PokemonHubDragSlot>
}

function PokemonSlotSprite({ slot }) {
  const sprite = getPokemonSlotSprite(slot)
  if (!sprite) return null
  return <img className="pokemon-hub-slot-sprite" src={sprite} alt="" aria-hidden="true" draggable={false} onError={event => hidePokemonSlotSprite(event.currentTarget)} />
}

function PokemonHubDragSlot({ location, slot, children }) {
  const id = pokemonHubDragId(location)
  const data = { location, slot }
  const draggable = useDraggable({ id, data, disabled: !isPokemonHubDraggable(slot) })
  const droppable = useDroppable({ id, data: { location } })
  const setNodeRef = node => {
    draggable.ref(node)
    droppable.ref(node)
  }
  const className = [
    children.props.className,
    draggable.isDragging && 'dragging',
    droppable.isDropTarget && !draggable.isDragging && 'drag-over',
  ].filter(Boolean).join(' ')

  return React.cloneElement(children, { ref: setNodeRef, className })
}

function PokemonHubDragOverlay({ slot }) {
  return <DragOverlay className="pokemon-hub-drag-overlay" dropAnimation={null}>{slot && <div className="pokemon-hub-drag-preview"><PokemonSlotSprite slot={slot} /></div>}</DragOverlay>
}

function saveSourceKey(gameId, profileId) {
  return gameId && profileId ? `${gameId}:${profileId}` : ''
}

function paneSnapshotKey(source) {
  if (source?.kind === 'hub') return source.hubProfileId ? `hub:${source.hubProfileId}` : ''
  return saveSourceKey(source?.gameId, source?.profileId)
}

function sessionSlot(location, saveLayoutsBySource) {
  if (location?.kind === 'hub') return location.slot
  const layout = saveLayoutsBySource[saveSourceKey(location?.gameId, location?.profileId)]
  if (!layout || !['party', 'box'].includes(location?.area)) throw new Error('Only loaded Party and Box slots can be moved in the workspace session.')
  if (location.area === 'party') return location.slot
  return layout.party.length + location.box * 30 + location.slot
}

function createHubSessionSourceSnapshot({ profileId, hubProfileId, source }) {
  return {
    kind: 'hub',
    profileId,
    hubProfileId,
    sourceKey: `hub:${hubProfileId}`,
    pokemonDisplay: source.pokemonDisplay,
    placements: source.placements,
  }
}

function snapshotDispatchDelay(session) {
  const debounceMs = 500
  const safetyMs = 1_000
  const sample = session?.leaseSample
  if (!sample || !Number.isFinite(sample.serverNow) || !Number.isFinite(sample.expiresAt) || !Number.isFinite(sample.sentAt) || !Number.isFinite(sample.receivedAt)) return debounceMs
  const remainingLeaseMs = sample.expiresAt - sample.serverNow - Math.max(0, sample.receivedAt - sample.sentAt)
  return Math.max(0, Math.min(debounceMs, remainingLeaseMs - safetyMs))
}

function createCanonicalPokemonHubSnapshot(session, panes, snapshots) {
  return {
    revision: session.version,
    panes: Array.from({ length: 3 }, (_, pane) => {
      const source = panes[pane] ?? null
      if (!source) return null
      const snapshot = snapshots[paneSnapshotKey(source)]
      if (!snapshot) throw new Error('The selected workspace source is not ready.')
      if (source.kind === 'hub') return {
        pane,
        profile: { type: 'hub-profile', hubProfileId: source.hubProfileId },
        hub: snapshot.placements.flatMap(placement => placement.pokemonInstanceId ? [{ pokemonInstanceId: placement.pokemonInstanceId, slot: placement.location.slot }] : []),
      }
      return {
        pane,
        profile: { type: 'save', gameId: source.gameId },
        party: snapshot.placements.flatMap(placement => placement.location.area === 'party' && placement.pokemonInstanceId ? [{ pokemonInstanceId: placement.pokemonInstanceId, slot: placement.location.slot }] : []),
        boxes: snapshot.placements.flatMap(placement => placement.location.area === 'box' && placement.pokemonInstanceId ? [{ pokemonInstanceId: placement.pokemonInstanceId, slot: placement.location.box * 30 + placement.location.slot }] : []),
      }
    }),
  }
}

function canonicalPaneOccupancy(pane) {
  const entries = pane.profile.type === 'hub-profile'
    ? pane.hub.map(entry => [{ kind: 'hub', hubProfileId: pane.profile.hubProfileId, slot: entry.slot }, entry.pokemonInstanceId])
    : [
      ...pane.party.map(entry => [{ kind: 'game', area: 'party', slot: entry.slot }, entry.pokemonInstanceId]),
      ...pane.boxes.map(entry => [{ kind: 'game', area: 'box', box: Math.floor(entry.slot / 30), slot: entry.slot % 30 }, entry.pokemonInstanceId]),
    ]
  return new Map(entries.map(([location, pokemonInstanceId]) => [pokemonHubLocationKey(location), pokemonInstanceId]))
}

function sourceProjectionFromHubProfile(profile) {
  const entries = profile.grid?.entries ?? {}
  return {
    placements: Array.from({ length: 60 }, (_, slot) => ({ location: { kind: 'hub', hubProfileId: profile.hubProfileId, slot }, pokemonInstanceId: entries[String(slot)]?.pokemonInstanceId ?? null })),
    pokemonDisplay: Object.fromEntries(Object.values(entries).flatMap(entry => entry?.pokemonInstanceId ? [[entry.pokemonInstanceId, entry]] : [])),
  }
}

function compactLocalParty(placements) {
  const party = placements.filter(placement => placement.location?.area === 'party').sort((left, right) => left.location.slot - right.location.slot)
  if (party.length === 0) return
  const occupied = party.flatMap(placement => placement.pokemonInstanceId ? [placement.pokemonInstanceId] : [])
  party.forEach((placement, slot) => { placement.pokemonInstanceId = occupied[slot] ?? null })
}

function projectHubEntries(snapshot) {
  return Object.fromEntries(snapshot.placements.flatMap(placement => {
    if (!placement.pokemonInstanceId) return []
    return [[String(placement.location.slot), { pokemonInstanceId: placement.pokemonInstanceId, ...(snapshot.pokemonDisplay?.[placement.pokemonInstanceId] ?? {}) }]]
  }))
}

createRoot(document.getElementById('root')).render(<ConfigProvider theme={antTheme}><App /></ConfigProvider>)
