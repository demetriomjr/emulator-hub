import assert from 'node:assert/strict'
import test from 'node:test'

import { createPokemonHubEventStore } from './pokemon-hub-event-store.mjs'
import { createPokemonHubSessionService } from './pokemon-hub-session-service.mjs'
import { createPokemonHubSnapshotCoordinator } from './pokemon-hub-snapshot-coordinator.mjs'
import { createMemoryRedisPersistence } from './redis-persistence.mjs'

const profileId = 'profile-may'
const sourceKey = 'save:profile-may:emerald'

test('finds expired sessions through the expiry index without scanning the Redis keyspace', async () => {
  let instant = 1_000
  const memory = createMemoryRedisPersistence()
  const persistence = {
    ...memory,
    async keys() { throw new Error('Expired session observation must not scan Redis') },
  }
  const coordinator = createPokemonHubSnapshotCoordinator({ persistence, eventStore: createPokemonHubEventStore({ persistence }) })
  const service = createPokemonHubSessionService({ persistence, coordinator, now: () => instant, leaseMs: 9, newId: () => 'session-a' })
  await service.open({ profileId })
  instant = 1_009

  const expired = await service.listExpired()

  assert.deepEqual(expired, [{ profileId, sessionId: 'session-a' }])
})

test('attaching a source returns its complete safe bootstrap data separately from compact session state', async () => {
  const persistence = createMemoryRedisPersistence()
  const coordinator = createPokemonHubSnapshotCoordinator({
    persistence,
    eventStore: createPokemonHubEventStore({ persistence }),
  })
  const adopted = await coordinator.adopt({
    profileId,
    sourceKey,
    sourceRevision: 1,
    adapter: 'gen3-gba-v1',
    slots: [
      { location: { kind: 'game', area: 'box', box: 0, slot: 0 }, record: { representation: { adapter: 'gen3-gba-v1', kind: 'pc-record', bytes: Buffer.alloc(80, 7) }, display: { species: 289, shiny: false, nature: 'lonely' } } },
      { location: { kind: 'game', area: 'box', box: 0, slot: 1 }, record: null },
    ],
  })
  const lease = await coordinator.acquire({ profileId, sourceKey, workspaceId: 'workspace-a' })
  const service = createPokemonHubSessionService({ persistence, coordinator, newId: (() => { let value = 0; return () => `session-${++value}` })() })
  const opened = await service.open({ profileId })

  const attached = await service.attach({ profileId, sessionId: opened.sessionId, sourceKey, sourceSnapshot: lease })

  assert.deepEqual(attached.source, {
    sourceId: attached.sourceId,
    sourceKey,
    sourceRevision: adopted.sourceRevision,
    snapshotRevision: adopted.snapshotRevision,
    adapter: adopted.adapter,
    placements: adopted.placements,
    pokemonDisplay: adopted.pokemonDisplay,
  })
  assert.deepEqual(attached.snapshot.sources, [{ id: attached.sourceId, occupied: [[0, adopted.placements[0].pokemonInstanceId]] }])
})

test('acquires a new source only inside the serialized live session attach operation', async () => {
  const persistence = createMemoryRedisPersistence()
  const coordinator = createPokemonHubSnapshotCoordinator({ persistence, eventStore: createPokemonHubEventStore({ persistence }) })
  await coordinator.adopt({ profileId, sourceKey, sourceRevision: 1, adapter: 'gen3-gba-v1', slots: [{ location: { kind: 'game', area: 'box', box: 0, slot: 0 }, record: null }] })
  const service = createPokemonHubSessionService({ persistence, coordinator, newId: (() => { let value = 0; return () => `session-${++value}` })() })
  const opened = await service.open({ profileId })
  let acquisitions = 0

  const attached = await service.attach({
    profileId,
    sessionId: opened.sessionId,
    sourceKey,
    acquireSource: async () => {
      acquisitions += 1
      return coordinator.acquire({ profileId, sourceKey, workspaceId: opened.sessionId })
    },
  })

  assert.equal(acquisitions, 1)
  assert.equal(attached.source.sourceKey, sourceKey)
})

