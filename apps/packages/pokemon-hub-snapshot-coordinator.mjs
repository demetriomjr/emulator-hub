import { createHash, randomUUID } from 'node:crypto'

export function createPokemonHubSnapshotCoordinator({ persistence, eventStore, now = () => new Date(), newId = randomUUID, leaseMs = 30_000 }) {
  if (!persistence || typeof persistence.get !== 'function' || typeof persistence.set !== 'function' || typeof persistence.keys !== 'function') throw new TypeError('Pokemon Hub snapshot persistence is invalid')
  if (!eventStore || typeof eventStore.append !== 'function') throw new TypeError('Pokemon Hub event store is invalid')

  return {
    async adopt(input) {
      const source = normalizeAdoption(input)
      const previous = await readSource(source.profileId, source.sourceKey)
      const reusable = await reusableRecords(previous)
      const placements = []
      const createdRecords = []
      const pokemonDisplay = {}
      for (const slot of source.slots) {
        if (!slot.record) {
          placements.push({ location: slot.location, pokemonInstanceId: null })
          continue
        }
        const fingerprint = sha256(slot.record.bytes)
        const candidate = reusable.get(fingerprint)?.shift() ?? null
        const pokemonInstanceId = candidate?.pokemonInstanceId ?? newId()
        const document = candidate ?? {
          schemaVersion: 1,
          profileId: source.profileId,
          pokemonInstanceId,
          display: structuredClone(slot.record.display),
          representations: [],
          provenance: { firstObservedAt: now().toISOString(), originSourceKey: source.sourceKey, originSnapshotRevision: source.sourceRevision },
        }
        const representation = { adapter: slot.record.adapter, kind: slot.record.kind, bytesBase64: Buffer.from(slot.record.bytes).toString('base64'), sha256: fingerprint }
        const next = { ...document, display: structuredClone(slot.record.display), representations: [representation], placement: { sourceKey: source.sourceKey, location: slot.location }, revision: (document.revision ?? 0) + 1 }
        await writeRecord(next)
        if (!candidate) createdRecords.push(next)
        placements.push({ location: slot.location, pokemonInstanceId })
        pokemonDisplay[pokemonInstanceId] = structuredClone(next.display)
      }
      const stored = {
        schemaVersion: 1,
        profileId: source.profileId,
        sourceKey: source.sourceKey,
        sourceRevision: source.sourceRevision,
        snapshotRevision: source.sourceRevision,
        adapter: source.adapter,
        placements,
        pokemonDisplay,
      }
      await writeSource(stored)
      for (const document of createdRecords) {
        const representation = document.representations[0]
        await eventStore.append({
          profileId: source.profileId,
          pokemonInstanceId: document.pokemonInstanceId,
          operationId: `adopt:${source.sourceKey}:${source.sourceRevision}:${document.pokemonInstanceId}`,
          type: 'pokemon.observed',
          source: document.placement,
          sourceRevision: source.sourceRevision,
          adapter: { source: representation.adapter, capabilityVersion: '1' },
          representationHashes: { source: representation.sha256 },
        })
      }
      return safeSnapshot(stored)
    },

    async acquire({ profileId, sourceKey, workspaceId }) {
      assertString(profileId, 'Profile ID'); assertString(sourceKey, 'Source key'); assertString(workspaceId, 'Workspace ID')
      const source = await readSource(profileId, sourceKey)
      if (!source) throw coordinatorError('SOURCE_NOT_ADOPTED', 'Pokemon Hub source has not been adopted.')
      const key = leaseKey(profileId, sourceKey)
      const existing = await readLease(key)
      const instant = now().getTime()
      if (existing && existing.expiresAt > instant && existing.workspaceId !== workspaceId) throw coordinatorError('SOURCE_RESERVED', 'Pokemon Hub source is reserved by another workspace.')
      const lease = existing && existing.expiresAt > instant && existing.workspaceId === workspaceId
        ? { ...existing, expiresAt: instant + leaseMs }
        : { sourceKey, workspaceId, sourceSessionId: randomUUID(), leaseToken: randomUUID(), expiresAt: instant + leaseMs }
      await persistence.set(key, JSON.stringify(lease))
      return { ...safeSnapshot(source), sourceSessionId: lease.sourceSessionId, leaseToken: lease.leaseToken, expiresAt: lease.expiresAt }
    },

    async sync(request) {
      normalizeSyncRequest(request)
      const operationKey = syncKey(request.profileId, request.workspaceId, request.idempotencyKey)
      const previousResult = await persistence.get(operationKey)
      if (previousResult !== null) return structuredClone(JSON.parse(previousResult))

      const sources = []
      for (const submitted of request.sources) {
        const source = await readSource(request.profileId, submitted.sourceKey)
        if (!source) throw coordinatorError('SOURCE_NOT_ADOPTED', 'Pokemon Hub source has not been adopted.')
        const lease = await readLease(leaseKey(request.profileId, submitted.sourceKey))
        if (!lease || lease.workspaceId !== request.workspaceId || lease.sourceSessionId !== submitted.sourceSessionId || lease.leaseToken !== submitted.leaseToken || lease.expiresAt <= now().getTime()) throw coordinatorError('LEASE_INVALID', 'Pokemon Hub source lease is invalid.')
        if (source.sourceRevision !== submitted.baseRevision) return correction('SNAPSHOT_STALE', request, sources.length ? sources : await readRequestSources(request), now().getTime())
        assertSameLocations(source.placements, submitted.placements)
        sources.push({ source, submitted })
      }
      await assertCompleteWorkspaceSourceSet(request, sources)

      const duplicate = findDuplicate(request.sources)
      if (duplicate) return correction('DUPLICATE_INSTANCE_CORRECTED', request, sources, now().getTime())
      for (const submitted of request.sources) for (const placement of submitted.placements) {
        if (placement.pokemonInstanceId && !await readRecord(request.profileId, placement.pokemonInstanceId)) throw coordinatorError('POKEMON_UNKNOWN', 'Pokemon instance is unknown.')
      }

      const prior = indexPlacements(sources.map(({ source }) => ({ sourceKey: source.sourceKey, placements: source.placements })))
      const next = indexPlacements(request.sources)
      for (const pokemonInstanceId of next.keys()) {
        if (!prior.has(pokemonInstanceId)) throw coordinatorError('POKEMON_UNAUTHORIZED', 'Pokemon instance is not present in a leased snapshot source.')
      }
      const displayById = Object.assign({}, ...sources.map(({ source }) => source.pokemonDisplay ?? {}))
      const snapshots = []
      for (const { source, submitted } of sources.sort((left, right) => left.source.sourceKey.localeCompare(right.source.sourceKey))) {
        const placements = clonePlacements(submitted.placements)
        const pokemonDisplay = Object.fromEntries(placements.flatMap(placement => placement.pokemonInstanceId && displayById[placement.pokemonInstanceId] ? [[placement.pokemonInstanceId, displayById[placement.pokemonInstanceId]]] : []))
        const updated = { ...source, sourceRevision: source.sourceRevision + 1, snapshotRevision: source.snapshotRevision + 1, placements, pokemonDisplay }
        await writeSource(updated)
        snapshots.push(safeSnapshot(updated))
      }
      for (const [pokemonInstanceId, destination] of next) {
        const origin = prior.get(pokemonInstanceId)
        if (samePlacement(origin, destination)) continue
        const document = await readRecord(request.profileId, pokemonInstanceId)
        if (!document) throw coordinatorError('POKEMON_UNKNOWN', 'Pokemon instance is unknown.')
        const sourceAdapter = sourceAdapterFor(sources, origin?.sourceKey) ?? document.representations[0]?.adapter
        const destinationAdapter = sourceAdapterFor(sources, destination.sourceKey) ?? sourceAdapterFor(request.sources, destination.sourceKey) ?? sourceAdapterFor(sources, origin?.sourceKey)
        const hash = document.representations[0]?.sha256
        const revised = { ...document, placement: { sourceKey: destination.sourceKey, location: destination.location }, revision: document.revision + 1 }
        await writeRecord(revised)
        await eventStore.append({
          profileId: request.profileId,
          pokemonInstanceId,
          operationId: request.idempotencyKey,
          type: 'pokemon.placement-changed',
          source: origin ?? destination,
          destination,
          sourceRevision: sourceRevisionFor(snapshots, origin?.sourceKey) ?? 0,
          destinationRevision: sourceRevisionFor(snapshots, destination.sourceKey) ?? 0,
          adapter: { source: sourceAdapter, destination: destinationAdapter, capabilityVersion: '1' },
          representationHashes: { source: hash, destination: hash },
        })
      }
      const result = { status: 'accepted', clientSequence: request.clientSequence, idempotencyKey: request.idempotencyKey, serverSequence: Date.parse(now().toISOString()), snapshots }
      await persistence.set(operationKey, JSON.stringify(result), { NX: true })
      return result
    },
  }

  async function readSource(profileId, sourceKey) {
    const stored = await persistence.get(sourceKeyFor(profileId, sourceKey))
    return stored === null ? null : JSON.parse(stored)
  }
  async function writeSource(source) { await persistence.set(sourceKeyFor(source.profileId, source.sourceKey), JSON.stringify(source)) }
  async function readRecord(profileId, pokemonInstanceId) {
    const stored = await persistence.get(recordKey(profileId, pokemonInstanceId))
    return stored === null ? null : JSON.parse(stored)
  }
  async function writeRecord(record) { await persistence.set(recordKey(record.profileId, record.pokemonInstanceId), JSON.stringify(record)) }
  async function reusableRecords(source) {
    const result = new Map()
    if (!source) return result
    for (const placement of source.placements) {
      if (!placement.pokemonInstanceId) continue
      const record = await readRecord(source.profileId, placement.pokemonInstanceId)
      const hash = record?.representations?.[0]?.sha256
      if (!hash) continue
      const entries = result.get(hash) ?? []
      entries.push(record)
      result.set(hash, entries)
    }
    return result
  }
  async function readLease(key) {
    const source = await persistence.get(key)
    return source === null ? null : JSON.parse(source)
  }
  async function assertCompleteWorkspaceSourceSet(request, sources) {
    const prefix = `pokemon-hub:snapshot-lease:${encodeURIComponent(request.profileId)}:`
    const keys = await persistence.keys(prefix)
    const active = new Set()
    for (const key of keys) {
      const lease = await readLease(key)
      if (lease?.workspaceId === request.workspaceId && lease.expiresAt > now().getTime()) active.add(lease.sourceKey)
    }
    const submitted = new Set(sources.map(({ source }) => source.sourceKey))
    if (active.size !== submitted.size || [...active].some(sourceKey => !submitted.has(sourceKey))) throw coordinatorError('SOURCE_SET_INCOMPLETE', 'Pokemon Hub snapshot must include every leased source in the workspace.')
  }
  async function readRequestSources(request) {
    const results = []
    for (const submitted of request.sources) {
      const source = await readSource(request.profileId, submitted.sourceKey)
      if (source) results.push({ source, submitted })
    }
    return results
  }
}

