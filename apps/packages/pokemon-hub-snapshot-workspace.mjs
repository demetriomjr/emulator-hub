export function createPokemonHubSnapshotWorkspace({ workspaceId, sources }) {
  assertNonEmptyString(workspaceId, 'Workspace ID')
  if (!Array.isArray(sources)) throw new TypeError('Sources must be an array')

  const sourceMap = {}
  for (const source of sources) {
    assertNonEmptyString(source?.sourceKey, 'Source key')
    if (sourceMap[source.sourceKey]) throw new TypeError(`Source ${source.sourceKey} is duplicated`)
    sourceMap[source.sourceKey] = {
      sourceKey: source.sourceKey,
      sourceSessionId: requiredString(source.sourceSessionId, 'Source session ID'),
      leaseToken: requiredString(source.leaseToken, 'Lease token'),
      sourceRevision: requiredNonNegativeInteger(source.sourceRevision, 'Source revision'),
      adapter: requiredString(source.adapter, 'Source adapter'),
      receivePolicy: { acceptsAdapters: [...(source.receivePolicy?.acceptsAdapters ?? [])] },
      status: source.status ?? 'ready',
      confirmedPlacements: clonePlacements(source.placements),
      optimisticPlacements: clonePlacements(source.placements),
      pokemonDisplay: { ...(source.pokemonDisplay ?? {}) },
    }
  }

  assertUniqueInstancePlacements(sourceMap)
  return { workspaceId, sources: sourceMap, inFlight: null, hasQueuedChanges: false, lastServerSequence: 0 }
}

export function movePokemonHubSnapshotPlacement(state, sourceRef, targetRef) {
  const source = state?.sources?.[sourceRef?.sourceKey]
  const target = state?.sources?.[targetRef?.sourceKey]
  if (!source || !target || source.status !== 'ready' || target.status !== 'ready') return unchanged(state)

  const sourceIndex = placementIndex(source.optimisticPlacements, sourceRef.location)
  const targetIndex = placementIndex(target.optimisticPlacements, targetRef.location)
  if (sourceIndex < 0 || targetIndex < 0 || sameRef(sourceRef, targetRef)) return unchanged(state)

  const sourcePlacement = source.optimisticPlacements[sourceIndex]
  const targetPlacement = target.optimisticPlacements[targetIndex]
  if (!sourcePlacement.pokemonInstanceId) return unchanged(state)

  const action = targetPlacement.pokemonInstanceId
    ? (canSwapWithinSource(sourceRef, targetRef) ? 'swap' : 'none')
    : (canMove(source, target) ? 'move' : 'none')
  if (action === 'none') return unchanged(state)

  const nextSources = { ...state.sources }
  if (sourceRef.sourceKey === targetRef.sourceKey) {
    const placements = [...source.optimisticPlacements]
    placements[sourceIndex] = { ...sourcePlacement, pokemonInstanceId: action === 'swap' ? targetPlacement.pokemonInstanceId : null }
    placements[targetIndex] = { ...targetPlacement, pokemonInstanceId: sourcePlacement.pokemonInstanceId }
    nextSources[sourceRef.sourceKey] = { ...source, optimisticPlacements: placements }
  } else {
    const sourcePlacements = [...source.optimisticPlacements]
    const targetPlacements = [...target.optimisticPlacements]
    sourcePlacements[sourceIndex] = { ...sourcePlacement, pokemonInstanceId: null }
    targetPlacements[targetIndex] = { ...targetPlacement, pokemonInstanceId: sourcePlacement.pokemonInstanceId }
    nextSources[sourceRef.sourceKey] = { ...source, optimisticPlacements: sourcePlacements }
    nextSources[targetRef.sourceKey] = { ...target, optimisticPlacements: targetPlacements }
  }

  assertUniqueInstancePlacements(nextSources)
  return { ...state, action, sources: nextSources, hasQueuedChanges: true }
}

