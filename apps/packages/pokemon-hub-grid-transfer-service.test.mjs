import assert from 'node:assert/strict'
import test from 'node:test'

import { createPokemonHubEventStore } from './pokemon-hub-event-store.mjs'
import { createPokemonHubGridTransferService } from './pokemon-hub-grid-transfer-service.mjs'
import { createPokemonHubSnapshotCoordinator } from './pokemon-hub-snapshot-coordinator.mjs'
import { createMemoryRedisPersistence } from './redis-persistence.mjs'
import { validatePokemonHubTransferPlacement } from './pokemon-hub-transfer-placement-policy.mjs'

const profileId = 'profile-may'
const hubProfileId = '11111111-1111-4111-8111-111111111111'
const gameSourceKey = 'save:profile-may:emerald'
const hubSourceKey = `hub:${hubProfileId}`
const gameLocation = { kind: 'game', area: 'box', box: 0, slot: 0 }
const hubLocation = { kind: 'hub', hubProfileId, slot: 0 }

function requestSource(snapshot) {
  return {
    sourceKey: snapshot.sourceKey,
    sourceSessionId: snapshot.sourceSessionId,
    leaseToken: snapshot.leaseToken,
    baseRevision: snapshot.sourceRevision,
    placements: snapshot.placements.map(placement => ({ location: placement.location, pokemonInstanceId: placement.pokemonInstanceId })),
  }
}

async function fixture() {
  const persistence = createMemoryRedisPersistence()
  const events = createPokemonHubEventStore({ persistence })
  const coordinator = createPokemonHubSnapshotCoordinator({ persistence, eventStore: events, validatePlacementChange: validatePokemonHubTransferPlacement })
  const profiles = [{ hubProfileId, name: 'Transfer box', grid: { entries: {} } }]
  const profileStore = {
    async bindOwner(id, ownerProfileId) {
      const profile = profiles.find(candidate => candidate.hubProfileId === id)
      if (!profile) throw new Error('missing profile')
      if (profile.ownerProfileId && profile.ownerProfileId !== ownerProfileId) {
        const error = new Error('owner conflict')
        error.code = 'POKEMON_HUB_PROFILE_OWNER_CONFLICT'
        throw error
      }
      profile.ownerProfileId = ownerProfileId
      return structuredClone(profile)
    },
  }
  const service = createPokemonHubGridTransferService({ coordinator, profileStore })
  const game = await coordinator.adopt({
    profileId,
    sourceKey: gameSourceKey,
    sourceRevision: 4,
    adapter: 'gen3-gba-v1',
    slots: [{ location: gameLocation, record: { representation: { adapter: 'gen3-gba-v1', kind: 'pc-record', bytes: Buffer.alloc(80, 7) }, display: { species: 25, shiny: false } } }],
  })
  const lease = await coordinator.acquire({ profileId, sourceKey: game.sourceKey, workspaceId: 'workspace-a' })
  return { coordinator, events, service, lease }
}

test('moves an opaque Box record into and back from a Hub grid with one placement event per move', async () => {
  const { coordinator, events, service, lease } = await fixture()
  await coordinator.ensureHubSource({ profileId, sourceKey: hubSourceKey, hubProfileId, minimumSlotCount: 1 })
  const hubLease = await coordinator.acquire({ profileId, sourceKey: hubSourceKey, workspaceId: 'workspace-a' })

  const deposited = await service.transfer({
    profileId,
    workspaceId: 'workspace-a',
    idempotencyKey: 'deposit-1',
    clientSequence: 1,
    source: { kind: 'game', gameId: 'emerald', profileId, area: 'box', box: 0, slot: 0 },
    target: { kind: 'hub', hubProfileId, slot: 0 },
    sources: [requestSource(lease), requestSource(hubLease)],
  })

  const pokemonInstanceId = deposited.hubProfile.grid.entries[0].pokemonInstanceId
  assert.equal(deposited.status, 'accepted')
  assert.equal(deposited.hubProfile.grid.entries[0].species, 25)
  assert.equal(deposited.snapshots.find(snapshot => snapshot.sourceKey === gameSourceKey).placements[0].pokemonInstanceId, null)
  assert.equal(deposited.snapshots.find(snapshot => snapshot.sourceKey === hubSourceKey).placements[0].pokemonInstanceId, pokemonInstanceId)
  assert.equal((await events.listForPokemon(profileId, pokemonInstanceId)).filter(event => event.type === 'pokemon.placement-changed').length, 1)

  const gameSnapshot = deposited.snapshots.find(snapshot => snapshot.sourceKey === gameSourceKey)
  const hubSnapshot = deposited.snapshots.find(snapshot => snapshot.sourceKey === hubSourceKey)
  const returned = await service.transfer({
    profileId,
    workspaceId: 'workspace-a',
    idempotencyKey: 'withdraw-1',
    clientSequence: 2,
    source: { kind: 'hub', hubProfileId, slot: 0 },
    target: { kind: 'game', gameId: 'emerald', profileId, area: 'box', box: 0, slot: 0 },
    sources: [
      requestSource({ ...gameSnapshot, sourceSessionId: lease.sourceSessionId, leaseToken: lease.leaseToken }),
      requestSource({ ...hubSnapshot, sourceSessionId: hubLease.sourceSessionId, leaseToken: hubLease.leaseToken }),
    ],
  })

  assert.deepEqual(returned.hubProfile.grid.entries, {})
  assert.equal(returned.snapshots.find(snapshot => snapshot.sourceKey === gameSourceKey).placements[0].pokemonInstanceId, pokemonInstanceId)
  assert.equal((await events.listForPokemon(profileId, pokemonInstanceId)).filter(event => event.type === 'pokemon.placement-changed').length, 2)
  const finalHubSnapshot = await coordinator.ensureHubSource({ profileId, sourceKey: hubSourceKey, hubProfileId, minimumSlotCount: 1 })
  assert.equal(finalHubSnapshot.placements[0].pokemonInstanceId, null)
})

test('rejects a Party transfer before changing an authoritative snapshot', async () => {
  const { coordinator, service, lease } = await fixture()

  await assert.rejects(() => service.transfer({
    profileId,
    workspaceId: 'workspace-a',
    idempotencyKey: 'party-1',
    clientSequence: 1,
    source: { kind: 'game', gameId: 'emerald', profileId, area: 'party', slot: 0 },
    target: { kind: 'hub', hubProfileId, slot: 0 },
    sources: [requestSource(lease)],
  }), { code: 'SAVE_MATERIALIZATION_UNSUPPORTED' })

  const source = await coordinator.getSaveFlushPlan({ profileId, sourceKey: gameSourceKey })
  assert.notEqual(source.source.placements[0].pokemonInstanceId, null)
})
