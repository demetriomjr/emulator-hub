import { randomUUID } from 'node:crypto'

export function createPokemonHubSessionService({ persistence, coordinator, now = () => Date.now(), newId = randomUUID, leaseMs = 9_000 } = {}) {
  if (!persistence || typeof persistence.get !== 'function' || typeof persistence.set !== 'function' || typeof persistence.delete !== 'function' || typeof persistence.addToSortedSet !== 'function' || typeof persistence.removeFromSortedSet !== 'function' || typeof persistence.rangeByScore !== 'function') throw new TypeError('Pokemon Hub session persistence is invalid')
  if (!coordinator || typeof coordinator.getSnapshot !== 'function' || typeof coordinator.renew !== 'function' || typeof coordinator.release !== 'function' || typeof coordinator.sync !== 'function' || typeof coordinator.reconcileWorkspaceLeases !== 'function') throw new TypeError('Pokemon Hub snapshot coordinator is invalid')
  const queues = new Map()

  return { open, attach, heartbeat, syncSnapshot, detach, close, listExpired, releaseExpired }

  async function open({ profileId }) {
    assertString(profileId, 'Profile ID')
    const session = { schemaVersion: 1, profileId, sessionId: newId(), version: 0, expiresAt: now() + leaseMs, sources: [] }
    await write(session)
    return { sessionId: session.sessionId, expiresAt: session.expiresAt, snapshot: { sessionId: session.sessionId, version: 0, sources: [] }, pokemonDisplay: {} }
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
        session.sources.push({ sourceId, sourceKey, sourceSessionId: source.sourceSessionId, leaseToken: source.leaseToken })
        session.version += 1
        session.expiresAt = now() + leaseMs
        await write(session)
        stored = true
        return await sourceResponse(session, sourceId, source)
      } catch (error) {
        if (stored) {
          session.sources = session.sources.filter(candidate => candidate.sourceId !== sourceId)
          session.version -= 1
          await write(session)
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
      for (const source of session.sources) await coordinator.renew({ profileId, sourceKey: source.sourceKey, workspaceId: sessionId, sourceSessionId: source.sourceSessionId, leaseToken: source.leaseToken })
      session.expiresAt = now() + leaseMs
      await write(session)
      return { ok: true, expiresAt: session.expiresAt }
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
      try {
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
        await write(session)
        const response = { ok: true, sequence: input.n, version: session.version }
        await writeOperation(profileId, sessionId, input.n, fingerprint, response)
        return { ...response, dirtySourceKeys: changedSources.map(source => source.sourceKey).filter(key => key.startsWith(`save:${profileId}:`)) }
      } catch (error) {
        if (isRecoverableSnapshotError(error)) return reject(session, input.n, error.code, { fingerprint })
        throw error
      }
    })
  }

  async function detach({ profileId, sessionId, sourceId, beforeDetach } = {}) {
    assertString(profileId, 'Profile ID'); assertString(sessionId, 'Session ID'); assertString(sourceId, 'Source ID')
    return enqueue(sessionId, async () => {
      const session = await requireLive(profileId, sessionId)
      const index = session.sources.findIndex(source => source.sourceId === sourceId)
      if (index === -1) throw sessionError('SESSION_SOURCE_INVALID', 'Session source is invalid.')
      const source = structuredClone(session.sources[index])
      if (beforeDetach) await beforeDetach(source)
      session.sources.splice(index, 1)
      session.version += 1
      await write(session)
      return { source, ...await compact(session) }
    })
  }

  async function close({ profileId, sessionId, allowExpired = false, beforeClose } = {}) {
    assertString(profileId, 'Profile ID'); assertString(sessionId, 'Session ID')
    return enqueue(sessionId, async () => {
      const session = await read(profileId, sessionId)
      if (!session || (!allowExpired && session.expiresAt <= now())) throw sessionError('SESSION_INVALID', 'Workspace session is invalid.')
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
    const members = await persistence.rangeByScore(expiringSessionIndexKey(), 0, now())
    for (const member of members) {
      const identity = parseSessionMember(member)
      if (!identity) {
        await persistence.removeFromSortedSet(expiringSessionIndexKey(), member)
        continue
      }
      const session = await read(identity.profileId, identity.sessionId)
      if (!session || session.expiresAt > now()) {
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
      if (!session || session.expiresAt > now()) return null
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
    if (!session || session.expiresAt <= now()) throw sessionError('SESSION_INVALID', 'Workspace session is invalid.')
    return session
  }
  async function read(profileId, sessionId) {
    const stored = await persistence.get(sessionKey(profileId, sessionId))
    return stored === null ? null : JSON.parse(stored)
  }
  async function write(session) {
    await Promise.all([
      persistence.set(sessionKey(session.profileId, session.sessionId), JSON.stringify(session)),
      persistence.addToSortedSet(expiringSessionIndexKey(), sessionMember(session.profileId, session.sessionId), session.expiresAt),
    ])
  }
  async function writeOperation(profileId, sessionId, sequence, fingerprint, response) {
    await persistence.set(operationKey(profileId, sessionId, sequence), JSON.stringify({ fingerprint, response }), { NX: true })
  }
  function enqueue(sessionId, operation) {
    const previous = queues.get(sessionId) ?? Promise.resolve()
    const next = previous.then(operation, operation)
    const queued = next.finally(() => { if (queues.get(sessionId) === queued) queues.delete(sessionId) })
    queues.set(sessionId, queued)
    return queued
  }
}

function normalizeLeasedSource(snapshot, sourceKey) {
  if (!snapshot || snapshot.sourceKey !== sourceKey || typeof snapshot.sourceSessionId !== 'string' || typeof snapshot.leaseToken !== 'string') throw new TypeError('Pokemon Hub source lease is invalid')
  return snapshot
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
function isRecoverableSnapshotError(error) { return ['SOURCE_SET_INCOMPLETE', 'LEASE_INVALID', 'SNAPSHOT_STALE', 'SNAPSHOT_INVALID', 'DUPLICATE_INSTANCE_CORRECTED', 'SAVE_MATERIALIZATION_UNSUPPORTED', 'POKEMON_UNAUTHORIZED', 'POKEMON_UNKNOWN'].includes(error?.code) }
function sessionKey(profileId, sessionId) { return `pokemon-hub:session:${encodeURIComponent(profileId)}:${encodeURIComponent(sessionId)}` }
function expiringSessionIndexKey() { return 'pokemon-hub:expiring-session' }
function sessionMember(profileId, sessionId) { return JSON.stringify([profileId, sessionId]) }
function parseSessionMember(member) {
  try {
    const [profileId, sessionId] = JSON.parse(member)
    return typeof profileId === 'string' && profileId.length > 0 && typeof sessionId === 'string' && sessionId.length > 0 ? { profileId, sessionId } : null
  } catch { return null }
}
function operationKey(profileId, sessionId, operationId) { return `pokemon-hub:session-operation:${encodeURIComponent(profileId)}:${encodeURIComponent(sessionId)}:${encodeURIComponent(operationId)}` }
function assertString(value, label) { if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} is required`) }
function sessionError(code, message) { const error = new Error(message); error.code = code; return error }