export function createPokemonHubSnapshotRequest(state, { clientSequence, idempotencyKey }) {
  if (!Number.isInteger(clientSequence) || clientSequence < 1) throw new TypeError('Client sequence must be a positive integer')
  assertNonEmptyString(idempotencyKey, 'Idempotency key')
  assertUniqueInstancePlacements(state?.sources)

  return {
    workspaceId: requiredString(state?.workspaceId, 'Workspace ID'),
    clientSequence,
    idempotencyKey,
    sources: Object.values(state.sources)
      .sort((left, right) => left.sourceKey.localeCompare(right.sourceKey))
      .map(source => ({
        sourceKey: source.sourceKey,
        sourceSessionId: source.sourceSessionId,
        leaseToken: source.leaseToken,
        baseRevision: source.sourceRevision,
        placements: clonePlacements(source.optimisticPlacements).sort(comparePlacement),
      })),
  }
}

export function beginPokemonHubSnapshotRequest(state, requestIdentity) {
  if (state?.inFlight) throw new Error('A Pokemon Hub snapshot request is already in flight')
  if (!state?.hasQueuedChanges) throw new Error('Pokemon Hub snapshot is not dirty')
  assertEverySourceReady(state.sources)
  const request = createPokemonHubSnapshotRequest(state, requestIdentity)
  return {
    request,
    state: {
      ...state,
      inFlight: { clientSequence: request.clientSequence, idempotencyKey: request.idempotencyKey, request },
      hasQueuedChanges: false,
    },
  }
}

export function retryPokemonHubSnapshotRequest(state) {
  if (!state?.inFlight?.request) throw new Error('No Pokemon Hub snapshot request can be retried')
  return state.inFlight.request
}

export function acknowledgePokemonHubSnapshotRequest(state, response) {
  const inFlight = state?.inFlight
  if (!inFlight || response?.clientSequence !== inFlight.clientSequence || response?.idempotencyKey !== inFlight.idempotencyKey) {
    return { action: 'ignored', state }
  }
  if (!['accepted', 'corrected', 'stale'].includes(response.status)) throw new TypeError('Pokemon Hub acknowledgement status is unsupported')
  if (!Number.isInteger(response.serverSequence) || response.serverSequence <= state.lastServerSequence) return { action: 'ignored', state }
  if (!Array.isArray(response.snapshots) || response.snapshots.length !== Object.keys(state.sources).length) throw new TypeError('Pokemon Hub acknowledgement must contain every leased source')

  const snapshots = new Map(response.snapshots.map(snapshot => [snapshot.sourceKey, snapshot]))
  if (snapshots.size !== response.snapshots.length) throw new TypeError('Pokemon Hub acknowledgement source is duplicated')
  const sources = {}
  for (const [sourceKey, source] of Object.entries(state.sources)) {
    const snapshot = snapshots.get(sourceKey)
    if (!snapshot) throw new TypeError(`Pokemon Hub acknowledgement is missing ${sourceKey}`)
    const confirmedPlacements = clonePlacements(snapshot.placements)
    if (!sameLocationSet(source.confirmedPlacements, confirmedPlacements)) throw new TypeError(`Pokemon Hub acknowledgement locations changed for ${sourceKey}`)
    const sourceRevision = requiredNonNegativeInteger(snapshot.sourceRevision, 'Source revision')
    const retainQueuedPlacements = response.status === 'accepted' && state.hasQueuedChanges
    sources[sourceKey] = {
      ...source,
      sourceRevision,
      confirmedPlacements,
      optimisticPlacements: retainQueuedPlacements ? source.optimisticPlacements : confirmedPlacements,
      ...(snapshot.pokemonDisplay ? { pokemonDisplay: { ...snapshot.pokemonDisplay } } : {}),
    }
  }
  assertUniqueInstancePlacements(sources)
  const action = response.status === 'accepted' ? 'accepted' : response.status
  return {
    action,
    state: {
      ...state,
      sources,
      inFlight: null,
      hasQueuedChanges: response.status === 'accepted' ? state.hasQueuedChanges : false,
      lastServerSequence: response.serverSequence,
    },
  }
}

