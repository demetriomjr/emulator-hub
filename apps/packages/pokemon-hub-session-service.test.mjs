import assert from 'node:assert/strict'
import test from 'node:test'

import { createPokemonHubEventStore } from './pokemon-hub-event-store.mjs'
import { createPokemonHubSessionService } from './pokemon-hub-session-service.mjs'
import { createPokemonHubSnapshotCoordinator } from './pokemon-hub-snapshot-coordinator.mjs'
import { validatePokemonHubTransferPlacement } from './pokemon-hub-transfer-placement-policy.mjs'
import { pokemonHubRedisKeys } from './pokemon-hub-redis-keys.mjs'
import { createMemoryRedisPersistence } from './redis-persistence.mjs'

const profileId = 'profile-may'
const sourceKey = 'save:profile-may:emerald'

test('opens a session with the persisted canonical three-pane snapshot', async () => {
  let instant = 1_000
  const persistence = createMemoryRedisPersistence()
  const coordinator = createPokemonHubSnapshotCoordinator({ persistence, eventStore: createPokemonHubEventStore({ persistence }) })
  const service = createPokemonHubSessionService({ persistence, coordinator, now: () => instant, leaseMs: 9, newId: () => 'session-a' })

  const opened = await service.open({ profileId })

  assert.deepEqual(opened, {
    sessionId: 'session-a',
    serverNow: 1_000,
    expiresAt: 1_009,
    snapshot: { revision: 0, panes: [null, null, null] },
  })
})

test('returns a fresh server clock sample when renewing a session heartbeat', async () => {
  let instant = 1_000
  const persistence = createMemoryRedisPersistence()
  const coordinator = createPokemonHubSnapshotCoordinator({ persistence, eventStore: createPokemonHubEventStore({ persistence }) })
  const service = createPokemonHubSessionService({ persistence, coordinator, now: () => instant, leaseMs: 9, newId: () => 'session-a' })
  const opened = await service.open({ profileId })
  instant = 1_005

  const renewed = await service.heartbeat({ profileId, sessionId: opened.sessionId, sequence: 1 })

  assert.deepEqual(renewed, { serverNow: 1_005, expiresAt: 1_014 })
})

test('preserves empty session arrays across Redis Lua transitions', async () => {
  let instant = 1_000
  const persistence = createRedisCjsonPersistence()
  const coordinator = createPokemonHubSnapshotCoordinator({ persistence, eventStore: createPokemonHubEventStore({ persistence }) })
  const service = createPokemonHubSessionService({ persistence, coordinator, now: () => instant, leaseMs: 9, newId: () => 'session-empty-arrays' })
  const opened = await service.open({ profileId })

  instant = 1_001
  assert.deepEqual(await service.heartbeat({ profileId, sessionId: opened.sessionId, sequence: 1 }), { serverNow: 1_001, expiresAt: 1_010 })
  instant = 1_002
  assert.deepEqual(await service.heartbeat({ profileId, sessionId: opened.sessionId, sequence: 2 }), { serverNow: 1_002, expiresAt: 1_011 })
  assert.deepEqual(await service.getCanonicalSnapshot({ profileId, sessionId: opened.sessionId }), { revision: 0, panes: [null, null, null] })
})

test('repairs empty arrays corrupted by an older Redis Lua round trip', async () => {
  const persistence = createMemoryRedisPersistence()
  const coordinator = createPokemonHubSnapshotCoordinator({ persistence, eventStore: createPokemonHubEventStore({ persistence }) })
  const service = createPokemonHubSessionService({ persistence, coordinator, now: () => 1_000, leaseMs: 9, newId: () => 'session-legacy-empty-object' })
  const opened = await service.open({ profileId })
  const key = pokemonHubRedisKeys.session(profileId, opened.sessionId)
  const corrupted = JSON.parse(await persistence.get(key))
  corrupted.sources = {}
  await persistence.set(key, JSON.stringify(corrupted))

  assert.deepEqual(await service.heartbeat({ profileId, sessionId: opened.sessionId, sequence: 1 }), { serverNow: 1_000, expiresAt: 1_009 })
  assert.deepEqual(JSON.parse(await persistence.get(key)).sources, [])
})

