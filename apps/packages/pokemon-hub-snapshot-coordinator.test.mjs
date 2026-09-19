import assert from 'node:assert/strict'
import test from 'node:test'

import { createPokemonHubEventStore } from './pokemon-hub-event-store.mjs'
import { createGameSaveLeaseCoordinator } from './game-save-lease-coordinator.mjs'
import { createPokemonHubSnapshotCoordinator } from './pokemon-hub-snapshot-coordinator.mjs'
import { createPokemonHubTransferPlacementPolicy, validatePokemonHubTransferPlacement } from './pokemon-hub-transfer-placement-policy.mjs'
import { pokemonHubRedisKeys } from './pokemon-hub-redis-keys.mjs'
import { createMemoryRedisPersistence } from './redis-persistence.mjs'

const profileId = 'profile-may'
const party = slot => ({ kind: 'game', area: 'party', slot })
const hub = (hubProfileId, slot) => ({ kind: 'hub', hubProfileId, slot })

function record(seed, display) {
  return { representation: { adapter: 'gen3-gba-v1', kind: 'pc-record', bytes: Buffer.alloc(80, seed) }, display }
}

async function fixture(options = {}) {
  let instant = Date.parse('2026-09-17T12:00:00.000Z')
  const now = () => new Date(instant)
  const persistence = createMemoryRedisPersistence()
  const events = createPokemonHubEventStore({ persistence, now })
  const coordinator = createPokemonHubSnapshotCoordinator({
    persistence,
    eventStore: events,
    now,
    newId: (() => { let value = 0; return () => `00000000-0000-4000-8000-${String(++value).padStart(12, '0')}` })(),
    validatePlacementChange: options.validatePlacementChange,
    gameSaveLeases: options.gameSaveLeases,
  })
  return { persistence, events, coordinator, setTime: value => { instant = value } }
}

test('does not acquire a save source while the player owns its global save lease', async () => {
  const persistence = createMemoryRedisPersistence()
  const leases = createGameSaveLeaseCoordinator({ persistence, now: () => Date.parse('2026-09-17T12:00:00.000Z') })
  await leases.acquirePlayer({ profileId, gameId: 'emerald', deviceId: 'device-a', sessionId: 'player-a' })
  const { coordinator } = await fixture({ gameSaveLeases: leases })
  await coordinator.adopt({ profileId, sourceKey: 'save:profile-may:emerald', sourceRevision: 1, adapter: 'gen3-gba-v1', slots: [{ location: party(0), record: null }] })

  await assert.rejects(
    coordinator.acquire({ profileId, sourceKey: 'save:profile-may:emerald', workspaceId: 'workspace-a' }),
    error => error.code === 'SAVE_IN_USE_BY_PLAYER',
  )
})

test('adopts native records once and acquires a safe snapshot without bytes', async () => {
  const { coordinator, events } = await fixture()
  const adopted = await coordinator.adopt({
    profileId,
    sourceKey: 'save:profile-may:emerald',
    sourceRevision: 4,
    adapter: 'gen3-gba-v1',
    slots: [
      { location: party(0), record: record(7, { species: 289, shiny: false }) },
      { location: party(1), record: null },
    ],
  })
  const acquired = await coordinator.acquire({ profileId, sourceKey: adopted.sourceKey, workspaceId: 'workspace-a' })

  assert.equal(adopted.placements[0].pokemonInstanceId, '00000000-0000-4000-8000-000000000001')
  assert.deepEqual(acquired.placements, adopted.placements)
  assert.deepEqual(acquired.pokemonDisplay, { '00000000-0000-4000-8000-000000000001': { species: 289, shiny: false } })
  assert.equal(JSON.stringify(acquired).includes('bytesBase64'), false)
  assert.equal(JSON.stringify(acquired).includes(Buffer.alloc(80, 7).toString('base64')), false)
  assert.equal((await events.listForPokemon(profileId, adopted.placements[0].pokemonInstanceId))[0].type, 'pokemon.observed')
})

test('creates and expands a Hub grid source without assigning native bytes to empty grid slots', async () => {
  const { coordinator } = await fixture()

  const created = await coordinator.ensureHubSource({
    profileId,
    sourceKey: 'hub:11111111-1111-4111-8111-111111111111',
    hubProfileId: '11111111-1111-4111-8111-111111111111',
    minimumSlotCount: 3,
  })
  const expanded = await coordinator.ensureHubSource({
    profileId,
    sourceKey: created.sourceKey,
    hubProfileId: '11111111-1111-4111-8111-111111111111',
    minimumSlotCount: 5,
  })

  assert.equal(created.adapter, 'hub-grid-v1')
  assert.deepEqual(created.placements, [
    { location: hub('11111111-1111-4111-8111-111111111111', 0), pokemonInstanceId: null },
    { location: hub('11111111-1111-4111-8111-111111111111', 1), pokemonInstanceId: null },
    { location: hub('11111111-1111-4111-8111-111111111111', 2), pokemonInstanceId: null },
  ])
  assert.equal(expanded.placements.length, 5)
  assert.equal(expanded.placements[4].pokemonInstanceId, null)
  assert.deepEqual(await coordinator.getSnapshot({ profileId, sourceKey: created.sourceKey }), expanded)
})

