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

test('creates a fresh empty identity for every workspace opening', async () => {
  const persistence = createMemoryRedisPersistence()
  const coordinator = createPokemonHubSnapshotCoordinator({ persistence, eventStore: createPokemonHubEventStore({ persistence }) })
  let id = 0
  const service = createPokemonHubSessionService({ persistence, coordinator, newId: () => `session-${++id}` })

  const first = await service.open({ profileId })
  const second = await service.open({ profileId })

  assert.equal(first.sessionId, 'session-1')
  assert.equal(second.sessionId, 'session-2')
  assert.deepEqual(first.snapshot, { revision: 0, panes: [null, null, null] })
  assert.deepEqual(second.snapshot, { revision: 0, panes: [null, null, null] })
})

test('loads a save into one pane without sending a canonical sync candidate', async () => {
  const persistence = createMemoryRedisPersistence()
  const baseCoordinator = createPokemonHubSnapshotCoordinator({ persistence, eventStore: createPokemonHubEventStore({ persistence }) })
  await baseCoordinator.adopt({ profileId, sourceKey, sourceRevision: 1, adapter: 'gen3-gba-v1', slots: [{ location: { kind: 'game', area: 'box', box: 0, slot: 0 }, record: null }] })
  const coordinator = { ...baseCoordinator, async sync() { throw new Error('pane load must not call coordinator.sync') } }
  const service = createPokemonHubSessionService({ persistence, coordinator, newId: (() => { let id = 0; return () => `pane-${++id}` })() })
  const opened = await service.open({ profileId })
  const lifecycle = {
    acquireSource: key => baseCoordinator.acquire({ profileId, sourceKey: key, workspaceId: opened.sessionId }),
    flushOutgoingSource: async () => {},
    releaseSource: source => baseCoordinator.release({ profileId, sourceKey: source.sourceKey, workspaceId: opened.sessionId, sourceSessionId: source.sourceSessionId, leaseToken: source.leaseToken }),
  }

  const loaded = await service.loadCanonicalPane({
    profileId, sessionId: opened.sessionId, pane: 1, sourceKey,
    profile: { type: 'save', profileId, gameId: 'emerald' }, ...lifecycle,
  })

  assert.deepEqual(loaded, { status: 'accepted', snapshot: {
    revision: 1,
    panes: [null, { pane: 1, profile: { type: 'save', profileId, gameId: 'emerald' }, party: [], boxes: [] }, null],
  } })
})

test('runs a save item operation only for a live, loaded source in the session queue', async () => {
  const persistence = createMemoryRedisPersistence()
  const coordinator = createPokemonHubSnapshotCoordinator({ persistence, eventStore: createPokemonHubEventStore({ persistence }) })
  await coordinator.adopt({ profileId, sourceKey, sourceRevision: 1, adapter: 'gen3-gba-v1', slots: [] })
  const service = createPokemonHubSessionService({ persistence, coordinator, newId: () => 'item-session' })
  const opened = await service.open({ profileId })
  const request = { profileId, sessionId: opened.sessionId, sourceKey }
  await assert.rejects(() => service.withLoadedSource({ ...request, run: async () => {} }), { code: 'SESSION_SOURCE_INVALID' })
  await service.loadCanonicalPane({ ...request, pane: 0, profile: { type: 'save', profileId, gameId: 'emerald' },
    acquireSource: key => coordinator.acquire({ profileId, sourceKey: key, workspaceId: opened.sessionId }),
    flushOutgoingSource: async () => {}, releaseSource: async () => {},
  })
  const sourceId = await service.withLoadedSource({ ...request, run: async source => source.sourceId })
  assert.equal(typeof sourceId, 'string')
  assert.ok(sourceId.length > 0)
  await assert.rejects(() => service.withLoadedSource({ ...request, sourceKey: 'save:profile-may:ruby', run: async () => {} }), { code: 'SESSION_SOURCE_INVALID' })
})

