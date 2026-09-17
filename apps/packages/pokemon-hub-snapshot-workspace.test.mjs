import assert from 'node:assert/strict'
import test from 'node:test'

import { acknowledgePokemonHubSnapshotRequest, beginPokemonHubSnapshotRequest, createPokemonHubSnapshotRequest, createPokemonHubSnapshotWorkspace, movePokemonHubSnapshotPlacement, retryPokemonHubSnapshotRequest } from './pokemon-hub-snapshot-workspace.mjs'

const party = slot => ({ kind: 'game', area: 'party', slot })
const box = (boxIndex, slot) => ({ kind: 'game', area: 'box', box: boxIndex, slot })

function source({ sourceKey, revision, adapter, placements, receivePolicy = { acceptsAdapters: ['gen3-gba-v1'] }, status = 'ready' }) {
  return {
    sourceKey,
    sourceSessionId: `${sourceKey}:session`,
    leaseToken: `${sourceKey}:lease`,
    sourceRevision: revision,
    adapter,
    receivePolicy,
    status,
    placements,
    pokemonDisplay: {
      alpha: { species: 289, shiny: false },
      beta: { species: 64, shiny: true },
    },
  }
}

function fixture() {
  return createPokemonHubSnapshotWorkspace({
    workspaceId: 'workspace-may',
    sources: [
      source({
        sourceKey: 'save:may:ruby',
        revision: 7,
        adapter: 'gen3-gba-v1',
        placements: [
          { location: party(0), pokemonInstanceId: null },
          { location: box(0, 0), pokemonInstanceId: 'beta' },
        ],
      }),
      source({
        sourceKey: 'save:may:emerald',
        revision: 4,
        adapter: 'gen3-gba-v1',
        placements: [
          { location: party(0), pokemonInstanceId: 'alpha' },
          { location: box(0, 0), pokemonInstanceId: null },
        ],
      }),
    ],
  })
}

test('moves an instance between ready compatible saves and serializes one complete ordered snapshot', () => {
  const state = fixture()
  const moved = movePokemonHubSnapshotPlacement(
    state,
    { sourceKey: 'save:may:emerald', location: party(0) },
    { sourceKey: 'save:may:ruby', location: party(0) },
  )

  assert.equal(moved.action, 'move')
  assert.equal(moved.sources['save:may:emerald'].optimisticPlacements[0].pokemonInstanceId, null)
  assert.equal(moved.sources['save:may:ruby'].optimisticPlacements[0].pokemonInstanceId, 'alpha')
  assert.equal(state.sources['save:may:emerald'].optimisticPlacements[0].pokemonInstanceId, 'alpha')

  assert.deepEqual(createPokemonHubSnapshotRequest(moved, { clientSequence: 1, idempotencyKey: 'sync-1' }), {
    workspaceId: 'workspace-may',
    clientSequence: 1,
    idempotencyKey: 'sync-1',
    sources: [
      {
        sourceKey: 'save:may:emerald',
        sourceSessionId: 'save:may:emerald:session',
        leaseToken: 'save:may:emerald:lease',
        baseRevision: 4,
        placements: [
          { location: party(0), pokemonInstanceId: null },
          { location: box(0, 0), pokemonInstanceId: null },
        ],
      },
      {
        sourceKey: 'save:may:ruby',
        sourceSessionId: 'save:may:ruby:session',
        leaseToken: 'save:may:ruby:lease',
        baseRevision: 7,
        placements: [
          { location: party(0), pokemonInstanceId: 'alpha' },
          { location: box(0, 0), pokemonInstanceId: 'beta' },
        ],
      },
    ],
  })
})

test('swaps occupied placements only inside one ready source', () => {
  const moved = movePokemonHubSnapshotPlacement(
    fixture(),
    { sourceKey: 'save:may:emerald', location: party(0) },
    { sourceKey: 'save:may:ruby', location: box(0, 0) },
  )

  assert.equal(moved.action, 'none')

  const state = createPokemonHubSnapshotWorkspace({
    workspaceId: 'workspace-may',
    sources: [source({
      sourceKey: 'save:may:emerald', revision: 4, adapter: 'gen3-gba-v1',
      placements: [{ location: party(0), pokemonInstanceId: 'alpha' }, { location: party(1), pokemonInstanceId: 'beta' }],
    })],
  })
  const swapped = movePokemonHubSnapshotPlacement(state, { sourceKey: 'save:may:emerald', location: party(0) }, { sourceKey: 'save:may:emerald', location: party(1) })

  assert.equal(swapped.action, 'swap')
  assert.deepEqual(swapped.sources['save:may:emerald'].optimisticPlacements, [
    { location: party(0), pokemonInstanceId: 'beta' },
    { location: party(1), pokemonInstanceId: 'alpha' },
  ])
})

test('does not optimistically move when a source is not ready or the receiver rejects the adapter', () => {
  const state = fixture()
  const unavailableState = { ...state, sources: { ...state.sources, 'save:may:ruby': { ...state.sources['save:may:ruby'], status: 'lease-lost' } } }
  const incompatibleState = { ...state, sources: { ...state.sources, 'save:may:ruby': { ...state.sources['save:may:ruby'], receivePolicy: { acceptsAdapters: [] } } } }
  const unavailable = movePokemonHubSnapshotPlacement(
    unavailableState,
    { sourceKey: 'save:may:emerald', location: party(0) },
    { sourceKey: 'save:may:ruby', location: party(0) },
  )
  const incompatible = movePokemonHubSnapshotPlacement(
    incompatibleState,
    { sourceKey: 'save:may:emerald', location: party(0) },
    { sourceKey: 'save:may:ruby', location: party(0) },
  )

  assert.equal(unavailable.action, 'none')
  assert.equal(incompatible.action, 'none')
  assert.equal(unavailable.sources, unavailableState.sources)
  assert.equal(incompatible.sources, incompatibleState.sources)
})