test('expires a source session after three missed handshake windows', async () => {
  const { coordinator } = await fixture()
  const source = await coordinator.adopt({ profileId, sourceKey: 'save:profile-may:emerald', sourceRevision: 4, adapter: 'gen3-gba-v1', slots: [{ location: party(0), record: null }] })

  const lease = await coordinator.acquire({ profileId, sourceKey: source.sourceKey, workspaceId: 'browser-session-a' })

  assert.equal(lease.expiresAt, Date.parse('2026-09-17T12:00:09.000Z'))
})

test('persists a pending save flush until the materialized revision is acknowledged', async () => {
  const { coordinator } = await fixture()
  const source = await coordinator.adopt({
    profileId,
    sourceKey: 'save:profile-may:emerald',
    sourceRevision: 4,
    adapter: 'gen3-gba-v1',
    slots: [
      { location: party(0), record: record(7, { species: 289, shiny: false }) },
      { location: party(1), record: null },
    ],
  })
  const lease = await coordinator.acquire({ profileId, sourceKey: source.sourceKey, workspaceId: 'browser-session-a' })
  const pokemonInstanceId = lease.placements[0].pokemonInstanceId

  await coordinator.sync({
    profileId,
    workspaceId: 'browser-session-a',
    clientSequence: 1,
    idempotencyKey: 'pending-flush-1',
    sources: [{
      sourceKey: source.sourceKey,
      sourceSessionId: lease.sourceSessionId,
      leaseToken: lease.leaseToken,
      baseRevision: source.sourceRevision,
      placements: [
        { location: party(0), pokemonInstanceId: null },
        { location: party(1), pokemonInstanceId },
      ],
    }],
  })

  const pending = await coordinator.getSaveFlushPlan({ profileId, sourceKey: source.sourceKey })
  assert.equal(pending.source.needsSaveFlush, true)
  await assert.rejects(
    () => coordinator.markSaveFlushed({ profileId, sourceKey: source.sourceKey, sourceRevision: pending.source.sourceRevision - 1, saveRevision: 5 }),
    error => error.code === 'SOURCE_FLUSH_STALE',
  )
  assert.equal((await coordinator.getSaveFlushPlan({ profileId, sourceKey: source.sourceKey })).source.needsSaveFlush, true)
  await coordinator.markSaveFlushed({ profileId, sourceKey: source.sourceKey, sourceRevision: pending.source.sourceRevision, saveRevision: 5 })
  assert.equal((await coordinator.getSaveFlushPlan({ profileId, sourceKey: source.sourceKey })).source.needsSaveFlush, false)
})

test('loads occupied records for a save flush concurrently', async () => {
  const basePersistence = createMemoryRedisPersistence()
  let measureRecordReads = false
  let activeRecordReads = 0
  let maximumConcurrentRecordReads = 0
  const persistence = {
    ...basePersistence,
    async get(key) {
      if (measureRecordReads && key.includes(':record:')) {
        activeRecordReads += 1
        maximumConcurrentRecordReads = Math.max(maximumConcurrentRecordReads, activeRecordReads)
        await new Promise(resolve => setImmediate(resolve))
        activeRecordReads -= 1
      }
      return basePersistence.get(key)
    },
  }
  const coordinator = createPokemonHubSnapshotCoordinator({
    persistence,
    eventStore: createPokemonHubEventStore({ persistence }),
    newId: (() => { let value = 0; return () => `record-${++value}` })(),
  })
  const source = await coordinator.adopt({
    profileId,
    sourceKey: 'save:profile-may:emerald',
    sourceRevision: 1,
    adapter: 'gen3-gba-v1',
    slots: [
      { location: party(0), record: record(1, { species: 1 }) },
      { location: party(1), record: record(2, { species: 2 }) },
      { location: party(2), record: record(3, { species: 3 }) },
    ],
  })

  measureRecordReads = true
  const plan = await coordinator.getSaveFlushPlan({ profileId, sourceKey: source.sourceKey })

  assert.equal(plan.records.size, 3)
  assert.equal(maximumConcurrentRecordReads, 3)
})

