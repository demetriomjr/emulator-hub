import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { DragDropProvider, DragOverlay, useDraggable, useDroppable } from '@dnd-kit/react'
import { PointerActivationConstraints, PointerSensor } from '@dnd-kit/dom'
import { Button, Form, Input, Modal, Popconfirm, Select } from 'antd'
import { CloseOutlined, CodeSandboxOutlined, DeleteOutlined, EditOutlined, FolderAddOutlined, InboxOutlined, LeftOutlined, PlusOutlined, RightOutlined, SaveOutlined, StopOutlined } from '@ant-design/icons'
import { closePokemonHubSession, createPokemonHubProfile, deletePokemonHubProfile, getGames, getPokemonHubProfiles, getSaveProfileLayout, heartbeatPokemonHubSession, loadPokemonHubSessionPane, openPokemonHubSession, renamePokemonHubProfile, syncPokemonHubSessionSnapshot } from './hub-client.js'
import { isPokemonHubDraggable, pokemonHubDragId } from './pokemon-hub-drag-identity.mjs'
import { getPokemonHubDragFeedback } from './pokemon-hub-drag-feedback.mjs'
import { getPokemonHubColumnCount, getPokemonHubGridWidth, getPokemonHubVisibleSlotCount } from './pokemon-hub-grid.mjs'
import { createPokemonHubHeartbeatMonitor } from './pokemon-hub-heartbeat-monitor.mjs'
import { createPokemonHubRequestGate } from './pokemon-hub-request-gate.mjs'
import { createPokemonHubSnapshotFlight } from './pokemon-hub-snapshot-flight.mjs'
import { pokemonHubLocationKey } from './pokemon-hub-location-key.mjs'
import { getNextSaveBoxIndex, getPreviousSaveBoxIndex, getSaveBoxSlotPosition, getSavePartySlotPosition } from './pokemon-save-layout-grid.mjs'
import { getPokemonSlotSprite, hidePokemonSlotSprite } from './pokemon-slot-sprite.mjs'
import { createGameSessionSourceSnapshot, snapshotToSaveLayout, visiblePokemonHubPanes } from './pokemon-hub-session-view.mjs'
import { deriveSaveProfileCatalog } from './save-profile-catalog.mjs'
import { formatGameProfileLabel } from './save-profile-display.mjs'
import { activePaneSourceKind, addWorkspacePane, choosePaneSource, createPokemonHubWorkspaceState, hasAvailableSaveProfile, isCompletePaneSource, isPaneSourceAvailable, removeWorkspacePane } from './pokemon-hub-workspace.mjs'

