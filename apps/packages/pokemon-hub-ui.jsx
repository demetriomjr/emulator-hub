import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { DragDropProvider, DragOverlay, useDraggable, useDroppable } from '@dnd-kit/react'
import { PointerActivationConstraints, PointerSensor } from '@dnd-kit/dom'
import { Button, Form, Input, Modal, Popconfirm, Select, notification } from 'antd'
import { CloseOutlined, CodeSandboxOutlined, DeleteOutlined, EditOutlined, FolderAddOutlined, InboxOutlined, LeftOutlined, PlusOutlined, RightOutlined, SaveOutlined, StopOutlined } from '@ant-design/icons'
import { closePokemonHubSession, createPokemonHubProfile, deletePokemonHubProfile, getGames, getPokemonHubProfile, getPokemonHubProfiles, getSaveProfileLayout, heartbeatPokemonHubSession, loadPokemonHubSessionPane, openPokemonHubSession, renamePokemonHubProfile, reorderPokemonSaveItems, transferPokemonSaveItems, syncPokemonHubSessionSnapshot } from './hub-client.js'
import { isPokemonHubDraggable, pokemonHubDragId } from './pokemon-hub-drag-identity.mjs'
import { getPokemonHubDragFeedback, isPokemonHubPartyDropForbidden } from './pokemon-hub-drag-feedback.mjs'
import { getPokemonHubColumnCount, getPokemonHubGridWidth, getPokemonHubVisibleSlotCount } from './pokemon-hub-grid.mjs'
import { getPokemonItemAreaView, getPokemonItemName } from './pokemon-item-view.mjs'
import { getPokemonItemPolicy } from './pokemon-item-policy.mjs'
import { getPokemonHubItemTransferIntent, getPokemonItemReorderIntent, getPokemonItemTransferIntent } from './pokemon-item-drag.mjs'
import { projectPokemonItemTransfers } from './pokemon-item-transfer-projection.mjs'
import { getPokemonItemSpriteUrl } from './pokemon-item-sprite-view.mjs'
import { createPokemonHubHeartbeatMonitor } from './pokemon-hub-heartbeat-monitor.mjs'
import { reconcilePokemonCardSelection } from './pokemon-hub-card-selection.mjs'
import { createPokemonHubRequestGate } from './pokemon-hub-request-gate.mjs'
import { createPokemonHubSnapshotFlight } from './pokemon-hub-snapshot-flight.mjs'
import { getNextSaveBoxIndex, getPreviousSaveBoxIndex, getSaveBoxSlotPosition, getSavePartySlotPosition } from './pokemon-save-layout-grid.mjs'
import { getPokemonSlotFallback, getPokemonSlotSprite, hidePokemonSlotSprite } from './pokemon-slot-sprite.mjs'
import { PokemonDetailCard } from './pokemon-detail-card.jsx'
import { createGameSessionSourceSnapshot, createHubSessionSourceSnapshot, extendHubSessionSourceSnapshot, reconcileCanonicalSessionSnapshot, snapshotToSaveLayout } from './pokemon-hub-session-view.mjs'
import { deriveSaveProfileCatalog } from './save-profile-catalog.mjs'
import { formatGameProfileLabel } from './save-profile-display.mjs'
import { addWorkspacePane, choosePaneSource, createPokemonHubWorkspaceState, hasAvailableSaveProfile, isCompletePaneSource, isPaneSourceAvailable, paneControlSources, removeWorkspacePane } from './pokemon-hub-workspace.mjs'