test('queues whole-session close behind an earlier snapshot and rebases its final intent', async () => {
  const persistence = createMemoryRedisPersistence()
  let releaseSync
  let syncStarted
  const started = new Promise(resolve => { syncStarted = resolve })
  const blocked = new Promise(resolve => { releaseSync = resolve })
  const coordinator = {
    async getSnapshot() { throw new Error('empty snapshot has no sources') },
    async renew() {},
    async release() {},
    async reconcileWorkspaceLeases() {},
    async sync() {
      syncStarted()
      await blocked
      return { status: 'accepted' }
    },
  }
  let id = 0
  const service = createPokemonHubSessionService({ persistence, coordinator, newId: () => `operation-${++id}` })
  const opened = await service.open({ profileId })

  const snapshotPromise = service.syncCanonicalSnapshot({
    profileId,
    sessionId: opened.sessionId,
    idempotencyKey: 'snapshot-1',
    snapshot: { revision: 0, panes: [null, null, null] },
    acquireSource: async () => { throw new Error('must not acquire') },
    flushOutgoingSource: async () => { throw new Error('must not flush') },
    releaseSource: async () => { throw new Error('must not release') },
  })
  await started

  const closing = service.closeCanonicalSession({
    profileId,
    sessionId: opened.sessionId,
    idempotencyKey: 'close-0',
    snapshot: { revision: 0, panes: [null, null, null] },
    acquireSource: async () => { throw new Error('must not acquire') },
    flushOutgoingSource: async () => { throw new Error('must not flush') },
    releaseSource: async () => { throw new Error('must not release') },
  })

  releaseSync()
  assert.deepEqual(await snapshotPromise, { status: 'accepted', dirtySourceKeys: [] })
  assert.deepEqual(await closing, { status: 'complete' })
  assert.deepEqual(await service.closeCanonicalSession({
    profileId,
    sessionId: opened.sessionId,
    idempotencyKey: 'close-0',
    snapshot: { revision: 0, panes: [null, null, null] },
    acquireSource: async () => { throw new Error('a completed close must not acquire') },
    flushOutgoingSource: async () => { throw new Error('a completed close must not flush again') },
    releaseSource: async () => { throw new Error('a completed close must not release again') },
  }), { status: 'complete' })
  await assert.rejects(() => service.getCanonicalSnapshot({ profileId, sessionId: opened.sessionId }), { code: 'SESSION_INVALID' })
})

test('a snapshot queued after whole-session close cannot reopen the session', async () => {
  const persistence = createMemoryRedisPersistence()
  const coordinator = {
    async getSnapshot() { throw new Error('empty snapshot has no sources') },
    async renew() {},
    async release() {},
    async reconcileWorkspaceLeases() {},
    async sync() { return { status: 'accepted' } },
  }
  const service = createPokemonHubSessionService({ persistence, coordinator, newId: (() => { let id = 0; return () => `close-first-${++id}` })() })
  const opened = await service.open({ profileId })
  const closing = service.closeCanonicalSession({
    profileId,
    sessionId: opened.sessionId,
    idempotencyKey: 'close-first',
    snapshot: { revision: 0, panes: [null, null, null] },
    acquireSource: async () => { throw new Error('must not acquire') },
    flushOutgoingSource: async () => { throw new Error('must not flush') },
    releaseSource: async () => { throw new Error('must not release') },
  })
  const staleSnapshot = service.syncCanonicalSnapshot({
    profileId,
    sessionId: opened.sessionId,
    idempotencyKey: 'late-snapshot',
    snapshot: { revision: 0, panes: [null, null, null] },
    acquireSource: async () => { throw new Error('must not acquire') },
    flushOutgoingSource: async () => { throw new Error('must not flush') },
    releaseSource: async () => { throw new Error('must not release') },
  })

  assert.deepEqual(await closing, { status: 'complete' })
  await assert.rejects(staleSnapshot, { code: 'SESSION_INVALID' })
})

