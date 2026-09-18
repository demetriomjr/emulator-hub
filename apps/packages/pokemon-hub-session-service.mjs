import { randomUUID } from 'node:crypto'
import { createInitialPokemonHubCanonicalSnapshot, validatePokemonHubCanonicalSnapshot } from './pokemon-hub-canonical-session-snapshot.mjs'
import { pokemonHubRedisKeys } from './pokemon-hub-redis-keys.mjs'

const claimSessionTransition = Object.freeze({
  lua: `
local raw = redis.call('GET', KEYS[1])
if not raw then return { 'missing' } end
local session = cjson.decode(raw)
if session.state and session.state ~= 'open' then return { 'busy' } end
redis.call('SET', KEYS[1], ARGV[1])
return { 'claimed' }
`.trim(),
  memory: claimSessionTransitionMemory,
})

const commitSessionTransition = Object.freeze({
  lua: `
local raw = redis.call('GET', KEYS[1])
if not raw then return { 'missing' } end
local session = cjson.decode(raw)
local operation = session.operation
if session.state ~= 'transitioning' or not operation or operation.id ~= ARGV[1] or operation.generation ~= tonumber(ARGV[2]) then return { 'fenced' } end
redis.call('SET', KEYS[1], ARGV[3])
return { 'committed' }
`.trim(),
  memory: commitSessionTransitionMemory,
})

const abortSessionTransition = Object.freeze({
  lua: `
local raw = redis.call('GET', KEYS[1])
if not raw then return { 'missing' } end
local session = cjson.decode(raw)
local operation = session.operation
if session.state ~= 'transitioning' or not operation or operation.id ~= ARGV[1] or operation.generation ~= tonumber(ARGV[2]) then return { 'ignored' } end
redis.call('SET', KEYS[1], ARGV[3])
return { 'aborted' }
`.trim(),
  memory: abortSessionTransitionMemory,
})

const replaceOpenSessionTransition = Object.freeze({
  lua: `
local raw = redis.call('GET', KEYS[1])
if not raw then return { 'missing' } end
local current = cjson.decode(raw)
if current.state and current.state ~= 'open' then return { 'busy' } end
if (current.version or 0) ~= tonumber(ARGV[1]) then return { 'stale' } end
redis.call('SET', KEYS[1], ARGV[2])
return { 'replaced' }
`.trim(),
  memory: replaceOpenSessionTransitionMemory,
})

const completeSessionCloseTransition = Object.freeze({
  lua: `
local terminal = redis.call('GET', KEYS[2])
if terminal then return { 'replayed' } end
if not redis.call('GET', KEYS[1]) then return { 'missing' } end
redis.call('SET', KEYS[2], ARGV[1], 'EX', tonumber(ARGV[2]))
redis.call('DEL', KEYS[1])
return { 'completed' }
`.trim(),
  memory: completeSessionCloseTransitionMemory,
})