test('accepts a complete two-source placement snapshot and emits one movement event', async () => {
  const { coordinator, events } = await fixture()
  const source = await coordinator.adopt({
    profileId, sourceKey: 'save:profile-may:emerald', sourceRevision: 4, adapter: 'gen3-gba-v1',
    slots: [{ location: party(0), record: record(7, { species: 289, shiny: false }) }],
  })
  const destination = await coordinator.adopt({
    profileId, sourceKey: 'save:profile-may:ruby', sourceRevision: 8, adapter: 'gen3-gba-v1',
    slots: [{ location: party(0), record: null }],
  })
  const [sourceLease, destinationLease] = await Promise.all([
    coordinator.acquire({ profileId, sourceKey: source.sourceKey, workspaceId: 'workspace-a' }),
    coordinator.acquire({ profileId, sourceKey: destination.sourceKey, workspaceId: 'workspace-a' }),
  ])
  const pokemonInstanceId = source.placements[0].pokemonInstanceId

  const accepted = await coordinator.sync({
    profileId,
    workspaceId: 'workspace-a',
    clientSequence: 1,
    idempotencyKey: 'sync-1',
    sources: [
      { sourceKey: source.sourceKey, sourceSessionId: sourceLease.sourceSessionId, leaseToken: sourceLease.leaseToken, baseRevision: 4, placements: [{ location: party(0), pokemonInstanceId: null }] },
      { sourceKey: destination.sourceKey, sourceSessionId: destinationLease.sourceSessionId, leaseToken: destinationLease.leaseToken, baseRevision: 8, placements: [{ location: party(0), pokemonInstanceId }] },
    ],
  })

  assert.equal(accepted.status, 'accepted')
  assert.deepEqual(accepted.snapshots.map(snapshot => [snapshot.sourceKey, snapshot.sourceRevision]), [
    ['save:profile-may:emerald', 5],
    ['save:profile-may:ruby', 9],
  ])
  const movementEvents = await events.listForPokemon(profileId, pokemonInstanceId)
  assert.equal(movementEvents.filter(event => event.type === 'pokemon.placement-changed').length, 1)
})

test('accepts a Hub slot reorder while a save pane remains open in the same snapshot', async () => {
  const { coordinator } = await fixture({ validatePlacementChange: validatePokemonHubTransferPlacement })
  const game = await coordinator.adopt({
    profileId,
    sourceKey: 'save:profile-may:emerald',
    sourceRevision: 4,
    adapter: 'gen3-gba-v1',
    slots: [{ location: { kind: 'game', area: 'box', box: 0, slot: 0 }, record: record(7, { species: 289, shiny: false }) }],
  })
  const hubProfileId = '11111111-1111-4111-8111-111111111111'
  const hubSourceKey = `hub:${hubProfileId}`
  const hubSnapshot = await coordinator.ensureHubSource({ profileId, sourceKey: hubSourceKey, hubProfileId, minimumSlotCount: 2 })
  const [gameLease, hubLease] = await Promise.all([
    coordinator.acquire({ profileId, sourceKey: game.sourceKey, workspaceId: 'workspace-a' }),
    coordinator.acquire({ profileId, sourceKey: hubSourceKey, workspaceId: 'workspace-a' }),
  ])
  const pokemonInstanceId = game.placements[0].pokemonInstanceId
  const deposited = await coordinator.sync({
    profileId,
    workspaceId: 'workspace-a',
    clientSequence: 1,
    idempotencyKey: 'move-into-hub',
    sources: [
      { sourceKey: game.sourceKey, sourceSessionId: gameLease.sourceSessionId, leaseToken: gameLease.leaseToken, baseRevision: game.sourceRevision, placements: [{ location: { kind: 'game', area: 'box', box: 0, slot: 0 }, pokemonInstanceId: null }] },
      { sourceKey: hubSourceKey, sourceSessionId: hubLease.sourceSessionId, leaseToken: hubLease.leaseToken, baseRevision: hubSnapshot.sourceRevision, placements: [{ location: hub(hubProfileId, 0), pokemonInstanceId }, { location: hub(hubProfileId, 1), pokemonInstanceId: null }] },
    ],
  })
  const depositedGame = deposited.snapshots.find(snapshot => snapshot.sourceKey === game.sourceKey)
  const depositedHub = deposited.snapshots.find(snapshot => snapshot.sourceKey === hubSourceKey)

  const reordered = await coordinator.sync({
    profileId,
    workspaceId: 'workspace-a',
    clientSequence: 2,
    idempotencyKey: 'reorder-hub-slot',
    sources: [
      { sourceKey: game.sourceKey, sourceSessionId: gameLease.sourceSessionId, leaseToken: gameLease.leaseToken, baseRevision: depositedGame.sourceRevision, placements: depositedGame.placements },
      { sourceKey: hubSourceKey, sourceSessionId: hubLease.sourceSessionId, leaseToken: hubLease.leaseToken, baseRevision: depositedHub.sourceRevision, placements: [{ location: hub(hubProfileId, 0), pokemonInstanceId: null }, { location: hub(hubProfileId, 1), pokemonInstanceId }] },
    ],
  })

  assert.equal(reordered.status, 'accepted')
  assert.deepEqual((await coordinator.getSnapshot({ profileId, sourceKey: hubSourceKey })).placements.map(placement => placement.pokemonInstanceId), [null, pokemonInstanceId])
})

