import assert from 'node:assert/strict'
import test from 'node:test'

import { createPokemonHubEventStore } from './pokemon-hub-event-store.mjs'
import { createPokemonHubSnapshotCoordinator } from './pokemon-hub-snapshot-coordinator.mjs'
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
  })
  return { persistence, events, coordinator, setTime: value => { instant = value } }
}

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

  assert.equal((await coordinator.getSaveFlushPlan({ profileId, sourceKey: source.sourceKey })).source.needsSaveFlush, true)
  await coordinator.markSaveFlushed({ profileId, sourceKey: source.sourceKey, saveRevision: 5 })
  assert.equal((await coordinator.getSaveFlushPlan({ profileId, sourceKey: source.sourceKey })).source.needsSaveFlush, false)
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

test('validates a synchronized workspace through its lease index without scanning the Redis keyspace', async () => {
  const memory = createMemoryRedisPersistence()
  const persistence = {
    ...memory,
    async keys(prefix) {
      if (prefix.startsWith('pokemon-hub:snapshot-lease:')) throw new Error('Request-path lease scans are forbidden')
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

test('rejects an identifier that was not adopted by the backend', async () => {
  const { coordinator } = await fixture()
  const source = await coordinator.adopt({ profileId, sourceKey: 'save:profile-may:emerald', sourceRevision: 4, adapter: 'gen3-gba-v1', slots: [{ location: party(0), record: null }] })
  const lease = await coordinator.acquire({ profileId, sourceKey: source.sourceKey, workspaceId: 'workspace-a' })

  await assert.rejects(() => coordinator.sync({
    profileId, workspaceId: 'workspace-a', clientSequence: 1, idempotencyKey: 'sync-invented',
    sources: [{ sourceKey: source.sourceKey, sourceSessionId: lease.sourceSessionId, leaseToken: lease.leaseToken, baseRevision: 4, placements: [{ location: party(0), pokemonInstanceId: 'invented' }] }],
  }), error => error.code === 'POKEMON_UNKNOWN')
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

  await coordinator.markSaveFlushed({ profileId, sourceKey: 'save:profile-may:emerald', saveRevision: 9 })
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