test('keeps a whole-session close protected across service instances until finalization completes', async () => {
  const persistence = createMemoryRedisPersistence()
  const coordinator = createPokemonHubSnapshotCoordinator({ persistence, eventStore: createPokemonHubEventStore({ persistence }) })
  const hubProfileId = 'hub-close-lock'
  const hubSourceKey = `hub:${hubProfileId}`
  await coordinator.ensureHubSource({ profileId, sourceKey: hubSourceKey, hubProfileId, minimumSlotCount: 1 })
  let nextId = 0
  const first = createPokemonHubSessionService({ persistence, coordinator, newId: () => `close-lock-${++nextId}` })
  const second = createPokemonHubSessionService({ persistence, coordinator, newId: () => `close-lock-${++nextId}` })
  const opened = await first.open({ profileId })
  const pane = { pane: 0, profile: { type: 'hub-profile', hubProfileId }, hub: [] }
  const lifecycle = {
    acquireSource: sourceKey => coordinator.acquire({ profileId, sourceKey, workspaceId: opened.sessionId }),
    flushOutgoingSource: async () => {},
    releaseSource: source => coordinator.release({ profileId, sourceKey: source.sourceKey, workspaceId: opened.sessionId, sourceSessionId: source.sourceSessionId, leaseToken: source.leaseToken }),
  }
  await first.syncCanonicalSnapshot({ profileId, sessionId: opened.sessionId, idempotencyKey: 'open-close-lock', snapshot: { revision: 0, panes: [pane, null, null] }, ...lifecycle })

  let flushStarted
  const started = new Promise(resolve => { flushStarted = resolve })
  let releaseFlush
  const blocked = new Promise(resolve => { releaseFlush = resolve })
  const closing = first.closeCanonicalSession({
    profileId,
    sessionId: opened.sessionId,
    idempotencyKey: 'close-lock',
    snapshot: { revision: 1, panes: [pane, null, null] },
    acquireSource: lifecycle.acquireSource,
    flushOutgoingSource: async () => { flushStarted(); await blocked },
    releaseSource: lifecycle.releaseSource,
  })
  await started

  await assert.rejects(() => second.syncCanonicalSnapshot({
    profileId,
    sessionId: opened.sessionId,
    idempotencyKey: 'concurrent-snapshot',
    snapshot: { revision: 2, panes: [pane, null, null] },
    ...lifecycle,
  }), { code: 'SESSION_INVALID' })

  releaseFlush()
  assert.deepEqual(await closing, { status: 'complete' })
})

test('emits correlated lifecycle logs for a canonical snapshot', async () => {
  const persistence = createMemoryRedisPersistence()
  const coordinator = createPokemonHubSnapshotCoordinator({ persistence, eventStore: createPokemonHubEventStore({ persistence }) })
  const events = []
  const logger = { info: (event, context) => events.push({ event, context }), warn: () => {}, error: () => {} }
  const service = createPokemonHubSessionService({ persistence, coordinator, logger, newId: (() => { let value = 0; return () => `log-${++value}` })() })
  const opened = await service.open({ profileId })

  const result = await service.syncCanonicalSnapshot({
    profileId,
    sessionId: opened.sessionId,
    idempotencyKey: 'log-canonical-snapshot',
    snapshot: { revision: 0, panes: [null, null, null] },
    acquireSource: async () => { throw new Error('must not acquire an empty snapshot') },
    flushOutgoingSource: async () => { throw new Error('must not flush an empty snapshot') },
    releaseSource: async () => { throw new Error('must not release an empty snapshot') },
  })

  assert.deepEqual(result, { status: 'accepted', dirtySourceKeys: [] })
  assert.deepEqual(events.map(entry => entry.event), [
    'snapshot.canonical.received',
    'snapshot.canonical.session-loaded',
    'snapshot.canonical.operation-started',
    'snapshot.canonical.sources-requested',
    'snapshot.canonical.coordinator-sync-started',
    'snapshot.coordinator.received',
    'snapshot.coordinator.leases-verified',
    'snapshot.coordinator.identity-validated',
    'snapshot.coordinator.placement-policy-started',
    'snapshot.coordinator.placement-policy-finished',
    'snapshot.coordinator.accepted',
    'snapshot.canonical.coordinator-sync-finished',
    'snapshot.canonical.session-persisted',
    'snapshot.canonical.accepted',
    'snapshot.canonical.operation-settled',
  ])
  assert.equal(events[0].context.idempotencyKey, 'log-canonical-snapshot')
  assert.equal(events[0].context.sessionId, opened.sessionId)
})

