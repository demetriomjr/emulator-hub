import assert from 'node:assert/strict'
import test from 'node:test'

import { createPokemonHubEventStore } from './pokemon-hub-event-store.mjs'
import { createMemoryRedisPersistence } from './redis-persistence.mjs'

function event(overrides = {}) {
  return {
    profileId: 'profile-may',
    pokemonInstanceId: 'pokemon-alpha',
    operationId: 'snapshot-41',
    type: 'pokemon.placement-changed',
    source: { sourceKey: 'save:may:emerald', location: { kind: 'game', area: 'box', box: 0, slot: 1 } },
    destination: { sourceKey: 'hub:living-dex', location: { kind: 'hub', slot: 4 } },
    sourceRevision: 7,
    destinationRevision: 12,
    adapter: { source: 'gen3-gba-v1', destination: 'hub-v1', capabilityVersion: '1' },
    representationHashes: { source: 'a'.repeat(64), destination: 'b'.repeat(64) },
    ...overrides,
  }
}

test('stores an immutable movement event outside the Pokemon document collection', async () => {
  const persistence = createMemoryRedisPersistence()
  const events = createPokemonHubEventStore({ persistence, now: () => new Date('2026-09-17T12:00:00.000Z') })

  const created = await events.append(event())

  assert.deepEqual(created, {
    schemaVersion: 1,
    eventId: created.eventId,
    profileId: 'profile-may',
    pokemonInstanceId: 'pokemon-alpha',
    operationId: 'snapshot-41',
    type: 'pokemon.placement-changed',
    occurredAt: '2026-09-17T12:00:00.000Z',
    source: { sourceKey: 'save:may:emerald', location: { kind: 'game', area: 'box', box: 0, slot: 1 } },
    destination: { sourceKey: 'hub:living-dex', location: { kind: 'hub', slot: 4 } },
    sourceRevision: 7,
    destinationRevision: 12,
    adapter: { source: 'gen3-gba-v1', destination: 'hub-v1', capabilityVersion: '1' },
    representationHashes: { source: 'a'.repeat(64), destination: 'b'.repeat(64) },
  })
  assert.equal(await persistence.get(`pokemon-hub:pokemon:profile-may:pokemon-alpha`), null)
  assert.equal((await events.listForPokemon('profile-may', 'pokemon-alpha')).length, 1)
})

test('returns the original event when an accepted operation is retried', async () => {
  const events = createPokemonHubEventStore({ persistence: createMemoryRedisPersistence() })
  const first = await events.append(event())
  const retried = await events.append(event({ occurredAt: '2026-09-18T12:00:00.000Z' }))

  assert.deepEqual(retried, first)
  assert.deepEqual(await events.listForPokemon('profile-may', 'pokemon-alpha'), [first])
})

test('rejects raw save representations and rich gameplay fields from event data', async () => {
  const events = createPokemonHubEventStore({ persistence: createMemoryRedisPersistence() })

  await assert.rejects(() => events.append(event({ bytesBase64: 'AA==' })), /not allowed/i)
  await assert.rejects(() => events.append(event({ canonical: { ribbons: ['champion'] } })), /not allowed/i)
  await assert.rejects(() => events.append(event({ representationHashes: { source: 'not-a-hash' } })), /hash/i)
})

test('records observation events without inventing a destination', async () => {
  const events = createPokemonHubEventStore({ persistence: createMemoryRedisPersistence() })

  const observed = await events.append(event({
    operationId: 'import-1',
    type: 'pokemon.observed',
    destination: undefined,
    destinationRevision: undefined,
    adapter: { source: 'gen3-gba-v1', capabilityVersion: '1' },
    representationHashes: { source: 'a'.repeat(64) },
  }))

  assert.equal(observed.type, 'pokemon.observed')
  assert.equal(observed.destination, null)
  assert.equal(observed.destinationRevision, null)
  assert.equal(observed.adapter.destination, null)
  assert.equal(observed.representationHashes.destination, null)
})
