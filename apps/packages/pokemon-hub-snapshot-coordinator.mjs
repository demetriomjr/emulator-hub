import { compareAndWriteJson } from './redis-json-transaction.mjs'
import { createHash, randomUUID } from 'node:crypto'
import { extendPokemonHubPlacements } from './pokemon-hub-canonical-session-snapshot.mjs'
import { pokemonHubRedisKeys } from './pokemon-hub-redis-keys.mjs'
import { pokemonHubLocationKey } from './pokemon-hub-location-key.mjs'

const markSaveFlushedTransition = Object.freeze({
  lua: `
    local raw = redis.call('GET', KEYS[1])
    if not raw then return cjson.encode({ status = 'missing' }) end
    local source = cjson.decode(raw)
    if source.sourceRevision ~= tonumber(ARGV[1]) then
      return cjson.encode({ status = 'stale', sourceRevision = source.sourceRevision })
    end
    source.saveRevision = tonumber(ARGV[2])
    source.needsSaveFlush = false
    redis.call('SET', KEYS[1], cjson.encode(source))
    return cjson.encode({ status = 'flushed', source = source })
  `,
  memory: async ({ keys, arguments: values, get, set }) => {
    const raw = await get(keys[0])
    if (raw === null) return JSON.stringify({ status: 'missing' })
    const source = JSON.parse(raw)
    if (source.sourceRevision !== Number(values[0])) return JSON.stringify({ status: 'stale', sourceRevision: source.sourceRevision })
    const updated = { ...source, saveRevision: Number(values[1]), needsSaveFlush: false }
    await set(keys[0], JSON.stringify(updated))
    return JSON.stringify({ status: 'flushed', source: updated })
  },
})

const refreshTransferCapabilityTransition = Object.freeze({
  lua: `
    local raw = redis.call('GET', KEYS[1])
    if not raw then return cjson.encode({ status = 'missing' }) end
    local source = cjson.decode(raw)
    source.transferCapability = cjson.decode(ARGV[1])
    redis.call('SET', KEYS[1], cjson.encode(source))
    return cjson.encode({ status = 'updated' })
  `,
  memory: async ({ keys, arguments: values, get, set }) => {
    const raw = await get(keys[0])
    if (raw === null) return JSON.stringify({ status: 'missing' })
    await set(keys[0], JSON.stringify({ ...JSON.parse(raw), transferCapability: JSON.parse(values[0]) }))
    return JSON.stringify({ status: 'updated' })
  },
})

const pokemonHubHandshakeIntervalMs = 3_000
const pokemonHubMissedHandshakeLimit = 3