function normalizeAdoption(input) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.slots)) throw new TypeError('Pokemon Hub source adoption is invalid')
  assertString(input.profileId, 'Profile ID'); assertString(input.sourceKey, 'Source key'); assertString(input.adapter, 'Adapter')
  if (!Number.isInteger(input.sourceRevision) || input.sourceRevision < 0) throw new TypeError('Source revision is invalid')
  return { ...input, slots: input.slots.map(slot => ({ location: normalizeLocation(slot.location), record: slot.record ? normalizeRecord(slot.record) : null })) }
}

function normalizeRecord(record) {
  if (!record || typeof record !== 'object' || !Buffer.isBuffer(record.representation?.bytes)) throw new TypeError('Pokemon native representation is invalid')
  assertString(record.representation.adapter, 'Representation adapter'); assertString(record.representation.kind, 'Representation kind')
  if (!record.display || typeof record.display !== 'object') throw new TypeError('Pokemon display projection is invalid')
  return { adapter: record.representation.adapter, kind: record.representation.kind, bytes: Buffer.from(record.representation.bytes), display: structuredClone(record.display) }
}

function normalizeSyncRequest(request) {
  if (!request || typeof request !== 'object' || !Array.isArray(request.sources) || !Number.isInteger(request.clientSequence) || request.clientSequence < 1) throw new TypeError('Pokemon Hub snapshot request is invalid')
  assertString(request.profileId, 'Profile ID'); assertString(request.workspaceId, 'Workspace ID'); assertString(request.idempotencyKey, 'Idempotency key')
  for (const source of request.sources) {
    assertString(source?.sourceKey, 'Source key'); assertString(source?.sourceSessionId, 'Source session ID'); assertString(source?.leaseToken, 'Lease token')
    if (!Number.isInteger(source.baseRevision) || source.baseRevision < 0 || !Array.isArray(source.placements)) throw new TypeError('Pokemon Hub source snapshot is invalid')
    source.placements = clonePlacements(source.placements)
  }
}

