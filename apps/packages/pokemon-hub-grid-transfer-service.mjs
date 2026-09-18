export function createPokemonHubGridTransferService({ coordinator, profileStore }) {
  if (!coordinator || typeof coordinator.sync !== 'function') throw new TypeError('Pokemon Hub snapshot coordinator is invalid')
  if (!profileStore || typeof profileStore.bindOwner !== 'function') throw new TypeError('Pokemon Hub profile store is invalid')

  return { transfer }

  async function transfer(request) {
    const input = normalizeRequest(request)
    const gameLocation = input.source.kind === 'game' ? input.source : input.target
    const hubLocation = input.source.kind === 'hub' ? input.source : input.target
    if (gameLocation.profileId !== input.profileId) throw transferError('POKEMON_HUB_TRANSFER_INVALID', 'Pokemon Hub game source does not belong to this backend profile.')
    if (gameLocation.area !== 'box') throw transferError('SAVE_MATERIALIZATION_UNSUPPORTED', 'Pokemon Hub can currently persist only Box transfers.')

    const hubProfile = await profileStore.bindOwner(hubLocation.hubProfileId, input.profileId)
    const hubSourceKey = `hub:${hubLocation.hubProfileId}`
    const sources = input.sources.map(copySource)
    const gameSourceKey = `save:${input.profileId}:${gameLocation.gameId}`
    if (!sources.some(source => source.sourceKey === gameSourceKey)) throw transferError('SOURCE_SET_INCOMPLETE', 'Pokemon Hub transfer is missing its game snapshot source.')
    if (!sources.some(source => source.sourceKey === hubSourceKey)) throw transferError('SOURCE_SET_INCOMPLETE', 'Pokemon Hub transfer is missing its grid snapshot source.')

    movePlacement(sources, input.source, input.target, input.profileId)
    const result = await coordinator.sync({
      profileId: input.profileId,
      workspaceId: input.workspaceId,
      clientSequence: input.clientSequence,
      idempotencyKey: input.idempotencyKey,
      sources,
    })
    const hubSnapshot = result.snapshots?.find(snapshot => snapshot.sourceKey === hubSourceKey)
    return { ...result, hubProfile: projectHubProfile(hubProfile, hubSnapshot) }
  }
}

function normalizeRequest(request) {
  if (!request || typeof request !== 'object' || !Array.isArray(request.sources)) throw new TypeError('Pokemon Hub transfer request is invalid')
  assertString(request.profileId, 'Profile ID')
  assertString(request.workspaceId, 'Workspace ID')
  assertString(request.idempotencyKey, 'Idempotency key')
  if (!Number.isInteger(request.clientSequence) || request.clientSequence < 1) throw new TypeError('Pokemon Hub transfer client sequence is invalid')
  const source = normalizeLocation(request.source)
  const target = normalizeLocation(request.target)
  if (source.kind === target.kind) throw transferError('POKEMON_HUB_TRANSFER_INVALID', 'Pokemon Hub transfer must cross between a game Box and a Hub grid.')
  return { ...request, source, target }
}

function normalizeLocation(location) {
  if (!location || typeof location !== 'object' || !Number.isInteger(location.slot) || location.slot < 0) throw transferError('POKEMON_HUB_TRANSFER_INVALID', 'Pokemon Hub transfer location is invalid.')
  if (location.kind === 'hub' && typeof location.hubProfileId === 'string' && location.hubProfileId.length > 0) return { kind: 'hub', hubProfileId: location.hubProfileId, slot: location.slot }
  if (location.kind === 'game' && typeof location.gameId === 'string' && location.gameId.length > 0 && typeof location.profileId === 'string' && location.profileId.length > 0 && (location.area === 'box' || location.area === 'party')) {
    return location.area === 'box' && Number.isInteger(location.box) && location.box >= 0
      ? { kind: 'game', gameId: location.gameId, profileId: location.profileId, area: 'box', box: location.box, slot: location.slot }
      : location.area === 'party' ? { kind: 'game', gameId: location.gameId, profileId: location.profileId, area: 'party', slot: location.slot } : invalidLocation()
  }
  return invalidLocation()
}

function movePlacement(sources, sourceLocation, targetLocation, profileId) {
  const sourceReference = snapshotReference(sourceLocation, profileId)
  const targetReference = snapshotReference(targetLocation, profileId)
  const source = sources.find(candidate => candidate.sourceKey === sourceReference.sourceKey)
  const target = sources.find(candidate => candidate.sourceKey === targetReference.sourceKey)
  const sourcePlacement = source?.placements.find(candidate => sameLocation(candidate.location, sourceReference.location))
  const targetPlacement = target?.placements.find(candidate => sameLocation(candidate.location, targetReference.location))
  if (!sourcePlacement || !targetPlacement) throw transferError('SNAPSHOT_INVALID', 'Pokemon Hub transfer location is absent from its snapshot.')
  if (!sourcePlacement.pokemonInstanceId) throw transferError('POKEMON_HUB_SOURCE_EMPTY', 'Pokemon Hub transfer source is empty.')
  if (targetPlacement.pokemonInstanceId) throw transferError('POKEMON_HUB_DESTINATION_OCCUPIED', 'Pokemon Hub transfer destination is occupied.')
  targetPlacement.pokemonInstanceId = sourcePlacement.pokemonInstanceId
  sourcePlacement.pokemonInstanceId = null
}

function snapshotReference(location, profileId) {
  if (location.kind === 'hub') return { sourceKey: `hub:${location.hubProfileId}`, location: { kind: 'hub', hubProfileId: location.hubProfileId, slot: location.slot } }
  return {
    sourceKey: `save:${profileId}:${location.gameId}`,
    location: location.area === 'box' ? { kind: 'game', area: 'box', box: location.box, slot: location.slot } : { kind: 'game', area: 'party', slot: location.slot },
  }
}

function projectHubProfile(profile, snapshot) {
  const entries = Object.fromEntries((snapshot?.placements ?? []).flatMap(placement => {
    if (!placement.pokemonInstanceId) return []
    const display = snapshot.pokemonDisplay?.[placement.pokemonInstanceId] ?? {}
    return [[String(placement.location.slot), { pokemonInstanceId: placement.pokemonInstanceId, ...display }]]
  }))
  return { ...profile, grid: { entries } }
}

function copySource(source) {
  return {
    sourceKey: source.sourceKey,
    sourceSessionId: source.sourceSessionId,
    leaseToken: source.leaseToken,
    baseRevision: source.baseRevision ?? source.sourceRevision,
    placements: source.placements.map(placement => ({ location: structuredClone(placement.location), pokemonInstanceId: placement.pokemonInstanceId ?? null })),
  }
}

function sameLocation(left, right) { return JSON.stringify(left) === JSON.stringify(right) }
function assertString(value, label) { if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} is required`) }
function invalidLocation() { throw transferError('POKEMON_HUB_TRANSFER_INVALID', 'Pokemon Hub transfer location is invalid.') }
function transferError(code, message) { const error = new Error(message); error.code = code; return error }