test('commits a canonical snapshot without exposing lease internals and releases a closed source only after acceptance', async () => {
  const persistence = createMemoryRedisPersistence()
  const coordinator = createPokemonHubSnapshotCoordinator({ persistence, eventStore: createPokemonHubEventStore({ persistence }) })
  const service = createPokemonHubSessionService({ persistence, coordinator, newId: (() => { let value = 0; return () => `canonical-${++value}` })() })
  await coordinator.adopt({
    profileId,
    sourceKey,
    sourceRevision: 1,
    adapter: 'gen3-gba-v1',
    slots: [
      { location: { kind: 'game', area: 'party', slot: 0 }, record: { representation: { adapter: 'gen3-gba-v1', kind: 'party-record', bytes: Buffer.alloc(100, 1) }, display: { species: 289 } } },
      ...Array.from({ length: 420 }, (_, slot) => ({ location: { kind: 'game', area: 'box', box: Math.floor(slot / 30), slot: slot % 30 }, record: null })),
    ],
  })
  const opened = await service.open({ profileId })
  const acquired = []
  const released = []
  const result = await service.syncCanonicalSnapshot({
    profileId,
    sessionId: opened.sessionId,
    idempotencyKey: 'canonical-open-close',
    snapshot: {
      revision: 0,
      panes: [
        { pane: 0, profile: { type: 'save', gameId: 'emerald' }, party: [{ pokemonInstanceId: (await coordinator.getSnapshot({ profileId, sourceKey })).placements[0].pokemonInstanceId, slot: 0 }], boxes: [] },
        null,
        null,
      ],
    },
    acquireSource: async requestedSourceKey => {
      acquired.push(requestedSourceKey)
      return coordinator.acquire({ profileId, sourceKey: requestedSourceKey, workspaceId: opened.sessionId })
    },
    flushOutgoingSource: async () => { throw new Error('must not flush an opened source') },
    releaseSource: async source => {
      released.push(source.sourceKey)
      return coordinator.release({ profileId, sourceKey: source.sourceKey, workspaceId: opened.sessionId, sourceSessionId: source.sourceSessionId, leaseToken: source.leaseToken })
    },
  })

  assert.deepEqual(result, { status: 'accepted', dirtySourceKeys: [] })
  assert.deepEqual(acquired, [sourceKey])
  assert.deepEqual(released, [])
  assert.deepEqual(await service.syncCanonicalSnapshot({
    profileId, sessionId: opened.sessionId, idempotencyKey: 'canonical-open-close',
    snapshot: {
      revision: 0,
      panes: [{ pane: 0, profile: { type: 'save', gameId: 'emerald' }, party: [{ pokemonInstanceId: (await coordinator.getSnapshot({ profileId, sourceKey })).placements[0].pokemonInstanceId, slot: 0 }], boxes: [] }, null, null],
    },
    acquireSource: async () => { throw new Error('must not reacquire') },
    flushOutgoingSource: async () => { throw new Error('must not flush') },
    releaseSource: async () => { throw new Error('must not release') },
  }), { status: 'accepted', dirtySourceKeys: [] })

  const originalSync = coordinator.sync
  let heldUntilCommit = false
  coordinator.sync = async request => {
    if (request.retiredSourceKeys?.includes(sourceKey)) {
      await assert.rejects(
        () => coordinator.acquire({ profileId, sourceKey, workspaceId: 'other-workspace' }),
        { code: 'SOURCE_RESERVED' },
      )
      heldUntilCommit = true
    }
    return originalSync(request)
  }
  const closed = await service.syncCanonicalSnapshot({
    profileId,
    sessionId: opened.sessionId,
    idempotencyKey: 'canonical-close',
    snapshot: { revision: 1, panes: [null, null, null] },
    acquireSource: async requestedSourceKey => coordinator.acquire({ profileId, sourceKey: requestedSourceKey, workspaceId: opened.sessionId }),
    flushOutgoingSource: async source => { released.push(`flushed:${source.sourceKey}`) },
    releaseSource: async source => {
      released.push(source.sourceKey)
      return coordinator.release({ profileId, sourceKey: source.sourceKey, workspaceId: opened.sessionId, sourceSessionId: source.sourceSessionId, leaseToken: source.leaseToken })
    },
  })

  assert.deepEqual(closed, { status: 'accepted', dirtySourceKeys: [] })
  assert.equal(heldUntilCommit, true)
  assert.deepEqual(released, [`flushed:${sourceKey}`, sourceKey])
  assert.deepEqual(await service.getCanonicalSnapshot({ profileId, sessionId: opened.sessionId }), { revision: 2, panes: [null, null, null] })
})