test('accepts a complete compact snapshot and returns an acknowledgement without bootstrap data', async () => {
  const persistence = createMemoryRedisPersistence()
  const coordinator = createPokemonHubSnapshotCoordinator({
    persistence,
    eventStore: createPokemonHubEventStore({ persistence }),
  })
  const adopted = await coordinator.adopt({
    profileId,
    sourceKey,
    sourceRevision: 1,
    adapter: 'gen3-gba-v1',
    slots: [
      { location: { kind: 'game', area: 'box', box: 0, slot: 0 }, record: { representation: { adapter: 'gen3-gba-v1', kind: 'pc-record', bytes: Buffer.alloc(80, 7) }, display: { species: 289, shiny: false } } },
      { location: { kind: 'game', area: 'box', box: 0, slot: 1 }, record: null },
    ],
  })
  const service = createPokemonHubSessionService({ persistence, coordinator, newId: (() => { let value = 0; return () => `session-${++value}` })() })
  const opened = await service.open({ profileId })
  const lease = await coordinator.acquire({ profileId, sourceKey, workspaceId: opened.sessionId })
  const attached = await service.attach({ profileId, sessionId: opened.sessionId, sourceKey, sourceSnapshot: lease })
  const pokemonInstanceId = adopted.placements[0].pokemonInstanceId

  const result = await service.syncSnapshot({
    profileId,
    sessionId: opened.sessionId,
    snapshot: { n: 1, v: attached.snapshot.version, s: [[attached.sourceId, [[1, pokemonInstanceId]]]] },
  })

  const { dirtySourceKeys, ...acknowledgement } = result
  assert.deepEqual(acknowledgement, { ok: true, sequence: 1, version: attached.snapshot.version + 1 })
  assert.deepEqual(dirtySourceKeys, [sourceKey])
  assert.equal('snapshot' in acknowledgement, false)
  assert.equal('pokemonDisplay' in acknowledgement, false)
  assert.deepEqual((await coordinator.getSnapshot({ profileId, sourceKey })).placements.map(placement => placement.pokemonInstanceId), [null, pokemonInstanceId])
})

test('reconciles an orphaned lease before accepting the first changed compact snapshot', async () => {
  const persistence = createMemoryRedisPersistence()
  const coordinator = createPokemonHubSnapshotCoordinator({ persistence, eventStore: createPokemonHubEventStore({ persistence }) })
  const first = await coordinator.adopt({
    profileId,
    sourceKey,
    sourceRevision: 1,
    adapter: 'gen3-gba-v1',
    slots: [
      { location: { kind: 'game', area: 'box', box: 0, slot: 0 }, record: { representation: { adapter: 'gen3-gba-v1', kind: 'pc-record', bytes: Buffer.alloc(80, 7) }, display: { species: 289 } } },
      { location: { kind: 'game', area: 'box', box: 0, slot: 1 }, record: null },
    ],
  })
  const orphanSourceKey = 'hub:orphan-grid'
  await coordinator.adopt({
    profileId,
    sourceKey: orphanSourceKey,
    sourceRevision: 1,
    adapter: 'hub-grid-v1',
    slots: [{ location: { kind: 'hub', hubProfileId: 'orphan-grid', slot: 0 }, record: null }],
  })
  const service = createPokemonHubSessionService({ persistence, coordinator, newId: (() => { let value = 0; return () => `session-${++value}` })() })
  const opened = await service.open({ profileId })
  const [lease] = await Promise.all([
    coordinator.acquire({ profileId, sourceKey, workspaceId: opened.sessionId }),
    coordinator.acquire({ profileId, sourceKey: orphanSourceKey, workspaceId: opened.sessionId }),
  ])
  const attached = await service.attach({ profileId, sessionId: opened.sessionId, sourceKey, sourceSnapshot: lease })
  const pokemonInstanceId = first.placements[0].pokemonInstanceId

  const accepted = await service.syncSnapshot({
    profileId,
    sessionId: opened.sessionId,
    snapshot: { n: 1, v: attached.snapshot.version, s: [[attached.sourceId, [[1, pokemonInstanceId]]]] },
  })

  assert.deepEqual(accepted, { ok: true, sequence: 1, version: 2, dirtySourceKeys: [sourceKey] })
  const reacquired = await coordinator.acquire({ profileId, sourceKey: orphanSourceKey, workspaceId: 'other-workspace' })
  assert.equal(reacquired.sourceKey, orphanSourceKey)
})