test('rejects a swap into an occupied destination belonging to another source', async () => {
  const { coordinator } = await fixture({ validatePlacementChange: validatePokemonHubTransferPlacement })
  const game = await coordinator.adopt({
    profileId,
    sourceKey: 'save:profile-may:emerald',
    sourceRevision: 4,
    adapter: 'gen3-gba-v1',
    slots: [{ location: { kind: 'game', area: 'box', box: 0, slot: 0 }, record: record(7, { species: 289, shiny: false }) }],
  })
  const hubProfileId = '11111111-1111-4111-8111-111111111111'
  const hubSourceKey = `hub:${hubProfileId}`
  const hubSource = await coordinator.adopt({
    profileId,
    sourceKey: hubSourceKey,
    sourceRevision: 0,
    adapter: 'hub-grid-v1',
    slots: [{ location: hub(hubProfileId, 0), record: record(8, { species: 25, shiny: false }) }],
  })
  const [gameLease, hubLease] = await Promise.all([
    coordinator.acquire({ profileId, sourceKey: game.sourceKey, workspaceId: 'workspace-a' }),
    coordinator.acquire({ profileId, sourceKey: hubSourceKey, workspaceId: 'workspace-a' }),
  ])

  await assert.rejects(() => coordinator.sync({
    profileId,
    workspaceId: 'workspace-a',
    clientSequence: 1,
    idempotencyKey: 'cross-source-swap',
    sources: [
      { sourceKey: game.sourceKey, sourceSessionId: gameLease.sourceSessionId, leaseToken: gameLease.leaseToken, baseRevision: game.sourceRevision, placements: [{ location: { kind: 'game', area: 'box', box: 0, slot: 0 }, pokemonInstanceId: hubSource.placements[0].pokemonInstanceId }] },
      { sourceKey: hubSourceKey, sourceSessionId: hubLease.sourceSessionId, leaseToken: hubLease.leaseToken, baseRevision: hubSource.sourceRevision, placements: [{ location: hub(hubProfileId, 0), pokemonInstanceId: game.placements[0].pokemonInstanceId }] },
    ],
  }), { code: 'CROSS_SOURCE_OCCUPIED' })
})

test('validates a synchronized workspace through its lease index without scanning the Redis keyspace', async () => {
  const memory = createMemoryRedisPersistence()
  const persistence = {
    ...memory,
    async keys(prefix) {
      if (prefix.startsWith(pokemonHubRedisKeys.lease(profileId, 'ignored').slice(0, -'ignored'.length))) throw new Error('Request-path lease scans are forbidden')
      return memory.keys(prefix)
    },
  }
  const coordinator = createPokemonHubSnapshotCoordinator({ persistence, eventStore: createPokemonHubEventStore({ persistence }) })
  const source = await coordinator.adopt({ profileId, sourceKey: 'save:profile-may:emerald', sourceRevision: 1, adapter: 'gen3-gba-v1', slots: [{ location: party(0), record: record(7, { species: 289 }) }] })
  const lease = await coordinator.acquire({ profileId, sourceKey: source.sourceKey, workspaceId: 'workspace-a' })

  const accepted = await coordinator.sync({
    profileId,
    workspaceId: 'workspace-a',
    clientSequence: 1,
    idempotencyKey: 'no-scan-sync',
    sources: [{ sourceKey: source.sourceKey, sourceSessionId: lease.sourceSessionId, leaseToken: lease.leaseToken, baseRevision: source.sourceRevision, placements: [{ location: party(0), pokemonInstanceId: source.placements[0].pokemonInstanceId }] }],
  })

  assert.equal(accepted.status, 'accepted')
})

test('returns a corrected snapshot rather than accepting a duplicated instance', async () => {
  const { coordinator } = await fixture()
  const source = await coordinator.adopt({ profileId, sourceKey: 'save:profile-may:emerald', sourceRevision: 4, adapter: 'gen3-gba-v1', slots: [{ location: party(0), record: record(7, { species: 289, shiny: false }) }] })
  const destination = await coordinator.adopt({ profileId, sourceKey: 'save:profile-may:ruby', sourceRevision: 8, adapter: 'gen3-gba-v1', slots: [{ location: party(0), record: null }] })
  const [sourceLease, destinationLease] = await Promise.all([
    coordinator.acquire({ profileId, sourceKey: source.sourceKey, workspaceId: 'workspace-a' }),
    coordinator.acquire({ profileId, sourceKey: destination.sourceKey, workspaceId: 'workspace-a' }),
  ])
  const pokemonInstanceId = source.placements[0].pokemonInstanceId

  const corrected = await coordinator.sync({
    profileId, workspaceId: 'workspace-a', clientSequence: 1, idempotencyKey: 'sync-duplicate',
    sources: [
      { sourceKey: source.sourceKey, sourceSessionId: sourceLease.sourceSessionId, leaseToken: sourceLease.leaseToken, baseRevision: 4, placements: [{ location: party(0), pokemonInstanceId }] },
      { sourceKey: destination.sourceKey, sourceSessionId: destinationLease.sourceSessionId, leaseToken: destinationLease.leaseToken, baseRevision: 8, placements: [{ location: party(0), pokemonInstanceId }] },
    ],
  })

  assert.equal(corrected.status, 'corrected')
  assert.equal(corrected.code, 'DUPLICATE_INSTANCE_CORRECTED')
  assert.equal(corrected.snapshots[0].placements[0].pokemonInstanceId, pokemonInstanceId)
  assert.equal(corrected.snapshots[1].placements[0].pokemonInstanceId, null)
})