test('requires both item transfer saves to be loaded in one live session', async () => {
  const persistence = createMemoryRedisPersistence()
  const coordinator = createPokemonHubSnapshotCoordinator({ persistence, eventStore: createPokemonHubEventStore({ persistence }) })
  const sourceKeys = [sourceKey, `save:${profileId}:ruby`]
  for (const key of sourceKeys) await coordinator.adopt({ profileId, sourceKey: key, sourceRevision: 1, adapter: 'gen3-gba-v1', slots: [] })
  const service = createPokemonHubSessionService({ persistence, coordinator, newId: () => 'pair-session' })
  const opened = await service.open({ profileId })
  const input = { profileId, sessionId: opened.sessionId, sourceKeys }
  await assert.rejects(() => service.withLoadedSources({ ...input, run: async () => {} }), { code: 'SESSION_SOURCE_INVALID' })
  for (const [pane, key] of sourceKeys.entries()) {
    await service.loadCanonicalPane({ profileId, sessionId: opened.sessionId, pane, sourceKey: key,
      profile: { type: 'save', profileId, gameId: pane ? 'ruby' : 'emerald' },
      acquireSource: candidate => coordinator.acquire({ profileId, sourceKey: candidate, workspaceId: opened.sessionId }),
      flushOutgoingSource: async () => {}, releaseSource: async () => {},
    })
  }
  assert.deepEqual(await service.withLoadedSources({ ...input, run: async sources => sources.map(source => source.sourceKey) }), sourceKeys)
  await assert.rejects(() => service.withLoadedSources({ ...input, sourceKeys: [sourceKeys[0], 'save:other:emerald'], run: async () => {} }), { code: 'SESSION_SOURCE_INVALID' })
})