export default function PokemonHub({ onClose, closeSignal = 0, layout }) {
  function setPokemonHubError(error) {
    if (error) notification.error({ message: error, placement: 'bottomLeft', className: 'pokemon-hub-error-toast' })
  }
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [catalogError, setCatalogError] = useState('')
  const [pokemonHubData, setPokemonHubData] = useState(null)
  const [pokemonHubSelection, setPokemonHubSelection] = useState([])
  const [pokemonCardSelection, setPokemonCardSelection] = useState([])
  const [pokemonDetailsById, setPokemonDetailsById] = useState({})
  const [pokemonHubActiveDrag, setPokemonHubActiveDrag] = useState(null)
  const [pokemonItemTransferDraft, setPokemonItemTransferDraft] = useState(null)
  const [pokemonItemPendingTransfers, setPokemonItemPendingTransfers] = useState([])
  const [pokemonHubBusy, setPokemonHubBusy] = useState(false)
  const [pokemonHubPendingPanes, setPokemonHubPendingPanes] = useState({})
  const [pokemonHubPanes, setPokemonHubPanes] = useState([])
  const [pokemonHubBoxes, setPokemonHubBoxes] = useState({})
  const [pokemonHubProfiles, setPokemonHubProfiles] = useState([])
  const [pokemonHubProfilesLoading, setPokemonHubProfilesLoading] = useState(false)
  const [saveLayoutsBySource, setSaveLayoutsBySource] = useState({})
  const [pokemonHubProfileCreator, setPokemonHubProfileCreator] = useState(null)
  const [pokemonHubProfileName, setPokemonHubProfileName] = useState('')
  const [pokemonHubProfileRenaming, setPokemonHubProfileRenaming] = useState(null)
  const [pokemonHubProfileRenameName, setPokemonHubProfileRenameName] = useState('')
  const pokemonHubSessionIdRef = useRef(null)
  pokemonHubSessionIdRef.current ??= crypto.randomUUID()
  const pokemonHubSessionRef = useRef(null)
  const pokemonHubSessionOpeningRef = useRef(null)
  const pokemonHubSnapshotTimerRef = useRef(null)
  const pokemonHubSnapshotsRef = useRef({})
  const pokemonHubPanesRef = useRef([])
  const pokemonHubBusyRef = useRef(false)
  const pokemonHubPaneQueueRef = useRef(Promise.resolve())
  const pokemonItemTransferQueueRef = useRef(Promise.resolve())
  const pokemonItemPendingTransfersRef = useRef([])
  const pokemonItemConfirmedRef = useRef(new Map())
  const saveLayoutsBySourceRef = useRef({})
  const pokemonHubProfilesRef = useRef([])
  const pokemonHubPendingSourcesRef = useRef({})
  const pokemonHubClosingRef = useRef(false)
  const pokemonHubAbortedRef = useRef(false)
  const pokemonHubLastDragRef = useRef(-Infinity)
  const pokemonHubDragActiveRef = useRef(false)
  const pokemonHubDragCancelledRef = useRef(false)
  const pokemonCardTriggerRefs = useRef([])
  pokemonHubPanesRef.current = pokemonHubPanes
  saveLayoutsBySourceRef.current = saveLayoutsBySource
  pokemonHubProfilesRef.current = pokemonHubProfiles
  const projectedItems = projectPokemonItemTransfers(saveLayoutsBySource, pokemonHubProfiles, pokemonItemPendingTransfers)
  const games = pokemonHubData?.games || []
  const { profilesByGame: saveProfilesByGame, saveProfileGames } = deriveSaveProfileCatalog(games, layout)
  const pokemonHubDragSensors = [PointerSensor.configure({
    activationConstraints: [new PointerActivationConstraints.Distance({ value: 6 })],
  })]
  useEffect(() => {
    let mounted = true
    const workspace = createPokemonHubWorkspaceState()
    setPokemonHubPanes(workspace.panes); setPokemonHubBoxes(workspace.boxes)
    void getGames().then(catalog => { if (mounted) setPokemonHubData({ games: catalog }) }).catch(cause => { if (mounted) setCatalogError(cause.message) }).finally(() => { if (mounted) setCatalogLoading(false) })
    void loadPokemonHubProfiles()
    void ensurePokemonHubSession().catch(cause => { if (mounted) setPokemonHubError(cause.message) })
    return () => { mounted = false; if (pokemonHubSnapshotTimerRef.current !== null) window.clearTimeout(pokemonHubSnapshotTimerRef.current) }
  }, [])
  useEffect(() => { if (closeSignal) void closePokemonHub() }, [closeSignal])
  useEffect(() => {
    const cancelActiveDrag = event => {
      if (event.key === 'Escape' && pokemonHubDragActiveRef.current) pokemonHubDragCancelledRef.current = true
    }
    document.addEventListener('keydown', cancelActiveDrag, true)
    return () => document.removeEventListener('keydown', cancelActiveDrag, true)
  }, [])
  useEffect(() => {
    const renew = async () => {
      const session = pokemonHubSessionRef.current
      if (!session || session.heartbeatInFlight || session.closing || pokemonHubClosingRef.current) return
      session.heartbeatInFlight = true
      try {
        session.heartbeatPromise = session.heartbeatMonitor.observe(async () => {
          const sentAt = performance.now()
          const renewal = await heartbeatPokemonHubSession(session.sessionId, ++session.heartbeatSequence)
          session.leaseSample = { serverNow: renewal.serverNow, expiresAt: renewal.expiresAt, sentAt, receivedAt: performance.now() }
        }, {
          waitUntilReady: session.requestGate.isInFlight()
            ? async () => await session.requestGate.waitForIdle() && pokemonHubSessionRef.current === session
            : undefined,
        })
        const result = await session.heartbeatPromise
        if (result.status === 'cancelled') return
        if (result.status === 'expired' && pokemonHubSessionRef.current === session) {
          console.error('[Pokemon Hub] session heartbeat expired locally', { code: result.error.code, failures: result.failures })
          endPokemonHubSessionLocally(result.error)
        }
      } finally {
        session.heartbeatInFlight = false
        session.heartbeatPromise = null
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

  async function ensurePokemonHubSession() {
    const current = pokemonHubSessionRef.current
    if (current) return current
    const opening = pokemonHubSessionOpeningRef.current
    if (opening) {
      return opening.promise
    }
    const promise = openPokemonHubSession(pokemonHubSessionIdRef.current).then(opened => {
      const receivedAt = performance.now()
      const session = { sessionId: opened.sessionId, version: opened.snapshot.revision, heartbeatSequence: 0, heartbeatInFlight: false, heartbeatMonitor: createPokemonHubHeartbeatMonitor(), requestGate: createPokemonHubRequestGate(), leaseSample: { serverNow: opened.serverNow, expiresAt: opened.expiresAt, sentAt: receivedAt, receivedAt } }
      session.snapshotFlight = createPokemonHubSnapshotFlight({
        capture: () => createCanonicalPokemonHubSnapshot(session, pokemonHubPanesRef.current, pokemonHubSnapshotsRef.current),
        send: request => session.requestGate.run(() => syncPokemonHubSessionSnapshot(session.sessionId, request.snapshot, request.idempotencyKey)),
        onAccepted: snapshot => {
          if (pokemonHubSessionRef.current !== session) return
          session.version = snapshot.revision + 1
        },
        onCorrection: snapshot => {
          if (pokemonHubSessionRef.current !== session) return
          applyCanonicalSessionSnapshot(snapshot)
          setPokemonHubError('The backend corrected the workspace snapshot.')
        },
        onFailure: cause => {
          if (pokemonHubSessionRef.current !== session) return
          console.error('[Pokemon Hub] snapshot synchronization failed', { code: cause.code, message: cause.message })
          endPokemonHubSessionLocally(cause)
        },
      })
      pokemonHubSessionRef.current = session
      return session
    }).finally(() => { pokemonHubSessionOpeningRef.current = null })
    pokemonHubSessionOpeningRef.current = { promise }
    return promise
  }

  async function completePokemonHubDrag(event) {
    pokemonHubLastDragRef.current = performance.now()
    pokemonHubDragActiveRef.current = false
    if (pokemonHubDragCancelledRef.current || pokemonHubClosingRef.current) {
      pokemonHubDragCancelledRef.current = false
      setPokemonHubActiveDrag(null)
      return
    }
    const source = event.operation.source?.data?.location
    const target = event.operation.target?.data?.location
    if (['item', 'hub-item'].includes(source?.kind) || ['item', 'hub-item'].includes(target?.kind)) {
      if (['item', 'hub-item'].includes(source?.kind) && ['item', 'hub-item'].includes(target?.kind)) {
        if (source.kind === 'item' && target.kind === 'item' && saveSourceKey(source.gameId, source.profileId) === saveSourceKey(target.gameId, target.profileId)) await persistPokemonItemReorder(source, target)
        else if (source.kind === 'hub-item' && target.kind === 'hub-item' && source.hubProfileId === target.hubProfileId) await persistPokemonHubItemReorder(source, target)
        else {
          const view = location => location.kind === 'hub-item'
            ? projectedItems.profiles.find(profile => profile.hubProfileId === location.hubProfileId)?.itemInventory
            : projectedItems.layouts[saveSourceKey(location.gameId, location.profileId)]
          const preview = source.kind === 'item' && target.kind === 'item'
            ? getPokemonItemTransferIntent(source, target, view(source), view(target))
            : getPokemonHubItemTransferIntent(source, target, view(source), view(target))
          if (preview) setPokemonItemTransferDraft({ ...preview, quantity: preview.maxQuantity })
        }
      }
      setPokemonHubActiveDrag(null)
      return
    }
    if (isPokemonHubPartyDropForbidden(source, target)) {
      setPokemonHubActiveDrag(null)
      return
    }
    if (source && target) {
      await persistPokemonHubSessionMove(source, target)
      setPokemonHubActiveDrag(null)
      return
    }
    setPokemonHubActiveDrag(null)
  }

  function queuePokemonHubPaneWork(work) {
    const queued = pokemonHubPaneQueueRef.current.then(work, work)
    pokemonHubPaneQueueRef.current = queued.catch(() => {})
    return queued
  }

  function confirmPokemonItemTransfer() {
    const draft = pokemonItemTransferDraft
    if (!draft || pokemonHubClosingRef.current) return
    setPokemonItemTransferDraft(null)
    if (!Object.keys(pokemonHubPendingSourcesRef.current).length) {
      enqueuePokemonItemTransfer(draft)
      return
    }
    void queuePokemonHubPaneWork(async () => {
      enqueuePokemonItemTransfer(draft)
      await pokemonItemTransferQueueRef.current
    })
  }

  function enqueuePokemonItemTransfer(draft) {
    if (!draft || !Number.isSafeInteger(draft.quantity) || draft.quantity < 1 || draft.quantity > draft.maxQuantity
      || pokemonHubBusyRef.current || pokemonHubAbortedRef.current) return
    const session = pokemonHubSessionRef.current
    if (!session) return
    if (!pokemonItemPendingTransfersRef.current.length) pokemonItemConfirmedRef.current.clear()
    const transfer = { ...draft, toSlot: draft.destination.slot }
    const pending = [...pokemonItemPendingTransfersRef.current, transfer]
    if (projectPokemonItemTransfers(saveLayoutsBySourceRef.current, pokemonHubProfilesRef.current, pending).skipped.some(entry => entry.transfer === transfer)) {
      setPokemonHubError('A quantidade ou o espaço disponível mudou. Tente arrastar o item novamente.')
      return
    }
    for (const location of [transfer.source, transfer.destination]) {
      const key = itemInventorySourceKey(location)
      if (pokemonItemConfirmedRef.current.has(key)) continue
      const inventory = location.kind === 'hub-item'
        ? pokemonHubProfilesRef.current.find(profile => profile.hubProfileId === location.hubProfileId)?.itemInventory
        : saveLayoutsBySourceRef.current[key]?.itemInventory
      pokemonItemConfirmedRef.current.set(key, inventory)
    }
    pokemonItemPendingTransfersRef.current = pending
    setPokemonItemPendingTransfers(pending)
    setPokemonItemTransferDraft(null)
    pokemonItemTransferQueueRef.current = pokemonItemTransferQueueRef.current.then(
      () => executePokemonItemTransfer(transfer, session),
      () => executePokemonItemTransfer(transfer, session),
    )
  }

  async function executePokemonItemTransfer(transfer, session) {
    try {
      if (pokemonHubSessionRef.current !== session) throw new Error('A sessão mudou antes da transferência do item.')
      const confirmed = location => pokemonItemConfirmedRef.current.get(itemInventorySourceKey(location))
      const sourceInventory = confirmed(transfer.source)
      const sourceSlot = transfer.source.kind === 'hub-item'
        ? Number(Object.entries(sourceInventory?.slots ?? {}).find(([, item]) => item.itemKey === transfer.itemKey)?.[0])
        : sourceInventory?.areas?.[transfer.area]?.slots.findIndex(item => item.itemKey === transfer.itemKey)
      if (!Number.isSafeInteger(sourceSlot) || sourceSlot < 0) throw new Error('O item não está mais disponível na origem.')
      const source = { ...transfer.source, slot: sourceSlot }
      const view = location => location.kind === 'hub-item' ? confirmed(location) : {
        ...saveLayoutsBySourceRef.current[itemInventorySourceKey(location)], itemInventory: confirmed(location),
      }
      const preview = source.kind === 'item' && transfer.destination.kind === 'item'
        ? getPokemonItemTransferIntent(source, transfer.destination, view(source), view(transfer.destination))
        : getPokemonHubItemTransferIntent(source, transfer.destination, view(source), view(transfer.destination))
      if (!preview || transfer.quantity > preview.maxQuantity) throw new Error('A quantidade ou o espaço disponível mudou antes da transferência.')
      if (!await flushPendingPokemonHubSnapshot()) throw new Error('The workspace snapshot could not be synchronized before transferring items.')
      const identity = (location, revision) => location.kind === 'hub-item'
        ? { hubProfileId: location.hubProfileId, expectedItemRevision: revision }
        : { gameId: location.gameId, profileId: location.profileId, expectedSaveRevision: revision }
      const result = await session.requestGate.run(() => transferPokemonSaveItems(session.sessionId, {
        source: identity(source, source.kind === 'hub-item' ? preview.sourceItemRevision : preview.sourceSaveRevision),
        destination: identity(transfer.destination, transfer.destination.kind === 'hub-item' ? preview.destinationItemRevision : preview.destinationSaveRevision),
        area: transfer.area, fromSlot: sourceSlot, toSlot: transfer.toSlot, quantity: transfer.quantity,
      }))
      if (pokemonHubSessionRef.current !== session) return
      const snapshots = { ...pokemonHubSnapshotsRef.current }
      for (const [location, inventory] of [[transfer.source, result.sourceItemInventory], [transfer.destination, result.destinationItemInventory]]) {
        if (!inventory || location.kind === 'hub-item') continue
        pokemonItemConfirmedRef.current.set(itemInventorySourceKey(location), inventory)
        const key = saveSourceKey(location.gameId, location.profileId)
        if (snapshots[key]) snapshots[key] = { ...snapshots[key], layout: { ...snapshots[key].layout, itemInventory: inventory } }
      }
      commitSessionSnapshots(snapshots)
      for (const [location, inventory] of [[transfer.source, result.sourceHubItemInventory], [transfer.destination, result.destinationHubItemInventory]]) {
        if (location.kind !== 'hub-item' || !inventory) continue
        pokemonItemConfirmedRef.current.set(itemInventorySourceKey(location), inventory)
        setPokemonHubProfiles(current => current.map(profile => profile.hubProfileId === location.hubProfileId ? { ...profile, itemInventory: inventory } : profile))
      }
    } catch (cause) {
      if (['SAVE_ITEM_REVISION_CONFLICT', 'SAVE_REVISION_CONFLICT', 'SAVE_FENCE_CONFLICT'].includes(cause.code)) {
        for (const identity of [transfer.source, transfer.destination]) {
          try {
            if (identity.kind === 'hub-item') {
              const refreshed = await getPokemonHubProfile(identity.hubProfileId)
              pokemonItemConfirmedRef.current.set(itemInventorySourceKey(identity), refreshed.profile.itemInventory)
              setPokemonHubProfiles(current => current.map(profile => profile.hubProfileId === identity.hubProfileId ? { ...profile, itemInventory: refreshed.profile.itemInventory } : profile))
              continue
            }
            const refreshed = await getSaveProfileLayout(identity.gameId, identity.profileId)
            pokemonItemConfirmedRef.current.set(itemInventorySourceKey(identity), refreshed.itemInventory)
            const key = saveSourceKey(identity.gameId, identity.profileId)
            const snapshot = pokemonHubSnapshotsRef.current[key]
            if (pokemonHubSessionRef.current === session && snapshot) commitSessionSnapshots({ ...pokemonHubSnapshotsRef.current, [key]: {
              ...snapshot, layout: { ...snapshot.layout, itemInventory: refreshed.itemInventory },
            } })
          } catch (refreshError) { console.error('[Pokemon Hub] item inventory refresh failed', { code: refreshError.code, message: refreshError.message }) }
        }
      }
      setPokemonHubError(cause.message)
    } finally {
      pokemonItemPendingTransfersRef.current = pokemonItemPendingTransfersRef.current.filter(candidate => candidate !== transfer)
      setPokemonItemPendingTransfers(pokemonItemPendingTransfersRef.current)
    }
  }

  function persistPokemonHubItemReorder(source, target) {
    return queuePokemonHubPaneWork(() => applyPokemonHubItemReorder(source, target))
  }

  async function applyPokemonHubItemReorder(source, target) {
    await pokemonItemTransferQueueRef.current
    const profile = pokemonHubProfilesRef.current.find(candidate => candidate.hubProfileId === source.hubProfileId)
    const revision = profile?.itemInventory?.revision
    if (!Number.isSafeInteger(revision) || !profile.itemInventory.slots[source.slot]
      || pokemonHubBusyRef.current || pokemonHubAbortedRef.current) return
    const session = pokemonHubSessionRef.current
    if (!session) return
    pokemonHubBusyRef.current = true
    setPokemonHubBusy(true)
    try {
      if (!await flushPendingPokemonHubSnapshot()) throw new Error('The workspace snapshot could not be synchronized before reordering items.')
      const result = await session.requestGate.run(() => reorderPokemonSaveItems(session.sessionId, {
        hubProfileId: source.hubProfileId, fromSlot: source.slot, toSlot: target.slot, expectedItemRevision: revision,
      }))
      if (pokemonHubSessionRef.current === session) setPokemonHubProfiles(current => current.map(candidate => candidate.hubProfileId === source.hubProfileId ? { ...candidate, itemInventory: result.hubItemInventory } : candidate))
    } catch (cause) {
      setPokemonHubError(cause.message)
    } finally { pokemonHubBusyRef.current = false; setPokemonHubBusy(false) }
  }

  function persistPokemonItemReorder(source, target) {
    return queuePokemonHubPaneWork(() => applyPokemonItemReorder(source, target))
  }

  async function applyPokemonItemReorder(source, target) {
    await pokemonItemTransferQueueRef.current
    const key = saveSourceKey(source.gameId, source.profileId)
    const inventory = saveLayoutsBySourceRef.current[key]?.itemInventory
    const intent = getPokemonItemReorderIntent(source, target, inventory)
    if (!intent || pokemonHubBusyRef.current || pokemonHubAbortedRef.current) return
    const session = pokemonHubSessionRef.current
    if (!session || !pokemonHubSnapshotsRef.current[key]) return
    pokemonHubBusyRef.current = true
    setPokemonHubBusy(true)
    try {
      if (!await flushPendingPokemonHubSnapshot()) throw new Error('The workspace snapshot could not be synchronized before reordering items.')
      const result = await session.requestGate.run(() => reorderPokemonSaveItems(session.sessionId, {
        gameId: source.gameId, sourceProfileId: source.profileId, ...intent,
      }))
      if (pokemonHubSessionRef.current !== session || !pokemonHubSnapshotsRef.current[key]) return
      const snapshot = pokemonHubSnapshotsRef.current[key]
      commitSessionSnapshots({ ...pokemonHubSnapshotsRef.current, [key]: {
        ...snapshot, layout: { ...snapshot.layout, itemInventory: result.itemInventory },
      } })
    } catch (cause) {
      if (['SAVE_ITEM_REVISION_CONFLICT', 'SAVE_REVISION_CONFLICT', 'SAVE_FENCE_CONFLICT'].includes(cause.code)) {
        try {
          const refreshed = await getSaveProfileLayout(source.gameId, source.profileId)
          const snapshot = pokemonHubSnapshotsRef.current[key]
          if (pokemonHubSessionRef.current === session && snapshot) commitSessionSnapshots({ ...pokemonHubSnapshotsRef.current, [key]: {
            ...snapshot, layout: { ...snapshot.layout, itemInventory: refreshed.itemInventory },
          } })
        } catch (refreshError) { console.error('[Pokemon Hub] item inventory refresh failed', { code: refreshError.code, message: refreshError.message }) }
      }
      setPokemonHubError(cause.message)
    } finally {
      pokemonHubBusyRef.current = false
      setPokemonHubBusy(false)
    }
  }

  function persistPokemonHubSessionMove(source, target) {
    const session = pokemonHubSessionRef.current
    return queuePokemonHubPaneWork(() => applyPokemonHubSessionMove(source, target, session))
  }

  async function applyPokemonHubSessionMove(source, target, session) {
    try {
      if (pokemonHubSessionRef.current !== session || pokemonHubAbortedRef.current) return
      const activeKeys = new Set(pokemonHubPanesRef.current.map(paneSnapshotKey))
      for (const location of [source, target]) {
        const key = location.kind === 'hub' ? `hub:${location.hubProfileId}` : saveSourceKey(location.gameId, location.profileId)
        if (!activeKeys.has(key)) throw new Error('O perfil mudou antes de concluir o movimento.')
      }
      await ensurePokemonHubSession()
      const sourceSnapshot = await ensureHubSessionSource(source)
      const targetSnapshot = await ensureHubSessionSource(target)
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
      if (source.area === 'party' && target.area !== 'party' && sourceSnapshot.placements.filter(placement => placement.location.area === 'party' && placement.pokemonInstanceId).length === 1) {
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

  async function ensureHubSessionSource(location) {
    const key = location.kind === 'hub' ? `hub:${location.hubProfileId}` : saveSourceKey(location.gameId, location.profileId)
    const existing = pokemonHubSnapshotsRef.current[key]
    if (existing) {
      if (location.kind !== 'hub' || location.slot < existing.placements.length) return existing
      const expanded = extendHubSessionSourceSnapshot(existing, location.slot)
      commitSessionSnapshots({ ...pokemonHubSnapshotsRef.current, [key]: expanded })
      return expanded
    }
    if (location.kind === 'game') throw new Error('The source save is not loaded in this workspace.')
    const profile = pokemonHubProfiles.find(candidate => candidate.hubProfileId === location.hubProfileId)
    if (!profile) throw new Error('The Hub profile is not available.')
    const sourceSnapshot = extendHubSessionSourceSnapshot(createHubSessionSourceSnapshot({ profile }), location.slot)
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
    setPokemonCardSelection(current => current.map(selection => selection?.pokemonInstanceId === pokemonInstanceId || selection?.pokemonInstanceId === swappedPokemonInstanceId ? null : selection))
    setPokemonDetailsById(current => {
      const nextDetails = { ...current }
      for (const id of [pokemonInstanceId, swappedPokemonInstanceId]) {
        if (id && nextDetails[id]?.availability === 'ready') nextDetails[id] = { ...nextDetails[id], training: { ...nextDetails[id].training, partyRuntime: null } }
      }
      return nextDetails
    })
  }

  async function submitStructuralPokemonHubPaneChange(nextPanes, incomingSource, { paneLoad = false, paneIndex = null, signal = undefined } = {}) {
    await pokemonItemTransferQueueRef.current
    if (pokemonHubBusyRef.current) return false
    pokemonHubBusyRef.current = true
    if (!paneLoad) setPokemonHubBusy(true)
    try {
      if (!await waitForPokemonHubLoad(flushPendingPokemonHubSnapshot(), signal)) throw new Error('The workspace snapshot could not be synchronized before changing a pane.')
      signal?.throwIfAborted()

      const loadedHubProfile = incomingSource?.kind === 'hub' ? await getPokemonHubProfile(incomingSource.hubProfileId, signal) : null
      signal?.throwIfAborted()

      const nextSnapshots = { ...pokemonHubSnapshotsRef.current }
      let loadedSave = null
      if (incomingSource?.kind === 'game') {
        const session = await ensurePokemonHubSession()
        const layout = await getSaveProfileLayout(incomingSource.gameId, incomingSource.profileId, signal)
        signal?.throwIfAborted()
        const key = saveSourceKey(incomingSource.gameId, incomingSource.profileId)
        const sourceSnapshot = createGameSessionSourceSnapshot({ profileId: incomingSource.profileId, gameId: incomingSource.gameId, layout })
        nextSnapshots[key] = sourceSnapshot
        loadedSave = { key, layout, sourceSnapshot }
      } else if (incomingSource?.kind === 'hub') {
        nextSnapshots[`hub:${incomingSource.hubProfileId}`] = createHubSessionSourceSnapshot({ profile: loadedHubProfile.profile })
      }
      const session = await ensurePokemonHubSession()
      signal?.throwIfAborted()
      if (incomingSource) {
        const pane = nextPanes.findIndex(source => samePokemonHubPaneSource(source, incomingSource))
        if (pane < 0) throw new Error('The workspace pane source is invalid.')
        const loaded = await waitForPokemonHubLoad(session.requestGate.run(() => loadPokemonHubSessionPane(session.sessionId, pane, incomingSource, signal)), signal)
        signal?.throwIfAborted()
        if (loaded.corrected) {
          applyCanonicalSessionSnapshot(loaded.snapshot)
          setPokemonHubError('The backend corrected the workspace snapshot.')
          return false
        }
        session.version = loaded.snapshot.revision
      } else {
        const candidate = createCanonicalPokemonHubSnapshot(session, nextPanes, nextSnapshots)
        const correction = await session.requestGate.run(() => syncPokemonHubSessionSnapshot(session.sessionId, candidate, crypto.randomUUID()))
        if (correction) {
          applyCanonicalSessionSnapshot(correction)
          setPokemonHubError('The backend corrected the workspace snapshot.')
          return false
        }
        session.version = candidate.revision + 1
      }
      if (paneLoad) nextPanes = choosePaneSource(pokemonHubPanesRef.current, paneIndex, incomingSource).panes
      const previousPanes = pokemonHubPanesRef.current
      const previousTriggers = pokemonCardTriggerRefs.current
      pokemonCardTriggerRefs.current = nextPanes.map(source => previousTriggers[previousPanes.findIndex(previous => samePokemonHubPaneSource(previous, source))] ?? null)
      pokemonHubPanesRef.current = nextPanes
      setPokemonHubPanes(nextPanes)
      commitSessionSnapshots(nextSnapshots)
      if (loadedSave) setSaveLayoutsBySource(current => ({ ...current, [loadedSave.key]: snapshotToSaveLayout(loadedSave.sourceSnapshot, loadedSave.layout) }))
      if (loadedSave) setPokemonDetailsById(current => ({ ...current, ...loadedSave.layout.pokemonDetailsById }))
      if (loadedHubProfile) {
        setPokemonDetailsById(current => ({ ...current, ...loadedHubProfile.pokemonDetailsById }))
        setPokemonHubProfiles(current => current.map(profile => profile.hubProfileId === loadedHubProfile.profile.hubProfileId
          ? { ...profile, itemInventory: loadedHubProfile.profile.itemInventory } : profile))
      }
      setPokemonCardSelection(current => reconcilePokemonCardSelection(current, nextPanes, paneSnapshotKey))
      setPokemonHubSelection([])
      setPokemonHubProfileCreator(null)
      return true
    } catch (cause) {
      console.error('[Pokemon Hub] structural snapshot failed', { code: cause.code, message: cause.message })
      if (paneLoad && signal?.aborted && pokemonHubSessionRef.current) {
        pokemonHubClosingRef.current = true
        endPokemonHubSessionLocally(new Error('O carregamento do perfil excedeu cinco minutos.'))
      } else setPokemonHubError(signal?.aborted ? 'O carregamento do perfil excedeu cinco minutos.' : cause.message)
      return false
    } finally {
      pokemonHubBusyRef.current = false
      if (!paneLoad) setPokemonHubBusy(false)
    }
  }

  function applyCanonicalSessionSnapshot(snapshot) {
    const session = pokemonHubSessionRef.current
    if (session) session.version = snapshot.revision
    const { panes, snapshots } = reconcileCanonicalSessionSnapshot(snapshot, pokemonHubPanesRef.current.length, pokemonHubSnapshotsRef.current)
    pokemonHubPanesRef.current = panes
    setPokemonHubPanes(panes)
    setPokemonCardSelection([])
    commitSessionSnapshots(snapshots)
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

  function selectPokemonHubPane(index, source, { allowBusy = false } = {}) {
    if ((!allowBusy && pokemonHubBusy) || pokemonHubClosingRef.current || Object.hasOwn(pokemonHubPendingSourcesRef.current, index)) return
    const result = choosePaneSource(pokemonHubPanesRef.current, index, source || null, pokemonHubPendingSourcesRef.current)
    if (result.error) { setPokemonHubError(result.error); return }
    if (source && !isCompletePaneSource(source)) return
    pokemonHubPendingSourcesRef.current[index] = source || null
    setPokemonHubPendingPanes(current => ({ ...current, [index]: source || null }))
    const load = async () => {
      try {
        if (pokemonHubClosingRef.current) return
        const current = choosePaneSource(pokemonHubPanesRef.current, index, source || null)
        if (current.error) { setPokemonHubError(current.error); return }
        await submitStructuralPokemonHubPaneChange(current.panes, source, { paneLoad: true, paneIndex: index, signal: AbortSignal.timeout(300_000) })
      } finally {
        delete pokemonHubPendingSourcesRef.current[index]
        setPokemonHubPendingPanes(current => {
          const next = { ...current }
          delete next[index]
          return next
        })
      }
    }
    pokemonHubPaneQueueRef.current = pokemonHubPaneQueueRef.current.then(load, load)
  }

  function addPokemonHubPane() {
    try {
      const next = addWorkspacePane(pokemonHubPanesRef.current)
      pokemonHubPanesRef.current = next
      setPokemonHubPanes(next)
      setPokemonHubSelection([])
    } catch (cause) { setPokemonHubError(cause.message) }
  }

  async function closePokemonHubPane(index) {
    if (Object.keys(pokemonHubPendingSourcesRef.current).length) return
    try {
      await submitStructuralPokemonHubPaneChange(removeWorkspacePane(pokemonHubPanesRef.current, index), null)
    } catch (cause) { setPokemonHubError(cause.message) }
  }

  async function closePokemonHub() {
    if (pokemonHubClosingRef.current) return
    pokemonHubClosingRef.current = true
    await pokemonItemTransferQueueRef.current
    if (pokemonHubDragActiveRef.current) pokemonHubDragCancelledRef.current = true
    setPokemonHubBusy(true)
    await pokemonHubPaneQueueRef.current
    if (pokemonHubAbortedRef.current) return
    if (pokemonHubSnapshotTimerRef.current !== null) window.clearTimeout(pokemonHubSnapshotTimerRef.current)
    pokemonHubSnapshotTimerRef.current = null
    const session = pokemonHubSessionRef.current ?? await pokemonHubSessionOpeningRef.current?.promise.catch(() => null)
    if (session?.heartbeatPromise) await session.heartbeatPromise
    const finalSnapshot = session ? createCanonicalPokemonHubSnapshot(session, pokemonHubPanesRef.current, pokemonHubSnapshotsRef.current) : null
    pokemonHubSnapshotsRef.current = {}
    pokemonHubSessionRef.current = null
    pokemonHubSessionOpeningRef.current = null
    onClose()
    setPokemonHubBusy(false)
    if (!session) return
    try {
      const correction = await closePokemonHubSession(session.sessionId, finalSnapshot, session.pendingCloseIdempotencyKey ??= crypto.randomUUID())
      if (correction) console.error('[Pokemon Hub] close snapshot corrected after local shutdown')
    } catch (cause) {
      console.error('[Pokemon Hub] remote close failed; heartbeat expiry will finalize the session', { code: cause.code, message: cause.message })
    }
  }

  function endPokemonHubSessionLocally(cause) {
    pokemonHubClosingRef.current = true
    if (pokemonHubAbortedRef.current) return
    pokemonHubAbortedRef.current = true
    if (pokemonHubSnapshotTimerRef.current !== null) window.clearTimeout(pokemonHubSnapshotTimerRef.current)
    pokemonHubSnapshotTimerRef.current = null
    pokemonHubSnapshotsRef.current = {}
    pokemonHubSessionRef.current = null
    pokemonHubSessionOpeningRef.current = null
    setPokemonHubActiveDrag(null)
    onClose()
    setPokemonHubError(cause.message)
  }

  function openPokemonHubProfileCreator(index) {
    setPokemonHubProfileCreator(index)
    setPokemonHubProfileName('')
  }

  async function createHubProfile(index) {
    setPokemonHubBusy(true)
    try {
      const profile = await createPokemonHubProfile({ name: pokemonHubProfileName })
      setPokemonHubProfiles(current => [...current, profile])
      setPokemonHubProfileCreator(null)
      selectPokemonHubPane(index, { kind: 'hub', hubProfileId: profile.hubProfileId }, { allowBusy: true })
    } catch (cause) { setPokemonHubError(cause.message) } finally { setPokemonHubBusy(false) }
  }

  function openPokemonHubProfileRenamer(profile) {
    setPokemonHubProfileRenaming(profile)
    setPokemonHubProfileRenameName(profile.name)
  }

  async function renameHubProfile() {
    if (!pokemonHubProfileRenaming) return
    setPokemonHubBusy(true)
    try {
      const renamed = await renamePokemonHubProfile(pokemonHubProfileRenaming.hubProfileId, pokemonHubProfileRenameName)
      setPokemonHubProfiles(current => current.map(profile => profile.hubProfileId === renamed.hubProfileId ? { ...profile, name: renamed.name } : profile))
      setPokemonHubProfileRenaming(null)
    } catch (cause) { setPokemonHubError(cause.message) } finally { setPokemonHubBusy(false) }
  }

  async function deleteHubProfile(profile) {
    const discardOccupied = Object.keys(profile.grid.entries).length > 0 || Object.keys(profile.itemInventory?.slots ?? {}).length > 0
    setPokemonHubBusy(true)
    try {
      await deletePokemonHubProfile(profile.hubProfileId, { discardOccupied })
      setPokemonHubProfiles(current => current.filter(candidate => candidate.hubProfileId !== profile.hubProfileId))
      setPokemonHubPanes(current => current.map(source => source?.kind === 'hub' && source.hubProfileId === profile.hubProfileId ? null : source))
      setPokemonCardSelection(current => current.map(selection => selection?.sourceKey === `hub:${profile.hubProfileId}` ? null : selection))
      setPokemonHubSelection([])
    } catch (cause) { setPokemonHubError(cause.message) } finally { setPokemonHubBusy(false) }
  }

  function closePokemonCard(pane) {
    setPokemonCardSelection(current => current.map((selection, index) => index === pane ? null : selection))
    window.requestAnimationFrame(() => pokemonCardTriggerRefs.current[pane]?.focus())
  }

  function selectPokemonHubLocation(location, pane, pokemonInstanceId = null, trigger = null) {
    if (performance.now() - pokemonHubLastDragRef.current < 250) return
    setPokemonHubSelection(current => current.length === 1 && current[0].pane !== pane ? [...current, { ...location, pane }] : [{ ...location, pane }])
    if (pokemonInstanceId) {
      pokemonCardTriggerRefs.current[pane] = trigger
      const sourceKey = paneSnapshotKey(pokemonHubPanesRef.current[pane])
      setPokemonCardSelection(current => {
        const next = [...current]
        next[pane] = next[pane]?.pokemonInstanceId === pokemonInstanceId && next[pane]?.sourceKey === sourceKey ? null : { sourceKey, pokemonInstanceId }
        return next
      })
    }
  }
  return <>
    <DragDropProvider sensors={pokemonHubDragSensors} onDragStart={event => {
      const data = event.operation.source?.data
      pokemonHubLastDragRef.current = performance.now()
      pokemonHubDragActiveRef.current = true
      pokemonHubDragCancelledRef.current = false
      setPokemonHubActiveDrag(data?.slot ? data : null)
    }} onDragEnd={completePokemonHubDrag} onDragCancel={() => { pokemonHubDragActiveRef.current = false; pokemonHubDragCancelledRef.current = true; setPokemonHubActiveDrag(null) }}><div className="pokemon-workspace" role="dialog" aria-modal="true" aria-label="Pokémon Hub">
      <header className="pokemon-workspace-header">
        <Button className="dialog-close" type="text" aria-label="Fechar Pokémon Hub" icon={<CloseOutlined />} onClick={() => void closePokemonHub()} />
      </header>
      <div className={`pokemon-workspace-body pokemon-workspace-body-${pokemonHubPanes.length}`}>
        {pokemonHubPanes.map((source, index) => <PokemonHubPane key={index} side={index} panes={pokemonHubPanes} pendingSources={pokemonHubPendingPanes} paneCount={pokemonHubPanes.length} source={source} activeDrag={pokemonHubActiveDrag} transferDraft={pokemonItemTransferDraft} onTransferQuantityChange={quantity => setPokemonItemTransferDraft(current => current ? { ...current, quantity } : null)} onTransferConfirm={confirmPokemonItemTransfer} onTransferCancel={() => setPokemonItemTransferDraft(null)} data={pokemonHubData} hubProfiles={projectedItems.profiles} profilesLoading={pokemonHubProfilesLoading} saveProfileGames={saveProfileGames} saveProfileGamesLoading={catalogLoading} saveProfileGamesError={catalogError} saveProfilesByGame={saveProfilesByGame} saveLayoutsBySource={projectedItems.layouts} selected={pokemonHubSelection} cardSelection={pokemonCardSelection[index]} pokemonDetailsById={pokemonDetailsById} onCardClose={() => closePokemonCard(index)} selectedBox={pokemonHubBoxes[saveSourceKey(source?.gameId, source?.profileId)]} busy={pokemonHubBusy || pokemonItemPendingTransfers.length > 0} loading={Object.hasOwn(pokemonHubPendingPanes, index)} structureBusy={Object.keys(pokemonHubPendingPanes).length > 0} onSourceChange={nextSource => selectPokemonHubPane(index, nextSource)} onCreate={() => openPokemonHubProfileCreator(index)} onAddPane={addPokemonHubPane} onClosePane={() => closePokemonHubPane(index)} onBoxChange={(gameId, profileId, box) => setPokemonHubBoxes(current => ({ ...current, [saveSourceKey(gameId, profileId)]: box }))} onSlotSelect={selectPokemonHubLocation} onRename={openPokemonHubProfileRenamer} onDelete={deleteHubProfile} />)}
      </div>
    </div><PokemonHubDragOverlay drag={pokemonHubActiveDrag} /></DragDropProvider>
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

function PokemonHubPaneControls({ side, panes, pendingSources, source, hubProfiles, profilesLoading, saveProfileGames, saveProfileGamesLoading, saveProfileGamesError, saveProfilesByGame, busy, onSourceChange, onCreate, onDelete }) {
  const [selectionDraft, setSelectionDraft] = useState(null)
  useEffect(() => { setSelectionDraft(null) }, [source?.gameId, source?.hubProfileId, source?.kind, source?.profileId])
  const availableHubProfiles = hubProfiles.filter(profile => isPaneSourceAvailable(panes, side, { kind: 'hub', hubProfileId: profile.hubProfileId }, pendingSources))
  const { activeSourceKind, selectedSaveSource, selectedHubSource } = paneControlSources(source, selectionDraft)
  const selectedHubProfile = source?.kind === 'hub' && selectedHubSource?.hubProfileId === source.hubProfileId
    ? hubProfiles.find(profile => profile.hubProfileId === source.hubProfileId) : null
  const selectedGameId = selectedSaveSource?.gameId ?? null
  const saveProfiles = selectedGameId ? saveProfilesByGame[selectedGameId] ?? [] : []
  const allSaveProfiles = saveProfileGames.find(game => game.id === selectedGameId)?.profiles ?? []
  const availableSaveProfileGames = saveProfileGames.filter(game => hasAvailableSaveProfile(panes, side, game.id, saveProfilesByGame[game.id], pendingSources))
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
      }} options={saveProfiles.filter(profile => isPaneSourceAvailable(panes, side, { kind: 'game', gameId: selectedGameId, profileId: profile.id }, pendingSources)).map(profile => ({ value: profile.id, label: formatGameProfileLabel(profile, allSaveProfiles) }))} />
      {saveProfileGamesError && <p className="pokemon-pane-note" role="alert">{saveProfileGamesError}</p>}
    </>}
    {activeSourceKind === 'hub' && <><Select className="pokemon-pane-profile" classNames={{ popup: { root: 'pokemon-hub-select-popup' } }} aria-label="Perfil do Hub" value={selectedHubSource?.hubProfileId} placeholder={profilesLoading ? 'Carregando perfis…' : 'Escolher perfil…'} loading={profilesLoading} disabled={busy} allowClear showSearch optionFilterProp="label" onClear={() => setSelectionDraft({ kind: 'hub' })} onChange={value => {
      if (!value) { setSelectionDraft({ kind: 'hub' }); return }
      setSelectionDraft(null)
      onSourceChange({ kind: 'hub', hubProfileId: value })
    }} options={availableHubProfiles.map(profile => ({ value: profile.hubProfileId, label: profile.name }))} /><Button className="pokemon-add-pane" type="default" aria-label="Criar Perfil do Hub" icon={<PlusOutlined />} disabled={busy} onClick={onCreate} />{selectedHubProfile && <PokemonHubProfileDelete profile={selectedHubProfile} busy={busy} onDelete={onDelete} />}</>}
  </div>
}

function PokemonPaneTabs({ activeTab, onChange, side, width }) {
  return <div className="pokemon-pane-tabs" role="group" aria-label={`Conteúdo do painel ${side + 1}`} style={width ? { width } : undefined}>
    <button type="button" className={`pokemon-pane-tab${activeTab === 'pokemon' ? ' is-active' : ''}`} aria-pressed={activeTab === 'pokemon'} onClick={() => onChange('pokemon')}>Pokémons</button>
    <button type="button" className={`pokemon-pane-tab${activeTab === 'items' ? ' is-active' : ''}`} aria-pressed={activeTab === 'items'} onClick={() => onChange('items')}>Itens</button>
  </div>
}

const PokemonHubSlotFrame = React.forwardRef(function PokemonHubSlotFrame({ as = 'button', className, position, corner, footer, children, ...props }, ref) {
  const content = <><span className="pokemon-hub-slot-index">{position}</span>{corner}{children}{footer && <span className="pokemon-save-party-strip pokemon-slot-footer" title={footer}><span>{footer}</span></span>}</>
  return as === 'div'
    ? <div ref={ref} className={className} {...props}>{content}</div>
    : <button ref={ref} type="button" className={className} {...props}>{content}</button>
})

function PokemonHubSlotGrid({ profile, entries, layoutVersion, side, title, selected, pokemonCount, busy, onSlotSelect, onRename, dragPermission, activeTab, onTabChange, transferDraft, onTransferQuantityChange, onTransferConfirm, onTransferCancel }) {
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
  const itemEntries = profile.itemInventory?.slots ?? {}
  const visibleItemSlotCount = getPokemonHubVisibleSlotCount(itemEntries, columns)
  const cardRowWidth = `${getPokemonHubGridWidth(columns)}px`
  const isSelected = location => selected.some(candidate => candidate.kind === location.kind && candidate.slot === location.slot)

  return <div className="pokemon-hub-profile-layout">
    <div className="pokemon-hub-profile-scroll" ref={frameRef}>
      <div className="pokemon-hub-profile-canvas">
        <PokemonPaneTabs activeTab={activeTab} onChange={onTabChange} side={side} width={cardRowWidth} />
        {activeTab === 'pokemon' ? <><header className="pokemon-hub-profile-summary" style={{ width: cardRowWidth }}>
          <p className="pokemon-hub-profile-count"><strong>{pokemonCount}</strong><span>Pokémon</span></p>
          <h3>{profile.name}</h3>
          <PokemonHubProfileActions profile={profile} busy={busy} onRename={onRename} />
        </header>
        <div className="pokemon-workspace-grid pokemon-hub-profile-grid" style={{ gridTemplateColumns: `repeat(${columns}, var(--pokemon-slot-size))`, width: cardRowWidth }} aria-label={`${title} slots`}>
          {Array.from({ length: visibleSlotCount }, (_, slot) => {
            const entry = entries[slot] ?? null
            const location = { kind: 'hub', slot }
            const occupied = Boolean(entry)
            const slotProjection = { occupied, species: entry?.species, shiny: entry?.shiny, isEgg: entry?.isEgg, hubPassport: entry?.hubPassport }
            const permission = dragPermission(slotProjection)
            return <PokemonHubDragSlot key={slot} location={{ ...location, hubProfileId: profile.hubProfileId }} slot={slotProjection} dragDisabled={permission.dragDisabled} dragBlockReason={permission.reason?.message}><PokemonHubSlotFrame className={`pokemon-hub-slot${occupied ? ' occupied' : ''}${isSelected(location) ? ' selected' : ''}`} position={slot + 1} corner={occupied && <span className="pokemon-hub-slot-content">{getPokemonSlotFallback(slotProjection)}</span>} aria-label={`${title}, posição ${slot + 1}, ${occupied ? slotProjection.isEgg ? 'ovo' : 'ocupada' : 'vazia'}`} onClick={event => onSlotSelect(location, side, entry?.pokemonInstanceId, event.currentTarget)}><PokemonSlotSprite slot={slotProjection} /></PokemonHubSlotFrame></PokemonHubDragSlot>
          })}
        </div></> : <div className="pokemon-item-inventory pokemon-hub-item-inventory" style={{ width: cardRowWidth }}>
          <header className="pokemon-hub-profile-summary pokemon-hub-item-nav">
            <h3>{profile.name}</h3>
            <PokemonHubProfileActions profile={profile} busy={busy} onRename={onRename} />
          </header>
          <div className="pokemon-item-grid pokemon-hub-item-grid" role="list" style={{ gridTemplateColumns: `repeat(${columns}, var(--pokemon-slot-size))`, width: cardRowWidth }} aria-label={`Itens de ${title}`}>
            {Array.from({ length: visibleItemSlotCount }, (_, slot) => {
              const item = itemEntries[slot] ?? null
              const occupied = Boolean(item)
              const frame = <PokemonHubSlotFrame as="div" className={`pokemon-hub-slot pokemon-item-slot${occupied ? ' occupied reorderable' : ''}`} role="listitem" position={slot + 1}
                corner={occupied && <span className="pokemon-item-quantity">×{item.quantity}</span>}
                footer={occupied ? getPokemonItemName({ nativeId: 1, itemKey: item.itemKey }) : null}
                aria-label={`Itens de ${title}, posição ${slot + 1}, ${occupied ? `${getPokemonItemName({ nativeId: 1, itemKey: item.itemKey })}, ${item.quantity}` : 'vazia'}`}>
                {occupied && <PokemonItemSprite itemKey={item.itemKey} />}
              </PokemonHubSlotFrame>
              return <PokemonItemDragSlot key={slot} location={{ kind: 'hub-item', hubProfileId: profile.hubProfileId, slot }} slot={item} canDrag={occupied}>{frame}</PokemonItemDragSlot>
            })}
          </div>
          {transferDraft && <PokemonItemTransferPrompt transferDraft={transferDraft} onTransferQuantityChange={onTransferQuantityChange} onTransferConfirm={onTransferConfirm} onTransferCancel={onTransferCancel} />}
        </div>}
      </div>
    </div>
  </div>
}

function PokemonHubProfileActions({ profile, busy, onRename }) {
  return <div className="pokemon-hub-profile-actions">
    <Button type="default" aria-label={`Renomear ${profile.name}`} icon={<EditOutlined />} disabled={busy} onClick={() => onRename(profile)} />
  </div>
}

function PokemonHubProfileDelete({ profile, busy, onDelete }) {
  const pokemonCount = Object.keys(profile.grid.entries).length
  const itemCount = Object.keys(profile.itemInventory?.slots ?? {}).length
  return <Popconfirm title={`Excluir ${profile.name}?`} description={pokemonCount || itemCount ? `${pokemonCount} Pokémon e ${itemCount} itens serão perdidos permanentemente.` : 'O perfil vazio será removido.'} okText="Excluir" cancelText="Cancelar" okButtonProps={{ danger: true }} onConfirm={() => onDelete(profile)}>
    <Button className="pokemon-pane-profile-delete" type="default" danger aria-label={`Excluir ${profile.name}`} icon={<DeleteOutlined />} disabled={busy} />
  </Popconfirm>
}

function PokemonHubPane({ side, panes, pendingSources, paneCount, source, activeDrag, transferDraft, onTransferQuantityChange, onTransferConfirm, onTransferCancel, data, hubProfiles, profilesLoading, saveProfileGames, saveProfileGamesLoading, saveProfileGamesError, saveProfilesByGame, saveLayoutsBySource, selected, cardSelection, pokemonDetailsById, onCardClose, selectedBox, busy, loading, structureBusy, onSourceChange, onCreate, onAddPane, onClosePane, onBoxChange, onSlotSelect, onRename, onDelete }) {
  const [activeTab, setActiveTab] = useState('pokemon')
  const [itemAreaId, setItemAreaId] = useState('pc')
  useEffect(() => { setActiveTab('pokemon'); setItemAreaId('pc') }, [source?.gameId, source?.profileId, source?.hubProfileId, source?.kind])
  useEffect(() => {
    const location = activeDrag?.location
    if (!['item', 'hub-item'].includes(location?.kind)) return
    if (source?.kind === 'game' && (location.kind === 'hub-item'
      || saveSourceKey(source.gameId, source.profileId) !== saveSourceKey(location.gameId, location.profileId))) {
      setActiveTab('items')
      if (location.kind === 'item') setItemAreaId(location.area)
    }
    if (source?.kind === 'hub' && (location.kind === 'item' || location.hubProfileId !== source.hubProfileId)) setActiveTab('items')
  }, [activeDrag?.location, source?.gameId, source?.profileId, source?.hubProfileId, source?.kind])
  const games = data?.games ?? []
  const game = source?.kind === 'game' ? games.find(candidate => candidate.id === source.gameId) : null
  const hubProfile = source?.kind === 'hub' ? hubProfiles.find(candidate => candidate.hubProfileId === source.hubProfileId) : null
  const sourceKey = saveSourceKey(source?.gameId, source?.profileId)
  const saveLayout = saveLayoutsBySource[sourceKey]
  const currentCardId = cardSelection?.sourceKey === paneSnapshotKey(source) ? cardSelection.pokemonInstanceId : null
  const cardIsPresent = currentCardId && (hubProfile
    ? Object.values(hubProfile.grid.entries).some(entry => entry.pokemonInstanceId === currentCardId)
    : saveLayout && !saveLayout.missing && [...saveLayout.party, ...saveLayout.boxes.flatMap(box => box.slots)].some(slot => slot.pokemonInstanceId === currentCardId))
  const cardOpen = Boolean(currentCardId && cardIsPresent)
  const cardDetail = cardIsPresent ? pokemonDetailsById[currentCardId] : null
  const dragPermission = slot => getPokemonHubDragFeedback({ panes, source, slot, saveLayoutsBySource })
  const activeSource = activeDrag ? sourceForPokemonHubLocation(panes, activeDrag.location) : null
  const activeFeedback = activeSource ? getPokemonHubDragFeedback({ panes, source: activeSource, slot: activeDrag.slot, saveLayoutsBySource }) : null
  const dragOverlayMessage = activeFeedback?.destinations.find(destination => samePokemonHubPaneSource(destination.source, source) && !destination.allowed)?.reason?.message ?? ''
  const itemDragLocation = activeDrag?.location
  const itemDragInventory = itemDragLocation?.kind === 'item' ? saveLayoutsBySource[saveSourceKey(itemDragLocation.gameId, itemDragLocation.profileId)]?.itemInventory : null
  const itemDragBlocked = itemDragInventory && source && (source.kind === 'hub' || source.gameId !== itemDragLocation.gameId || source.profileId !== itemDragLocation.profileId)
    && !getPokemonItemPolicy(itemDragInventory.title, itemDragLocation.area, activeDrag.slot?.itemKey)?.canTransfer
  const gameBoxes = game?.boxes ?? []
  const boxIndex = gameBoxes.length ? Math.min(selectedBox ?? 0, gameBoxes.length - 1) : 0
  const gameSlots = gameBoxes[boxIndex]?.slots ?? []
  const title = hubProfile?.name ?? game?.title ?? ''
  const pokemonCount = hubProfile ? Object.keys(hubProfile.grid.entries).length : 0
  const canClose = paneCount > 1
  const canAdd = paneCount < 3 && side === paneCount - 1
  const showTabs = Boolean(hubProfile || saveLayout)
  const isSelected = location => selected.some(candidate => candidate.kind === location.kind && candidate.gameId === location.gameId && candidate.box === location.box && candidate.slot === location.slot)
  const slotGrid = source && (hubProfile || game?.status === 'ready') && (hubProfile
    ? <PokemonHubSlotGrid profile={hubProfile} entries={hubProfile.grid.entries} layoutVersion={paneCount} side={side} title={title} selected={selected} pokemonCount={pokemonCount} busy={busy} onSlotSelect={onSlotSelect} onRename={onRename} dragPermission={dragPermission} activeTab={activeTab} onTabChange={setActiveTab}
      transferDraft={transferDraft?.destination.kind === 'hub-item' && transferDraft.destination.hubProfileId === source.hubProfileId ? transferDraft : null}
      onTransferQuantityChange={onTransferQuantityChange} onTransferConfirm={onTransferConfirm} onTransferCancel={onTransferCancel} />
    : <div className="pokemon-workspace-grid" aria-label={`${title} slots`}>
    {gameSlots.map((entry, slot) => {
      const location = source.kind === 'hub' ? { kind: 'hub', slot } : { kind: 'game', gameId: game.id, box: boxIndex, slot }
      const dragLocation = { kind: 'game', gameId: game.id, profileId: source.profileId, area: 'box', box: boxIndex, slot }
      const occupied = Boolean(entry.occupied)
      return <PokemonHubDragSlot key={slot} location={dragLocation} slot={entry}><PokemonHubSlotFrame className={`pokemon-hub-slot${occupied ? ' occupied' : ''}${isSelected(location) ? ' selected' : ''}`} position={slot + 1} corner={occupied && <span className="pokemon-hub-slot-content">{getPokemonSlotFallback(entry)}</span>} aria-label={`${title}, posição ${slot + 1}, ${occupied ? entry.isEgg ? 'ovo' : 'ocupada' : 'vazia'}`} onClick={event => onSlotSelect(location, side, entry.pokemonInstanceId, event.currentTarget)}><PokemonSlotSprite slot={entry} /></PokemonHubSlotFrame></PokemonHubDragSlot>
    })}
  </div>)
  return <section className="pokemon-workspace-pane" aria-label={`Painel ${side + 1} do Pokémon Hub`}>
    <header className="pokemon-pane-header" inert={cardOpen}>
      <PokemonHubPaneControls side={side} panes={panes} pendingSources={pendingSources} source={source} hubProfiles={hubProfiles} profilesLoading={profilesLoading} saveProfileGames={saveProfileGames} saveProfileGamesLoading={saveProfileGamesLoading} saveProfileGamesError={saveProfileGamesError} saveProfilesByGame={saveProfilesByGame} busy={busy} onSourceChange={onSourceChange} onCreate={onCreate} onDelete={onDelete} />
      <div className="pokemon-pane-actions">
        {canClose && <Button className="pokemon-pane-action pokemon-pane-close" type="default" aria-label="Fechar container" title="Fechar container" icon={<CloseOutlined />} disabled={busy || structureBusy} onClick={onClosePane} />}
        {canAdd && <Button className="pokemon-pane-action pokemon-pane-add" type="primary" aria-label="Abrir novo container" title="Abrir novo container" icon={<PlusOutlined />} disabled={busy} onClick={onAddPane} />}
      </div>
    </header>
    <div className="pokemon-pane-content" inert={cardOpen}>
      {!hubProfile && showTabs && <PokemonPaneTabs activeTab={activeTab} onChange={setActiveTab} side={side} />}
      {activeTab === 'pokemon' ? <>
        {saveLayout?.missing && <PokemonSaveLayoutMissing />}
        {saveLayout && !saveLayout.missing && <PokemonSaveLayout layout={saveLayout} gameId={source.gameId} profileId={source.profileId} selectedBox={selectedBox ?? 0} onBoxChange={onBoxChange} dragPermission={dragPermission} activeDrag={activeDrag} side={side} onSlotSelect={onSlotSelect} />}
        {!hubProfile && slotGrid}
        {dragOverlayMessage && <div className="pokemon-hub-transfer-block-overlay" role="status">{dragOverlayMessage}</div>}
      </> : <>
        {saveLayout?.missing && <PokemonSaveLayoutMissing items />}
        {saveLayout && !saveLayout.missing && <PokemonItemInventory inventory={saveLayout.itemInventory} gameId={source.gameId} profileId={source.profileId} areaId={itemAreaId} onAreaChange={setItemAreaId}
          transferDraft={transferDraft?.destination.kind === 'item' && transferDraft.destination.gameId === source.gameId && transferDraft.destination.profileId === source.profileId ? transferDraft : null}
          onTransferQuantityChange={onTransferQuantityChange} onTransferConfirm={onTransferConfirm} onTransferCancel={onTransferCancel} />}
      </>}
      {hubProfile && slotGrid}
      {game && game.status !== 'ready' && <p className="pokemon-pane-note">{game.status === 'active' ? 'Feche o jogo antes de usar o Hub.' : 'Este save ainda não está disponível.'}</p>}
    </div>
    {itemDragBlocked && <div className="pokemon-item-block-overlay" role="status" aria-label="Não é possível arrastar esse item." aria-live="polite"><StopOutlined className="pokemon-item-block-icon" aria-hidden="true" /><span>Não é possível arrastar esse item.</span></div>}
    {cardOpen && <PokemonDetailCard key={currentCardId} detail={cardDetail} onClose={onCardClose} />}
    {loading && <div className="pokemon-workspace-pane-stale" role="status" aria-label={`Processando painel ${side + 1}`}><span>Processando…</span></div>}
  </section>
}

function PokemonSaveLayout({ layout, gameId, profileId, selectedBox, onBoxChange, dragPermission, activeDrag, side, onSlotSelect }) {
  const boxIndex = Math.max(0, Math.min(selectedBox, layout.boxes.length - 1))
  const box = layout.boxes[boxIndex]
  const partyDropForbidden = isPokemonHubPartyDropForbidden(activeDrag?.location, { kind: 'game', area: 'party' })
  return <div className="pokemon-save-layout">
    <section aria-label="Party"><div className="pokemon-save-party">{layout.party.map((slot, index) => <SaveSlot key={index} location={{ kind: 'game', gameId, profileId, area: 'party', slot: index }} slot={slot} position={getSavePartySlotPosition(index, layout.party.length)} label={`Party, posição ${index + 1}`} showPartyStrip dragPermission={dragPermission(slot)} dropForbidden={partyDropForbidden} side={side} onSlotSelect={onSlotSelect} />)}</div></section>
    <div className="pokemon-save-divider" />
    <section aria-label="Boxes"><div className="pokemon-save-box-nav"><Button aria-label="Box anterior" icon={<LeftOutlined />} onClick={() => onBoxChange(gameId, profileId, getPreviousSaveBoxIndex(boxIndex, layout.boxes.length))} /><h4>Box {boxIndex + 1} de {layout.boxes.length}</h4><Button aria-label="Próxima Box" icon={<RightOutlined />} onClick={() => onBoxChange(gameId, profileId, getNextSaveBoxIndex(boxIndex, layout.boxes.length))} /></div><div className="pokemon-save-box-grid">{box.slots.map((slot, index) => <SaveSlot key={index} location={{ kind: 'game', gameId, profileId, area: 'box', box: boxIndex, slot: index }} slot={slot} position={getSaveBoxSlotPosition(boxIndex, index, box.slots.length)} label={`Box ${boxIndex + 1}, posição ${index + 1}`} dragPermission={dragPermission(slot)} side={side} onSlotSelect={onSlotSelect} />)}</div></section>
  </div>
}

function PokemonSaveLayoutMissing({ items = false }) {
  return <div className="pokemon-save-layout-missing"><div className="pokemon-save-layout-missing-card"><InboxOutlined /><h3>Este perfil ainda não possui um save.</h3><p>Abra o jogo e salve uma partida para carregar {items ? 'os itens' : 'Party e Boxes'}.</p></div></div>
}

function PokemonItemInventory({ inventory, gameId, profileId, areaId, onAreaChange, transferDraft, onTransferQuantityChange, onTransferConfirm, onTransferCancel }) {
  const areaView = getPokemonItemAreaView(inventory, areaId)
  if (!areaView) return <p className="pokemon-item-unavailable">Itens deste save indisponíveis.</p>
  const changeArea = direction => onAreaChange(areaView.areaIds[direction < 0
    ? getPreviousSaveBoxIndex(areaView.index, areaView.areaIds.length)
    : getNextSaveBoxIndex(areaView.index, areaView.areaIds.length)])
  const firstEmptySlot = areaView.slots.findIndex(slot => !slot.nativeId)
  const reorderable = Boolean(getPokemonItemPolicy(inventory.title, areaId, null)?.canReorder)
    && !areaView.issues?.length
    && (firstEmptySlot < 0 || !areaView.slots.slice(firstEmptySlot).some(slot => slot.nativeId))
  const droppable = reorderable || areaId === 'tm-hm' || areaId === 'berries'
  return <div className="pokemon-item-inventory">
    <div className="pokemon-save-box-nav pokemon-item-area-nav">
      <Button aria-label="Tipo anterior de itens" icon={<LeftOutlined />} onClick={() => changeArea(-1)} />
      <h4>{areaView.label}</h4>
      <Button aria-label="Próximo tipo de itens" icon={<RightOutlined />} onClick={() => changeArea(1)} />
    </div>
    <div className="pokemon-item-grid" role="list" aria-label={`Slots de ${areaView.label}`}>
      {areaView.slots.map(slot => {
        const occupied = slot.nativeId !== 0
        const name = getPokemonItemName(slot)
        const issue = areaView.issues?.some(problem => problem.slot === slot.index)
        const policy = getPokemonItemPolicy(inventory.title, areaId, slot.itemKey)
        const showQuantity = policy?.showQuantity !== false
        const canDrag = occupied && !areaView.issues?.length && Boolean(policy)
        const frame = <PokemonHubSlotFrame as="div" className={`pokemon-hub-slot pokemon-item-slot${occupied ? ' occupied' : ''}${issue ? ' has-issue' : ''}${canDrag ? ' draggable' : ''}`} role="listitem" position={slot.index + 1} corner={occupied && showQuantity && <span className="pokemon-item-quantity">×{slot.quantity}</span>} footer={occupied ? name : null} aria-label={`${areaView.label}, posição ${slot.index + 1}, ${occupied ? `${name}${showQuantity ? `, ${slot.quantity}` : ''}` : 'vazia'}${issue ? ', dados inválidos' : ''}`}>
          {occupied && <PokemonItemSprite itemKey={slot.itemKey} />}
        </PokemonHubSlotFrame>
        return droppable ? <PokemonItemDragSlot key={slot.index} location={{ kind: 'item', gameId, profileId, area: areaId, slot: slot.index }} slot={slot} canDrag={canDrag}>{frame}</PokemonItemDragSlot> : React.cloneElement(frame, { key: slot.index })
      })}
    </div>
    {transferDraft && <PokemonItemTransferPrompt transferDraft={transferDraft} onTransferQuantityChange={onTransferQuantityChange} onTransferConfirm={onTransferConfirm} onTransferCancel={onTransferCancel} />}
  </div>
}

function PokemonItemTransferPrompt({ transferDraft, onTransferQuantityChange, onTransferConfirm, onTransferCancel }) {
  const name = getPokemonItemName({ nativeId: 1, itemKey: transferDraft.itemKey })
  return <div className="pokemon-item-transfer-shade"><div className="pokemon-item-transfer-prompt" role="dialog" aria-label={`Transferir ${name}`}>
      <div className="pokemon-item-transfer-identity">
        <div className="pokemon-item-transfer-art"><PokemonItemSprite itemKey={transferDraft.itemKey} /></div>
        <div><span>Transferir item</span><strong>{name}</strong></div>
      </div>
      <label className="pokemon-item-transfer-quantity"><span>Quantidade a transferir</span><span className="pokemon-item-transfer-quantity-input"><input type="number" min="1" max={transferDraft.maxQuantity} step="1" value={transferDraft.quantity} onChange={event => onTransferQuantityChange(Number(event.target.value))} /><span className="pokemon-item-transfer-limit">/ {transferDraft.maxQuantity}</span></span></label>
      <div className="pokemon-item-transfer-actions"><Button onClick={onTransferCancel}>Cancelar</Button><Button type="primary" disabled={!Number.isSafeInteger(transferDraft.quantity) || transferDraft.quantity < 1 || transferDraft.quantity > transferDraft.maxQuantity} onClick={onTransferConfirm}>Transferir</Button></div>
    </div></div>
}

function SaveSlot({ location, slot, position, label, showPartyStrip = false, dragPermission = { dragDisabled: false }, dropForbidden = false, side, onSlotSelect }) {
  return <PokemonHubDragSlot location={location} slot={slot} dragDisabled={dragPermission.dragDisabled} dragBlockReason={dragPermission.reason?.message} dropForbidden={dropForbidden}><PokemonHubSlotFrame className={`pokemon-hub-slot${slot.occupied ? ' occupied' : ''}`} position={position} corner={slot.occupied && <span className="pokemon-hub-slot-content">{getPokemonSlotFallback(slot)}</span>} footer={showPartyStrip ? 'Party' : null} aria-label={`${label}, ${slot.occupied ? slot.isEgg ? 'ovo' : `ocupada${slot.species ? `, espécie ${slot.species}` : ''}` : 'vazia'}`} onClick={event => onSlotSelect(location, side, slot.pokemonInstanceId, event.currentTarget)}><PokemonSlotSprite slot={slot} /></PokemonHubSlotFrame></PokemonHubDragSlot>
}

function PokemonSlotSprite({ slot }) {
  const sprite = getPokemonSlotSprite(slot)
  if (!sprite) return null
  return <img className="pokemon-hub-slot-sprite" src={sprite} alt="" aria-hidden="true" draggable={false} onError={event => hidePokemonSlotSprite(event.currentTarget)} />
}

function PokemonItemSprite({ itemKey }) {
  const sprite = getPokemonItemSpriteUrl(itemKey)
  return <>
    {sprite && <img className="pokemon-item-sprite" src={sprite} alt="" aria-hidden="true" draggable={false} onError={event => { event.currentTarget.hidden = true }} onLoad={event => { event.currentTarget.hidden = false }} />}
    <CodeSandboxOutlined className="pokemon-item-icon" aria-hidden="true" />
  </>
}

function PokemonHubDragSlot({ location, slot, children, dragDisabled = false, dragBlockReason = '', dropForbidden = false }) {
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
    droppable.isDropTarget && !draggable.isDragging && !dropForbidden && 'drag-over',
    blocked && 'drag-blocked',
    dropForbidden && 'drop-forbidden',
  ].filter(Boolean).join(' ')

  return React.cloneElement(children, { ref: setNodeRef, className, ...(blocked ? { title: dragBlockReason, 'aria-disabled': true } : {}), children: <>{children.props.children}{(blocked || dropForbidden) && <span className="pokemon-hub-slot-block-icon" aria-label={dropForbidden ? 'Movimento para a Party proibido' : dragBlockReason}><StopOutlined /></span>}</> })
}

function PokemonItemDragSlot({ location, slot, canDrag, children }) {
  const id = location.kind === 'hub-item' ? `hub-item:${location.hubProfileId}:${location.slot}`
    : `item:${location.gameId}:${location.profileId}:${location.area}:${location.slot}`
  const draggable = useDraggable({ id, data: { location, slot }, disabled: !canDrag })
  const droppable = useDroppable({ id, data: { location } })
  const setNodeRef = node => { draggable.ref(node); droppable.ref(node) }
  const className = [children.props.className, draggable.isDragging && 'dragging', droppable.isDropTarget && !draggable.isDragging && 'drag-over'].filter(Boolean).join(' ')
  return React.cloneElement(children, { ref: setNodeRef, className })
}

function PokemonHubDragOverlay({ drag }) {
  return <DragOverlay className="pokemon-hub-drag-overlay" dropAnimation={null}>{drag?.slot && <div className="pokemon-hub-drag-preview">{['item', 'hub-item'].includes(drag.location?.kind) ? <PokemonItemSprite itemKey={drag.slot.itemKey} /> : <PokemonSlotSprite slot={drag.slot} />}</div>}</DragOverlay>
}

function saveSourceKey(gameId, profileId) {
  return gameId && profileId ? `${gameId}:${profileId}` : ''
}

function itemInventorySourceKey(location) {
  return location.kind === 'hub-item' ? `hub:${location.hubProfileId}` : saveSourceKey(location.gameId, location.profileId)
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

function waitForPokemonHubLoad(promise, signal) {
  if (!signal) return promise
  signal.throwIfAborted()
  let onAbort
  const aborted = new Promise((_resolve, reject) => {
    onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
  })
  return Promise.race([promise, aborted]).finally(() => signal.removeEventListener('abort', onAbort))
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