export function createPokemonHubSnapshotCoordinator({ persistence, eventStore, logger = nullPokemonHubLogger, now = () => new Date(), newId = randomUUID, leaseMs = pokemonHubHandshakeIntervalMs * pokemonHubMissedHandshakeLimit, validatePlacementChange = () => {}, gameSaveLeases = null }) {
  if (!persistence || typeof persistence.get !== 'function' || typeof persistence.set !== 'function' || typeof persistence.delete !== 'function' || typeof persistence.keys !== 'function') throw new TypeError('Pokemon Hub snapshot persistence is invalid')
  if (!eventStore || typeof eventStore.append !== 'function') throw new TypeError('Pokemon Hub event store is invalid')
  if (typeof validatePlacementChange !== 'function') throw new TypeError('Pokemon Hub placement validation is invalid')
  if (gameSaveLeases && ['acquireHub', 'renewHub', 'releaseHub'].some(method => typeof gameSaveLeases[method] !== 'function')) throw new TypeError('Game save lease coordinator is invalid')

  return {
    async getSnapshot({ sourceKey }) {
      assertString(sourceKey, 'Source key')
      const source = await readSource(sourceKey)
      if (!source) throw coordinatorError('SOURCE_NOT_ADOPTED', 'Pokemon Hub source has not been adopted.')
      return publicSnapshot(source)
    },

    async getDetailSource({ sourceKey }) {
      assertString(sourceKey, 'Source key')
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const source = await readSource(sourceKey)
        if (!source) throw coordinatorError('SOURCE_NOT_ADOPTED', 'Pokemon Hub source has not been adopted.')
        const ids = [...new Set(source.placements.flatMap(placement => placement.pokemonInstanceId ? [placement.pokemonInstanceId] : []))]
        const records = new Map(await Promise.all(ids.map(async id => [id, await readRecord(id)])))
        const after = await readSource(sourceKey)
        if (!after || JSON.stringify(source) !== JSON.stringify(after)) continue
        const confirmedRecords = await Promise.all(ids.map(id => readRecord(id)))
        if (ids.some((id, index) => JSON.stringify(records.get(id)) !== JSON.stringify(confirmedRecords[index]))) continue
        return { source: structuredClone(source), records: new Map([...records].map(([id, record]) => [id, record ? structuredClone(record) : null])) }
      }
      throw coordinatorError('SOURCE_DETAIL_STALE', 'Pokemon Hub source changed during detail hydration.')
    },

    async refreshTransferCapability({ sourceKey, transferCapability }) {
      assertString(sourceKey, 'Source key')
      if (!transferCapability || typeof transferCapability !== 'object' || Array.isArray(transferCapability)) throw new TypeError('Pokemon Hub transfer capability is invalid')
      const result = JSON.parse(await persistence.eval(refreshTransferCapabilityTransition, {
        keys: [sourceKeyFor(sourceKey)], arguments: [JSON.stringify(transferCapability)],
      }))
      if (result.status === 'missing') throw coordinatorError('SOURCE_NOT_ADOPTED', 'Pokemon Hub source has not been adopted.')
    },

    async ensureHubSource({ sourceKey, hubProfileId, minimumSlotCount }) {
      assertString(sourceKey, 'Source key'); assertString(hubProfileId, 'Hub profile ID')
      if (!Number.isInteger(minimumSlotCount) || minimumSlotCount < 1) throw new TypeError('Hub grid slot count is invalid')

      const existing = await readSource(sourceKey)
      if (existing) {
        if (existing.adapter !== 'hub-grid-v1' || existing.placements.some(placement => placement.location?.kind !== 'hub' || placement.location.hubProfileId !== hubProfileId)) {
          throw coordinatorError('HUB_SOURCE_INVALID', 'Pokemon Hub grid source is invalid.')
        }
        if (existing.placements.length >= minimumSlotCount) return safeSnapshot(existing)
        const placements = [...existing.placements]
        for (let slot = placements.length; slot < minimumSlotCount; slot += 1) {
          placements.push({ location: { kind: 'hub', hubProfileId, slot }, pokemonInstanceId: null })
        }
        const expanded = { ...existing, sourceRevision: existing.sourceRevision + 1, snapshotRevision: existing.snapshotRevision + 1, placements }
        if (!await compareAndWriteJson(persistence, { checks: [{ key: sourceKeyFor(sourceKey), fields: { sourceRevision: existing.sourceRevision, snapshotRevision: existing.snapshotRevision } }], writes: [{ key: sourceKeyFor(sourceKey), value: JSON.stringify(expanded) }] })) throw coordinatorError('SOURCE_ADOPTION_CONFLICT', 'Hub source changed during expansion.')
        return safeSnapshot(expanded)
      }

      const created = {
        schemaVersion: 1,
        sourceKey,
        sourceRevision: 0,
        snapshotRevision: 0,
        saveRevision: 0,
        needsSaveFlush: false,
        adapter: 'hub-grid-v1',
        placements: Array.from({ length: minimumSlotCount }, (_, slot) => ({ location: { kind: 'hub', hubProfileId, slot }, pokemonInstanceId: null })),
        pokemonDisplay: {},
      }
      const installed = await persistence.set(sourceKeyFor(sourceKey), JSON.stringify(created), { NX: true })
      return safeSnapshot(installed === null ? await readSource(sourceKey) : created)
    },

    async adopt(input) {
      const source = normalizeAdoption(input)
      const previous = await readSource(source.sourceKey)
      if (previous?.needsSaveFlush) throw coordinatorError('SOURCE_ADOPTION_CONFLICT', 'An unpublished source cannot be replaced by a native copy.')
      const writes = []
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
          pokemonInstanceId,
          display: structuredClone(slot.record.display),
          representations: [],
          provenance: { firstObservedAt: now().toISOString(), originSourceKey: source.sourceKey, originSnapshotRevision: source.sourceRevision },
        }
        const representation = { adapter: slot.record.adapter, kind: slot.record.kind, bytesBase64: Buffer.from(slot.record.bytes).toString('base64'), sha256: fingerprint }
        const next = { ...document, display: structuredClone(slot.record.display), representations: [representation], placement: { sourceKey: source.sourceKey, location: slot.location }, revision: (document.revision ?? 0) + 1 }
        writes.push({ key: recordKey(pokemonInstanceId), value: JSON.stringify(next) })
        if (!candidate) createdRecords.push(next)
        placements.push({ location: slot.location, pokemonInstanceId })
        pokemonDisplay[pokemonInstanceId] = structuredClone(next.display)
      }
      const stored = {
        schemaVersion: 1,
        sourceKey: source.sourceKey,
        sourceRevision: previous ? previous.sourceRevision + 1 : source.sourceRevision,
        snapshotRevision: previous ? previous.snapshotRevision + 1 : source.sourceRevision,
        saveRevision: source.sourceRevision,
        needsSaveFlush: false,
        adapter: source.adapter,
        ...(source.transferCapability ? { transferCapability: structuredClone(source.transferCapability) } : {}),
        placements,
        pokemonDisplay,
      }
      writes.push({ key: sourceKeyFor(source.sourceKey), value: JSON.stringify(stored) })
      for (const document of createdRecords) {
        const representation = document.representations[0]
        const event = eventStore.prepare({
          pokemonInstanceId: document.pokemonInstanceId,
          operationId: `adopt:${source.sourceKey}:${source.sourceRevision}:${document.pokemonInstanceId}`,
          type: 'pokemon.observed',
          source: document.placement,
          sourceRevision: source.sourceRevision,
          adapter: { source: representation.adapter, capabilityVersion: '1' },
          representationHashes: { source: representation.sha256 },
        })
        writes.push({ key: event.key, value: JSON.stringify(event.document) })
      }
      const check = previous ? { key: sourceKeyFor(source.sourceKey), fields: { sourceRevision: previous.sourceRevision, snapshotRevision: previous.snapshotRevision, saveRevision: previous.saveRevision, needsSaveFlush: previous.needsSaveFlush } } : { key: sourceKeyFor(source.sourceKey), absent: true }
      if (!await compareAndWriteJson(persistence, { checks: [check], writes })) throw coordinatorError('SOURCE_ADOPTION_CONFLICT', 'Source changed during native adoption.')
      return safeSnapshot(stored)
    },

    async getSaveFlushPlan({ sourceKey }) {
      assertString(sourceKey, 'Source key')
      const source = await readSource(sourceKey)
      if (!source) throw coordinatorError('SOURCE_NOT_ADOPTED', 'Pokemon Hub source has not been adopted.')
      const pokemonInstanceIds = [...new Set(source.placements.flatMap(placement => placement.pokemonInstanceId ? [placement.pokemonInstanceId] : []))]
      const entries = await Promise.all(pokemonInstanceIds.map(async pokemonInstanceId => {
        const record = await readRecord(pokemonInstanceId)
        if (!record) throw coordinatorError('POKEMON_UNKNOWN', 'Pokemon instance is unknown.')
        return [pokemonInstanceId, structuredClone(record)]
      }))
      const records = new Map(entries)
      return { source: structuredClone(source), records }
    },

    async markSaveFlushed({ sourceKey, sourceRevision, saveRevision }) {
      assertString(sourceKey, 'Source key')
      if (!Number.isInteger(sourceRevision) || sourceRevision < 1) throw new TypeError('Source revision is invalid')
      if (!Number.isInteger(saveRevision) || saveRevision < 1) throw new TypeError('Save revision is invalid')
      const outcome = JSON.parse(await persistence.eval(markSaveFlushedTransition, {
        keys: [sourceKeyFor(sourceKey)],
        arguments: [String(sourceRevision), String(saveRevision)],
      }))
      if (outcome.status === 'missing') throw coordinatorError('SOURCE_NOT_ADOPTED', 'Pokemon Hub source has not been adopted.')
      if (outcome.status === 'stale') throw coordinatorError('SOURCE_FLUSH_STALE', 'Pokemon Hub source changed while its save was being flushed.')
      return safeSnapshot(outcome.source)
    },

    reserveSource,

    async acquire({ sourceKey, workspaceId }) {
      assertString(sourceKey, 'Source key'); assertString(workspaceId, 'Workspace ID')
      const source = await readSource(sourceKey)
      if (!source) throw coordinatorError('SOURCE_NOT_ADOPTED', 'Pokemon Hub source has not been adopted.')
      const lease = await reserveSource({ sourceKey, workspaceId })
      if (lease.state !== 'active') {
        const active = { ...lease, state: 'active' }
        if (!await compareAndWriteJson(persistence, { checks: [{ key: leaseKey(sourceKey), fields: lease, live: true }], writes: [{ key: leaseKey(sourceKey), value: JSON.stringify(active) }], instant: now().getTime() })) throw coordinatorError('LEASE_INVALID', 'Source reservation changed during acquisition.')
      }
      return { ...safeSnapshot(source), sourceSessionId: lease.sourceSessionId, leaseToken: lease.leaseToken, expiresAt: lease.expiresAt }
    },

    async renew({ sourceKey, workspaceId, sourceSessionId, leaseToken, minimumExpiresAt = 0 }) {
      assertString(sourceKey, 'Source key'); assertString(workspaceId, 'Workspace ID'); assertString(sourceSessionId, 'Source session ID'); assertString(leaseToken, 'Lease token')
      const key = leaseKey(sourceKey)
      const lease = await readLease(key)
      if (!lease || lease.state !== 'active' || lease.workspaceId !== workspaceId || lease.sourceSessionId !== sourceSessionId || lease.leaseToken !== leaseToken || lease.expiresAt <= now().getTime()) throw coordinatorError('LEASE_INVALID', 'Pokemon Hub source lease is invalid.')
      const gameSaveLease = gameSaveLeaseIdentity(sourceKey, workspaceId)
      if (gameSaveLease) await gameSaveLeases?.renewHub({ ...gameSaveLease, minimumExpiresAt })
      const renewed = { ...lease, expiresAt: Math.max(now().getTime() + leaseMs, minimumExpiresAt) }
      if (!await compareAndWriteJson(persistence, { instant: now().getTime(), checks: [{ key, fields: lease, live: true }], writes: [
        { key, value: JSON.stringify(renewed) },
        { key: expiringLeaseIndexKey(), kind: 'zadd', value: leaseMember(sourceKey), score: renewed.expiresAt },
      ] })) throw coordinatorError('LEASE_INVALID', 'Source lease changed during renewal.')
      return { sourceKey, sourceSessionId: renewed.sourceSessionId, leaseToken: renewed.leaseToken, expiresAt: renewed.expiresAt }
    },

    async release({ sourceKey, workspaceId, sourceSessionId, leaseToken }) {
      assertString(sourceKey, 'Source key'); assertString(workspaceId, 'Workspace ID'); assertString(sourceSessionId, 'Source session ID'); assertString(leaseToken, 'Lease token')
      const key = leaseKey(sourceKey)
      const lease = await readLease(key)
      if (!lease || lease.workspaceId !== workspaceId || lease.sourceSessionId !== sourceSessionId || lease.leaseToken !== leaseToken) throw coordinatorError('LEASE_INVALID', 'Pokemon Hub source lease is invalid.')
      await finishRelease(lease)
      return { sourceKey, released: true }
    },

    async listExpiredLeases() {
      const members = await persistence.rangeByScore(expiringLeaseIndexKey(), 0, now().getTime())
      const expired = []
      for (const member of members) {
        const identity = parseLeaseMember(member)
        if (!identity) {
          await persistence.removeFromSortedSet(expiringLeaseIndexKey(), member)
          continue
        }
        const lease = await readLease(leaseKey(identity.sourceKey))
        if (!lease || lease.expiresAt > now().getTime()) {
          if (lease) await persistence.addToSortedSet(expiringLeaseIndexKey(), member, lease.expiresAt)
          else await persistence.removeFromSortedSet(expiringLeaseIndexKey(), member)
          continue
        }
        // A registered session owns recovery of all its endpoints as one group.
        if (await persistence.get(pokemonHubRedisKeys.session(lease.workspaceId)) !== null) continue
        expired.push({ sourceKey: lease.sourceKey, workspaceId: lease.workspaceId, sourceSessionId: lease.sourceSessionId, leaseToken: lease.leaseToken, state: lease.state })
      }
      return expired
    },

    async listWorkspaceLeases({ workspaceId }) {
      const keys = await readWorkspaceLeaseSources(workspaceId)
      return (await Promise.all(keys.map(key => readLease(leaseKey(key))))).filter(lease => lease?.workspaceId === workspaceId)
    },

    async releaseExpiredLease({ sourceKey, workspaceId, sourceSessionId, leaseToken }) {
      assertString(sourceKey, 'Source key'); assertString(workspaceId, 'Workspace ID'); assertString(sourceSessionId, 'Source session ID'); assertString(leaseToken, 'Lease token')
      const key = leaseKey(sourceKey)
      const lease = await readLease(key)
      if (!lease || lease.workspaceId !== workspaceId || lease.sourceSessionId !== sourceSessionId || lease.leaseToken !== leaseToken || lease.expiresAt > now().getTime()) throw coordinatorError('LEASE_INVALID', 'Pokemon Hub source lease is invalid.')
      await finishRelease(lease)
      return { sourceKey, released: true }
    },

    async reconcileWorkspaceLeases({ workspaceId, sources }) {
      const requested = normalizeWorkspaceSources({ workspaceId, sources })
      const requestedKeys = new Set(requested.sources.map(source => source.sourceKey))
      const indexedKeys = await readWorkspaceLeaseSources(workspaceId)
      for (const sourceKey of indexedKeys) {
        if (requestedKeys.has(sourceKey)) continue
        const key = leaseKey(sourceKey)
        const lease = await readLease(key)
        if (lease?.workspaceId === workspaceId && lease.expiresAt > now().getTime()) {
          await Promise.all([
            persistence.delete(key),
            persistence.removeFromSortedSet(expiringLeaseIndexKey(), leaseMember(sourceKey)),
          ])
        }
      }
      await Promise.all([
        ...indexedKeys.filter(sourceKey => !requestedKeys.has(sourceKey)).map(sourceKey => persistence.removeFromSet(workspaceLeaseIndexKey(workspaceId), sourceKey)),
        ...[...requestedKeys].filter(sourceKey => !indexedKeys.includes(sourceKey)).map(sourceKey => persistence.addToSet(workspaceLeaseIndexKey(workspaceId), sourceKey)),
      ])
      return verifyWorkspaceSources(requested)
    },

    async sync(request) {
      const trace = normalizePokemonHubLogger(request?.logger ?? logger)
      trace.info('snapshot.coordinator.received', summarizeSyncRequest(request))
      try {
        normalizeSyncRequest(request)
        const operationKey = syncKey(request.workspaceId, request.idempotencyKey)
        const previousResult = await persistence.get(operationKey)
        if (previousResult !== null) {
          const replayed = structuredClone(JSON.parse(previousResult))
          trace.info('snapshot.coordinator.replayed', { ...summarizeSyncRequest(request), status: replayed.status, code: replayed.code ?? null })
          return replayed
        }

        const sources = await verifyWorkspaceSources(request)
        trace.info('snapshot.coordinator.leases-verified', { ...summarizeSyncRequest(request), sourceRevisions: sources.map(({ source }) => ({ sourceKey: source.sourceKey, sourceRevision: source.sourceRevision, snapshotRevision: source.snapshotRevision })) })
        for (const { source, submitted } of sources) {
          if (source.sourceRevision !== submitted.baseRevision) {
            trace.warn('snapshot.coordinator.stale', { ...summarizeSyncRequest(request), sourceKey: source.sourceKey, expectedRevision: source.sourceRevision, submittedRevision: submitted.baseRevision })
            return correction('SNAPSHOT_STALE', request, sources.length ? sources : await readRequestSources(request), now().getTime())
          }
          assertSameLocations(source.placements, submitted.placements, source.adapter)
          assertGen3PartyShape(source, submitted)
        }

        const duplicate = findDuplicate(request.sources)
        if (duplicate) {
          trace.warn('snapshot.coordinator.duplicate-corrected', { ...summarizeSyncRequest(request) })
          return correction('DUPLICATE_INSTANCE_CORRECTED', request, sources, now().getTime())
        }
        const prior = indexPlacements(sources.map(({ source }) => ({ sourceKey: source.sourceKey, placements: source.placements })))
        const next = indexPlacements(request.sources)
        trace.info('snapshot.coordinator.identity-validated', { ...summarizeSyncRequest(request), previousPokemonCount: prior.size, requestedPokemonCount: next.size })
        for (const pokemonInstanceId of next.keys()) {
          if (!prior.has(pokemonInstanceId)) throw coordinatorError('POKEMON_UNAUTHORIZED', 'Pokemon instance is not present in a leased snapshot source.')
        }
        rejectCrossSourceOccupiedDestinations(prior, next)
        const changedPokemonIds = [...next].filter(([pokemonInstanceId, destination]) => !samePlacement(prior.get(pokemonInstanceId), destination)).map(([pokemonInstanceId]) => pokemonInstanceId)
        const changedRecords = new Map()
        const placementDecisions = new Map()
        for (const pokemonInstanceId of changedPokemonIds) {
          const document = await readRecord(pokemonInstanceId)
          if (!document) throw coordinatorError('POKEMON_UNKNOWN', 'Pokemon instance is unknown.')
          changedRecords.set(pokemonInstanceId, document)
        }
        trace.info('snapshot.coordinator.placement-policy-started', { ...summarizeSyncRequest(request), changedPokemonCount: changedPokemonIds.length })
        for (const [pokemonInstanceId, destination] of next) {
          const origin = prior.get(pokemonInstanceId)
          if (samePlacement(origin, destination)) continue
          const validation = await validatePlacementChange({
            pokemonInstanceId,
            origin,
            destination,
            record: changedRecords.get(pokemonInstanceId),
            source: sourceFor(sources, origin?.sourceKey),
            destinationSource: sourceFor(sources, destination.sourceKey),
            sourcePokemonCount: pokemonCountForSource(sources, origin?.sourceKey),
            sourceAdapter: sourceAdapterFor(sources, origin?.sourceKey),
            destinationAdapter: sourceAdapterFor(sources, destination.sourceKey),
          })
          if (validation?.allowed === false) return correction(validation.reason?.code ?? 'TRANSFER_GAME_PAIR_UNSUPPORTED', request, sources, now().getTime(), validation.reason)
          placementDecisions.set(pokemonInstanceId, validation)
        }
        for (const [pokemonInstanceId, origin] of prior) {
          if (next.has(pokemonInstanceId)) continue
          const validation = await validatePlacementChange({
            pokemonInstanceId,
            origin,
            destination: null,
            record: changedRecords.get(pokemonInstanceId),
            source: sourceFor(sources, origin.sourceKey),
            destinationSource: null,
            sourcePokemonCount: pokemonCountForSource(sources, origin.sourceKey),
            sourceAdapter: sourceAdapterFor(sources, origin.sourceKey),
            destinationAdapter: null,
          })
          if (validation?.allowed === false) return correction(validation.reason?.code ?? 'TRANSFER_GAME_PAIR_UNSUPPORTED', request, sources, now().getTime(), validation.reason)
        }
        trace.info('snapshot.coordinator.placement-policy-finished', { ...summarizeSyncRequest(request), changedPokemonCount: changedPokemonIds.length })
        const displayById = Object.assign({}, ...sources.map(({ source }) => source.pokemonDisplay ?? {}))
        const snapshots = []
        const writes = []
        for (const { source, submitted } of sources.sort((left, right) => left.source.sourceKey.localeCompare(right.source.sourceKey))) {
          const placements = clonePlacements(submitted.placements)
          if (!placementsChanged(source.placements, placements)) {
            snapshots.push(safeSnapshot(source))
            trace.info('snapshot.coordinator.source-unchanged', { ...summarizeSyncRequest(request), sourceKey: source.sourceKey, sourceRevision: source.sourceRevision })
            continue
          }
          const pokemonDisplay = Object.fromEntries(placements.flatMap(placement => placement.pokemonInstanceId && displayById[placement.pokemonInstanceId] ? [[placement.pokemonInstanceId, displayById[placement.pokemonInstanceId]]] : []))
          const updated = { ...source, sourceRevision: source.sourceRevision + 1, snapshotRevision: source.snapshotRevision + 1, needsSaveFlush: source.needsSaveFlush || placementsChanged(source.placements, placements), placements, pokemonDisplay }
          writes.push({ key: sourceKeyFor(updated.sourceKey), value: JSON.stringify(updated) })
          snapshots.push(safeSnapshot(updated))
          trace.info('snapshot.coordinator.source-persisted', { ...summarizeSyncRequest(request), sourceKey: source.sourceKey, sourceRevision: updated.sourceRevision, snapshotRevision: updated.snapshotRevision, needsSaveFlush: updated.needsSaveFlush })
        }
        for (const [pokemonInstanceId, destination] of next) {
          const origin = prior.get(pokemonInstanceId)
          if (samePlacement(origin, destination)) continue
          const document = changedRecords.get(pokemonInstanceId)
          const decision = placementDecisions.get(pokemonInstanceId)
          const sourceAdapter = sourceAdapterFor(sources, origin?.sourceKey) ?? document.representations[0]?.adapter
          const destinationAdapter = sourceAdapterFor(sources, destination.sourceKey) ?? sourceAdapterFor(request.sources, destination.sourceKey) ?? sourceAdapterFor(sources, origin?.sourceKey)
          const hash = document.representations[0]?.sha256
          const revised = { ...document, ...(document.hubPassport || !decision?.hubPassport ? {} : { hubPassport: structuredClone(decision.hubPassport) }), placement: { sourceKey: destination.sourceKey, location: destination.location }, revision: document.revision + 1 }
          writes.push({ key: recordKey(pokemonInstanceId), value: JSON.stringify(revised) })
          const event = eventStore.prepare({
            pokemonInstanceId,
            operationId: `${request.workspaceId}:${request.idempotencyKey}`,
            type: 'pokemon.placement-changed',
            source: origin ?? destination,
            destination,
            sourceRevision: sourceRevisionFor(snapshots, origin?.sourceKey) ?? 0,
            destinationRevision: sourceRevisionFor(snapshots, destination.sourceKey) ?? 0,
            adapter: { source: sourceAdapter, destination: destinationAdapter, capabilityVersion: '1' },
            representationHashes: { source: hash, destination: hash },
          })
          writes.push({ key: event.key, value: JSON.stringify(event.document) })
        }
        const result = { status: 'accepted', ...(request.transaction ? { sessionCommitted: true } : {}), clientSequence: request.clientSequence, idempotencyKey: request.idempotencyKey, serverSequence: Date.parse(now().toISOString()), snapshots }
        writes.push({ key: operationKey, value: JSON.stringify(result) }, ...(request.transaction?.writes ?? []))
        const checks = [
          ...(request.transaction?.checks ?? []),
          { key: operationKey, absent: true },
          ...sources.flatMap(({source, submitted}) => [
            { key: sourceKeyFor(source.sourceKey), fields: { sourceRevision: source.sourceRevision, snapshotRevision: source.snapshotRevision, ...(source.saveRevision === undefined ? {} : { saveRevision: source.saveRevision }), needsSaveFlush: source.needsSaveFlush } },
            { key: leaseKey(source.sourceKey), fields: { state: 'active', workspaceId: request.workspaceId, sourceSessionId: submitted.sourceSessionId, leaseToken: submitted.leaseToken }, live: true },
          ]),
          ...[...changedRecords].map(([id, record]) => ({ key: recordKey(id), fields: { revision: record.revision } })),
        ]
        if (!await compareAndWriteJson(persistence, { checks, writes, instant: now().getTime() })) throw coordinatorError('SNAPSHOT_COMMIT_CONFLICT', 'Source state or lease changed before the snapshot commit.')
        trace.info('snapshot.coordinator.accepted', { ...summarizeSyncRequest(request), snapshotRevisions: snapshots.map(snapshot => ({ sourceKey: snapshot.sourceKey, sourceRevision: snapshot.sourceRevision, snapshotRevision: snapshot.snapshotRevision })) })
        return result
      } catch (error) {
        trace.error('snapshot.coordinator.failed', { ...summarizeSyncRequest(request), error: errorDetails(error) })
        throw error
      }
    },
  }


  async function reserveSource({ sourceKey, workspaceId }) {
    assertString(sourceKey, 'Source key'); assertString(workspaceId, 'Workspace ID')
    const key = leaseKey(sourceKey), instant = now().getTime()
    let lease = await readLease(key)
    if (!lease) {
      const intent = { sourceKey, workspaceId, state: 'acquiring', sourceSessionId: randomUUID(), leaseToken: randomUUID(), expiresAt: instant + leaseMs }
      const installed = await compareAndWriteJson(persistence, { checks: [{ key, absent: true }], writes: [
        { key, value: JSON.stringify(intent) },
        { key: workspaceLeaseIndexKey(workspaceId), kind: 'sadd', value: sourceKey },
        { key: expiringLeaseIndexKey(), kind: 'zadd', value: leaseMember(sourceKey), score: intent.expiresAt },
      ] })
      lease = installed ? intent : await readLease(key)
    }
    if (!lease || lease.expiresAt <= instant || lease.state === 'releasing') throw coordinatorError('SOURCE_FLUSH_PENDING', 'Source reservation requires recovery.')
    if (lease.workspaceId !== workspaceId) throw coordinatorError('SOURCE_RESERVED', 'Pokemon Hub source is reserved by another workspace.')
    const physical = gameSaveLeaseIdentity(sourceKey, workspaceId)
    // The indexed intent must precede the physical lock: a crash is discoverable.
    if (physical) {
      try { await gameSaveLeases?.acquireHub(physical) } catch (error) {
        const stale = error.code === 'SAVE_IN_USE_BY_POKEMON_HUB' ? await gameSaveLeases?.get?.(physical) : null
        const source = stale ? await readSource(sourceKey) : null
        if (!stale || stale.ownerKind !== 'pokemon-hub' || stale.expiresAt > instant || source?.needsSaveFlush || await persistence.get(pokemonHubRedisKeys.session(stale.workspaceId)) !== null) throw error
        // Reconcile a late orphan acquisition without allowing a live session or
        // an unpublished source to lose its physical reservation.
        await gameSaveLeases.releaseHub({ ...physical, workspaceId: stale.workspaceId })
        await gameSaveLeases.acquireHub(physical)
      }
    }
    return lease
  }

  async function finishRelease(lease) {
    const key = leaseKey(lease.sourceKey)
    const releasing = { ...lease, state: 'releasing' }
    if (!await compareAndWriteJson(persistence, { checks: [{ key, fields: lease }], writes: [{ key, value: JSON.stringify(releasing) }] })) throw coordinatorError('LEASE_INVALID', 'Source lease changed during release.')
    const physical = gameSaveLeaseIdentity(lease.sourceKey, lease.workspaceId)
    if (physical) await gameSaveLeases?.releaseHub(physical).catch(error => { if (error.code !== 'HUB_LEASE_INVALID') throw error })
    if (!await compareAndWriteJson(persistence, { checks: [{ key, fields: releasing }], writes: [
      { key, value: null },
      { key: workspaceLeaseIndexKey(lease.workspaceId), kind: 'srem', value: lease.sourceKey },
      { key: expiringLeaseIndexKey(), kind: 'zrem', value: leaseMember(lease.sourceKey) },
    ] })) throw coordinatorError('LEASE_INVALID', 'Source lease changed during release completion.')
  }

  async function readSource(sourceKey) {
    const stored = await persistence.get(sourceKeyFor(sourceKey))
    return stored === null ? null : JSON.parse(stored)
  }
  async function readRecord(pokemonInstanceId) {
    const stored = await persistence.get(recordKey(pokemonInstanceId))
    return stored === null ? null : JSON.parse(stored)
  }
  async function publicSnapshot(source) {
    const snapshot = safeSnapshot(source)
    await Promise.all(snapshot.placements.filter(placement => placement.pokemonInstanceId).map(async placement => {
      const record = await readRecord(placement.pokemonInstanceId)
      if (record?.hubPassport) snapshot.pokemonDisplay[placement.pokemonInstanceId] = { ...snapshot.pokemonDisplay[placement.pokemonInstanceId], hubPassport: structuredClone(record.hubPassport) }
    }))
    return snapshot
  }
  async function reusableRecords(source) {
    const result = new Map()
    if (!source) return result
    for (const placement of source.placements) {
      if (!placement.pokemonInstanceId) continue
      const record = await readRecord(placement.pokemonInstanceId)
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
  async function readWorkspaceLeaseSources(workspaceId) {
    const sourceKeys = await persistence.members(workspaceLeaseIndexKey(workspaceId))
    if (!Array.isArray(sourceKeys) || sourceKeys.some(sourceKey => typeof sourceKey !== 'string' || sourceKey.length === 0)) {
      throw coordinatorError('LEASE_INDEX_INVALID', 'Pokemon Hub workspace lease index is invalid.')
    }
    return [...new Set(sourceKeys)].sort()
  }
  async function verifyWorkspaceSources(request) {
    const verified = []
    for (const submitted of request.sources) {
      const source = await readSource(submitted.sourceKey)
      if (!source) throw coordinatorError('SOURCE_NOT_ADOPTED', 'Pokemon Hub source has not been adopted.')
      const lease = await readLease(leaseKey(submitted.sourceKey))
      if (!lease || lease.state !== 'active' || lease.workspaceId !== request.workspaceId || lease.sourceSessionId !== submitted.sourceSessionId || lease.leaseToken !== submitted.leaseToken || lease.expiresAt <= now().getTime()) throw coordinatorError('LEASE_INVALID', 'Pokemon Hub source lease is invalid.')
      verified.push({ source, submitted })
    }
    await assertCompleteWorkspaceSourceSet(request, verified)
    return verified
  }
  async function assertCompleteWorkspaceSourceSet(request, sources) {
    const active = new Set()
    const sourceKeys = await readWorkspaceLeaseSources(request.workspaceId)
    const leases = await Promise.all(sourceKeys.map(sourceKey => readLease(leaseKey(sourceKey))))
    for (const lease of leases) {
      if (lease?.workspaceId === request.workspaceId && lease.expiresAt > now().getTime()) active.add(lease.sourceKey)
    }
    const submitted = new Set(sources.map(({ source }) => source.sourceKey))
    const retiring = new Set(request.retiredSourceKeys ?? [])
    if ([...retiring].some(sourceKey => submitted.has(sourceKey))) throw coordinatorError('SNAPSHOT_INVALID', 'Pokemon Hub retired source is also submitted.')
    const complete = new Set([...submitted, ...retiring])
    if (active.size !== complete.size || [...active].some(sourceKey => !complete.has(sourceKey))) throw coordinatorError('SOURCE_SET_INCOMPLETE', 'Pokemon Hub snapshot must include every leased source in the workspace.')
  }
  async function readRequestSources(request) {
    const results = []
    for (const submitted of request.sources) {
      const source = await readSource(submitted.sourceKey)
      if (source) results.push({ source, submitted })
    }
    return results
  }
}

const nullPokemonHubLogger = Object.freeze({ info() {}, warn() {}, error() {} })

function normalizePokemonHubLogger(logger) {
  return logger && typeof logger.info === 'function' && typeof logger.warn === 'function' && typeof logger.error === 'function'
    ? logger
    : nullPokemonHubLogger
}

function summarizeSyncRequest(request) {
  if (!request || typeof request !== 'object') return { requestType: request === null ? 'null' : typeof request }
  return {
    workspaceId: request.workspaceId ?? null,
    idempotencyKey: request.idempotencyKey ?? null,
    clientSequence: request.clientSequence ?? null,
    sourceKeys: Array.isArray(request.sources) ? request.sources.map(source => source?.sourceKey ?? null) : null,
    retiredSourceKeys: Array.isArray(request.retiredSourceKeys) ? request.retiredSourceKeys : null,
    placementCounts: Array.isArray(request.sources) ? request.sources.map(source => ({ sourceKey: source?.sourceKey ?? null, total: Array.isArray(source?.placements) ? source.placements.length : null, occupied: Array.isArray(source?.placements) ? source.placements.filter(placement => placement?.pokemonInstanceId).length : null })) : null,
  }
}

function errorDetails(error) {
  return {
    name: error?.name ?? 'Error',
    code: error?.code ?? null,
    message: error?.message ?? String(error),
    stack: error?.stack ?? null,
  }
}

function normalizeAdoption(input) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.slots)) throw new TypeError('Pokemon Hub source adoption is invalid')
  assertString(input.sourceKey, 'Source key'); assertString(input.adapter, 'Adapter')
  if (!Number.isInteger(input.sourceRevision) || input.sourceRevision < 0) throw new TypeError('Source revision is invalid')
  if (input.transferCapability !== undefined && (!input.transferCapability || typeof input.transferCapability !== 'object')) throw new TypeError('Pokemon Hub transfer capability is invalid')
  return { ...input, ...(input.transferCapability ? { transferCapability: structuredClone(input.transferCapability) } : {}), slots: input.slots.map(slot => ({ location: normalizeLocation(slot.location), record: slot.record ? normalizeRecord(slot.record) : null })) }
}