test('closes a Hub pane through the canonical snapshot without attempting a save flush', async () => {
  const persistence = createMemoryRedisPersistence()
  const coordinator = createPokemonHubSnapshotCoordinator({ persistence, eventStore: createPokemonHubEventStore({ persistence }) })
  const service = createPokemonHubSessionService({ persistence, coordinator, newId: (() => { let value = 0; return () => `hub-close-${++value}` })() })
  const hubProfileId = 'hub-profile-a'
  const hubSourceKey = `hub:${hubProfileId}`
  await coordinator.ensureHubSource({ profileId, sourceKey: hubSourceKey, hubProfileId, minimumSlotCount: 1 })
  const opened = await service.open({ profileId })
  const released = []

  assert.deepEqual(await service.syncCanonicalSnapshot({
    profileId,
    sessionId: opened.sessionId,
    idempotencyKey: 'hub-open',
    snapshot: { revision: 0, panes: [{ pane: 0, profile: { type: 'hub-profile', hubProfileId }, hub: [] }, null, null] },
    acquireSource: requestedSourceKey => coordinator.acquire({ profileId, sourceKey: requestedSourceKey, workspaceId: opened.sessionId }),
    flushOutgoingSource: async () => { throw new Error('A newly opened Hub profile must not be flushed.') },
    releaseSource: async source => coordinator.release({ profileId, sourceKey: source.sourceKey, workspaceId: opened.sessionId, sourceSessionId: source.sourceSessionId, leaseToken: source.leaseToken }),
  }), { status: 'accepted', dirtySourceKeys: [] })

  assert.deepEqual(await service.syncCanonicalSnapshot({
    profileId,
    sessionId: opened.sessionId,
    idempotencyKey: 'hub-close',
    snapshot: { revision: 1, panes: [null, null, null] },
    acquireSource: async () => { throw new Error('The closing snapshot must not acquire a source.') },
    flushOutgoingSource: async () => { throw new Error('A Hub profile has no save file to flush.') },
    releaseSource: async source => {
      released.push(source.sourceKey)
      return coordinator.release({ profileId, sourceKey: source.sourceKey, workspaceId: opened.sessionId, sourceSessionId: source.sourceSessionId, leaseToken: source.leaseToken })
    },
  }), { status: 'accepted', dirtySourceKeys: [] })
  assert.deepEqual(released, [hubSourceKey])
  assert.deepEqual(await service.getCanonicalSnapshot({ profileId, sessionId: opened.sessionId }), { revision: 2, panes: [null, null, null] })
})

test('keeps an individual pane bound when its lease release fails', async () => {
  const persistence = createMemoryRedisPersistence()
  const coordinator = createPokemonHubSnapshotCoordinator({ persistence, eventStore: createPokemonHubEventStore({ persistence }) })
  const service = createPokemonHubSessionService({ persistence, coordinator, newId: (() => { let value = 0; return () => `release-failure-${++value}` })() })
  const hubProfileId = 'hub-release-failure'
  const hubSourceKey = `hub:${hubProfileId}`
  await coordinator.ensureHubSource({ profileId, sourceKey: hubSourceKey, hubProfileId, minimumSlotCount: 1 })
  const opened = await service.open({ profileId })
  const pane = { pane: 0, profile: { type: 'hub-profile', hubProfileId }, hub: [] }
  const acquireSource = sourceKey => coordinator.acquire({ profileId, sourceKey, workspaceId: opened.sessionId })
  await service.syncCanonicalSnapshot({
    profileId,
    sessionId: opened.sessionId,
    idempotencyKey: 'open-release-failure',
    snapshot: { revision: 0, panes: [pane, null, null] },
    acquireSource,
    flushOutgoingSource: async () => {},
    releaseSource: async () => {},
  })

  const failed = await service.syncCanonicalSnapshot({
    profileId,
    sessionId: opened.sessionId,
    idempotencyKey: 'close-release-failure',
    snapshot: { revision: 1, panes: [null, null, null] },
    acquireSource,
    flushOutgoingSource: async () => {},
    releaseSource: async () => { const error = new Error('release failed'); error.code = 'LEASE_RELEASE_FAILED'; throw error },
  })

  assert.deepEqual(failed, { status: 'corrected', snapshot: { revision: 1, panes: [pane, null, null] } })
  assert.deepEqual(await service.getCanonicalSnapshot({ profileId, sessionId: opened.sessionId }), { revision: 1, panes: [pane, null, null] })
})

