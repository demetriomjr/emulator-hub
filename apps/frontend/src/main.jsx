import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ConfigProvider } from 'antd'
import { acquirePlayerLease, createProfile, deleteProfile as deleteProfileRequest, getControlProfile, getGames, getProfiles, releasePlayerLease, updateControlProfile, updateProfile } from '../../packages/hub-client.js'
import { activeGamepadBindings, readGamepadBinding, readGamepadSnapshot } from '../../packages/gamepad-input.mjs'
import { replaceCatalogProfile } from '../../packages/save-profile-catalog.mjs'
import { groupGamesByLayout } from '../../packages/hub-layout.mjs'
import { getProfilePickerPlacement } from '../../packages/profile-picker-placement.mjs'
import { appendClientDiagnosticsParameters, createClientDiagnostics, getClientDiagnosticsOptions } from '../../packages/client-diagnostics.mjs'
import { closePlayerAfterSaveAttempts } from '../../packages/player-close.mjs'
import { isMobileLandscapeViewport, isNarrowPortraitViewport } from '../../packages/mobile-viewport.mjs'
import { shouldReloadForFrontendRevision } from '../../packages/frontend-revision.mjs'
import { readFastForwardSpeed, writeFastForwardSpeed } from '../../packages/fast-forward-preference.mjs'
import { createLocalRuntimeRecoveryStore } from '../../packages/local-runtime-recovery-store.mjs'
import hubLayout from './hub-layout.json'
import './styles.css'