test('preserves a placement-rule reason when the snapshot coordinator corrects the workspace', async () => {
  const persistence = createMemoryRedisPersistence()
  const reason = { code: 'TRANSFER_NATIONAL_DEX_REQUIRED', message: 'Este save ainda não pode enviar ou receber esse Pokémon sem a Pokédex Nacional.' }
  const coordinator = {
    async getSnapshot() { throw new Error('empty snapshot has no sources') },
    async renew() {},
    async release() {},
    async reconcileWorkspaceLeases() {},
    async sync() { return { status: 'corrected', code: reason.code, reason } },
  }
  const service = createPokemonHubSessionService({ persistence, coordinator, newId: () => 'session-rule-reason' })
  const opened = await service.open({ profileId })

  const corrected = await service.syncCanonicalSnapshot({
    profileId,
    sessionId: opened.sessionId,
    idempotencyKey: 'rule-reason',
    snapshot: { revision: 0, panes: [null, null, null] },
    acquireSource: async () => { throw new Error('must not acquire') },
    flushOutgoingSource: async () => { throw new Error('must not flush') },
    releaseSource: async () => { throw new Error('must not release') },
  })

  assert.deepEqual(corrected, { status: 'corrected', snapshot: { revision: 0, panes: [null, null, null] }, reason })
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
  const key = pokemonHubRedisKeys.session(opened.sessionId)
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

test('flushes a cross-profile save before releasing it from a canonical session', async () => {
  const persistence = createMemoryRedisPersistence()
  const coordinator = createPokemonHubSnapshotCoordinator({ persistence, eventStore: createPokemonHubEventStore({ persistence }) })
  const service = createPokemonHubSessionService({ persistence, coordinator, newId: (() => { let value = 0; return () => `canonical-${++value}` })() })
  const sapphireProfileId = 'profile-sapphire'
  const sapphireSourceKey = 'save:profile-sapphire:emerald'
  await coordinator.adopt({
    profileId,
    sourceKey: sapphireSourceKey,
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
        { pane: 0, profile: { type: 'save', profileId: sapphireProfileId, gameId: 'emerald' }, party: [{ pokemonInstanceId: (await coordinator.getSnapshot({ profileId, sourceKey: sapphireSourceKey })).placements[0].pokemonInstanceId, slot: 0 }], boxes: [] },
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
  assert.deepEqual(acquired, [sapphireSourceKey])
  assert.deepEqual(released, [])
  assert.deepEqual(await service.syncCanonicalSnapshot({
    profileId, sessionId: opened.sessionId, idempotencyKey: 'canonical-open-close',
    snapshot: {
      revision: 0,
      panes: [{ pane: 0, profile: { type: 'save', profileId: sapphireProfileId, gameId: 'emerald' }, party: [{ pokemonInstanceId: (await coordinator.getSnapshot({ profileId, sourceKey: sapphireSourceKey })).placements[0].pokemonInstanceId, slot: 0 }], boxes: [] }, null, null],
    },
    acquireSource: async () => { throw new Error('must not reacquire') },
    flushOutgoingSource: async () => { throw new Error('must not flush') },
    releaseSource: async () => { throw new Error('must not release') },
  }), { status: 'accepted', dirtySourceKeys: [] })

  const originalSync = coordinator.sync
  let heldUntilCommit = false
  coordinator.sync = async request => {
    if (request.retiredSourceKeys?.includes(sapphireSourceKey)) {
      await assert.rejects(
        () => coordinator.acquire({ profileId, sourceKey: sapphireSourceKey, workspaceId: 'other-workspace' }),
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
  assert.deepEqual(released, [`flushed:${sapphireSourceKey}`, sapphireSourceKey])
  assert.deepEqual(await service.getCanonicalSnapshot({ profileId, sessionId: opened.sessionId }), { revision: 2, panes: [null, null, null] })
})

test('closes a canonical session by flushing every cross-profile save before any release', async () => {
  const persistence = createMemoryRedisPersistence()
  const coordinator = {
    async getSnapshot() { throw new Error('a closing session does not read source snapshots') },
    async renew() {},
    async release() {},
    async sync() {},
    async reconcileWorkspaceLeases() {},
  }
  const service = createPokemonHubSessionService({ persistence, coordinator })
  const sessionId = 'close-all-saves'
  const snapshot = { revision: 1, panes: [null, null, null] }
  const idempotencyKey = 'close-all-saves-key'
  const sources = [
    { sourceId: 'ruby', sourceKey: 'save:profile-ruby:ruby', sourceSessionId: 'lease-ruby', leaseToken: 'token-ruby' },
    { sourceId: 'sapphire', sourceKey: 'save:profile-sapphire:sapphire', sourceSessionId: 'lease-sapphire', leaseToken: 'token-sapphire' },
    { sourceId: 'emerald', sourceKey: 'save:profile-emerald:emerald', sourceSessionId: 'lease-emerald', leaseToken: 'token-emerald' },
  ]
  await persistence.set(pokemonHubRedisKeys.session(sessionId), JSON.stringify({
    schemaVersion: 3,
    profileId,
    sessionId,
    version: 1,
    canonicalSnapshot: snapshot,
    expiresAt: Date.now() + 10_000,
    state: 'closing',
    sources,
    close: { idempotencyKey, fingerprint: JSON.stringify(snapshot) },
  }))
  const actions = []

  const result = await service.closeCanonicalSession({
    profileId,
    sessionId,
    snapshot,
    idempotencyKey,
    acquireSource: async () => { throw new Error('a closing session does not acquire sources') },
    flushOutgoingSource: async source => { actions.push(`flush:${source.sourceKey}`) },
    releaseSource: async source => { actions.push(`release:${source.sourceKey}`) },
  })

  assert.deepEqual(result, { status: 'complete' })
  assert.deepEqual(actions, [
    ...sources.map(source => `flush:${source.sourceKey}`),
    ...sources.map(source => `release:${source.sourceKey}`),
  ])
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

test('grows a leased legacy Hub source when a canonical move reaches its next slot', async () => {
  const persistence = createMemoryRedisPersistence()
  const coordinator = createPokemonHubSnapshotCoordinator({ persistence, eventStore: createPokemonHubEventStore({ persistence }) })
  const hubProfileId = 'legacy-short-grid'
  const hubSourceKey = `hub:${hubProfileId}`
  const slots = Array.from({ length: 10 }, (_, slot) => ({
    location: { kind: 'hub', hubProfileId, slot },
    record: slot === 0 ? { representation: { adapter: 'gen3-gba-v1', kind: 'pc-record', bytes: Buffer.alloc(80, 1) }, display: { species: 25 } } : null,
  }))
  const adopted = await coordinator.adopt({ profileId, sourceKey: hubSourceKey, sourceRevision: 0, adapter: 'hub-grid-v1', slots })
  const pokemonInstanceId = adopted.placements[0].pokemonInstanceId
  const service = createPokemonHubSessionService({ persistence, coordinator, newId: () => 'legacy-grid-session' })
  const opened = await service.open({ profileId })
  const lifecycle = {
    acquireSource: sourceKey => coordinator.acquire({ profileId, sourceKey, workspaceId: opened.sessionId }),
    flushOutgoingSource: async () => {},
    releaseSource: async () => {},
  }
  const profile = { type: 'hub-profile', hubProfileId }
  assert.deepEqual(await service.syncCanonicalSnapshot({
    profileId, sessionId: opened.sessionId, idempotencyKey: 'open-short-grid',
    snapshot: { revision: 0, panes: [{ pane: 0, profile, hub: [{ pokemonInstanceId, slot: 0 }] }, null, null] }, ...lifecycle,
  }), { status: 'accepted', dirtySourceKeys: [] })

  assert.deepEqual(await service.syncCanonicalSnapshot({
    profileId, sessionId: opened.sessionId, idempotencyKey: 'move-to-next-slot',
    snapshot: { revision: 1, panes: [{ pane: 0, profile, hub: [{ pokemonInstanceId, slot: 10 }] }, null, null] }, ...lifecycle,
  }), { status: 'accepted', dirtySourceKeys: [] })
  const source = await coordinator.getSnapshot({ profileId, sourceKey: hubSourceKey })
  assert.equal(source.placements.length, 11)
  assert.equal(source.placements[0].pokemonInstanceId, null)
  assert.equal(source.placements[10].pokemonInstanceId, pokemonInstanceId)

  const oversized = await service.syncCanonicalSnapshot({
    profileId, sessionId: opened.sessionId, idempotencyKey: 'oversized-grid-jump',
    snapshot: { revision: 2, panes: [{ pane: 0, profile, hub: [{ pokemonInstanceId, slot: 1035 }] }, null, null] }, ...lifecycle,
  })
  assert.equal(oversized.status, 'corrected')
  assert.equal((await coordinator.getSnapshot({ profileId, sourceKey: hubSourceKey })).placements.length, 11)
})

test('moves a Box Pokemon beyond both a short Hub source and the initial sixty-slot projection', async () => {
  const persistence = createMemoryRedisPersistence()
  const coordinator = createPokemonHubSnapshotCoordinator({ persistence, eventStore: createPokemonHubEventStore({ persistence }) })
  const native = byte => ({ representation: { adapter: 'gen3-gba-v1', kind: 'pc-record', bytes: Buffer.alloc(80, byte) }, display: { species: byte } })
  const save = await coordinator.adopt({ profileId, sourceKey, sourceRevision: 1, adapter: 'gen3-gba-v1', slots: [
    { location: { kind: 'game', area: 'party', slot: 0 }, record: native(1) },
    { location: { kind: 'game', area: 'box', box: 0, slot: 0 }, record: native(2) },
  ] })
  const hubProfileId = 'short-destination'
  const hubSourceKey = `hub:${hubProfileId}`
  await coordinator.ensureHubSource({ profileId, sourceKey: hubSourceKey, hubProfileId, minimumSlotCount: 10 })
  const service = createPokemonHubSessionService({ persistence, coordinator, newId: () => 'save-to-short-hub' })
  const opened = await service.open({ profileId })
  const lifecycle = {
    acquireSource: key => coordinator.acquire({ profileId, sourceKey: key, workspaceId: opened.sessionId }),
    flushOutgoingSource: async () => {},
    releaseSource: async () => {},
  }
  const saveProfile = { type: 'save', profileId, gameId: 'emerald' }
  const hubProfile = { type: 'hub-profile', hubProfileId }
  const party = [{ pokemonInstanceId: save.placements[0].pokemonInstanceId, slot: 0 }]
  const boxPokemonInstanceId = save.placements[1].pokemonInstanceId
  assert.deepEqual(await service.syncCanonicalSnapshot({
    profileId, sessionId: opened.sessionId, idempotencyKey: 'open-save-and-hub',
    snapshot: { revision: 0, panes: [
      { pane: 0, profile: saveProfile, party, boxes: [{ pokemonInstanceId: boxPokemonInstanceId, slot: 0 }] },
      { pane: 1, profile: hubProfile, hub: [] }, null,
    ] }, ...lifecycle,
  }), { status: 'accepted', dirtySourceKeys: [] })

  assert.deepEqual(await service.syncCanonicalSnapshot({
    profileId, sessionId: opened.sessionId, idempotencyKey: 'box-to-hub-slot-sixty',
    snapshot: { revision: 1, panes: [
      { pane: 0, profile: saveProfile, party, boxes: [] },
      { pane: 1, profile: hubProfile, hub: [{ pokemonInstanceId: boxPokemonInstanceId, slot: 60 }] }, null,
    ] }, ...lifecycle,
  }), { status: 'accepted', dirtySourceKeys: [sourceKey] })
  const hub = await coordinator.getSnapshot({ profileId, sourceKey: hubSourceKey })
  assert.equal(hub.placements.length, 61)
  assert.equal(hub.placements[60].pokemonInstanceId, boxPokemonInstanceId)
  assert.equal((await coordinator.getSnapshot({ profileId, sourceKey })).placements[1].pokemonInstanceId, null)
})

test('a move with an outgoing pane retains its atomic receipt when release fails', async () => {
 const persistence = createMemoryRedisPersistence()
 const coordinator = createPokemonHubSnapshotCoordinator({ persistence, eventStore: createPokemonHubEventStore({ persistence }) })
 const original = await coordinator.adopt({ sourceKey: 'hub:a', sourceRevision: 1, adapter: 'hub-grid-v1', slots: [{ location: { kind: 'hub', hubProfileId: 'a', slot: 0 }, record: { representation: { adapter: 'gen3-gba-v1', kind: 'pc-record', bytes: Buffer.alloc(80, 1) }, display: { species: 25 } } }] })
 for (const id of ['b','c']) await coordinator.ensureHubSource({ sourceKey: 'hub:'+id, hubProfileId: id, minimumSlotCount: 1 })
 const service = createPokemonHubSessionService({ persistence, coordinator })
 const { sessionId } = await service.open()
 let fail = false
 const lifecycle = { acquireSource: sourceKey => coordinator.acquire({ sourceKey, workspaceId: sessionId }), flushOutgoingSource: async () => {}, releaseSource: async source => {
  if (fail) throw Object.assign(new Error('release failed'), { code: 'LEASE_RELEASE_FAILED' })
  return coordinator.release({ ...source, workspaceId: sessionId })
 } }
 const pokemonInstanceId = original.placements[0].pokemonInstanceId
 const pane = (id,index,occupied) => ({ pane:index, profile:{type:'hub-profile',hubProfileId:id},hub:occupied?[{pokemonInstanceId,slot:0}]:[] })
 await service.syncCanonicalSnapshot({ sessionId,idempotencyKey:'open',snapshot:{revision:0,panes:[pane('a',0,true),pane('b',1,false),pane('c',2,false)]},...lifecycle })
 const request={sessionId,idempotencyKey:'move-and-close',snapshot:{revision:1,panes:[pane('a',0,false),pane('b',1,true),null]},...lifecycle}
 fail=true
 await assert.rejects(service.syncCanonicalSnapshot(request),{code:'LEASE_RELEASE_FAILED'})
 const durable=JSON.parse(await persistence.get(pokemonHubRedisKeys.session(sessionId)))
 assert.equal(durable.state,'publishing')
 assert.deepEqual(durable.canonicalSnapshot.panes,request.snapshot.panes)
 assert.equal(durable.pendingPublication.retiredSources[0].sourceKey,'hub:c')
 assert.equal((await coordinator.getSnapshot({sourceKey:'hub:a'})).placements[0].pokemonInstanceId,null)
 assert.equal((await coordinator.getSnapshot({sourceKey:'hub:b'})).placements[0].pokemonInstanceId,pokemonInstanceId)
 fail=false
 assert.equal((await service.syncCanonicalSnapshot(request)).status,'accepted')
 assert.equal((await coordinator.acquire({sourceKey:'hub:c',workspaceId:'other'})).sourceKey,'hub:c')
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

  assert.deepEqual(expired, [{ sessionId: 'session-a' }])
})

test('expires a transition whose bounded active-request deadline has elapsed', async () => {
  let instant = 1_000
  const persistence = createMemoryRedisPersistence()
  const coordinator = createPokemonHubSnapshotCoordinator({ persistence, eventStore: createPokemonHubEventStore({ persistence }) })
  const service = createPokemonHubSessionService({ persistence, coordinator, now: () => instant, leaseMs: 9, operationLeaseMs: 20, newId: () => 'session-a' })
  const opened = await service.open({ profileId })
  const key = pokemonHubRedisKeys.session(opened.sessionId)
  const stored = JSON.parse(await persistence.get(key))
  stored.state = 'transitioning'
  stored.operation = { id: 'stuck-request', generation: 1, deadline: 1_020 }
  stored.activeOperation = stored.operation
  await persistence.set(key, JSON.stringify(stored))
  instant = 1_021

  assert.deepEqual(await service.listExpired(), [{ sessionId: 'session-a' }])
  assert.deepEqual(await service.releaseExpired({ profileId, sessionId: 'session-a' }), [])
  assert.equal(await persistence.get(key), null)
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

  const storedWhileSyncing = JSON.parse(await persistence.get(pokemonHubRedisKeys.session(opened.sessionId)))
  assert.equal(typeof storedWhileSyncing.activeOperation.id, 'string')
  assert.equal(storedWhileSyncing.activeOperation.generation, 1)
  assert.equal(storedWhileSyncing.activeOperation.deadline > opened.expiresAt, true)

  instant = opened.expiresAt + 1
  assert.deepEqual(await observer.listExpired(), [])
  assert.equal(await observer.releaseExpired({ profileId, sessionId: opened.sessionId }), null)

  releaseSync()
  await pending

  const storedAfterSync = JSON.parse(await persistence.get(pokemonHubRedisKeys.session(opened.sessionId)))
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

test('registers one owner-free session identity without resetting it on an opening retry', async () => {
  let instant = 1000
  const persistence = createMemoryRedisPersistence()
  const coordinator = createPokemonHubSnapshotCoordinator({ persistence, eventStore: createPokemonHubEventStore({ persistence }) })
  const service = createPokemonHubSessionService({ persistence, coordinator, now: () => instant })
  const opened = await service.open({ sessionId: 'browser-opening' })
  const key = pokemonHubRedisKeys.session(opened.sessionId)
  const original = await persistence.get(key)
  instant += 100
  const replay = await service.open({ sessionId: 'browser-opening' })
  assert.equal(replay.sessionId, opened.sessionId)
  assert.equal(await persistence.get(key), original)
  assert.equal(JSON.parse(original).profileId, undefined)
  assert.equal(JSON.parse(original).startedAt, 1000)
  await service.close({ sessionId: opened.sessionId })
  await assert.rejects(() => service.open({ sessionId: opened.sessionId }), { code: 'SESSION_INVALID' })
  const history = JSON.parse(await persistence.get(pokemonHubRedisKeys.sessionHistory(opened.sessionId)))
  assert.equal(history.startedAt, 1000)
  assert.equal(history.closedAt, 1100)
})

test('does not acknowledge a move before native persistence and retries its publication after failure', async () => {
  const persistence = createMemoryRedisPersistence()
  const coordinator = createPokemonHubSnapshotCoordinator({ persistence, eventStore: createPokemonHubEventStore({ persistence }) })
  const native = byte => ({ representation: { adapter: 'gen3-gba-v1', kind: 'pc-record', bytes: Buffer.alloc(80, byte) }, display: { species: byte } })
  const save = await coordinator.adopt({ profileId, sourceKey, sourceRevision: 1, adapter: 'gen3-gba-v1', slots: [
    { location: { kind: 'game', area: 'party', slot: 0 }, record: native(1) },
    { location: { kind: 'game', area: 'box', box: 0, slot: 0 }, record: native(2) },
  ] })
  const hubProfileId = 'short-destination'
  const hubSourceKey = `hub:${hubProfileId}`
  await coordinator.ensureHubSource({ profileId, sourceKey: hubSourceKey, hubProfileId, minimumSlotCount: 10 })
  const service = createPokemonHubSessionService({ persistence, coordinator, newId: () => 'save-to-short-hub' })
  const opened = await service.open({ profileId })
  let flushCalls = 0
  let fail = true
  const lifecycle = {
    acquireSource: key => coordinator.acquire({ profileId, sourceKey: key, workspaceId: opened.sessionId }),
    flushOutgoingSource: async () => { flushCalls++; if (fail) throw Object.assign(new Error('disk unavailable'), { code: 'SAVE_FLUSH_FAILED' }) },
    releaseSource: async () => {},
  }
  const saveProfile = { type: 'save', profileId, gameId: 'emerald' }
  const hubProfile = { type: 'hub-profile', hubProfileId }
  const party = [{ pokemonInstanceId: save.placements[0].pokemonInstanceId, slot: 0 }]
  const boxPokemonInstanceId = save.placements[1].pokemonInstanceId
  assert.deepEqual(await service.syncCanonicalSnapshot({
    profileId, sessionId: opened.sessionId, idempotencyKey: 'open-save-and-hub',
    snapshot: { revision: 0, panes: [
      { pane: 0, profile: saveProfile, party, boxes: [{ pokemonInstanceId: boxPokemonInstanceId, slot: 0 }] },
      { pane: 1, profile: hubProfile, hub: [] }, null,
    ] }, ...lifecycle,
  }), { status: 'accepted', dirtySourceKeys: [] })

  const request = {
    profileId, sessionId: opened.sessionId, idempotencyKey: 'box-to-hub-slot-sixty',
    snapshot: { revision: 1, panes: [
      { pane: 0, profile: saveProfile, party, boxes: [] },
      { pane: 1, profile: hubProfile, hub: [{ pokemonInstanceId: boxPokemonInstanceId, slot: 60 }] }, null,
    ] }, ...lifecycle,
  }
  await assert.rejects(service.syncCanonicalSnapshot(request), { code: 'SAVE_FLUSH_FAILED' })
  assert.equal(flushCalls, 1)
  fail = false
  assert.deepEqual(await service.syncCanonicalSnapshot(request), { status: 'accepted', dirtySourceKeys: [sourceKey] })
  assert.equal(flushCalls, 2)

  const hub = await coordinator.getSnapshot({ profileId, sourceKey: hubSourceKey })
  assert.equal(hub.placements.length, 61)
  assert.equal(hub.placements[60].pokemonInstanceId, boxPokemonInstanceId)
  assert.equal((await coordinator.getSnapshot({ profileId, sourceKey })).placements[1].pokemonInstanceId, null)
})

test('a failed outgoing release during pane replacement retains recoverable bindings until retry', async () => {
 const persistence=createMemoryRedisPersistence()
 const coordinator=createPokemonHubSnapshotCoordinator({persistence,eventStore:createPokemonHubEventStore({persistence})})
 for(const id of ['one','two']) await coordinator.ensureHubSource({sourceKey:'hub:'+id,hubProfileId:id,minimumSlotCount:2})
 const service=createPokemonHubSessionService({persistence,coordinator})
 const {sessionId}=await service.open()
 let fail=false
 const lifecycle={acquireSource:sourceKey=>coordinator.acquire({sourceKey,workspaceId:sessionId}),flushOutgoingSource:async()=>{},releaseSource:async source=>{
  if(fail && source.sourceKey==='hub:one') throw Object.assign(new Error('release failed'),{code:'LEASE_RELEASE_FAILED'})
  return coordinator.release({...source,workspaceId:sessionId})
 }}
 await service.loadCanonicalPane({sessionId,pane:0,sourceKey:'hub:one',profile:{type:'hub-profile',hubProfileId:'one'},...lifecycle})
 fail=true
 const request={sessionId,pane:0,sourceKey:'hub:two',profile:{type:'hub-profile',hubProfileId:'two'},...lifecycle}
 await assert.rejects(service.loadCanonicalPane(request),{code:'LEASE_RELEASE_FAILED'})
 await assert.rejects(coordinator.acquire({sourceKey:'hub:two',workspaceId:'other'}),{code:'SOURCE_RESERVED'})
 fail=false
 assert.equal((await service.loadCanonicalPane(request)).status,'accepted')
 assert.equal((await coordinator.acquire({sourceKey:'hub:one',workspaceId:'other'})).sourceKey,'hub:one')
})

test('expiry claims the session before cleanup so a pending publication cannot resume concurrently', async () => {
 const persistence=createMemoryRedisPersistence()
 const coordinator=createPokemonHubSnapshotCoordinator({persistence,eventStore:createPokemonHubEventStore({persistence})})
 let instant=1000
 const service=createPokemonHubSessionService({persistence,coordinator,now:()=>instant,leaseMs:10})
 const {sessionId}=await service.open()
 const key=pokemonHubRedisKeys.session(sessionId)
 const pending=JSON.parse(await persistence.get(key))
 pending.state='publishing'
 pending.pendingPublication={response:{status:'accepted',dirtySourceKeys:[]},retiredSources:[],operationKey:'receipt',fingerprint:'x'}
 await persistence.set(key,JSON.stringify(pending))
 instant=1100
 const observer=createPokemonHubSessionService({persistence,coordinator,now:()=>instant,leaseMs:10})
 await observer.releaseExpired({sessionId,beforeClose:async()=>{
  assert.equal(JSON.parse(await persistence.get(key)).state,'recovering')
  await assert.rejects(service.syncCanonicalSnapshot({sessionId,idempotencyKey:'retry',snapshot:{revision:0,panes:[null,null,null]},acquireSource:async()=>{},flushOutgoingSource:async()=>{},releaseSource:async()=>{}}))
 }})
 assert.equal(await persistence.get('receipt'),null)
})

test('native item operations cannot bypass a pending publication and fence delayed writes after expiry', async () => {
 const persistence=createMemoryRedisPersistence()
 let instant=1000
 const coordinator=createPokemonHubSnapshotCoordinator({persistence,eventStore:createPokemonHubEventStore({persistence}),now:()=>new Date(instant)})
 await coordinator.ensureHubSource({sourceKey:'hub:items',hubProfileId:'items',minimumSlotCount:1})
 const options={persistence,coordinator,now:()=>instant,leaseMs:100,operationLeaseMs:200}
 const service=createPokemonHubSessionService(options)
 const {sessionId}=await service.open()
 await service.loadCanonicalPane({sessionId,pane:0,sourceKey:'hub:items',profile:{type:'hub-profile',hubProfileId:'items'},acquireSource:sourceKey=>coordinator.acquire({sourceKey,workspaceId:sessionId}),flushOutgoingSource:async()=>{},releaseSource:async()=>{}})
 const key=pokemonHubRedisKeys.session(sessionId), original=await persistence.get(key)
 await persistence.set(key,JSON.stringify({...JSON.parse(original),state:'publishing'}))
 await assert.rejects(service.withLoadedSources({sessionId,sourceKeys:['hub:items'],run:async()=>assert.fail('pending publication must block item writes')}),{code:'SESSION_TRANSITION_IN_PROGRESS'})
 await persistence.set(key,original)
 const observer=createPokemonHubSessionService(options)
 await service.withLoadedSources({sessionId,sourceKeys:['hub:items'],run:async (_sources,assertActive)=>{
  await assertActive()
  instant=1150
  assert.deepEqual(await observer.listExpired(),[])
  instant=1250
  await observer.releaseExpired({sessionId})
  await assert.rejects(assertActive(),{code:'SESSION_TRANSITION_FENCED'})
 }})
})

test('a stale expiry score is repaired without losing the renewed session', async () => {
 const persistence=createMemoryRedisPersistence()
 const coordinator=createPokemonHubSnapshotCoordinator({persistence,eventStore:createPokemonHubEventStore({persistence})})
 let instant=1000
 const service=createPokemonHubSessionService({persistence,coordinator,now:()=>instant,leaseMs:100})
 const {sessionId}=await service.open()
 const key=pokemonHubRedisKeys.session(sessionId), session=JSON.parse(await persistence.get(key))
 await persistence.set(key,JSON.stringify({...session,expiresAt:1200}))
 instant=1150
 assert.deepEqual(await service.listExpired(),[])
 instant=1250
 assert.deepEqual(await service.listExpired(),[{sessionId}])
})

test('session registration writes its recovery and history indices in the same transaction', async () => {
 const memory=createMemoryRedisPersistence()
 const persistence={...memory,async addToSortedSet(){throw new Error('non-atomic index write')}}
 const coordinator=createPokemonHubSnapshotCoordinator({persistence,eventStore:createPokemonHubEventStore({persistence})})
 let instant=1000
 const service=createPokemonHubSessionService({persistence,coordinator,now:()=>instant,leaseMs:100})
 const {sessionId}=await service.open()
 assert.equal((await service.listHistory())[0].sessionId,sessionId)
 instant=1200
 assert.deepEqual(await service.listExpired(),[{sessionId}])
})