export function createPokemonHubSessionService({ persistence, coordinator, logger = nullPokemonHubLogger, now = () => Date.now(), newId = randomUUID, leaseMs = 9_000, operationLeaseMs = Math.max(leaseMs * 2, 30_000) } = {}) {
  if (!persistence || typeof persistence.get !== 'function' || typeof persistence.set !== 'function' || typeof persistence.delete !== 'function' || typeof persistence.eval !== 'function' || typeof persistence.addToSortedSet !== 'function' || typeof persistence.removeFromSortedSet !== 'function' || typeof persistence.rangeByScore !== 'function') throw new TypeError('Pokemon Hub session persistence is invalid')
  if (!coordinator || typeof coordinator.getSnapshot !== 'function' || typeof coordinator.renew !== 'function' || typeof coordinator.release !== 'function' || typeof coordinator.sync !== 'function' || typeof coordinator.reconcileWorkspaceLeases !== 'function') throw new TypeError('Pokemon Hub snapshot coordinator is invalid')
  const queues = new Map()

  return { open, attach, heartbeat, syncSnapshot, syncCanonicalSnapshot, closeCanonicalSession, getCanonicalSnapshot, detach, close, listExpired, releaseExpired }

  async function open({ profileId }) {
    assertString(profileId, 'Profile ID')
    const serverNow = now()
    const snapshot = createInitialPokemonHubCanonicalSnapshot()
    const session = { schemaVersion: 2, profileId, sessionId: newId(), version: 0, canonicalSnapshot: snapshot, expiresAt: serverNow + leaseMs, sources: [] }
    await write(session)
    return { sessionId: session.sessionId, serverNow, expiresAt: session.expiresAt, snapshot }
  }

  async function getCanonicalSnapshot({ profileId, sessionId }) {
    assertString(profileId, 'Profile ID'); assertString(sessionId, 'Session ID')
    const session = await read(profileId, sessionId)
    if (!session) throw sessionError('SESSION_INVALID', 'Workspace session is invalid.')
    return canonicalSnapshotForSession(session)
  }

  async function attach({ profileId, sessionId, sourceKey, sourceSnapshot, acquireSource }) {
    assertString(profileId, 'Profile ID'); assertString(sessionId, 'Session ID'); assertString(sourceKey, 'Source key')
    return enqueue(sessionId, async () => {
      const session = await requireLive(profileId, sessionId)
      const existing = session.sources.find(source => source.sourceKey === sourceKey)
      if (existing) {
        const snapshots = await readSnapshots(session)
        return sourceResponse(session, existing.sourceId, snapshots.get(existing.sourceId))
      }
      if (sourceSnapshot === undefined) {
        if (typeof acquireSource !== 'function') throw new TypeError('Pokemon Hub source acquisition is invalid')
        sourceSnapshot = await acquireSource()
      }
      const source = normalizeLeasedSource(sourceSnapshot, sourceKey)
      const sourceId = newId()
      let stored = false
      try {
        const expectedVersion = session.version
        session.sources.push({ sourceId, sourceKey, sourceSessionId: source.sourceSessionId, leaseToken: source.leaseToken })
        session.version += 1
        session.expiresAt = now() + leaseMs
        await writeOpenSession(session, expectedVersion)
        stored = true
        return await sourceResponse(session, sourceId, source)
      } catch (error) {
        if (stored) {
          const expectedVersion = session.version
          session.sources = session.sources.filter(candidate => candidate.sourceId !== sourceId)
          session.version -= 1
          await writeOpenSession(session, expectedVersion)
        }
        try {
          await coordinator.release({ profileId, sourceKey, workspaceId: sessionId, sourceSessionId: source.sourceSessionId, leaseToken: source.leaseToken })
        } catch {}
        throw error
      }
    })
  }

  async function heartbeat({ profileId, sessionId, sequence }) {
    assertString(profileId, 'Profile ID'); assertString(sessionId, 'Session ID')
    if (!Number.isInteger(sequence) || sequence < 1) throw sessionError('SESSION_HEARTBEAT_INVALID', 'Session heartbeat sequence is invalid.')
    return enqueue(sessionId, async () => {
      const session = await requireLive(profileId, sessionId)
      const expectedVersion = session.version
      for (const source of session.sources) await coordinator.renew({ profileId, sourceKey: source.sourceKey, workspaceId: sessionId, sourceSessionId: source.sourceSessionId, leaseToken: source.leaseToken })
      const serverNow = now()
      session.expiresAt = serverNow + leaseMs
      await writeOpenSession(session, expectedVersion)
      return { serverNow, expiresAt: session.expiresAt }
    })
  }

  async function syncSnapshot({ profileId, sessionId, snapshot }) {
    assertString(profileId, 'Profile ID'); assertString(sessionId, 'Session ID')
    const input = normalizeSnapshot(snapshot)
    const fingerprint = snapshotFingerprint(input)
    return enqueue(sessionId, async () => {
      const session = await requireLive(profileId, sessionId)
      const previous = await persistence.get(operationKey(profileId, sessionId, input.n))
      if (previous !== null) {
        const stored = JSON.parse(previous)
        if (stored.fingerprint === fingerprint) return stored.response
        return reject(session, input.n, 'SNAPSHOT_INVALID', { persist: false, fingerprint })
      }
      if (input.v !== session.version) return reject(session, input.n, 'SNAPSHOT_STALE', { fingerprint })

      const operation = await beginSnapshotOperation(session)
      try {
        const snapshots = await readSnapshots(session)
        if (input.s.length !== session.sources.length || new Set(input.s.map(source => source.id)).size !== session.sources.length) return reject(session, input.n, 'SNAPSHOT_INVALID', { fingerprint })
        const submittedBySourceId = new Map(input.s.map(source => [source.id, source.occupied]))
        if (session.sources.some(source => !submittedBySourceId.has(source.sourceId))) return reject(session, input.n, 'SNAPSHOT_INVALID', { fingerprint })

        if (session.sources.some(source => submittedBySourceId.get(source.sourceId).some(([slot]) => slot >= snapshots.get(source.sourceId).placements.length))) return reject(session, input.n, 'SNAPSHOT_INVALID', { fingerprint })
        const sources = session.sources.map(source => {
          const snapshot = snapshots.get(source.sourceId)
          const occupied = submittedBySourceId.get(source.sourceId)
          const requested = new Map(occupied)
          const placements = snapshot.placements.map((placement, slot) => ({ location: placement.location, pokemonInstanceId: requested.get(slot) ?? null }))
          return { ...source, baseRevision: snapshot.sourceRevision, placements }
        })

        const changedSources = sources.filter(source => source.placements.some((placement, slot) => placement.pokemonInstanceId !== snapshots.get(source.sourceId).placements[slot].pokemonInstanceId))
        await coordinator.reconcileWorkspaceLeases({ profileId, workspaceId: sessionId, sources: sources.map(source => ({ sourceKey: source.sourceKey, sourceSessionId: source.sourceSessionId, leaseToken: source.leaseToken })) })
        if (changedSources.length === 0) {
          const response = { ok: true, sequence: input.n, version: session.version }
          await writeOperation(profileId, sessionId, input.n, fingerprint, response)
          return response
        }

        const result = await coordinator.sync({
          profileId,
          workspaceId: sessionId,
          clientSequence: session.version + 1,
          idempotencyKey: `snapshot:${input.n}`,
          sources: sources.map(source => ({ sourceKey: source.sourceKey, sourceSessionId: source.sourceSessionId, leaseToken: source.leaseToken, baseRevision: source.baseRevision, placements: source.placements })),
        })
        if (result.status !== 'accepted') return reject(session, input.n, result.code ?? 'SNAPSHOT_STALE', { fingerprint })
        session.version += 1
        session.expiresAt = now() + leaseMs
        await commitSnapshotOperation(session, operation)
        const response = { ok: true, sequence: input.n, version: session.version }
        await writeOperation(profileId, sessionId, input.n, fingerprint, response)
        return { ...response, dirtySourceKeys: changedSources.map(source => source.sourceKey).filter(key => key.startsWith(`save:${profileId}:`)) }
      } catch (error) {
        if (isRecoverableSnapshotError(error)) return reject(session, input.n, error.code, { fingerprint })
        throw error
      } finally {
        await settleSnapshotOperation(profileId, sessionId, operation)
      }
    })
  }

  async function syncCanonicalSnapshot(options = {}) {
    return runCanonicalSnapshot(options, false)
  }

  async function closeCanonicalSession(options = {}) {
    return runCanonicalSnapshot(options, true)
  }

  async function runCanonicalSnapshot({ profileId, sessionId, snapshot, idempotencyKey, acquireSource, flushOutgoingSource, releaseSource, logger: requestLogger } = {}, closeSession) {
    assertString(profileId, 'Profile ID'); assertString(sessionId, 'Session ID'); assertString(idempotencyKey, 'Idempotency key')
    if (typeof acquireSource !== 'function' || typeof flushOutgoingSource !== 'function' || typeof releaseSource !== 'function') throw new TypeError('Pokemon Hub canonical snapshot lifecycle is invalid')
    const trace = normalizePokemonHubLogger(requestLogger ?? logger)
    trace.info('snapshot.canonical.received', { profileId, sessionId, idempotencyKey, snapshot: summarizeCanonicalSnapshot(snapshot) })
    let input
    try { input = validatePokemonHubCanonicalSnapshot(snapshot) } catch (error) {
      trace.warn('snapshot.canonical.validation-failed', { profileId, sessionId, idempotencyKey, error: errorDetails(error) })
      input = null
    }
    const fingerprint = JSON.stringify(input ?? snapshot)
    const terminalKey = closeSession ? pokemonHubRedisKeys.sessionTerminal(profileId, idempotencyKey) : null
    return enqueue(sessionId, async () => {
      if (closeSession) {
        const terminal = await persistence.get(terminalKey)
        if (terminal !== null) {
          const stored = JSON.parse(terminal)
          if (stored.fingerprint !== fingerprint) throw sessionError('IDEMPOTENCY_KEY_CONFLICT', 'Pokemon Hub close identity was reused with another snapshot.')
          return { status: 'complete' }
        }
      }
      const session = await read(profileId, sessionId)
      if (closeSession && session?.state === 'closing') {
        if (session.close?.idempotencyKey !== idempotencyKey || session.close?.fingerprint !== fingerprint) throw sessionError('SESSION_INVALID', 'Workspace session is already closing.')
        return finalizeCanonicalSession(session, { profileId, sessionId, idempotencyKey, fingerprint, flushOutgoingSource, releaseSource })
      }
      if (!session || session.expiresAt <= now() || session.state === 'closed' || session.state === 'closing') throw sessionError('SESSION_INVALID', 'Workspace session is invalid.')
      const authority = canonicalSnapshotForSession(session)
      if (closeSession && input) input = { ...input, revision: authority.revision }
      trace.info('snapshot.canonical.session-loaded', { profileId, sessionId, idempotencyKey, authorityRevision: authority.revision, sourceKeys: session.sources.map(source => source.sourceKey), expiresAt: session.expiresAt })
      const operationKeyValue = operationKey(profileId, sessionId, `${closeSession ? 'close' : 'canonical'}:${idempotencyKey}`)
      const previous = await persistence.get(operationKeyValue)
      if (previous !== null) {
        const stored = JSON.parse(previous)
        const response = stored.fingerprint === fingerprint ? stored.response : { status: 'corrected', snapshot: authority }
        trace.info('snapshot.canonical.replayed', { profileId, sessionId, idempotencyKey, status: response.status, fingerprintMatched: stored.fingerprint === fingerprint })
        if (!closeSession || response.status !== 'accepted') return response
        return finalizeCanonicalSession(session, { profileId, sessionId, idempotencyKey, fingerprint, flushOutgoingSource, releaseSource })
      }
      if (!input || input.revision !== authority.revision) {
        trace.warn('snapshot.canonical.corrected-before-operation', { profileId, sessionId, idempotencyKey, inputRevision: input?.revision ?? null, authorityRevision: authority.revision })
        return await canonicalReject(session, idempotencyKey, authority, fingerprint)
      }

      const operation = await beginSnapshotOperation(session)
      let canonicalCommitted = false
      trace.info('snapshot.canonical.operation-started', { profileId, sessionId, idempotencyKey, operationId: operation.id, generation: operation.generation, deadline: operation.deadline })
      const acquired = []
      try {
        const requested = requestedCanonicalSources(input, profileId)
        const currentByKey = new Map(session.sources.map(source => [source.sourceKey, source]))
        const outgoing = [...currentByKey.values()].filter(source => !requested.has(source.sourceKey))
        const workingByKey = new Map([...currentByKey].filter(([sourceKey]) => requested.has(sourceKey)))
        trace.info('snapshot.canonical.sources-requested', { profileId, sessionId, idempotencyKey, requestedSourceKeys: [...requested.keys()], retainedSourceKeys: [...workingByKey.keys()], outgoingSourceKeys: outgoing.map(source => source.sourceKey) })
        for (const sourceKey of requested.keys()) {
          if (workingByKey.has(sourceKey)) continue
          trace.info('snapshot.canonical.source-acquire-started', { profileId, sessionId, idempotencyKey, sourceKey })
          let lease
          try { lease = normalizeLeasedSource(await acquireSource(sourceKey), sourceKey) } catch (error) {
            trace.error('snapshot.canonical.source-acquire-failed', { profileId, sessionId, idempotencyKey, sourceKey, error: errorDetails(error) })
            throw error
          }
          const source = { sourceId: newId(), sourceKey, sourceSessionId: lease.sourceSessionId, leaseToken: lease.leaseToken }
          workingByKey.set(sourceKey, source)
          acquired.push(source)
          trace.info('snapshot.canonical.source-acquired', { profileId, sessionId, idempotencyKey, sourceKey, expiresAt: lease.expiresAt ?? null })
        }

        // A structural close is deliberately separate from a Pokemon move.  Its
        // flush therefore persists the previous authoritative source state
        // before this candidate changes durable pane membership.
        for (const source of outgoing.filter(source => source.sourceKey.startsWith(`save:${profileId}:`))) {
          trace.info('snapshot.canonical.source-flush-started', { profileId, sessionId, idempotencyKey, sourceKey: source.sourceKey })
          try { await flushOutgoingSource(source) } catch (error) {
            trace.error('snapshot.canonical.source-flush-failed', { profileId, sessionId, idempotencyKey, sourceKey: source.sourceKey, error: errorDetails(error) })
            throw error
          }
          trace.info('snapshot.canonical.source-flushed', { profileId, sessionId, idempotencyKey, sourceKey: source.sourceKey })
        }

        const baseSnapshots = await snapshotsForSources(profileId, workingByKey.values())
        const desiredSources = [...workingByKey.values()].map(source => ({
          ...source,
          baseRevision: baseSnapshots.get(source.sourceKey).sourceRevision,
          placements: placementsForCanonicalPane(baseSnapshots.get(source.sourceKey), requested.get(source.sourceKey)),
        }))
        if (!samePokemonMembership(
          [...baseSnapshots.values()].flatMap(source => source.placements.map(placement => placement.pokemonInstanceId)),
          desiredSources.flatMap(source => source.placements.map(placement => placement.pokemonInstanceId)),
        )) {
          trace.warn('snapshot.canonical.membership-rejected', { profileId, sessionId, idempotencyKey, requestedSourceKeys: [...requested.keys()] })
          return await canonicalReject(session, idempotencyKey, authority)
        }
        trace.info('snapshot.canonical.coordinator-sync-started', { profileId, sessionId, idempotencyKey, sourceKeys: desiredSources.map(source => source.sourceKey), retiredSourceKeys: outgoing.map(source => source.sourceKey) })
        const result = await coordinator.sync({
          profileId,
          workspaceId: sessionId,
          clientSequence: authority.revision + 1,
          idempotencyKey: `canonical:${idempotencyKey}`,
          retiredSourceKeys: outgoing.map(source => source.sourceKey),
          sources: desiredSources.map(source => ({ sourceKey: source.sourceKey, sourceSessionId: source.sourceSessionId, leaseToken: source.leaseToken, baseRevision: source.baseRevision, placements: source.placements })),
          logger: trace,
        })
        trace.info('snapshot.canonical.coordinator-sync-finished', { profileId, sessionId, idempotencyKey, status: result.status, code: result.code ?? null })
        if (result.status !== 'accepted') {
          trace.warn('snapshot.canonical.coordinator-corrected', { profileId, sessionId, idempotencyKey, code: result.code ?? null })
          return await canonicalReject(session, idempotencyKey, authority, fingerprint)
        }

        for (const source of outgoing) {
          trace.info('snapshot.canonical.source-release-started', { profileId, sessionId, idempotencyKey, sourceKey: source.sourceKey })
          try {
            await releaseSource(source)
            trace.info('snapshot.canonical.source-released', { profileId, sessionId, idempotencyKey, sourceKey: source.sourceKey })
          } catch (error) {
            trace.error('snapshot.canonical.source-release-failed', { profileId, sessionId, idempotencyKey, sourceKey: source.sourceKey, error: errorDetails(error) })
            throw sessionError('SOURCE_RELEASE_FAILED', 'Workspace source lease could not be released.')
          }
        }

        session.sources = [...workingByKey.values()].filter(source => requested.has(source.sourceKey))
        session.version += 1
        session.canonicalSnapshot = { ...input, revision: authority.revision + 1 }
        session.expiresAt = now() + leaseMs
        await commitSnapshotOperation(session, operation, closeSession ? { state: 'closing', close: { idempotencyKey, fingerprint } } : undefined)
        canonicalCommitted = true
        trace.info('snapshot.canonical.session-persisted', { profileId, sessionId, idempotencyKey, revision: session.version, sourceKeys: session.sources.map(source => source.sourceKey), expiresAt: session.expiresAt })
        const dirtySourceKeys = desiredSources
          .filter(source => requested.has(source.sourceKey) && source.placements.some((placement, index) => placement.pokemonInstanceId !== baseSnapshots.get(source.sourceKey).placements[index].pokemonInstanceId))
          .map(source => source.sourceKey)
          .filter(sourceKey => sourceKey.startsWith(`save:${profileId}:`))
        const response = { status: 'accepted', dirtySourceKeys: [...new Set(dirtySourceKeys)].sort() }
        await persistence.set(operationKeyValue, JSON.stringify({ fingerprint, response }), { NX: true })
        trace.info('snapshot.canonical.accepted', { profileId, sessionId, idempotencyKey, revision: session.version, dirtySourceKeys: response.dirtySourceKeys })
        if (!closeSession) return response
        return await finalizeCanonicalSession(session, { profileId, sessionId, idempotencyKey, fingerprint, flushOutgoingSource, releaseSource })
      } catch (error) {
        trace.error('snapshot.canonical.failed', { profileId, sessionId, idempotencyKey, error: errorDetails(error) })
        if (closeSession && canonicalCommitted) throw error
        if (!isRecoverableCanonicalError(error)) throw error
        for (const source of acquired.reverse()) {
          trace.info('snapshot.canonical.compensation-release-started', { profileId, sessionId, idempotencyKey, sourceKey: source.sourceKey })
          try {
            await releaseSource(source)
            trace.info('snapshot.canonical.compensation-released', { profileId, sessionId, idempotencyKey, sourceKey: source.sourceKey })
          } catch (releaseError) {
            trace.error('snapshot.canonical.compensation-release-failed', { profileId, sessionId, idempotencyKey, sourceKey: source.sourceKey, error: errorDetails(releaseError) })
          }
        }
        trace.warn('snapshot.canonical.corrected-after-failure', { profileId, sessionId, idempotencyKey, code: error.code ?? null })
        return await canonicalReject(session, idempotencyKey, authority, fingerprint)
      } finally {
        try {
          await settleSnapshotOperation(profileId, sessionId, operation)
          trace.info('snapshot.canonical.operation-settled', { profileId, sessionId, idempotencyKey, operationId: operation.id, generation: operation.generation })
        } catch (error) {
          trace.error('snapshot.canonical.operation-settle-failed', { profileId, sessionId, idempotencyKey, operationId: operation.id, generation: operation.generation, error: errorDetails(error) })
          throw error
        }
      }
    })
  }

  async function finalizeCanonicalSession(session, { profileId, sessionId, idempotencyKey, fingerprint, flushOutgoingSource, releaseSource }) {
    const sources = structuredClone(session.sources)
    for (const source of sources) await flushOutgoingSource(source)
    for (const source of sources) {
      try { await releaseSource(source) } catch (error) {
        if (error?.code !== 'LEASE_INVALID') throw error
      }
    }
    const completed = await persistence.eval(completeSessionCloseTransition, {
      keys: [sessionKey(profileId, sessionId), pokemonHubRedisKeys.sessionTerminal(profileId, idempotencyKey)],
      arguments: [JSON.stringify({ fingerprint }), String(86_400)],
    })
    if (!['completed', 'replayed'].includes(completed?.[0])) throw sessionError('SESSION_INVALID', 'Workspace session could not be completed.')
    await persistence.removeFromSortedSet(expiringSessionIndexKey(), sessionMember(profileId, sessionId))
    return { status: 'complete' }
  }

  async function detach({ profileId, sessionId, sourceId, beforeDetach } = {}) {
    assertString(profileId, 'Profile ID'); assertString(sessionId, 'Session ID'); assertString(sourceId, 'Source ID')
    return enqueue(sessionId, async () => {
      const session = await requireLive(profileId, sessionId)
      const index = session.sources.findIndex(source => source.sourceId === sourceId)
      if (index === -1) throw sessionError('SESSION_SOURCE_INVALID', 'Session source is invalid.')
      const source = structuredClone(session.sources[index])
      if (beforeDetach) await beforeDetach(source)
      const expectedVersion = session.version
      session.sources.splice(index, 1)
      session.version += 1
      await writeOpenSession(session, expectedVersion)
      return { source, ...await compact(session) }
    })
  }

  async function close({ profileId, sessionId, allowExpired = false, beforeClose } = {}) {
    assertString(profileId, 'Profile ID'); assertString(sessionId, 'Session ID')
    return enqueue(sessionId, async () => {
      const session = await read(profileId, sessionId)
      if (!session || (!allowExpired && session.expiresAt <= now())) throw sessionError('SESSION_INVALID', 'Workspace session is invalid.')
      if (session.sources.length > 0) throw sessionError('SESSION_NOT_EMPTY', 'Workspace session still has open sources.')
      const sources = structuredClone(session.sources)
      if (beforeClose) await beforeClose(sources)
      await Promise.all([
        persistence.delete(sessionKey(profileId, sessionId)),
        persistence.removeFromSortedSet(expiringSessionIndexKey(), sessionMember(profileId, sessionId)),
      ])
      return sources
    })
  }

  async function listExpired() {
    const results = []
    const currentNow = now()
    const members = await persistence.rangeByScore(expiringSessionIndexKey(), 0, currentNow)
    for (const member of members) {
      const identity = parseSessionMember(member)
      if (!identity) {
        await persistence.removeFromSortedSet(expiringSessionIndexKey(), member)
        continue
      }
      const session = await read(identity.profileId, identity.sessionId)
      if (isProtectedSessionTransition(session) || isLiveSnapshotOperation(session?.activeOperation, currentNow)) continue
      if (!session || session.expiresAt > currentNow) {
        await persistence.removeFromSortedSet(expiringSessionIndexKey(), member)
        continue
      }
      results.push({ profileId: session.profileId, sessionId: session.sessionId })
    }
    return results
  }

  async function releaseExpired({ profileId, sessionId, beforeClose } = {}) {
    assertString(profileId, 'Profile ID'); assertString(sessionId, 'Session ID')
    return enqueue(sessionId, async () => {
      const session = await read(profileId, sessionId)
      if (!session || isProtectedSessionTransition(session) || isLiveSnapshotOperation(session.activeOperation, now()) || session.expiresAt > now()) return null
      const sources = structuredClone(session.sources)
      if (beforeClose) await beforeClose(sources)
      await Promise.all([
        persistence.delete(sessionKey(profileId, sessionId)),
        persistence.removeFromSortedSet(expiringSessionIndexKey(), sessionMember(profileId, sessionId)),
      ])
      return sources
    })
  }

  async function reject(session, sequence, code, { persist = true, fingerprint = null } = {}) {
    const response = { ok: false, code, sequence, ...await compact(session) }
    if (persist) await writeOperation(session.profileId, session.sessionId, sequence, fingerprint, response)
    return response
  }

  async function sourceResponse(session, sourceId, source) {
    return {
      sourceId,
      expiresAt: session.expiresAt,
      source: safeBootstrapSource(source, sourceId),
      ...await compact(session),
    }
  }

  async function compact(session) {
    const snapshots = await readSnapshots(session)
    const pokemonDisplay = {}
    const sources = session.sources.map(source => {
      const snapshot = snapshots.get(source.sourceId)
      Object.assign(pokemonDisplay, snapshot.pokemonDisplay ?? {})
      return { id: source.sourceId, occupied: snapshot.placements.flatMap((placement, slot) => placement.pokemonInstanceId ? [[slot, placement.pokemonInstanceId]] : []) }
    })
    return { snapshot: { sessionId: session.sessionId, version: session.version, sources }, pokemonDisplay }
  }

  async function readSnapshots(session) {
    const entries = await Promise.all(session.sources.map(async source => [source.sourceId, { sourceKey: source.sourceKey, ...await coordinator.getSnapshot({ profileId: session.profileId, sourceKey: source.sourceKey }) }]))
    return new Map(entries)
  }

  async function requireLive(profileId, sessionId) {
    const session = await read(profileId, sessionId)
    if (!session || session.expiresAt <= now() || session.state === 'closed' || session.state === 'closing') throw sessionError('SESSION_INVALID', 'Workspace session is invalid.')
    return session
  }
  async function read(profileId, sessionId) {
    const stored = await persistence.get(sessionKey(profileId, sessionId))
    return stored === null ? null : normalizePersistedSession(JSON.parse(stored))
  }
  async function write(session) {
    await Promise.all([
      persistence.set(sessionKey(session.profileId, session.sessionId), JSON.stringify(session)),
      persistence.addToSortedSet(expiringSessionIndexKey(), sessionMember(session.profileId, session.sessionId), session.expiresAt),
    ])
  }
  async function writeOpenSession(session, expectedVersion) {
    const result = await persistence.eval(replaceOpenSessionTransition, {
      keys: [sessionKey(session.profileId, session.sessionId)],
      arguments: [String(expectedVersion), JSON.stringify(session)],
    })
    if (result?.[0] === 'replaced') {
      await persistence.addToSortedSet(expiringSessionIndexKey(), sessionMember(session.profileId, session.sessionId), session.expiresAt)
      return
    }
    if (result?.[0] === 'busy') throw sessionError('SESSION_TRANSITION_IN_PROGRESS', 'Workspace session already has a state transition in progress.')
    if (result?.[0] === 'stale') throw sessionError('SNAPSHOT_STALE', 'Workspace session changed before it could be persisted.')
    throw sessionError('SESSION_INVALID', 'Workspace session is invalid.')
  }
  async function writeOperation(profileId, sessionId, sequence, fingerprint, response) {
    await persistence.set(operationKey(profileId, sessionId, sequence), JSON.stringify({ fingerprint, response }), { NX: true })
  }
  async function beginSnapshotOperation(session) {
    const rollback = structuredClone(session)
    const operation = {
      id: newId(),
      generation: (Number.isInteger(session.operationGeneration) ? session.operationGeneration : 0) + 1,
      deadline: now() + operationLeaseMs,
    }
    const candidate = structuredClone(session)
    candidate.schemaVersion = 3
    candidate.state = 'transitioning'
    candidate.operationGeneration = operation.generation
    candidate.operation = operation
    candidate.activeOperation = operation
    const result = await persistence.eval(claimSessionTransition, {
      keys: [sessionKey(session.profileId, session.sessionId)],
      arguments: [JSON.stringify(candidate)],
    })
    if (result?.[0] === 'busy') throw sessionError('SESSION_TRANSITION_IN_PROGRESS', 'Workspace session already has a state transition in progress.')
    if (result?.[0] !== 'claimed') throw sessionError('SESSION_INVALID', 'Workspace session is invalid.')
    Object.assign(session, candidate)
    return { ...operation, rollback }
  }
  async function commitSnapshotOperation(session, operation, { state = 'open', close = null } = {}) {
    const candidate = structuredClone(session)
    candidate.state = state
    if (close) candidate.close = structuredClone(close)
    else delete candidate.close
    delete candidate.operation
    delete candidate.activeOperation
    const result = await persistence.eval(commitSessionTransition, {
      keys: [sessionKey(session.profileId, session.sessionId)],
      arguments: [operation.id, String(operation.generation), JSON.stringify(candidate)],
    })
    if (result?.[0] !== 'committed') throw sessionError('SESSION_TRANSITION_FENCED', 'Workspace session transition was fenced.')
    Object.assign(session, candidate)
  }
  async function settleSnapshotOperation(profileId, sessionId, operation) {
    const rollback = structuredClone(operation.rollback)
    rollback.schemaVersion = 3
    rollback.state = 'open'
    rollback.expiresAt = now() + leaseMs
    delete rollback.operation
    delete rollback.activeOperation
    await persistence.eval(abortSessionTransition, {
      keys: [sessionKey(profileId, sessionId)],
      arguments: [operation.id, String(operation.generation), JSON.stringify(rollback)],
    })
  }

  async function canonicalReject(session, idempotencyKey, snapshot, fingerprint) {
    const response = { status: 'corrected', snapshot: structuredClone(snapshot) }
    await persistence.set(operationKey(session.profileId, session.sessionId, `canonical:${idempotencyKey}`), JSON.stringify({ fingerprint, response }), { NX: true })
    return response
  }
  async function snapshotsForSources(profileId, sources) {
    const results = await Promise.all([...sources].map(async source => [source.sourceKey, await coordinator.getSnapshot({ profileId, sourceKey: source.sourceKey })]))
    return new Map(results)
  }
  function enqueue(sessionId, operation) {
    const previous = queues.get(sessionId) ?? Promise.resolve()
    const next = previous.then(operation, operation)
    const queued = next.finally(() => { if (queues.get(sessionId) === queued) queues.delete(sessionId) })
    queues.set(sessionId, queued)
    return queued
  }
}