export default function PokemonHub({ onClose, closeSignal = 0, layout }) {
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [catalogError, setCatalogError] = useState('')
  const [pokemonHubProfile, setPokemonHubProfile] = useState(null)
  const [pokemonHubData, setPokemonHubData] = useState(null)
  const [pokemonHubError, setPokemonHubError] = useState('')
  const [pokemonHubSnapshotStatus, setPokemonHubSnapshotStatus] = useState('')
  const [pokemonHubSelection, setPokemonHubSelection] = useState([])
  const [pokemonHubActiveDrag, setPokemonHubActiveDrag] = useState(null)
  const [pokemonHubBusy, setPokemonHubBusy] = useState(false)
  const [pokemonHubPanes, setPokemonHubPanes] = useState([])
  const [pokemonHubBoxes, setPokemonHubBoxes] = useState({})
  const [pokemonHubProfiles, setPokemonHubProfiles] = useState([])
  const [pokemonHubProfilesLoading, setPokemonHubProfilesLoading] = useState(false)
  const [saveLayoutsBySource, setSaveLayoutsBySource] = useState({})
  const [, setPokemonHubSnapshots] = useState({})
  const [saveLayoutsLoading, setSaveLayoutsLoading] = useState({})
  const [saveLayoutsError, setSaveLayoutsError] = useState({})
  const [pokemonHubProfileCreator, setPokemonHubProfileCreator] = useState(null)
  const [pokemonHubProfileName, setPokemonHubProfileName] = useState('')
  const [pokemonHubProfileRenaming, setPokemonHubProfileRenaming] = useState(null)
  const [pokemonHubProfileRenameName, setPokemonHubProfileRenameName] = useState('')
  const pokemonHubSessionRef = useRef(null)
  const pokemonHubSessionOpeningRef = useRef(null)
  const pokemonHubSnapshotTimerRef = useRef(null)
  const pokemonHubSnapshotsRef = useRef({})
  const pokemonHubPanesRef = useRef([])
  const pokemonHubBusyRef = useRef(false)
  pokemonHubPanesRef.current = pokemonHubPanes
  const games = pokemonHubData?.games || []
  const { profilesByGame: saveProfilesByGame, saveProfileGames } = deriveSaveProfileCatalog(games, layout)
  const pokemonHubDragSensors = [PointerSensor.configure({
    activationConstraints: [new PointerActivationConstraints.Distance({ value: 6 })],
  })]
  useEffect(() => {
    let mounted = true
    const workspace = createPokemonHubWorkspaceState()
    setPokemonHubProfile(workspace.profile); setPokemonHubPanes(workspace.panes); setPokemonHubBoxes(workspace.boxes)
    void getGames().then(catalog => { if (mounted) setPokemonHubData({ games: catalog }) }).catch(cause => { if (mounted) setCatalogError(cause.message) }).finally(() => { if (mounted) setCatalogLoading(false) })
    void loadPokemonHubProfiles()
    return () => { mounted = false; if (pokemonHubSnapshotTimerRef.current !== null) window.clearTimeout(pokemonHubSnapshotTimerRef.current) }
  }, [])
  useEffect(() => { if (closeSignal) void closePokemonHub() }, [closeSignal])
  useEffect(() => {
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
  }, [])
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
    if (current) return current
    const opening = pokemonHubSessionOpeningRef.current
    if (opening) {
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
          setPokemonHubError(snapshot.reason?.message ?? 'The backend corrected the workspace snapshot.')
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
    const profileId = pokemonHubSessionRef.current?.profileId ?? (source.kind === 'game' ? source.profileId : target.kind === 'game' ? target.profileId : null)
    if (!profileId) {
      setPokemonHubError('Load a save before moving a Pokémon in this workspace.')
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
      if (source.area === 'party' && target.area !== 'party' && sourceSnapshot.placements.filter(placement => placement.location.area === 'party' && placement.pokemonInstanceId).length === 1 && (sourceSnapshot.sourceKey !== targetSnapshot.sourceKey || !targetSnapshot.placements?.[toSlot]?.pokemonInstanceId)) {
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
    if (pokemonHubBusyRef.current) return false
    pokemonHubBusyRef.current = true
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
        const session = await ensurePokemonHubSession(profileId)
        const layout = await getSaveProfileLayout(incomingSource.gameId, incomingSource.profileId, session.profileId)
        const key = saveSourceKey(incomingSource.gameId, incomingSource.profileId)
        const sourceSnapshot = createGameSessionSourceSnapshot({ profileId: incomingSource.profileId, gameId: incomingSource.gameId, layout })
        nextSnapshots[key] = sourceSnapshot
        loadedSave = { key, layout, sourceSnapshot }
      } else if (incomingSource?.kind === 'hub') {
        const profile = pokemonHubProfiles.find(candidate => candidate.hubProfileId === incomingSource.hubProfileId)
        if (!profile) throw new Error('The Hub profile is not available.')
        nextSnapshots[`hub:${incomingSource.hubProfileId}`] = createHubSessionSourceSnapshot({ profileId, hubProfileId: incomingSource.hubProfileId, source: sourceProjectionFromHubProfile(profile) })
      }
      const session = await ensurePokemonHubSession(profileId)
      if (incomingSource) {
        const pane = nextPanes.findIndex(source => samePokemonHubPaneSource(source, incomingSource))
        if (pane < 0) throw new Error('The workspace pane source is invalid.')
        const loaded = await session.requestGate.run(() => loadPokemonHubSessionPane(session.profileId, session.sessionId, pane, incomingSource))
        if (loaded.corrected) {
          applyCanonicalSessionSnapshot(loaded.snapshot)
          setPokemonHubError(loaded.snapshot.reason?.message ?? 'The backend corrected the workspace snapshot.')
          return false
        }
        session.version = loaded.snapshot.revision
      } else {
        const candidate = createCanonicalPokemonHubSnapshot(session, nextPanes, nextSnapshots)
        const correction = await session.requestGate.run(() => syncPokemonHubSessionSnapshot(session.profileId, session.sessionId, candidate, crypto.randomUUID()))
        if (correction) {
          applyCanonicalSessionSnapshot(correction)
          setPokemonHubError(correction.reason?.message ?? 'The backend corrected the workspace snapshot.')
          return false
        }
        session.version = candidate.revision + 1
      }
      setPokemonHubSnapshotStatus('Snapshot sincronizado.')
      pokemonHubPanesRef.current = nextPanes
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
    } finally {
      if (!retainBusy) {
        pokemonHubBusyRef.current = false
        setPokemonHubBusy(false)
      }
    }
  }

  function applyCanonicalSessionSnapshot(snapshot) {
    const session = pokemonHubSessionRef.current
    if (session) session.version = snapshot.revision
    const panes = visiblePokemonHubPanes(snapshot.panes, pokemonHubPanesRef.current.length, session?.profileId)
    const next = {}
    for (const pane of snapshot.panes.slice(0, pokemonHubPanes.length)) {
      if (pane === null) continue
      const key = pane.profile.type === 'hub-profile' ? `hub:${pane.profile.hubProfileId}` : saveSourceKey(pane.profile.gameId, pane.profile.profileId)
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
    if (pokemonHubBusyRef.current) return
    const result = choosePaneSource(pokemonHubPanesRef.current, index, source || null)
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
      await submitStructuralPokemonHubPaneChange(removeWorkspacePane(pokemonHubPanesRef.current, index), null)
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
    onClose()
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
    onClose()
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
  return <>
    <DragDropProvider sensors={pokemonHubDragSensors} onDragStart={event => {
      const data = event.operation.source?.data
      setPokemonHubActiveDrag(data?.slot ? data : null)
    }} onDragEnd={completePokemonHubDrag} onDragCancel={() => setPokemonHubActiveDrag(null)}><div className="pokemon-workspace" role="dialog" aria-modal="true" aria-label="Pokémon Hub">
      <header className="pokemon-workspace-header">
        <Button className="dialog-close" type="text" aria-label="Fechar Pokémon Hub" icon={<CloseOutlined />} onClick={() => void closePokemonHub()} />
      </header>
      <div className={`pokemon-workspace-body pokemon-workspace-body-${pokemonHubPanes.length}`}>
        {pokemonHubPanes.map((source, index) => <PokemonHubPane key={index} side={index} panes={pokemonHubPanes} paneCount={pokemonHubPanes.length} source={source} activeDrag={pokemonHubActiveDrag} data={pokemonHubData} hubProfiles={pokemonHubProfiles} profilesLoading={pokemonHubProfilesLoading} saveProfileGames={saveProfileGames} saveProfileGamesLoading={catalogLoading} saveProfileGamesError={catalogError} saveProfilesByGame={saveProfilesByGame} saveLayoutsBySource={saveLayoutsBySource} saveLayoutsLoading={saveLayoutsLoading} saveLayoutsError={saveLayoutsError} selected={pokemonHubSelection} selectedBox={pokemonHubBoxes[saveSourceKey(source?.gameId, source?.profileId)]} busy={pokemonHubBusy} onSourceChange={nextSource => selectPokemonHubPane(index, nextSource)} onCreate={() => openPokemonHubProfileCreator(index)} onAddPane={addPokemonHubPane} onClosePane={() => closePokemonHubPane(index)} onBoxChange={(gameId, profileId, box) => setPokemonHubBoxes(current => ({ ...current, [saveSourceKey(gameId, profileId)]: box }))} onSlotSelect={selectPokemonHubLocation} onRename={openPokemonHubProfileRenamer} onDelete={deleteHubProfile} />)}
      </div>
      {pokemonHubBusy && <div className="pokemon-workspace-stale" role="status" aria-label="Processando alteração do workspace"><span>Processando…</span></div>}
      <footer className="pokemon-workspace-footer">{pokemonHubSnapshotStatus && <p className="pokemon-hub-snapshot-status" role="status">{pokemonHubSnapshotStatus}</p>}{pokemonHubError && <p className="profile-error" role="alert">{pokemonHubError}</p>}</footer>
    </div><PokemonHubDragOverlay slot={pokemonHubActiveDrag?.slot} /></DragDropProvider>
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
  </>
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
  const allSaveProfiles = saveProfileGames.find(game => game.id === selectedGameId)?.profiles ?? []
  const availableSaveProfileGames = saveProfileGames.filter(game => hasAvailableSaveProfile(panes, side, game.id, saveProfilesByGame[game.id]))
  return <div className="pokemon-pane-controls">
    <div className="pokemon-pane-source-toggle" role="group" aria-label="Tipo de perfil">
      <Button className={`pokemon-pane-source-button${activeSourceKind === 'hub' ? ' is-active' : ''}`} type="default" aria-label="Perfil do Hub" title="Perfil do Hub" icon={<CodeSandboxOutlined />} disabled={busy || profilesLoading} onClick={() => setSelectionDraft({ kind: 'hub' })} />
      <Button className={`pokemon-pane-source-button${activeSourceKind === 'game' ? ' is-active' : ''}`} type="default" aria-label="Perfil de Save" title="Perfil de Save" icon={<SaveOutlined />} disabled={busy || saveProfileGamesLoading} onClick={() => setSelectionDraft({ kind: 'game' })} />
    </div>
    {selectedSaveSource && <>
      <Select className="pokemon-pane-profile" classNames={{ popup: { root: 'pokemon-hub-select-popup' } }} aria-label="ROM com perfil" value={selectedGameId} placeholder={saveProfileGamesLoading ? 'Carregando ROMs...' : 'Escolher ROM...'} loading={saveProfileGamesLoading} disabled={busy || saveProfileGamesLoading} allowClear onChange={gameId => setSelectionDraft(gameId ? { kind: 'game', gameId } : { kind: 'game' })} options={availableSaveProfileGames.map(game => ({ value: game.id, label: game.title }))} />
      <Select className="pokemon-pane-profile" classNames={{ popup: { root: 'pokemon-hub-select-popup' } }} aria-label="Perfil de Save" value={selectedSaveSource.profileId} placeholder="Escolher perfil..." disabled={busy || !selectedGameId} allowClear onChange={profileId => {
        if (!profileId) { setSelectionDraft({ kind: 'game', gameId: selectedGameId }); return }
        setSelectionDraft(null)
        onSourceChange({ kind: 'game', gameId: selectedGameId, profileId })
      }} options={saveProfiles.filter(profile => isPaneSourceAvailable(panes, side, { kind: 'game', gameId: selectedGameId, profileId: profile.id })).map(profile => ({ value: profile.id, label: formatGameProfileLabel(profile, allSaveProfiles) }))} />
      {saveProfileGamesError && <p className="pokemon-pane-note" role="alert">{saveProfileGamesError}</p>}
    </>}
    {activeSourceKind === 'hub' && <><Select className="pokemon-pane-profile" classNames={{ popup: { root: 'pokemon-hub-select-popup' } }} aria-label="Perfil do Hub" value={selectedHubSource?.hubProfileId} placeholder={profilesLoading ? 'Carregando perfis…' : 'Escolher perfil…'} loading={profilesLoading} disabled={busy} allowClear onClear={() => setSelectionDraft({ kind: 'hub' })} onChange={value => {
      if (!value) { setSelectionDraft({ kind: 'hub' }); return }
      setSelectionDraft(null)
      onSourceChange({ kind: 'hub', hubProfileId: value })
    }} options={availableHubProfiles.map(profile => ({ value: profile.hubProfileId, label: profile.name }))} /><Button className="pokemon-add-pane" type="default" aria-label="Criar Perfil do Hub" icon={<PlusOutlined />} disabled={busy} onClick={onCreate} /></>}
  </div>
}

function PokemonHubSlotGrid({ profile, entries, layoutVersion, side, title, selected, pokemonCount, busy, onSlotSelect, onRename, onDelete, dragPermission }) {
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
            const slotProjection = { occupied, species: entry?.species, shiny: entry?.shiny, isEgg: entry?.isEgg, hubPassport: entry?.hubPassport }
            const permission = dragPermission(slotProjection)
            return <PokemonHubDragSlot key={slot} location={{ ...location, hubProfileId: profile.hubProfileId }} slot={slotProjection} dragDisabled={permission.dragDisabled} dragBlockReason={permission.reason?.message}><button className={`pokemon-hub-slot${occupied ? ' occupied' : ''}${isSelected(location) ? ' selected' : ''}`} type="button" aria-label={`${title}, posição ${slot + 1}, ${occupied ? 'ocupada' : 'vazia'}`} onClick={() => onSlotSelect(location, side)}><span className="pokemon-hub-slot-index">{slot + 1}</span>{occupied && <span className="pokemon-hub-slot-content">#{entry.species ?? '●'}</span>}<PokemonSlotSprite slot={slotProjection} /></button></PokemonHubDragSlot>
          })}
        </div>
      </div>
    </div>
  </div>
}