function normalizeRecord(record) {
  if (!record || typeof record !== 'object' || !Buffer.isBuffer(record.representation?.bytes)) throw new TypeError('Pokemon native representation is invalid')
  assertString(record.representation.adapter, 'Representation adapter'); assertString(record.representation.kind, 'Representation kind')
  if (!record.display || typeof record.display !== 'object') throw new TypeError('Pokemon display projection is invalid')
  return { adapter: record.representation.adapter, kind: record.representation.kind, bytes: Buffer.from(record.representation.bytes), display: structuredClone(record.display) }
}

function normalizeSyncRequest(request) {
  if (!request || typeof request !== 'object' || !Array.isArray(request.sources) || !Number.isInteger(request.clientSequence) || request.clientSequence < 1) throw new TypeError('Pokemon Hub snapshot request is invalid')
  assertString(request.workspaceId, 'Workspace ID'); assertString(request.idempotencyKey, 'Idempotency key')
  if (request.retiredSourceKeys === undefined) request.retiredSourceKeys = []
  if (!Array.isArray(request.retiredSourceKeys) || request.retiredSourceKeys.some(sourceKey => typeof sourceKey !== 'string' || sourceKey.length === 0) || new Set(request.retiredSourceKeys).size !== request.retiredSourceKeys.length) throw new TypeError('Pokemon Hub retired source set is invalid')
  for (const source of request.sources) {
    assertString(source?.sourceKey, 'Source key'); assertString(source?.sourceSessionId, 'Source session ID'); assertString(source?.leaseToken, 'Lease token')
    if (!Number.isInteger(source.baseRevision) || source.baseRevision < 0 || !Array.isArray(source.placements)) throw new TypeError('Pokemon Hub source snapshot is invalid')
    source.placements = clonePlacements(source.placements)
  }
}