test('persists a first-admission Hub passport only after the rule policy permits the export', async () => {
  const { coordinator } = await fixture({ validatePlacementChange: createPokemonHubTransferPlacementPolicy() })
  const game = await coordinator.adopt({
    profileId,
    sourceKey: 'save:profile-may:ruby',
    sourceRevision: 4,
    adapter: 'gen3-gba-v1',
    transferCapability: { title: 'pokemon-ruby', ordinaryTradeReady: true, nationalDexUnlocked: false, networkMachineRestored: false },
    slots: [
      { location: { kind: 'game', area: 'box', box: 0, slot: 0 }, record: record(7, { species: 252, shiny: false, isEgg: false }) },
      { location: { kind: 'game', area: 'box', box: 0, slot: 1 }, record: record(8, { species: 253, shiny: false, isEgg: false }) },
    ],
  })
  const hubProfileId = '11111111-1111-4111-8111-111111111111'
  const hubSource = await coordinator.ensureHubSource({ profileId, sourceKey: `hub:${hubProfileId}`, hubProfileId, minimumSlotCount: 1 })
  const [gameLease, hubLease] = await Promise.all([
    coordinator.acquire({ profileId, sourceKey: game.sourceKey, workspaceId: 'workspace-passport' }),
    coordinator.acquire({ profileId, sourceKey: hubSource.sourceKey, workspaceId: 'workspace-passport' }),
  ])
  const pokemonInstanceId = game.placements[0].pokemonInstanceId

  const accepted = await coordinator.sync({
    profileId, workspaceId: 'workspace-passport', clientSequence: 1, idempotencyKey: 'admit-ruby',
    sources: [
      { sourceKey: game.sourceKey, sourceSessionId: gameLease.sourceSessionId, leaseToken: gameLease.leaseToken, baseRevision: game.sourceRevision, placements: [{ location: { kind: 'game', area: 'box', box: 0, slot: 0 }, pokemonInstanceId: null }, game.placements[1]] },
      { sourceKey: hubSource.sourceKey, sourceSessionId: hubLease.sourceSessionId, leaseToken: hubLease.leaseToken, baseRevision: hubSource.sourceRevision, placements: [{ location: hub(hubProfileId, 0), pokemonInstanceId }] },
    ],
  })

  assert.equal(accepted.status, 'accepted')
  assert.deepEqual((await coordinator.getSaveFlushPlan({ profileId, sourceKey: hubSource.sourceKey })).records.get(pokemonInstanceId).hubPassport, { sourceTitle: 'pokemon-ruby', sourceFamily: 'hoenn-rs' })
})

test('returns an authoritative correction with a placement-rule reason without changing either source', async () => {
  const reason = { code: 'TRANSFER_NATIONAL_DEX_REQUIRED', message: 'Este save ainda não pode enviar ou receber esse Pokémon sem a Pokédex Nacional.' }
  const { coordinator } = await fixture({ validatePlacementChange: () => ({ allowed: false, reason }) })
  const source = await coordinator.adopt({ profileId, sourceKey: 'save:profile-may:emerald', sourceRevision: 4, adapter: 'gen3-gba-v1', slots: [{ location: party(0), record: record(7, { species: 289, shiny: false }) }] })
  const destination = await coordinator.adopt({ profileId, sourceKey: 'save:profile-may:firered', sourceRevision: 8, adapter: 'gen3-gba-v1', slots: [{ location: party(0), record: null }] })
  const [sourceLease, destinationLease] = await Promise.all([
    coordinator.acquire({ profileId, sourceKey: source.sourceKey, workspaceId: 'workspace-a' }),
    coordinator.acquire({ profileId, sourceKey: destination.sourceKey, workspaceId: 'workspace-a' }),
  ])

  const corrected = await coordinator.sync({
    profileId, workspaceId: 'workspace-a', clientSequence: 1, idempotencyKey: 'blocked-by-rule',
    sources: [
      { sourceKey: source.sourceKey, sourceSessionId: sourceLease.sourceSessionId, leaseToken: sourceLease.leaseToken, baseRevision: source.sourceRevision, placements: [{ location: party(0), pokemonInstanceId: null }] },
      { sourceKey: destination.sourceKey, sourceSessionId: destinationLease.sourceSessionId, leaseToken: destinationLease.leaseToken, baseRevision: destination.sourceRevision, placements: [{ location: party(0), pokemonInstanceId: source.placements[0].pokemonInstanceId }] },
    ],
  })

  assert.equal(corrected.status, 'corrected')
  assert.equal(corrected.code, 'TRANSFER_NATIONAL_DEX_REQUIRED')
  assert.deepEqual(corrected.reason, reason)
  assert.equal(corrected.snapshots.find(snapshot => snapshot.sourceKey === source.sourceKey).placements[0].pokemonInstanceId, source.placements[0].pokemonInstanceId)
  assert.equal(corrected.snapshots.find(snapshot => snapshot.sourceKey === destination.sourceKey).placements[0].pokemonInstanceId, null)
})