function safeSnapshot(source) {
  return { sourceKey: source.sourceKey, sourceRevision: source.sourceRevision, snapshotRevision: source.snapshotRevision, placements: clonePlacements(source.placements), pokemonDisplay: structuredClone(source.pokemonDisplay ?? {}) }
}

function clonePlacements(placements) { return placements.map(placement => ({ location: normalizeLocation(placement.location), pokemonInstanceId: placement.pokemonInstanceId ?? null })) }
function normalizeLocation(location) {
  if (!location || typeof location !== 'object' || !Number.isInteger(location.slot) || location.slot < 0) throw new TypeError('Pokemon Hub placement location is invalid')
  return structuredClone(location)
}
function assertSameLocations(expected, actual) {
  const expectedKeys = new Set(expected.map(placement => locationKey(placement.location)))
  if (expectedKeys.size !== actual.length || actual.some(placement => !expectedKeys.delete(locationKey(placement.location)))) throw coordinatorError('SNAPSHOT_INVALID', 'Pokemon Hub snapshot locations are invalid.')
}
function findDuplicate(sources) {
  const seen = new Set()
  for (const source of sources) for (const placement of source.placements) if (placement.pokemonInstanceId) {
    if (seen.has(placement.pokemonInstanceId)) return placement.pokemonInstanceId
    seen.add(placement.pokemonInstanceId)
  }
  return null
}
function indexPlacements(sources) {
  const result = new Map()
  for (const source of sources) for (const placement of source.placements) if (placement.pokemonInstanceId) result.set(placement.pokemonInstanceId, { sourceKey: source.sourceKey, location: placement.location })
  return result
}
function samePlacement(left, right) { return left?.sourceKey === right?.sourceKey && locationKey(left?.location) === locationKey(right?.location) }
function sourceAdapterFor(sources, sourceKey) { return sources.find(item => (item.source?.sourceKey ?? item.sourceKey) === sourceKey)?.source?.adapter ?? sources.find(item => item.sourceKey === sourceKey)?.adapter ?? null }
function sourceRevisionFor(snapshots, sourceKey) { return snapshots.find(snapshot => snapshot.sourceKey === sourceKey)?.sourceRevision ?? null }
function correction(code, request, sources, serverSequence) {
  const snapshots = sources.map(({ source }) => safeSnapshot(source)).sort((left, right) => left.sourceKey.localeCompare(right.sourceKey))
  return { status: 'corrected', code, clientSequence: request.clientSequence, idempotencyKey: request.idempotencyKey, serverSequence, snapshots }
}
function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex') }
function sourceKeyFor(profileId, sourceKey) { return `pokemon-hub:snapshot-source:${encodeURIComponent(profileId)}:${encodeURIComponent(sourceKey)}` }
function recordKey(profileId, pokemonInstanceId) { return `pokemon-hub:snapshot-record:${encodeURIComponent(profileId)}:${encodeURIComponent(pokemonInstanceId)}` }
function leaseKey(profileId, sourceKey) { return `pokemon-hub:snapshot-lease:${encodeURIComponent(profileId)}:${encodeURIComponent(sourceKey)}` }
function syncKey(profileId, workspaceId, idempotencyKey) { return `pokemon-hub:snapshot-sync:${encodeURIComponent(profileId)}:${encodeURIComponent(workspaceId)}:${encodeURIComponent(idempotencyKey)}` }
function locationKey(location) { return JSON.stringify(location ?? null) }
function assertString(value, label) { if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} is required`) }
function coordinatorError(code, message) { const error = new Error(message); error.code = code; return error }