function normalizeWorkspaceSources(request) {
  if (!request || typeof request !== 'object' || !Array.isArray(request.sources)) throw new TypeError('Pokemon Hub workspace sources are invalid')
  assertString(request.workspaceId, 'Workspace ID')
  const sourceKeys = new Set()
  const sources = request.sources.map(source => {
    assertString(source?.sourceKey, 'Source key'); assertString(source?.sourceSessionId, 'Source session ID'); assertString(source?.leaseToken, 'Lease token')
    if (sourceKeys.has(source.sourceKey)) throw coordinatorError('SNAPSHOT_INVALID', 'Pokemon Hub source is duplicated.')
    sourceKeys.add(source.sourceKey)
    return { sourceKey: source.sourceKey, sourceSessionId: source.sourceSessionId, leaseToken: source.leaseToken }
  })
  return { workspaceId: request.workspaceId, sources }
}

function safeSnapshot(source) {
  return { sourceKey: source.sourceKey, sourceRevision: source.sourceRevision, snapshotRevision: source.snapshotRevision, saveRevision: source.saveRevision, needsSaveFlush: source.needsSaveFlush, adapter: source.adapter, ...(source.transferCapability ? { transferCapability: structuredClone(source.transferCapability) } : {}), placements: clonePlacements(source.placements), pokemonDisplay: structuredClone(source.pokemonDisplay ?? {}) }
}