test('rejects an identifier that is not authorized by a leased source', async () => {
  const { coordinator } = await fixture()
  const source = await coordinator.adopt({ profileId, sourceKey: 'save:profile-may:emerald', sourceRevision: 4, adapter: 'gen3-gba-v1', slots: [{ location: party(0), record: null }] })
  const lease = await coordinator.acquire({ profileId, sourceKey: source.sourceKey, workspaceId: 'workspace-a' })

  await assert.rejects(() => coordinator.sync({
    profileId, workspaceId: 'workspace-a', clientSequence: 1, idempotencyKey: 'sync-invented',
    sources: [{ sourceKey: source.sourceKey, sourceSessionId: lease.sourceSessionId, leaseToken: lease.leaseToken, baseRevision: 4, placements: [{ location: party(0), pokemonInstanceId: 'invented' }] }],
  }), error => error.code === 'POKEMON_UNAUTHORIZED')
})

test('authorizes membership before record access and skips records for unchanged placements', async () => {
  const { coordinator, persistence } = await fixture()
  const source = await coordinator.adopt({
    profileId,
    sourceKey: 'save:profile-may:emerald',
    sourceRevision: 4,
    adapter: 'gen3-gba-v1',
    slots: [{ location: party(0), record: record(7, { species: 289, shiny: false }) }],
  })
  const lease = await coordinator.acquire({ profileId, sourceKey: source.sourceKey, workspaceId: 'workspace-read-count' })
  const originalGet = persistence.get.bind(persistence)
  let recordReads = 0
  persistence.get = async key => {
    if (key.includes(':record:')) recordReads += 1
    return originalGet(key)
  }

  await coordinator.sync({
    profileId,
    workspaceId: 'workspace-read-count',
    clientSequence: 1,
    idempotencyKey: 'unchanged-no-record-read',
    sources: [{ sourceKey: source.sourceKey, sourceSessionId: lease.sourceSessionId, leaseToken: lease.leaseToken, baseRevision: source.sourceRevision, placements: lease.placements }],
  })
  assert.equal(recordReads, 0)

  recordReads = 0
  await assert.rejects(() => coordinator.sync({
    profileId,
    workspaceId: 'workspace-read-count',
    clientSequence: 2,
    idempotencyKey: 'invented-before-record-read',
    sources: [{ sourceKey: source.sourceKey, sourceSessionId: lease.sourceSessionId, leaseToken: lease.leaseToken, baseRevision: source.sourceRevision, placements: [{ location: party(0), pokemonInstanceId: 'invented-id' }] }],
  }), error => error.code === 'POKEMON_UNAUTHORIZED')
  assert.equal(recordReads, 0)
})