test('returns the last canonical snapshot when a cross-profile occupied Hub target is submitted', async () => {
  const persistence = createMemoryRedisPersistence()
  const coordinator = createPokemonHubSnapshotCoordinator({ persistence, eventStore: createPokemonHubEventStore({ persistence }), validatePlacementChange: validatePokemonHubTransferPlacement })
  const firstHubProfileId = 'hub-profile-a'
  const secondHubProfileId = 'hub-profile-b'
  const firstHubSourceKey = `hub:${firstHubProfileId}`
  const secondHubSourceKey = `hub:${secondHubProfileId}`
  const first = await coordinator.adopt({
    profileId,
    sourceKey: firstHubSourceKey,
    sourceRevision: 0,
    adapter: 'hub-grid-v1',
    slots: [{ location: { kind: 'hub', hubProfileId: firstHubProfileId, slot: 0 }, record: { representation: { adapter: 'gen3-gba-v1', kind: 'pc-record', bytes: Buffer.alloc(80, 1) }, display: { species: 25 } } }],
  })
  const second = await coordinator.adopt({
    profileId,
    sourceKey: secondHubSourceKey,
    sourceRevision: 0,
    adapter: 'hub-grid-v1',
    slots: [{ location: { kind: 'hub', hubProfileId: secondHubProfileId, slot: 0 }, record: { representation: { adapter: 'gen3-gba-v1', kind: 'pc-record', bytes: Buffer.alloc(80, 2) }, display: { species: 289 } } }],
  })
  const service = createPokemonHubSessionService({ persistence, coordinator, newId: (() => { let value = 0; return () => `cross-source-${++value}` })() })
  const opened = await service.open({ profileId })
  const lifecycle = {
    acquireSource: sourceKey => coordinator.acquire({ profileId, sourceKey, workspaceId: opened.sessionId }),
    flushOutgoingSource: async () => { throw new Error('No source is closing.') },
    releaseSource: async () => { throw new Error('No source is closing.') },
  }
  const acceptedSnapshot = {
    revision: 0,
    panes: [
      { pane: 0, profile: { type: 'hub-profile', hubProfileId: firstHubProfileId }, hub: [{ pokemonInstanceId: first.placements[0].pokemonInstanceId, slot: 0 }] },
      { pane: 1, profile: { type: 'hub-profile', hubProfileId: secondHubProfileId }, hub: [{ pokemonInstanceId: second.placements[0].pokemonInstanceId, slot: 0 }] },
      null,
    ],
  }
  assert.deepEqual(await service.syncCanonicalSnapshot({ profileId, sessionId: opened.sessionId, idempotencyKey: 'open-hubs', snapshot: acceptedSnapshot, ...lifecycle }), { status: 'accepted', dirtySourceKeys: [] })

  assert.deepEqual(await service.syncCanonicalSnapshot({
    profileId,
    sessionId: opened.sessionId,
    idempotencyKey: 'cross-source-occupied',
    snapshot: {
      revision: 1,
      panes: [
        { pane: 0, profile: { type: 'hub-profile', hubProfileId: firstHubProfileId }, hub: [{ pokemonInstanceId: second.placements[0].pokemonInstanceId, slot: 0 }] },
        { pane: 1, profile: { type: 'hub-profile', hubProfileId: secondHubProfileId }, hub: [{ pokemonInstanceId: first.placements[0].pokemonInstanceId, slot: 0 }] },
        null,
      ],
    },
    ...lifecycle,
  }), { status: 'corrected', snapshot: { revision: 1, panes: acceptedSnapshot.panes } })
})