async function claimSessionTransitionMemory({ keys, arguments: args, get, set }) {
  const raw = await get(keys[0])
  if (raw === null) return ['missing']
  const session = JSON.parse(raw)
  if (session.state && session.state !== 'open') return ['busy']
  await set(keys[0], args[0])
  return ['claimed']
}

async function commitSessionTransitionMemory({ keys, arguments: args, get, set }) {
  const raw = await get(keys[0])
  if (raw === null) return ['missing']
  const session = JSON.parse(raw)
  const [operationId, generationText, candidateRaw] = args
  if (session.state !== 'transitioning' || session.operation?.id !== operationId || session.operation?.generation !== Number(generationText)) return ['fenced']
  await set(keys[0], candidateRaw)
  return ['committed']
}

async function completeSessionCloseTransitionMemory({ keys, arguments: args, get, set, delete: deleteKey }) {
  if (await get(keys[1]) !== null) return ['replayed']
  if (await get(keys[0]) === null) return ['missing']
  await set(keys[1], args[0], { EX: Number(args[1]) })
  await deleteKey(keys[0])
  return ['completed']
}

async function abortSessionTransitionMemory({ keys, arguments: args, get, set }) {
  const raw = await get(keys[0])
  if (raw === null) return ['missing']
  const session = JSON.parse(raw)
  const [operationId, generationText, rollbackRaw] = args
  if (session.state !== 'transitioning' || session.operation?.id !== operationId || session.operation?.generation !== Number(generationText)) return ['ignored']
  await set(keys[0], rollbackRaw)
  return ['aborted']
}

