import assert from 'node:assert/strict'
import test from 'node:test'

import { createPokemonHubEventStore } from './pokemon-hub-event-store.mjs'
import { createPokemonHubSnapshotCoordinator } from './pokemon-hub-snapshot-coordinator.mjs'
import { createMemoryRedisPersistence } from './redis-persistence.mjs'

const profileId = 'profile-may'
const party = slot => ({ kind: 'game', area: 'party', slot })

function record(seed, display) {
  return { representation: { adapter: 'gen3-gba-v1', kind: 'pc-record', bytes: Buffer.alloc(80, seed) }, display }
}

async function fixture() {
  const persistence = createMemoryRedisPersistence()
  const events = createPokemonHubEventStore({ persistence, now: () => new Date('2026-09-17T12:00:00.000Z') })
  const coordinator = createPokemonHubSnapshotCoordinator({
    persistence,
    eventStore: events,
    now: () => new Date('2026-09-17T12:00:00.000Z'),
    newId: (() => { let value = 0; return () => `00000000-0000-4000-8000-${String(++value).padStart(12, '0')}` })(),
  })
  return { persistence, events, coordinator }
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