const PokemonHub = React.lazy(() => import('../../packages/pokemon-hub-ui.jsx'))

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
const localRecoveryStore = createLocalRuntimeRecoveryStore()
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
    sessionId: session.sessionId,
    leaseGeneration: String(session.leaseGeneration),
    fastForward: session.initialFastForwardEnabled ? '1' : '0',
    fastForwardSpeed: String(session.initialFastForwardSpeed),
    restoreRecovery: session.restoreRecovery ? '1' : '0',
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
  const [pokemonHubCloseSignal, setPokemonHubCloseSignal] = useState(0)
  const [fastForwardEnabled, setFastForwardEnabled] = useState(false)
  const [fastForwardSpeed, setFastForwardSpeed] = useState(() => readFastForwardSpeed(document.cookie))
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
  const [recoveryCandidate, setRecoveryCandidate] = useState(null)
  const [error, setError] = useState('')
  const [installHelpOpen, setInstallHelpOpen] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [viewport, setViewport] = useState(readViewport)
  const playerShellRef = useRef(null)
  const profilePickerRequestRef = useRef(0)

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
      if (event.origin !== window.location.origin || event.data?.type !== 'emulator-hub:lease-lost') return
      if (!event.data.unavailable && event.data.sessionId && event.data.profileId && event.data.gameId && Number.isInteger(event.data.generation)) {
        void releasePlayerLease(event.data.sessionId, { profileId: event.data.profileId, gameId: event.data.gameId, generation: event.data.generation }).catch(() => {})
      }
      setActiveSessions(current => current.filter(session => session.sessionId !== event.data.sessionId))
      setError('A sessão do emulador foi substituída ou expirou.')
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [])

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
    if (!activeSessions.length && !profileGame && !instancePicker && !controlPanelOpen && !pokemonHubOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const syncFullscreen = () => setFullscreen(document.fullscreenElement === playerShellRef.current)
    const onKeyDown = event => {
      if (event.key === 'Escape' && !document.fullscreenElement) {
        if (controlPanelOpen) {
          setControlPanelOpen(false)
          setCaptureTarget(null)
        } else if (pokemonHubOpen) setPokemonHubCloseSignal(current => current + 1)
        else if (profileGame) {
          setProfileGame(null)
          setProfilePickerPlacement(null)
          setCreatingProfile(false)
        }
        else if (instancePicker) setInstancePicker(false)
        else void closePlayer()
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
    writeFastForwardSpeed(document, fastForwardSpeed)
  }, [fastForwardSpeed])

  async function toggleFullscreen() {
    if (isMobileLandscape) return
    try {
      if (document.fullscreenElement === playerShellRef.current) await document.exitFullscreen()
      else await playerShellRef.current.requestFullscreen()
    } catch (cause) {
      setError(cause.message)
    }
  }

  async function closePlayer() {
    const result = await closePlayerAfterSaveAttempts({
      saveAttempts: activeSessions.map((session, index) => {
        const frame = document.querySelectorAll('.player-grid iframe')[index]
        return Promise.resolve(frame ? flushPlayerSave(frame).finally(() => clearPlayerRecovery(frame)) : undefined).finally(() => releasePlayerLease(session.sessionId, { profileId: session.profileId, gameId: session.gameId, generation: session.leaseGeneration }).catch(() => {}))
      }),
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
      try {
        const directSync = frame.contentWindow?.emulatorHubSyncSave
        if (typeof directSync === 'function') {
          Promise.resolve(directSync()).then(() => finish(), finish)
          return
        }
      } catch {
        // The message fallback supports an iframe which has not exposed its
        // same-origin synchronizer yet.
      }
      window.addEventListener('message', receive)
      frame.contentWindow?.postMessage({ type: 'emulator-hub:sync-save', requestId }, window.location.origin)
    })
  }

  function clearPlayerRecovery(frame) {
    try {
      const clear = frame.contentWindow?.emulatorHubClearLocalRecovery
      if (typeof clear === 'function') return Promise.resolve(clear())
    } catch {}
    frame.contentWindow?.postMessage({ type: 'emulator-hub:clear-local-recovery' }, window.location.origin)
    return Promise.resolve()
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
    const game = profileGame
    let candidate = null
    try { candidate = await localRecoveryStore.get(profile.id, game.id) } catch {}
    if (candidate) {
      setRecoveryCandidate({ ...candidate, profile })
      return
    }
    return startPlayerWithProfile(profile, false)
  }

  async function startPlayerWithProfile(profile, restoreRecovery) {
    setError('')
    setProfileError('')
    setProfileBusy(true)
    try {
      const game = profileGame
      const sessionId = crypto.randomUUID()
      const lease = await acquirePlayerLease(game.id, profile.id, sessionId)
      setProfileGame(null)
      setProfilePickerPlacement(null)
      const session = {
        gameId: game.id,
        profileId: profile.id,
        sessionId,
        leaseGeneration: lease.leaseGeneration,
        initialFastForwardEnabled: fastForwardEnabled,
        initialFastForwardSpeed: fastForwardSpeed,
        restoreRecovery,
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

  async function restoreLocalRecovery() {
    if (!recoveryCandidate) return
    const candidate = recoveryCandidate
    setRecoveryCandidate(null)
    await startPlayerWithProfile(candidate.profile, true)
  }

  async function discardLocalRecovery() {
    if (!recoveryCandidate) return
    const candidate = recoveryCandidate
    await localRecoveryStore.clear(recoveryCandidate.profileId, recoveryCandidate.gameId)
    setRecoveryCandidate(null)
    await startPlayerWithProfile(candidate.profile, false)
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
    if (isMobileLandscape) return
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

  const activeProfileIds = new Set(activeSessions.map(session => `${session.gameId}:${session.profileId}`))
  const gameSections = groupGamesByLayout(games, hubLayout)
  const isStandalone = window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true
  const isNarrowPortrait = isNarrowPortraitViewport(viewport)
  const isMobileLandscape = isMobileLandscapeViewport(viewport)

  return <main className="hub">
    <div className="hub-layout" inert={activeSessions.length || profileGame || instancePicker || controlPanelOpen || pokemonHubOpen ? true : undefined}>
      <aside className="hub-sidebar" aria-label="Ações globais">
        <button className="hub-sidebar-action" type="button" aria-label="Configurar controles" title="Configurar controles" onClick={openControlPanel}>
          <svg viewBox="0 0 24 24" className="control-configuration-icon" aria-hidden="true">
            <path d="M7.1 8.5h9.8c1.5 0 2.8 1 3.2 2.45l1.08 4.15a2.35 2.35 0 0 1-4.08 2.1l-1.55-1.7H8.4l-1.55 1.7a2.35 2.35 0 0 1-4.08-2.1l1.08-4.15A3.3 3.3 0 0 1 7.1 8.5Z" />
            <path d="M7.3 11.15v3.1M5.75 12.7h3.1M16.35 11.8h.01M18.25 13.65h.01" />
          </svg>
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
    {pokemonHubOpen && <React.Suspense fallback={<div className="pokemon-workspace" role="status">Carregando workspace...</div>}><PokemonHub onClose={() => setPokemonHubOpen(false)} closeSignal={pokemonHubCloseSignal} /></React.Suspense>}
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
    {recoveryCandidate && <div className="profile-overlay" role="dialog" aria-modal="true" aria-label="Recuperação local disponível">
      <div className="profile-panel">
        <header className="profile-header"><h2>Recuperação local</h2></header>
        <div className="profile-body"><p>{recoveryCandidate.reason === 'runtime-break' ? 'O emulador foi interrompido. Restaurar a recuperação local?' : 'Há uma possível recuperação local. Restaurar?'}</p></div>
        <div className="profile-actions"><button type="button" onClick={discardLocalRecovery}>Descartar</button><button type="button" onClick={restoreLocalRecovery}>Restaurar</button></div>
      </div>
    </div>}
    {profileGame && !recoveryCandidate && <div className={`profile-overlay${profilePickerPlacement ? ' profile-picker-overlay' : ''} profile-picker-mobile`} role="dialog" aria-modal="true" aria-label="Selecionar perfil">
      <div className={`profile-panel${profilePickerPlacement ? ' profile-picker-panel' : ''}`} style={profilePickerPlacement ? profilePickerPlacement : undefined}>
        <header className="profile-header">
          <h2>{profileGame.title}</h2>
          <button className="dialog-close" type="button" aria-label="Fechar seleção de perfil" onClick={() => { setProfileGame(null); setProfilePickerPlacement(null); setCreatingProfile(false) }}>×</button>
        </header>
        <div className="profile-body">
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
              <svg viewBox="0 0 24 24" className="control-configuration-icon" aria-hidden="true">
                <path d="M7.1 8.5h9.8c1.5 0 2.8 1 3.2 2.45l1.08 4.15a2.35 2.35 0 0 1-4.08 2.1l-1.55-1.7H8.4l-1.55 1.7a2.35 2.35 0 0 1-4.08-2.1l1.08-4.15A3.3 3.3 0 0 1 7.1 8.5Z" />
                <path d="M7.3 11.15v3.1M5.75 12.7h3.1M16.35 11.8h.01M18.25 13.65h.01" />
              </svg>
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
            {!isMobileLandscape && <>
              <button type="button" aria-label="Adicionar instância" disabled={activeSessions.length >= 4} onClick={openInstancePicker}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
              </button>
              <button type="button" aria-label={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'} onClick={toggleFullscreen}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d={fullscreen ? 'M4 9h5V4M20 9h-5V4M4 15h5v5M20 15h-5v5' : 'M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5'} /></svg>
              </button>
            </>}
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


createRoot(document.getElementById('root')).render(<ConfigProvider theme={antTheme}><App /></ConfigProvider>)