test('rejects payload generation when the optimistic snapshot contains duplicate identifiers', () => {
  const state = fixture()
  const duplicate = {
    ...state,
    sources: {
      ...state.sources,
      'save:may:ruby': {
        ...state.sources['save:may:ruby'],
        optimisticPlacements: [{ location: party(0), pokemonInstanceId: 'alpha' }, { location: box(0, 0), pokemonInstanceId: 'beta' }],
      },
    },
  }

  assert.throws(() => createPokemonHubSnapshotRequest(duplicate, { clientSequence: 1, idempotencyKey: 'sync-1' }), /duplicate/i)
})

test('rebuilds a queued full snapshot with accepted source revisions after an in-flight acknowledgement', () => {
  const firstMove = movePokemonHubSnapshotPlacement(
    fixture(),
    { sourceKey: 'save:may:emerald', location: party(0) },
    { sourceKey: 'save:may:ruby', location: party(0) },
  )
  const dispatched = beginPokemonHubSnapshotRequest(firstMove, { clientSequence: 1, idempotencyKey: 'sync-1' })
  const queuedMove = movePokemonHubSnapshotPlacement(
    dispatched.state,
    { sourceKey: 'save:may:ruby', location: party(0) },
    { sourceKey: 'save:may:emerald', location: box(0, 0) },
  )

  assert.deepEqual(retryPokemonHubSnapshotRequest(queuedMove), dispatched.request)
  assert.equal(queuedMove.hasQueuedChanges, true)

  const acknowledged = acknowledgePokemonHubSnapshotRequest(queuedMove, {
    status: 'accepted',
    clientSequence: 1,
    idempotencyKey: 'sync-1',
    serverSequence: 21,
    snapshots: [
      { sourceKey: 'save:may:emerald', sourceRevision: 5, placements: [{ location: party(0), pokemonInstanceId: null }, { location: box(0, 0), pokemonInstanceId: null }] },
      { sourceKey: 'save:may:ruby', sourceRevision: 8, placements: [{ location: party(0), pokemonInstanceId: 'alpha' }, { location: box(0, 0), pokemonInstanceId: 'beta' }] },
    ],
  })
  const second = beginPokemonHubSnapshotRequest(acknowledged.state, { clientSequence: 2, idempotencyKey: 'sync-2' })

  assert.equal(acknowledged.action, 'accepted')
  assert.equal(acknowledged.state.sources['save:may:emerald'].optimisticPlacements[1].pokemonInstanceId, 'alpha')
  assert.deepEqual(second.request.sources.map(source => [source.sourceKey, source.baseRevision]), [
    ['save:may:emerald', 5],
    ['save:may:ruby', 8],
  ])
  assert.equal(second.request.sources[0].placements[1].pokemonInstanceId, 'alpha')
})

test('replaces optimistic placements with a corrected authority snapshot', () => {
  const moved = movePokemonHubSnapshotPlacement(
    fixture(),
    { sourceKey: 'save:may:emerald', location: party(0) },
    { sourceKey: 'save:may:ruby', location: party(0) },
  )
  const dispatched = beginPokemonHubSnapshotRequest(moved, { clientSequence: 1, idempotencyKey: 'sync-1' })
  const corrected = acknowledgePokemonHubSnapshotRequest(dispatched.state, {
    status: 'corrected',
    code: 'DUPLICATE_INSTANCE_CORRECTED',
    clientSequence: 1,
    idempotencyKey: 'sync-1',
    serverSequence: 22,
    snapshots: [
      { sourceKey: 'save:may:emerald', sourceRevision: 6, placements: [{ location: party(0), pokemonInstanceId: 'alpha' }, { location: box(0, 0), pokemonInstanceId: null }] },
      { sourceKey: 'save:may:ruby', sourceRevision: 9, placements: [{ location: party(0), pokemonInstanceId: null }, { location: box(0, 0), pokemonInstanceId: 'beta' }] },
    ],
  })

  assert.equal(corrected.action, 'corrected')
  assert.equal(corrected.state.hasQueuedChanges, false)
  assert.equal(corrected.state.sources['save:may:emerald'].optimisticPlacements[0].pokemonInstanceId, 'alpha')
  assert.equal(corrected.state.sources['save:may:ruby'].optimisticPlacements[0].pokemonInstanceId, null)
})

test('does not dispatch a workspace snapshot after any source loses readiness', () => {
  const moved = movePokemonHubSnapshotPlacement(
    fixture(),
    { sourceKey: 'save:may:emerald', location: party(0) },
    { sourceKey: 'save:may:ruby', location: party(0) },
  )
  const leaseLost = {
    ...moved,
    sources: {
      ...moved.sources,
      'save:may:ruby': { ...moved.sources['save:may:ruby'], status: 'lease-lost' },
    },
  }

  assert.throws(() => beginPokemonHubSnapshotRequest(leaseLost, { clientSequence: 1, idempotencyKey: 'sync-1' }), /ready/i)
})