function unchanged(state) {
  return { ...state, action: 'none' }
}

function canMove(source, target) {
  if (source.sourceKey === target.sourceKey) return true
  return target.receivePolicy.acceptsAdapters.includes(source.adapter)
}

function canSwapWithinSource(sourceRef, targetRef) {
  if (sourceRef.sourceKey !== targetRef.sourceKey) return false
  const source = sourceRef.location
  const target = targetRef.location
  if (source?.kind === 'hub' || target?.kind === 'hub') return source?.kind === 'hub' && target?.kind === 'hub'
  return source?.kind === 'game'
    && target?.kind === 'game'
    && ((source.area === 'party' && target.area === 'party')
      || (source.area === 'box' && target.area === 'box' && source.box === target.box))
}

function sameRef(sourceRef, targetRef) {
  return sourceRef.sourceKey === targetRef.sourceKey && locationKey(sourceRef.location) === locationKey(targetRef.location)
}

function clonePlacements(placements) {
  if (!Array.isArray(placements)) throw new TypeError('Placements must be an array')
  const cloned = placements.map(placement => ({ location: { ...placement.location }, pokemonInstanceId: placement.pokemonInstanceId ?? null }))
  const locations = new Set()
  for (const placement of cloned) {
    const key = locationKey(placement.location)
    if (locations.has(key)) throw new TypeError(`Placement location ${key} is duplicated`)
    locations.add(key)
    if (placement.pokemonInstanceId !== null) assertNonEmptyString(placement.pokemonInstanceId, 'Pokemon instance ID')
  }
  return cloned
}

function placementIndex(placements, location) {
  const key = locationKey(location)
  return placements.findIndex(placement => locationKey(placement.location) === key)
}

function assertUniqueInstancePlacements(sources) {
  const seen = new Set()
  for (const source of Object.values(sources ?? {})) {
    for (const placement of source.optimisticPlacements ?? []) {
      if (!placement.pokemonInstanceId) continue
      if (seen.has(placement.pokemonInstanceId)) throw new TypeError(`Duplicate Pokemon instance ID: ${placement.pokemonInstanceId}`)
      seen.add(placement.pokemonInstanceId)
    }
  }
}

function assertEverySourceReady(sources) {
  for (const source of Object.values(sources ?? {})) {
    if (source.status !== 'ready') throw new Error(`Pokemon Hub source ${source.sourceKey} is not ready`)
  }
}

function sameLocationSet(left, right) {
  if (left.length !== right.length) return false
  const locations = new Set(left.map(placement => locationKey(placement.location)))
  return right.every(placement => locations.delete(locationKey(placement.location))) && locations.size === 0
}

function comparePlacement(left, right) {
  const leftArea = left.location.kind === 'hub' ? 2 : left.location.area === 'party' ? 0 : 1
  const rightArea = right.location.kind === 'hub' ? 2 : right.location.area === 'party' ? 0 : 1
  return leftArea - rightArea
    || (left.location.box ?? -1) - (right.location.box ?? -1)
    || left.location.slot - right.location.slot
}

function locationKey(location) {
  if (!location || !Number.isInteger(location.slot) || location.slot < 0) throw new TypeError('Placement location requires a non-negative slot')
  if (location.kind === 'hub') return `hub:${location.slot}`
  if (location.kind !== 'game') throw new TypeError('Placement location kind is unsupported')
  if (location.area === 'party') return `game:party:${location.slot}`
  if (location.area === 'box' && Number.isInteger(location.box) && location.box >= 0) return `game:box:${location.box}:${location.slot}`
  throw new TypeError('Game placement requires a Party or Box location')
}

function requiredString(value, label) {
  assertNonEmptyString(value, label)
  return value
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} is required`)
}

function requiredNonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) throw new TypeError(`${label} must be a non-negative integer`)
  return value
}