test('rejects a conflicting compact payload that reuses an acknowledged sequence', async () => {
  const persistence = createMemoryRedisPersistence()
  const coordinator = createPokemonHubSnapshotCoordinator({ persistence, eventStore: createPokemonHubEventStore({ persistence }) })
  const adopted = await coordinator.adopt({
    profileId,
    sourceKey,
    sourceRevision: 1,
    adapter: 'gen3-gba-v1',
    slots: [
      { location: { kind: 'game', area: 'box', box: 0, slot: 0 }, record: { representation: { adapter: 'gen3-gba-v1', kind: 'pc-record', bytes: Buffer.alloc(80, 7) }, display: { species: 289 } } },
      { location: { kind: 'game', area: 'box', box: 0, slot: 1 }, record: null },
    ],
  })
  const service = createPokemonHubSessionService({ persistence, coordinator, newId: (() => { let value = 0; return () => `session-${++value}` })() })
  const opened = await service.open({ profileId })
  const lease = await coordinator.acquire({ profileId, sourceKey, workspaceId: opened.sessionId })
  const attached = await service.attach({ profileId, sessionId: opened.sessionId, sourceKey, sourceSnapshot: lease })
  const pokemonInstanceId = adopted.placements[0].pokemonInstanceId
  await service.syncSnapshot({ profileId, sessionId: opened.sessionId, snapshot: { n: 1, v: attached.snapshot.version, s: [[attached.sourceId, [[1, pokemonInstanceId]]]] } })

  const conflicting = await service.syncSnapshot({ profileId, sessionId: opened.sessionId, snapshot: { n: 1, v: attached.snapshot.version, s: [[attached.sourceId, [[0, pokemonInstanceId]]]] } })

  assert.equal(conflicting.ok, false)
  assert.equal(conflicting.code, 'SNAPSHOT_INVALID')
  assert.deepEqual(conflicting.snapshot.sources, [{ id: attached.sourceId, occupied: [[1, pokemonInstanceId]] }])
})

test('returns a compact authority correction when placement policy rejects a move', async () => {
  const persistence = createMemoryRedisPersistence()
  const coordinator = createPokemonHubSnapshotCoordinator({
    persistence,
    eventStore: createPokemonHubEventStore({ persistence }),
    validatePlacementChange() {
      const error = new Error('This placement cannot be materialized.')
      error.code = 'SAVE_MATERIALIZATION_UNSUPPORTED'
      throw error
    },
  })
  const adopted = await coordinator.adopt({
    profileId,
    sourceKey,
    sourceRevision: 1,
    adapter: 'gen3-gba-v1',
    slots: [
      { location: { kind: 'game', area: 'box', box: 0, slot: 0 }, record: { representation: { adapter: 'gen3-gba-v1', kind: 'pc-record', bytes: Buffer.alloc(80, 7) }, display: { species: 289 } } },
      { location: { kind: 'game', area: 'box', box: 0, slot: 1 }, record: null },
    ],
  })
  const service = createPokemonHubSessionService({ persistence, coordinator, newId: (() => { let value = 0; return () => `session-${++value}` })() })
  const opened = await service.open({ profileId })
  const lease = await coordinator.acquire({ profileId, sourceKey, workspaceId: opened.sessionId })
  const attached = await service.attach({ profileId, sessionId: opened.sessionId, sourceKey, sourceSnapshot: lease })
  const pokemonInstanceId = adopted.placements[0].pokemonInstanceId

  const rejected = await service.syncSnapshot({
    profileId,
    sessionId: opened.sessionId,
    snapshot: { n: 1, v: attached.snapshot.version, s: [[attached.sourceId, [[1, pokemonInstanceId]]]] },
  })

  assert.equal(rejected.ok, false)
  assert.equal(rejected.code, 'SAVE_MATERIALIZATION_UNSUPPORTED')
  assert.deepEqual(rejected.snapshot.sources, [{ id: attached.sourceId, occupied: [[0, pokemonInstanceId]] }])
  assert.deepEqual((await coordinator.getSnapshot({ profileId, sourceKey })).placements.map(placement => placement.pokemonInstanceId), [pokemonInstanceId, null])
})