test('does not replay a canonical operation when its idempotency key is reused for another body', async () => {
  const persistence = createMemoryRedisPersistence()
  const coordinator = createPokemonHubSnapshotCoordinator({ persistence, eventStore: createPokemonHubEventStore({ persistence }) })
  const service = createPokemonHubSessionService({ persistence, coordinator, newId: () => 'session-a' })
  const opened = await service.open({ profileId })
  const lifecycle = {
    acquireSource: async () => { throw new Error('must not acquire') },
    flushOutgoingSource: async () => { throw new Error('must not flush') },
    releaseSource: async () => { throw new Error('must not release') },
  }

  assert.deepEqual(await service.syncCanonicalSnapshot({ profileId, sessionId: opened.sessionId, idempotencyKey: 'same-key', snapshot: { revision: 1, panes: [null, null, null] }, ...lifecycle }), {
    status: 'corrected', snapshot: { revision: 0, panes: [null, null, null] },
  })
  assert.deepEqual(await service.syncCanonicalSnapshot({ profileId, sessionId: opened.sessionId, idempotencyKey: 'same-key', snapshot: { revision: 2, panes: [null, null, null] }, ...lifecycle }), {
    status: 'corrected', snapshot: { revision: 0, panes: [null, null, null] },
  })
})

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

test('does not expire or release a session while a delayed snapshot sync has a persisted active operation', async () => {
  let instant = 1_000
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
      { location: { kind: 'game', area: 'box', box: 0, slot: 0 }, record: { representation: { adapter: 'gen3-gba-v1', kind: 'pc-record', bytes: Buffer.alloc(80, 7) }, display: { species: 289 } } },
      { location: { kind: 'game', area: 'box', box: 0, slot: 1 }, record: null },
    ],
  })
  const nextId = (() => {
    let value = 0
    return () => `session-operation-${++value}`
  })()
  const service = createPokemonHubSessionService({ persistence, coordinator, now: () => instant, leaseMs: 9, newId: nextId })
  const observer = createPokemonHubSessionService({ persistence, coordinator, now: () => instant, leaseMs: 9, newId: () => 'observer-id' })
  const opened = await service.open({ profileId })
  const lease = await coordinator.acquire({ profileId, sourceKey, workspaceId: opened.sessionId })
  const attached = await service.attach({ profileId, sessionId: opened.sessionId, sourceKey, sourceSnapshot: lease })
  const pokemonInstanceId = adopted.placements[0].pokemonInstanceId

  let markSyncStarted
  const syncStarted = new Promise(resolve => { markSyncStarted = resolve })
  let releaseSync
  const syncGate = new Promise(resolve => { releaseSync = resolve })
  const originalSync = coordinator.sync
  coordinator.sync = async request => {
    markSyncStarted()
    await syncGate
    return originalSync(request)
  }

  const pending = service.syncSnapshot({
    profileId,
    sessionId: opened.sessionId,
    snapshot: { n: 1, v: attached.snapshot.version, s: [[attached.sourceId, [[1, pokemonInstanceId]]]] },
  })
  await syncStarted

  const storedWhileSyncing = JSON.parse(await persistence.get(pokemonHubRedisKeys.session(profileId, opened.sessionId)))
  assert.equal(typeof storedWhileSyncing.activeOperation.id, 'string')
  assert.equal(storedWhileSyncing.activeOperation.generation, 1)
  assert.equal(storedWhileSyncing.activeOperation.deadline > opened.expiresAt, true)

  instant = opened.expiresAt + 1
  assert.deepEqual(await observer.listExpired(), [])
  assert.equal(await observer.releaseExpired({ profileId, sessionId: opened.sessionId }), null)

  releaseSync()
  await pending

  const storedAfterSync = JSON.parse(await persistence.get(pokemonHubRedisKeys.session(profileId, opened.sessionId)))
  assert.equal('activeOperation' in storedAfterSync, false)
})

function createRedisCjsonPersistence() {
  const memory = createMemoryRedisPersistence()
  return {
    ...memory,
    async eval(transition, options) {
      const result = await memory.eval(transition, options)
      if (!transition.lua.includes('cjson.encode')) return result
      for (const key of options.keys ?? []) {
        const raw = await memory.get(key)
        if (raw === null) continue
        await memory.set(key, JSON.stringify(redisCjsonRoundTrip(JSON.parse(raw))))
      }
      return result
    },
  }
}

function redisCjsonRoundTrip(value) {
  if (Array.isArray(value)) return value.length === 0 ? {} : value.map(redisCjsonRoundTrip)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, redisCjsonRoundTrip(entry)]))
  return value
}