function PokemonHubPane({ side, panes, paneCount, source, activeDrag, data, hubProfiles, profilesLoading, saveProfileGames, saveProfileGamesLoading, saveProfileGamesError, saveProfilesByGame, saveLayoutsBySource, saveLayoutsLoading, saveLayoutsError, selected, selectedBox, busy, onSourceChange, onCreate, onAddPane, onClosePane, onBoxChange, onSlotSelect, onRename, onDelete }) {
  const games = data?.games ?? []
  const game = source?.kind === 'game' ? games.find(candidate => candidate.id === source.gameId) : null
  const hubProfile = source?.kind === 'hub' ? hubProfiles.find(candidate => candidate.hubProfileId === source.hubProfileId) : null
  const saveProfileGame = source?.kind === 'game' ? saveProfileGames.find(candidate => candidate.id === source.gameId) : null
  const saveProfile = source?.kind === 'game' && source.gameId ? (saveProfilesByGame[source.gameId] ?? []).find(candidate => candidate.id === source.profileId) : null
  const sourceKey = saveSourceKey(source?.gameId, source?.profileId)
  const saveLayout = saveLayoutsBySource[sourceKey]
  const dragPermission = slot => getPokemonHubDragFeedback({ panes, source, slot, saveLayoutsBySource })
  const activeSource = activeDrag ? sourceForPokemonHubLocation(panes, activeDrag.location) : null
  const activeFeedback = activeSource ? getPokemonHubDragFeedback({ panes, source: activeSource, slot: activeDrag.slot, saveLayoutsBySource }) : null
  const dragOverlayMessage = activeFeedback?.destinations.find(destination => samePokemonHubPaneSource(destination.source, source) && !destination.allowed)?.reason?.message ?? ''
  const gameBoxes = game?.boxes ?? []
  const boxIndex = gameBoxes.length ? Math.min(selectedBox ?? 0, gameBoxes.length - 1) : 0
  const gameSlots = gameBoxes[boxIndex]?.slots ?? []
  const title = hubProfile?.name ?? game?.title ?? ''
  const pokemonCount = hubProfile ? Object.keys(hubProfile.grid.entries).length : 0
  const canClose = paneCount > 1
  const canAdd = paneCount < 3 && side === paneCount - 1
  const isSelected = location => selected.some(candidate => candidate.kind === location.kind && candidate.gameId === location.gameId && candidate.box === location.box && candidate.slot === location.slot)
  const slotGrid = source && (hubProfile || game?.status === 'ready') && (hubProfile
    ? <PokemonHubSlotGrid profile={hubProfile} entries={hubProfile.grid.entries} layoutVersion={paneCount} side={side} title={title} selected={selected} pokemonCount={pokemonCount} busy={busy} onSlotSelect={onSlotSelect} onRename={onRename} onDelete={onDelete} dragPermission={dragPermission} />
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
      {saveLayout && !saveLayout.missing && <PokemonSaveLayout layout={saveLayout} gameId={source.gameId} profileId={source.profileId} selectedBox={selectedBox ?? 0} onBoxChange={onBoxChange} dragPermission={dragPermission} />}
      {slotGrid}
      {dragOverlayMessage && <div className="pokemon-hub-transfer-block-overlay" role="status">{dragOverlayMessage}</div>}
      {game && game.status !== 'ready' && <p className="pokemon-pane-note">{game.status === 'active' ? 'Feche o jogo antes de usar o Hub.' : 'Este save ainda não está disponível.'}</p>}
    </div>
  </section>
}

function PokemonSaveLayout({ layout, gameId, profileId, selectedBox, onBoxChange, dragPermission }) {
  const boxIndex = Math.max(0, Math.min(selectedBox, layout.boxes.length - 1))
  const box = layout.boxes[boxIndex]
  return <div className="pokemon-save-layout">
    <section aria-label="Party"><div className="pokemon-save-party">{layout.party.map((slot, index) => <SaveSlot key={index} location={{ kind: 'game', gameId, profileId, area: 'party', slot: index }} slot={slot} position={getSavePartySlotPosition(index, layout.party.length)} label={`Party, posição ${index + 1}`} showPartyStrip dragPermission={dragPermission(slot)} />)}</div></section>
    <div className="pokemon-save-divider" />
    <section aria-label="Boxes"><div className="pokemon-save-box-nav"><Button aria-label="Box anterior" icon={<LeftOutlined />} onClick={() => onBoxChange(gameId, profileId, getPreviousSaveBoxIndex(boxIndex, layout.boxes.length))} /><h4>Box {boxIndex + 1} de {layout.boxes.length}</h4><Button aria-label="Próxima Box" icon={<RightOutlined />} onClick={() => onBoxChange(gameId, profileId, getNextSaveBoxIndex(boxIndex, layout.boxes.length))} /></div><div className="pokemon-save-box-grid">{box.slots.map((slot, index) => <SaveSlot key={index} location={{ kind: 'game', gameId, profileId, area: 'box', box: boxIndex, slot: index }} slot={slot} position={getSaveBoxSlotPosition(boxIndex, index, box.slots.length)} label={`Box ${boxIndex + 1}, posição ${index + 1}`} dragPermission={dragPermission(slot)} />)}</div></section>
  </div>
}

function PokemonSaveLayoutMissing() {
  return <div className="pokemon-save-layout-missing"><div className="pokemon-save-layout-missing-card"><InboxOutlined /><h3>Este perfil ainda não possui um save.</h3><p>Abra o jogo e salve uma partida para carregar Party e Boxes.</p></div></div>
}

function SaveSlot({ location, slot, position, label, showPartyStrip = false, dragPermission = { dragDisabled: false } }) {
  return <PokemonHubDragSlot location={location} slot={slot} dragDisabled={dragPermission.dragDisabled} dragBlockReason={dragPermission.reason?.message}><div className={`pokemon-hub-slot${slot.occupied ? ' occupied' : ''}`} role="img" aria-label={`${label}, ${slot.occupied ? `ocupada${slot.species ? `, espécie ${slot.species}` : ''}` : 'vazia'}`}><span className="pokemon-hub-slot-index">{position}</span>{slot.occupied && <span className="pokemon-hub-slot-content">#{slot.species ?? '●'}</span>}<PokemonSlotSprite slot={slot} />{showPartyStrip && <span className="pokemon-save-party-strip">Party</span>}</div></PokemonHubDragSlot>
}

function PokemonSlotSprite({ slot }) {
  const sprite = getPokemonSlotSprite(slot)
  if (!sprite) return null
  return <img className="pokemon-hub-slot-sprite" src={sprite} alt="" aria-hidden="true" draggable={false} onError={event => hidePokemonSlotSprite(event.currentTarget)} />
}

function PokemonHubDragSlot({ location, slot, children, dragDisabled = false, dragBlockReason = '' }) {
  const id = pokemonHubDragId(location)
  const data = { location, slot }
  const blocked = isPokemonHubDraggable(slot) && dragDisabled
  const draggable = useDraggable({ id, data, disabled: !isPokemonHubDraggable(slot) || blocked })
  const droppable = useDroppable({ id, data: { location } })
  const setNodeRef = node => {
    draggable.ref(node)
    droppable.ref(node)
  }
  const className = [
    children.props.className,
    draggable.isDragging && 'dragging',
    droppable.isDropTarget && !draggable.isDragging && 'drag-over',
    blocked && 'drag-blocked',
  ].filter(Boolean).join(' ')

  return React.cloneElement(children, { ref: setNodeRef, className, ...(blocked ? { title: dragBlockReason, 'aria-disabled': true } : {}), children: <>{children.props.children}{blocked && <span className="pokemon-hub-slot-block-icon" aria-label={dragBlockReason}><StopOutlined /></span>}</> })
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
        profile: { type: 'save', profileId: source.profileId, gameId: source.gameId },
        party: snapshot.placements.flatMap(placement => placement.location.area === 'party' && placement.pokemonInstanceId ? [{ pokemonInstanceId: placement.pokemonInstanceId, slot: placement.location.slot }] : []),
        boxes: snapshot.placements.flatMap(placement => placement.location.area === 'box' && placement.pokemonInstanceId ? [{ pokemonInstanceId: placement.pokemonInstanceId, slot: placement.location.box * 30 + placement.location.slot }] : []),
      }
    }),
  }
}

function samePokemonHubPaneSource(left, right) {
  return left?.kind === right?.kind
    && (left?.kind === 'hub' ? left.hubProfileId === right.hubProfileId : left?.gameId === right?.gameId && left?.profileId === right?.profileId)
}

function sourceForPokemonHubLocation(panes, location) {
  if (location?.kind === 'hub') return panes.find(source => source?.kind === 'hub' && source.hubProfileId === location.hubProfileId) ?? null
  if (location?.kind === 'game') return panes.find(source => source?.kind === 'game' && source.gameId === location.gameId && source.profileId === location.profileId) ?? null
  return null
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