async function replaceOpenSessionTransitionMemory({ keys, arguments: args, get, set }) {
  const raw = await get(keys[0])
  if (raw === null) return ['missing']
  const current = JSON.parse(raw)
  if (current.state && current.state !== 'open') return ['busy']
  if ((current.version ?? 0) !== Number(args[0])) return ['stale']
  await set(keys[0], args[1])
  return ['replaced']
}

const nullPokemonHubLogger = Object.freeze({ info() {}, warn() {}, error() {} })

function normalizePokemonHubLogger(logger) {
  return logger && typeof logger.info === 'function' && typeof logger.warn === 'function' && typeof logger.error === 'function'
    ? logger
    : nullPokemonHubLogger
}

function summarizeCanonicalSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return { type: snapshot === null ? 'null' : typeof snapshot }
  const panes = Array.isArray(snapshot.panes) ? snapshot.panes : null
  return {
    revision: Number.isInteger(snapshot.revision) ? snapshot.revision : null,
    paneCount: panes?.length ?? null,
    panes: panes?.map(pane => pane === null ? null : {
      pane: pane.pane ?? null,
      profileType: pane.profile?.type ?? null,
      gameId: pane.profile?.gameId ?? null,
      hubProfileId: pane.profile?.hubProfileId ?? null,
      partyCount: Array.isArray(pane.party) ? pane.party.length : null,
      boxCount: Array.isArray(pane.boxes) ? pane.boxes.length : null,
      hubCount: Array.isArray(pane.hub) ? pane.hub.length : null,
    }) ?? null,
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

function normalizeLeasedSource(snapshot, sourceKey) {
  if (!snapshot || snapshot.sourceKey !== sourceKey || typeof snapshot.sourceSessionId !== 'string' || typeof snapshot.leaseToken !== 'string') throw new TypeError('Pokemon Hub source lease is invalid')
  return snapshot
}
function canonicalSnapshotForSession(session) {
  try { return validatePokemonHubCanonicalSnapshot(session.canonicalSnapshot) } catch { return createInitialPokemonHubCanonicalSnapshot() }
}
function normalizePersistedSession(session) {
  if (!session || typeof session !== 'object') return session
  session.sources = restoreRedisEmptyArray(session.sources)
  if (Array.isArray(session.canonicalSnapshot?.panes)) {
    for (const pane of session.canonicalSnapshot.panes) {
      if (!pane || typeof pane !== 'object') continue
      if ('party' in pane) pane.party = restoreRedisEmptyArray(pane.party)
      if ('boxes' in pane) pane.boxes = restoreRedisEmptyArray(pane.boxes)
      if ('hub' in pane) pane.hub = restoreRedisEmptyArray(pane.hub)
    }
  }
  return session
}
function restoreRedisEmptyArray(value) {
  return value && !Array.isArray(value) && typeof value === 'object' && Object.keys(value).length === 0 ? [] : value
}
function requestedCanonicalSources(snapshot, profileId) {
  const requested = new Map()
  for (const pane of snapshot.panes) {
    if (pane === null) continue
    const sourceKey = pane.profile.type === 'hub-profile'
      ? `hub:${pane.profile.hubProfileId}`
      : `save:${profileId}:${pane.profile.gameId}`
    requested.set(sourceKey, pane)
  }
  return requested
}
function placementsForCanonicalPane(source, pane) {
  const requested = new Map()
  const entries = pane.profile.type === 'hub-profile'
    ? pane.hub.map(entry => [{ kind: 'hub', slot: entry.slot }, entry.pokemonInstanceId])
    : [
      ...pane.party.map(entry => [{ kind: 'game', area: 'party', slot: entry.slot }, entry.pokemonInstanceId]),
      ...pane.boxes.map(entry => [{ kind: 'game', area: 'box', box: Math.floor(entry.slot / 30), slot: entry.slot % 30 }, entry.pokemonInstanceId]),
    ]
  for (const [location, pokemonInstanceId] of entries) requested.set(canonicalLocationKey(location), pokemonInstanceId)
  const expected = pane.profile.type === 'hub-profile' ? 'hub' : 'game'
  if (source.placements.some(placement => placement.location?.kind !== expected)) throw sessionError('SNAPSHOT_INVALID', 'Snapshot source type is invalid.')
  const placements = source.placements.map(placement => ({
    location: structuredClone(placement.location),
    pokemonInstanceId: requested.get(canonicalLocationKey(placement.location)) ?? null,
  }))
  for (const location of requested.keys()) {
    if (!source.placements.some(placement => canonicalLocationKey(placement.location) === location)) throw sessionError('SNAPSHOT_INVALID', 'Snapshot slot is invalid.')
  }
  return placements
}
function canonicalLocationKey(location) {
  if (location?.kind === 'hub') return `hub:${location.slot}`
  if (location?.kind === 'game' && location.area === 'party') return `party:${location.slot}`
  if (location?.kind === 'game' && location.area === 'box') return `box:${location.box * 30 + location.slot}`
  return ''
}
function samePokemonMembership(left, right) {
  const expected = new Set(left.filter(Boolean))
  const actual = new Set(right.filter(Boolean))
  return expected.size === actual.size && [...expected].every(pokemonInstanceId => actual.has(pokemonInstanceId))
}
function safeBootstrapSource(source, sourceId) {
  return {
    sourceId,
    sourceKey: source.sourceKey,
    sourceRevision: source.sourceRevision,
    snapshotRevision: source.snapshotRevision,
    adapter: source.adapter,
    placements: source.placements.map(placement => ({ location: structuredClone(placement.location), pokemonInstanceId: placement.pokemonInstanceId ?? null })),
    pokemonDisplay: structuredClone(source.pokemonDisplay ?? {}),
  }
}
function normalizeSnapshot(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.s)) throw new TypeError('Pokemon Hub snapshot is invalid')
  if (!Number.isInteger(value.n) || value.n < 1 || !Number.isInteger(value.v) || value.v < 0) throw new TypeError('Pokemon Hub snapshot version is invalid')
  const sourceIds = new Set()
  const sources = value.s.map(source => {
    if (!Array.isArray(source) || source.length !== 2 || typeof source[0] !== 'string' || !source[0] || !Array.isArray(source[1]) || sourceIds.has(source[0])) throw new TypeError('Pokemon Hub snapshot source is invalid')
    sourceIds.add(source[0])
    const slots = new Set()
    const occupied = source[1].map(entry => {
      if (!Array.isArray(entry) || entry.length !== 2 || !Number.isInteger(entry[0]) || entry[0] < 0 || typeof entry[1] !== 'string' || !entry[1] || slots.has(entry[0])) throw new TypeError('Pokemon Hub snapshot occupancy is invalid')
      slots.add(entry[0])
      return [entry[0], entry[1]]
    })
    occupied.sort((left, right) => left[0] - right[0])
    return { id: source[0], occupied }
  })
  sources.sort((left, right) => left.id.localeCompare(right.id))
  return { n: value.n, v: value.v, s: sources }
}
function snapshotFingerprint(snapshot) { return JSON.stringify(snapshot) }
function isRecoverableSnapshotError(error) { return ['SOURCE_SET_INCOMPLETE', 'LEASE_INVALID', 'SNAPSHOT_STALE', 'SNAPSHOT_INVALID', 'DUPLICATE_INSTANCE_CORRECTED', 'SAVE_MATERIALIZATION_UNSUPPORTED', 'POKEMON_UNAUTHORIZED', 'POKEMON_UNKNOWN', 'CROSS_SOURCE_OCCUPIED'].includes(error?.code) }
function isRecoverableCanonicalError(error) { return isRecoverableSnapshotError(error) || ['SOURCE_RESERVED', 'SOURCE_NOT_ADOPTED', 'SOURCE_FLUSH_PENDING', 'SOURCE_RELEASE_FAILED', 'SAVE_FLUSH_FAILED', 'SNAPSHOT_FORMAT_INVALID'].includes(error?.code) }
function sessionKey(profileId, sessionId) { return pokemonHubRedisKeys.session(profileId, sessionId) }
function expiringSessionIndexKey() { return pokemonHubRedisKeys.expiringSessionIndex() }
function sessionMember(profileId, sessionId) { return JSON.stringify([profileId, sessionId]) }
function parseSessionMember(member) {
  try {
    const [profileId, sessionId] = JSON.parse(member)
    return typeof profileId === 'string' && profileId.length > 0 && typeof sessionId === 'string' && sessionId.length > 0 ? { profileId, sessionId } : null
  } catch { return null }
}
function operationKey(profileId, sessionId, operationId) { return pokemonHubRedisKeys.sessionOperation(profileId, sessionId, operationId) }
function isLiveSnapshotOperation(operation, instant) {
  return Boolean(operation && typeof operation.id === 'string' && operation.id.length > 0 && Number.isInteger(operation.generation) && operation.generation > 0 && Number.isFinite(operation.deadline) && operation.deadline > instant)
}
function isProtectedSessionTransition(session) { return session?.state === 'transitioning' }
function sameSnapshotOperation(left, right) {
  return Boolean(left && right && left.id === right.id && left.generation === right.generation && left.deadline === right.deadline)
}
function assertString(value, label) { if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} is required`) }
function sessionError(code, message) { const error = new Error(message); error.code = code; return error }