function clonePlacements(placements) { return placements.map(placement => ({ location: normalizeLocation(placement.location), pokemonInstanceId: placement.pokemonInstanceId ?? null })) }
function placementsChanged(current, next) { return current.length !== next.length || current.some((placement, index) => placement.pokemonInstanceId !== next[index].pokemonInstanceId || pokemonHubLocationKey(placement.location) !== pokemonHubLocationKey(next[index].location)) }
function normalizeLocation(location) {
  if (!location || typeof location !== 'object' || !Number.isInteger(location.slot) || location.slot < 0) throw new TypeError('Pokemon Hub placement location is invalid')
  return structuredClone(location)
}
function assertSameLocations(expected, actual, adapter) {
  const expectedKeys = new Set(expected.map(placement => pokemonHubLocationKey(placement.location)))
  if (expectedKeys.size === actual.length && actual.every(placement => expectedKeys.delete(pokemonHubLocationKey(placement.location)))) return
  const hubProfileId = expected[0]?.location?.hubProfileId
  if (adapter === 'hub-grid-v1' && hubProfileId && actual.length > expected.length) {
    const extended = extendPokemonHubPlacements(expected, hubProfileId, actual.length - 1)
    if (extended && actual.every((placement, slot) => pokemonHubLocationKey(placement.location) === pokemonHubLocationKey(extended[slot].location))) return
  }
  throw coordinatorError('SNAPSHOT_INVALID', 'Pokemon Hub snapshot locations are invalid.')
}
function assertGen3PartyShape(source, submitted) {
  if (source.adapter !== 'gen3-gba-v1' || !source.sourceKey.startsWith('save:')) return
  const previous = source.placements.filter(placement => placement.location.area === 'party' && placement.pokemonInstanceId)
  const occupied = submitted.placements.filter(placement => placement.location.area === 'party' && placement.pokemonInstanceId)
    .sort((left, right) => left.location.slot - right.location.slot)
  if (previous.length > 0 && occupied.length === 0) throw coordinatorError('SNAPSHOT_INVALID', 'A save Party must keep at least one Pokemon.')
  if (occupied.some((placement, index) => placement.location.slot !== index)) throw coordinatorError('SNAPSHOT_INVALID', 'A save Party must be contiguous.')
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
function rejectCrossSourceOccupiedDestinations(prior, next) {
  const priorOccupants = new Map([...prior].map(([pokemonInstanceId, placement]) => [placementKey(placement), pokemonInstanceId]))
  for (const [pokemonInstanceId, destination] of next) {
    const origin = prior.get(pokemonInstanceId)
    const displacedPokemonInstanceId = priorOccupants.get(placementKey(destination))
    if (origin && displacedPokemonInstanceId && displacedPokemonInstanceId !== pokemonInstanceId && origin.sourceKey !== destination.sourceKey) {
      throw coordinatorError('CROSS_SOURCE_OCCUPIED', 'Pokemon cannot replace an occupied slot in another source.')
    }
  }
}
function placementKey(placement) { return `${placement.sourceKey}\u0000${pokemonHubLocationKey(placement.location)}` }
function samePlacement(left, right) { return left?.sourceKey === right?.sourceKey && pokemonHubLocationKey(left?.location) === pokemonHubLocationKey(right?.location) }
function sourceAdapterFor(sources, sourceKey) { return sources.find(item => (item.source?.sourceKey ?? item.sourceKey) === sourceKey)?.source?.adapter ?? sources.find(item => item.sourceKey === sourceKey)?.adapter ?? null }
function sourceFor(sources, sourceKey) { return sources.find(item => item.source?.sourceKey === sourceKey)?.source ?? null }
function pokemonCountForSource(sources, sourceKey) { return sourceFor(sources, sourceKey)?.placements.filter(placement => placement.pokemonInstanceId).length ?? null }
function sourceRevisionFor(snapshots, sourceKey) { return snapshots.find(snapshot => snapshot.sourceKey === sourceKey)?.sourceRevision ?? null }
function correction(code, request, sources, serverSequence, reason = null) {
  const snapshots = sources.map(({ source }) => safeSnapshot(source)).sort((left, right) => left.sourceKey.localeCompare(right.sourceKey))
  return { status: 'corrected', code, ...(reason ? { reason: structuredClone(reason) } : {}), clientSequence: request.clientSequence, idempotencyKey: request.idempotencyKey, serverSequence, snapshots }
}
function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex') }
function sourceKeyFor(sourceKey) { return pokemonHubRedisKeys.source(sourceKey) }
function recordKey(pokemonInstanceId) { return pokemonHubRedisKeys.record(pokemonInstanceId) }
function leaseKey(sourceKey) { return pokemonHubRedisKeys.lease(sourceKey) }
function workspaceLeaseIndexKey(workspaceId) { return pokemonHubRedisKeys.workspaceLease(workspaceId) }
function expiringLeaseIndexKey() { return pokemonHubRedisKeys.expiringLeaseIndex() }
function leaseMember(sourceKey) { return JSON.stringify(sourceKey) }
function parseLeaseMember(member) {
  try {
    const sourceKey = JSON.parse(member)
    return typeof sourceKey === 'string' && sourceKey.length > 0 ? { sourceKey } : null
  } catch { return null }
}
function gameSaveLeaseIdentity(sourceKey, workspaceId) {
  const match = /^save:([^:]+):([^:]+)$/.exec(sourceKey)
  return match ? { profileId: match[1], gameId: match[2], workspaceId } : null
}
function syncKey(workspaceId, idempotencyKey) { return pokemonHubRedisKeys.snapshotSync(workspaceId, idempotencyKey) }
function assertString(value, label) { if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} is required`) }
function coordinatorError(code, message) { const error = new Error(message); error.code = code; return error }