test('rejects a known instance when its current source is not part of the leased snapshot', async () => {
  const { coordinator } = await fixture()
  const source = await coordinator.adopt({ profileId, sourceKey: 'save:profile-may:emerald', sourceRevision: 4, adapter: 'gen3-gba-v1', slots: [{ location: party(0), record: null }] })
  const destination = await coordinator.adopt({ profileId, sourceKey: 'save:profile-may:ruby', sourceRevision: 8, adapter: 'gen3-gba-v1', slots: [{ location: party(0), record: null }] })
  const outside = await coordinator.adopt({ profileId, sourceKey: 'save:profile-may:sapphire', sourceRevision: 3, adapter: 'gen3-gba-v1', slots: [{ location: party(0), record: record(9, { species: 64, shiny: false }) }] })
  const [sourceLease, destinationLease] = await Promise.all([
    coordinator.acquire({ profileId, sourceKey: source.sourceKey, workspaceId: 'workspace-a' }),
    coordinator.acquire({ profileId, sourceKey: destination.sourceKey, workspaceId: 'workspace-a' }),
  ])
  const pokemonInstanceId = outside.placements[0].pokemonInstanceId

  await assert.rejects(() => coordinator.sync({
    profileId, workspaceId: 'workspace-a', clientSequence: 1, idempotencyKey: 'sync-unleased-instance',
    sources: [
      { sourceKey: source.sourceKey, sourceSessionId: sourceLease.sourceSessionId, leaseToken: sourceLease.leaseToken, baseRevision: 4, placements: [{ location: party(0), pokemonInstanceId: null }] },
      { sourceKey: destination.sourceKey, sourceSessionId: destinationLease.sourceSessionId, leaseToken: destinationLease.leaseToken, baseRevision: 8, placements: [{ location: party(0), pokemonInstanceId }] },
    ],
  }), error => error.code === 'POKEMON_UNAUTHORIZED')

  const stillOutside = await coordinator.acquire({ profileId, sourceKey: outside.sourceKey, workspaceId: 'workspace-a' })
  assert.equal(stillOutside.placements[0].pokemonInstanceId, pokemonInstanceId)
})

test('requires a complete placement map for every source leased by the workspace', async () => {
  const { coordinator } = await fixture()
  const first = await coordinator.adopt({ profileId, sourceKey: 'save:profile-may:emerald', sourceRevision: 4, adapter: 'gen3-gba-v1', slots: [{ location: party(0), record: null }] })
  const second = await coordinator.adopt({ profileId, sourceKey: 'save:profile-may:ruby', sourceRevision: 8, adapter: 'gen3-gba-v1', slots: [{ location: party(0), record: null }] })
  const [firstLease] = await Promise.all([
    coordinator.acquire({ profileId, sourceKey: first.sourceKey, workspaceId: 'workspace-a' }),
    coordinator.acquire({ profileId, sourceKey: second.sourceKey, workspaceId: 'workspace-a' }),
  ])

  await assert.rejects(() => coordinator.sync({
    profileId, workspaceId: 'workspace-a', clientSequence: 1, idempotencyKey: 'sync-incomplete-source-set',
    sources: [{ sourceKey: first.sourceKey, sourceSessionId: firstLease.sourceSessionId, leaseToken: firstLease.leaseToken, baseRevision: 4, placements: [{ location: party(0), pokemonInstanceId: null }] }],
  }), error => error.code === 'SOURCE_SET_INCOMPLETE')
})

test('keeps the logical snapshot revision independent from a flushed save revision', async () => {
  const { coordinator } = await fixture()
  await coordinator.adopt({ profileId, sourceKey: 'save:profile-may:emerald', sourceRevision: 4, adapter: 'gen3-gba-v1', slots: [{ location: party(0), record: null }] })

  await coordinator.markSaveFlushed({ profileId, sourceKey: 'save:profile-may:emerald', sourceRevision: 4, saveRevision: 9 })
  const flushed = await coordinator.getSaveFlushPlan({ profileId, sourceKey: 'save:profile-may:emerald' })
  await coordinator.adopt({ profileId, sourceKey: 'save:profile-may:emerald', sourceRevision: 10, adapter: 'gen3-gba-v1', slots: [{ location: party(0), record: null }] })
  const reimported = await coordinator.getSaveFlushPlan({ profileId, sourceKey: 'save:profile-may:emerald' })

  assert.equal(flushed.source.sourceRevision, 4)
  assert.equal(flushed.source.saveRevision, 9)
  assert.equal(reimported.source.sourceRevision, 5)
  assert.equal(reimported.source.saveRevision, 10)
})

test('releases a valid source lease so another workspace can acquire it after a final flush', async () => {
  const { coordinator } = await fixture()
  const source = await coordinator.adopt({ profileId, sourceKey: 'save:profile-may:emerald', sourceRevision: 4, adapter: 'gen3-gba-v1', slots: [{ location: party(0), record: null }] })
  const firstLease = await coordinator.acquire({ profileId, sourceKey: source.sourceKey, workspaceId: 'workspace-a' })

  await coordinator.release({ profileId, sourceKey: source.sourceKey, workspaceId: 'workspace-a', sourceSessionId: firstLease.sourceSessionId, leaseToken: firstLease.leaseToken })
  const nextLease = await coordinator.acquire({ profileId, sourceKey: source.sourceKey, workspaceId: 'workspace-b' })

  assert.notEqual(nextLease.sourceSessionId, firstLease.sourceSessionId)
})

