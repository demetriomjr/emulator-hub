import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createProfile, deleteProfile as deleteProfileRequest, getControlProfile, getGames, getLaunch, getPokemonHub, getProfiles, transferPokemonHub, updateControlProfile, updateProfile } from '../../packages/hub-client.js'
import { activeGamepadBindings, readGamepadBinding, readGamepadSnapshot } from '../../packages/gamepad-input.mjs'
import { addWorkspacePane, choosePaneSource, createPokemonHubWorkspaceState } from '../../packages/pokemon-hub-workspace.mjs'
import './styles.css'

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
  const [pokemonHubSelection, setPokemonHubSelection] = useState([])
  const [pokemonHubBusy, setPokemonHubBusy] = useState(false)
  const [pokemonHubPanes, setPokemonHubPanes] = useState([null])
  const [pokemonHubBoxes, setPokemonHubBoxes] = useState({})
  const [fastForwardEnabled, setFastForwardEnabled] = useState(false)
  const [fastForwardSpeed, setFastForwardSpeed] = useState(1.5)
  const [profileGame, setProfileGame] = useState(null)
  const [profilePurpose, setProfilePurpose] = useState('launch')
  const [profiles, setProfiles] = useState([])
  const [profileName, setProfileName] = useState('')
  const [editingProfileId, setEditingProfileId] = useState(null)
  const [profileEditName, setProfileEditName] = useState('')
  const [creatingProfile, setCreatingProfile] = useState(false)
  const [profileError, setProfileError] = useState('')
  const [profileBusy, setProfileBusy] = useState(false)
  const [error, setError] = useState('')
  const [fullscreen, setFullscreen] = useState(false)
  const playerShellRef = useRef(null)

  useEffect(() => {
    getGames().then(setGames).catch(cause => setError(cause.message))
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
        } else if (pokemonHubOpen) setPokemonHubOpen(false)
        else if (profileGame) {
          setProfileGame(null)
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

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement === playerShellRef.current) await document.exitFullscreen()
      else await playerShellRef.current.requestFullscreen()
    } catch (cause) {
      setError(cause.message)
    }
  }

  async function closePlayer() {
    try {
      await Promise.all([...document.querySelectorAll('.player-grid iframe')].map(frame => flushPlayerSave(frame)))
      if (document.fullscreenElement === playerShellRef.current) await document.exitFullscreen()
      setActiveSessions([])
      setFullscreen(false)
    } catch (cause) {
      setError(`Não foi possível sincronizar o save: ${cause.message}`)
    }
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

  async function openProfilePicker(game, purpose = 'launch') {
    setError('')
    setProfileError('')
    setProfileName('')
    setEditingProfileId(null)
    setCreatingProfile(false)
    setProfilePurpose(purpose)
    setProfileGame(game)
    try {
      setProfiles(await getProfiles())
    } catch (cause) {
      setProfileError(cause.message)
    }
  }

  async function launchWithProfile(profile) {
    setError('')
    setProfileError('')
    setProfileBusy(true)
    try {
      const game = profileGame
      if (profilePurpose === 'pokemon-hub') {
        setProfileGame(null)
        setPokemonHubOpen(true)
        await selectPokemonHubProfile(profile)
        return
      }
      await getLaunch(game.id, profile.id)
      setProfileGame(null)
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
      const profile = await createProfile(profileName)
      setProfiles(current => [...current, profile])
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
      await deleteProfileRequest(profile.id)
      setProfiles(current => current.filter(candidate => candidate.id !== profile.id))
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
      const updated = await updateProfile(profile.id, profileEditName)
      setProfiles(current => current.map(candidate => candidate.id === updated.id ? updated : candidate))
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
    setPokemonHubOpen(true)
    try { setProfiles(await getProfiles()) } catch (cause) { setPokemonHubError(cause.message) }
  }

  async function selectPokemonHubProfile(profile) {
    setPokemonHubError('')
    setPokemonHubProfile(profile)
    try {
      setPokemonHubData(await getPokemonHub(profile.id))
      setPokemonHubPanes([null])
      setPokemonHubBoxes({})
    } catch (cause) { setPokemonHubError(cause.message) }
  }

  function selectPokemonHubPane(index, source) {
    const result = choosePaneSource(pokemonHubPanes, index, source || null)
    setPokemonHubPanes(result.panes)
    setPokemonHubSelection([])
    setPokemonHubError(result.error)
  }

  function addPokemonHubPane() {
    try { setPokemonHubPanes(current => addWorkspacePane(current)) } catch (cause) { setPokemonHubError(cause.message) }
  }

  function selectPokemonHubLocation(location, pane) {
    setPokemonHubSelection(current => current.length === 1 && current[0].pane !== pane ? [...current, { ...location, pane }] : [{ ...location, pane }])
  }

  async function transferSelectedPokemon() {
    if (!pokemonHubProfile || !pokemonHubData || pokemonHubSelection.length !== 2) return
    const [first, second] = pokemonHubSelection
    const firstOccupied = first.kind === 'hub' ? Boolean(pokemonHubData.slots[first.slot]) : Boolean(pokemonHubData.games.find(game => game.id === first.gameId)?.boxes[first.box]?.slots[first.slot]?.occupied)
    const source = firstOccupied ? omitPane(first) : omitPane(second)
    const destination = firstOccupied ? omitPane(second) : omitPane(first)
    setPokemonHubBusy(true)
    setPokemonHubError('')
    try {
      await transferPokemonHub(pokemonHubProfile.id, { source, destination, expectedRevisions: Object.fromEntries(pokemonHubData.games.filter(game => Number.isInteger(game.revision)).map(game => [game.id, game.revision])), expectedHubEpoch: pokemonHubData.hubEpoch })
      setPokemonHubData(await getPokemonHub(pokemonHubProfile.id))
      setPokemonHubSelection([])
    } catch (cause) { setPokemonHubError(cause.message) } finally { setPokemonHubBusy(false) }
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

  return <main className="hub">
    <div className="hub-layout" inert={activeSessions.length || profileGame || instancePicker || controlPanelOpen || pokemonHubOpen ? true : undefined}>
      <aside className="hub-sidebar" aria-label="Ações globais">
        <button className="hub-sidebar-action" type="button" aria-label="Configurar controles" title="Configurar controles" onClick={openControlPanel}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 8h10M7 16h10M5 5h14v14H5zM9 8v8M15 8v8" /></svg>
        </button>
      </aside>
      <section className="hub-content">
        <div className="boxes">
          <div className="box pokemon-hub-card">
            <div className="cover">
              <button className="hub-button" type="button" aria-label="Abrir Pokémon Hub" onClick={openPokemonHub}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" /></svg>
              </button>
            </div>
            <div className="title"><small>Pokémon Hub</small></div>
          </div>
          {games.map(game => <div className="box" key={game.id}>
            <div className="cover">
              {game.coverUrl && <img className="cover-image" src={game.coverUrl} alt={`Capa de ${game.title}`} />}
              <button
                className="play-button"
                aria-label={`Play ${game.title}`}
                disabled={game.status !== 'ready'}
                onClick={() => openProfilePicker(game)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l13-7.5z" /></svg>
              </button>
            </div>
            {game.language && <div className="title"><small>{game.language}</small></div>}
          </div>)}
        </div>
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
    {pokemonHubOpen && <div className="pokemon-workspace" role="dialog" aria-modal="true" aria-label="Pokémon Hub">
      <header className="pokemon-workspace-header">
        <div className="pokemon-workspace-loaders">{pokemonHubPanes.map((source, index) => <PokemonHubPaneControls key={index} source={source} data={pokemonHubData} profiles={profiles} showAdd={index === pokemonHubPanes.length - 1 && pokemonHubPanes.length < 3} onAdd={addPokemonHubPane} onSourceChange={source => selectPokemonHubPane(index, source)} onProfileChange={selectPokemonHubProfile} />)}</div>
        <button className="dialog-close" type="button" aria-label="Fechar Pokémon Hub" onClick={() => setPokemonHubOpen(false)}>×</button>
      </header>
      <div className={`pokemon-workspace-body pokemon-workspace-body-${pokemonHubPanes.length}`}>
        {pokemonHubPanes.map((source, index) => <PokemonHubPane key={index} side={index} source={source} data={pokemonHubData} selected={pokemonHubSelection} selectedBox={pokemonHubBoxes[source?.gameId]} onBoxChange={(gameId, box) => setPokemonHubBoxes(current => ({ ...current, [gameId]: box }))} onSlotSelect={selectPokemonHubLocation} />)}
      </div>
      <footer className="pokemon-workspace-footer">{pokemonHubSelection.length === 2 && <button className="control-save" type="button" disabled={pokemonHubBusy} onClick={transferSelectedPokemon}>{pokemonHubBusy ? 'Transferindo...' : 'Confirmar transferência'}</button>}{pokemonHubError && <p className="profile-error" role="alert">{pokemonHubError}</p>}</footer>
    </div>}
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
    {profileGame && <div className="profile-overlay" role="dialog" aria-modal="true" aria-label="Selecionar perfil">
      <div className="profile-panel">
        <header className="profile-header">
          <h2>{profileGame.title}</h2>
          <button className="dialog-close" type="button" aria-label="Fechar seleção de perfil" onClick={() => { setProfileGame(null); setCreatingProfile(false) }}>×</button>
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
              src={`/player.html?id=${encodeURIComponent(session.gameId)}&profileId=${encodeURIComponent(session.profileId)}&fastForward=${session.initialFastForwardEnabled ? '1' : '0'}&fastForwardSpeed=${session.initialFastForwardSpeed}`}
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

function PokemonHubPaneControls({ source, data, profiles, showAdd, onAdd, onSourceChange, onProfileChange }) {
  const games = data?.games ?? []
  return <div className="pokemon-pane-controls">
    <select className="pokemon-pane-type" aria-label="Tipo de perfil" value={source?.kind ?? ''} onChange={event => onSourceChange(event.target.value ? { kind: event.target.value } : null)}>
      <option value="">Escolher tipo de perfil</option>
      <option value="game">Perfil de save</option>
      <option value="hub">Perfil do Hub</option>
    </select>
    {source && !data && <select className="pokemon-pane-profile" aria-label="Perfil" defaultValue="" onChange={event => { const profile = profiles.find(candidate => candidate.id === event.target.value); if (profile) onProfileChange(profile) }}><option value="" disabled>Escolher perfil…</option>{profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select>}
    {source?.kind === 'game' && data && <select className="pokemon-pane-profile" aria-label="Save" value={source.gameId ?? ''} onChange={event => onSourceChange({ ...source, gameId: event.target.value, profileId: data.profileId })}><option value="" disabled>Escolher save…</option>{games.map(candidate => <option key={candidate.id} value={candidate.id} disabled={candidate.status !== 'ready'}>{candidate.title}</option>)}</select>}
    {showAdd && source && <button className="pokemon-add-pane" type="button" aria-label="Adicionar painel" onClick={onAdd}>＋</button>}
  </div>
}

function PokemonHubPane({ side, source, data, selected, selectedBox, onBoxChange, onSlotSelect }) {
  const games = data?.games ?? []
  const game = source?.kind === 'game' ? games.find(candidate => candidate.id === source.gameId) : null
  const boxIndex = game ? Math.min(selectedBox ?? 0, game.boxes.length - 1) : 0
  const slots = source?.kind === 'hub' ? data?.slots ?? [] : game?.boxes[boxIndex]?.slots ?? []
  const title = source?.kind === 'hub' ? 'Hub' : game?.title ?? ''
  const isSelected = location => selected.some(candidate => candidate.kind === location.kind && candidate.gameId === location.gameId && candidate.box === location.box && candidate.slot === location.slot)
  return <section className="pokemon-workspace-pane" aria-label={`Painel ${side + 1} do Pokémon Hub`}>
    {game && <label className="pokemon-pane-source">Box do jogo
      <select value={boxIndex} onChange={event => onBoxChange(game.id, Number(event.target.value))}>
        {game.boxes.map((_box, index) => <option key={index} value={index}>Box {index + 1}</option>)}
      </select>
    </label>}
    {source?.kind === 'hub' && <p className="pokemon-pane-note">Box 1 · {data?.slots.filter(Boolean).length ?? 0}/30</p>}
    {source && data && (source.kind === 'hub' || game?.status === 'ready') && <div className="pokemon-workspace-grid" aria-label={`${title} slots`}>
      {slots.map((entry, slot) => {
        const location = source.kind === 'hub' ? { kind: 'hub', slot } : { kind: 'game', gameId: game.id, box: boxIndex, slot }
        const occupied = source.kind === 'hub' ? Boolean(entry) : Boolean(entry.occupied)
        return <button className={`pokemon-hub-slot${occupied ? ' occupied' : ''}${isSelected(location) ? ' selected' : ''}`} type="button" key={slot} aria-label={`${title}, posição ${slot + 1}, ${occupied ? 'ocupada' : 'vazia'}`} onClick={() => onSlotSelect(location, side)}>{occupied ? `#${entry.species ?? '●'}` : '—'}</button>
      })}
    </div>}
    {game && game.status !== 'ready' && <p className="pokemon-pane-note">{game.status === 'active' ? 'Feche o jogo antes de usar o Hub.' : 'Este save ainda não está disponível.'}</p>}
  </section>
}

function omitPane({ pane, ...location }) { return location }

createRoot(document.getElementById('root')).render(<App />)