test('keeps an expired lease unavailable until the final-flush worker releases it', async () => {
  const { coordinator, setTime } = await fixture()
  const source = await coordinator.adopt({ profileId, sourceKey: 'save:profile-may:emerald', sourceRevision: 4, adapter: 'gen3-gba-v1', slots: [{ location: party(0), record: null }] })
  const lease = await coordinator.acquire({ profileId, sourceKey: source.sourceKey, workspaceId: 'workspace-a' })
  setTime(lease.expiresAt)

  const expired = await coordinator.listExpiredLeases()
  await assert.rejects(() => coordinator.acquire({ profileId, sourceKey: source.sourceKey, workspaceId: 'workspace-b' }), error => error.code === 'SOURCE_FLUSH_PENDING')
  await coordinator.releaseExpiredLease(expired[0])
  const acquired = await coordinator.acquire({ profileId, sourceKey: source.sourceKey, workspaceId: 'workspace-b' })

  assert.deepEqual(expired.map(item => item.sourceKey), [source.sourceKey])
  assert.equal(acquired.sourceKey, source.sourceKey)
})

test('finds expired leases through the expiry index without scanning the Redis keyspace', async () => {
  let instant = Date.parse('2026-09-17T12:00:00.000Z')
  const memory = createMemoryRedisPersistence()
  const persistence = {
    ...memory,
    async keys() { throw new Error('Expired lease observation must not scan Redis') },
  }
  const coordinator = createPokemonHubSnapshotCoordinator({
    persistence,
    eventStore: createPokemonHubEventStore({ persistence, now: () => new Date(instant) }),
    now: () => new Date(instant),
  })
  const source = await coordinator.adopt({ profileId, sourceKey: 'save:profile-may:emerald', sourceRevision: 4, adapter: 'gen3-gba-v1', slots: [{ location: party(0), record: null }] })
  const lease = await coordinator.acquire({ profileId, sourceKey: source.sourceKey, workspaceId: 'workspace-a' })
  instant = lease.expiresAt

  const expired = await coordinator.listExpiredLeases()

  assert.deepEqual(expired.map(item => item.sourceKey), [source.sourceKey])
})

test('renews an active source handshake only with its current session credentials', async () => {
  const { coordinator, setTime } = await fixture()
  const source = await coordinator.adopt({ profileId, sourceKey: 'save:profile-may:emerald', sourceRevision: 4, adapter: 'gen3-gba-v1', slots: [{ location: party(0), record: null }] })
  const lease = await coordinator.acquire({ profileId, sourceKey: source.sourceKey, workspaceId: 'workspace-a' })
  setTime(Date.parse('2026-09-17T12:00:06.000Z'))

  const renewed = await coordinator.renew({ profileId, sourceKey: source.sourceKey, workspaceId: 'workspace-a', sourceSessionId: lease.sourceSessionId, leaseToken: lease.leaseToken })

  assert.ok(renewed.expiresAt > lease.expiresAt)
  await assert.rejects(() => coordinator.renew({ profileId, sourceKey: source.sourceKey, workspaceId: 'workspace-a', sourceSessionId: lease.sourceSessionId, leaseToken: 'wrong' }), error => error.code === 'LEASE_INVALID')
})

test('rejects a change the save materialization policy cannot write before accepting its snapshot', async () => {
  const { coordinator } = await fixture({
    validatePlacementChange: ({ origin, destination }) => {
      if (origin.location.area === 'party' || destination.location.area === 'party') {
        const error = new Error('Party placement changes require a verified Party writer.')
        error.code = 'SAVE_MATERIALIZATION_UNSUPPORTED'
        throw error
      }
    },
  })
  const source = await coordinator.adopt({ profileId, sourceKey: 'save:profile-may:emerald', sourceRevision: 4, adapter: 'gen3-gba-v1', slots: [{ location: party(0), record: record(7, { species: 289, shiny: false }) }] })
  const destination = await coordinator.adopt({ profileId, sourceKey: 'save:profile-may:ruby', sourceRevision: 8, adapter: 'gen3-gba-v1', slots: [{ location: party(0), record: null }] })
  const [sourceLease, destinationLease] = await Promise.all([
    coordinator.acquire({ profileId, sourceKey: source.sourceKey, workspaceId: 'workspace-a' }),
    coordinator.acquire({ profileId, sourceKey: destination.sourceKey, workspaceId: 'workspace-a' }),
  ])

  await assert.rejects(() => coordinator.sync({
    profileId, workspaceId: 'workspace-a', clientSequence: 1, idempotencyKey: 'sync-party-change',
    sources: [
      { sourceKey: source.sourceKey, sourceSessionId: sourceLease.sourceSessionId, leaseToken: sourceLease.leaseToken, baseRevision: 4, placements: [{ location: party(0), pokemonInstanceId: null }] },
      { sourceKey: destination.sourceKey, sourceSessionId: destinationLease.sourceSessionId, leaseToken: destinationLease.leaseToken, baseRevision: 8, placements: [{ location: party(0), pokemonInstanceId: source.placements[0].pokemonInstanceId }] },
    ],
  }), error => error.code === 'SAVE_MATERIALIZATION_UNSUPPORTED')
})
