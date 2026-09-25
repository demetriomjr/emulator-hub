import assert from 'node:assert/strict'
import test from 'node:test'

import { createPokemonHubSaveFlushService } from './pokemon-hub-save-flush.mjs'

function fixture({ materialize = () => ({ bytes: Buffer.from([2]), changed: true }) } = {}) {
  const writes = []
  const flushed = []
  const coordinator = {
    async getSaveFlushPlan() { return { source: { sourceKey: 'save:profile-may:emerald', sourceRevision: 7 }, records: new Map() } },
    async markSaveFlushed(value) { flushed.push(value) },
  }
  const saveStore = {
    async get() { return { bytes: Buffer.from([1]), revision: 3 } },
    async put(profileId, gameId, bytes, revision) { writes.push({ profileId, gameId, bytes, revision }); return { revision: 4 } },
  }
  const service = createPokemonHubSaveFlushService({
    coordinator,
    saveStore,
    resolveSaveSource: async () => ({ gameId: 'emerald', adapter: {}, layout: {} }),
    materialize,
  })
  return { service, writes, flushed }
}

test('an accepted move never schedules or performs a native save write', async () => {
  const { service, writes, flushed } = fixture()

  service.markDirty({ profileId: 'profile-may', sourceKey: 'save:profile-may:emerald' })
  await service.flushDue()

  assert.deepEqual(writes, [])
  assert.deepEqual(flushed, [])
})

test('an explicit source close flushes and acknowledges the exact source revision', async () => {
  const { service, writes, flushed } = fixture()

  assert.deepEqual(await service.flushSource({ profileId: 'profile-may', sourceKey: 'save:profile-may:emerald' }), { status: 'flushed' })
  assert.deepEqual(writes, [{ profileId: 'profile-may', gameId: 'emerald', bytes: Buffer.from([2]), revision: 3 }])
  assert.deepEqual(flushed, [{ profileId: 'profile-may', sourceKey: 'save:profile-may:emerald', sourceRevision: 7, saveRevision: 4 }])
})

test('does not rewrite a save but acknowledges its durable flush when materialization produced identical bytes', async () => {
  const { service, writes, flushed } = fixture({ materialize: () => ({ bytes: Buffer.from([1]), changed: false }) })

  await service.flushSource({ profileId: 'profile-may', sourceKey: 'save:profile-may:emerald' })

  assert.equal(writes.length, 0)
  assert.deepEqual(flushed, [{ profileId: 'profile-may', sourceKey: 'save:profile-may:emerald', sourceRevision: 7, saveRevision: 3 }])
  assert.equal(service.isDirty({ profileId: 'profile-may', sourceKey: 'save:profile-may:emerald' }), false)
})

test('commits a materialized save with the fence generation read from the store', async () => {
  const writes = []
  const service = createPokemonHubSaveFlushService({
    coordinator: { async getSaveFlushPlan() { return { source: { sourceKey: 'save:profile-may:emerald', sourceRevision: 7 }, records: new Map() } }, async markSaveFlushed() {} },
    saveStore: {
      async get() { return { bytes: Buffer.from([1]), revision: 3, fenceGeneration: 8 } },
      async put(profileId, gameId, bytes, revision, options) { writes.push({ profileId, gameId, bytes, revision, options }); return { revision: 4 } },
    },
    resolveSaveSource: async () => ({ gameId: 'emerald', adapter: {}, layout: {} }),
    materialize: () => ({ bytes: Buffer.from([2]), changed: true }),
  })

  await service.flushSource({ profileId: 'profile-may', sourceKey: 'save:profile-may:emerald' })

  assert.deepEqual(writes, [{ profileId: 'profile-may', gameId: 'emerald', bytes: Buffer.from([2]), revision: 3, options: { fenceGeneration: 8 } }])
})

test('installs the close generation before replacing a save', async () => {
  const calls = []
  const service = createPokemonHubSaveFlushService({
    coordinator: { async getSaveFlushPlan() { return { source: { sourceKey: 'save:profile-may:emerald', sourceRevision: 7 }, records: new Map() } }, async markSaveFlushed() {} },
    saveStore: {
      async advanceFence(profileId, gameId, generation) { calls.push(['fence', profileId, gameId, generation]); return { fenceGeneration: generation } },
      async get() { return { bytes: Buffer.from([1]), revision: 3, fenceGeneration: 4 } },
      async put(profileId, gameId, bytes, revision, options) { calls.push(['put', profileId, gameId, revision, options]); return { revision: 4 } },
    },
    resolveSaveSource: async () => ({ gameId: 'emerald', adapter: {}, layout: {} }),
    materialize: () => ({ bytes: Buffer.from([2]), changed: true }),
  })

  await service.flushSource({ profileId: 'profile-may', sourceKey: 'save:profile-may:emerald', generation: 5 })

  assert.deepEqual(calls, [
    ['fence', 'profile-may', 'emerald', 5],
    ['put', 'profile-may', 'emerald', 3, { fenceGeneration: 5 }],
  ])
})

test('advances beyond a fence left by an older session even when close generation restarted', async () => {
  const calls = []
  let fenceGeneration = 8
  const service = createPokemonHubSaveFlushService({
    coordinator: { async getSaveFlushPlan() { return { source: { sourceKey: 'save:profile-may:emerald', sourceRevision: 7 }, records: new Map() } }, async markSaveFlushed() {} },
    saveStore: {
      async advanceFence(profileId, gameId, generation) { calls.push(['fence', generation]); fenceGeneration = generation; return { fenceGeneration: generation } },
      async get() { return { bytes: Buffer.from([1]), revision: 3, fenceGeneration } },
      async put(profileId, gameId, bytes, revision, options) { calls.push(['put', options.fenceGeneration]); return { revision: 4 } },
    },
    resolveSaveSource: async () => ({ gameId: 'emerald', adapter: {}, layout: {} }),
    materialize: () => ({ bytes: Buffer.from([2]), changed: true }),
  })

  await service.flushSource({ profileId: 'profile-may', sourceKey: 'save:profile-may:emerald', generation: 1 })

  assert.deepEqual(calls, [['fence', 9], ['put', 9]])
})

test('flushes an expired leased source before releasing it to another workspace', async () => {
  const released = []
  const coordinator = {
    async getSaveFlushPlan() { return { source: { sourceKey: 'save:profile-may:emerald', sourceRevision: 7 }, records: new Map() } },
    async markSaveFlushed() {},
    async listExpiredLeases() { return [{ profileId: 'profile-may', sourceKey: 'save:profile-may:emerald', workspaceId: 'workspace-a', sourceSessionId: 'session-a', leaseToken: 'secret' }] },
    async releaseExpiredLease(lease) { released.push(lease) },
  }
  const service = createPokemonHubSaveFlushService({
    coordinator,
    saveStore: { async get() { return { bytes: Buffer.from([1]), revision: 3 } }, async put() { return { revision: 4 } } },
    resolveSaveSource: async () => ({ gameId: 'emerald', adapter: {}, layout: {} }),
    materialize: () => ({ bytes: Buffer.from([2]), changed: true }),
    schedule: () => null,
    cancel: () => {},
  })
  service.markDirty({ profileId: 'profile-may', sourceKey: 'save:profile-may:emerald' })

  await service.flushExpiredLeases()

  assert.equal(released.length, 1)
})

test('recovers a durable pending flush after a backend restart', async () => {
  const released = []
  const flushed = []
  const coordinator = {
    async getSaveFlushPlan() { return { source: { sourceKey: 'save:profile-may:emerald', sourceRevision: 7, needsSaveFlush: true }, records: new Map() } },
    async markSaveFlushed(value) { flushed.push(value) },
    async listExpiredLeases() { return [{ profileId: 'profile-may', sourceKey: 'save:profile-may:emerald', workspaceId: 'workspace-a', sourceSessionId: 'session-a', leaseToken: 'secret' }] },
    async releaseExpiredLease(lease) { released.push(lease) },
  }
  const writes = []
  const service = createPokemonHubSaveFlushService({
    coordinator,
    saveStore: { async get() { return { bytes: Buffer.from([1]), revision: 3 } }, async put(profileId, gameId, bytes, revision) { writes.push({ profileId, gameId, bytes, revision }); return { revision: 4 } } },
    resolveSaveSource: async () => ({ gameId: 'emerald', adapter: {}, layout: {} }),
    materialize: () => ({ bytes: Buffer.from([2]), changed: true }),
    schedule: () => null,
    cancel: () => {},
  })

  await service.flushExpiredLeases()

  assert.equal(writes.length, 1)
  assert.deepEqual(flushed, [{ profileId: 'profile-may', sourceKey: 'save:profile-may:emerald', sourceRevision: 7, saveRevision: 4 }])
  assert.equal(released.length, 1)
})

test('passes the Gen III adapter PC to Party converter into the save materializer', async () => {
  const converted = Buffer.alloc(100, 7)
  const service = createPokemonHubSaveFlushService({
    coordinator: {
      async getSaveFlushPlan() { return { source: { sourceRevision: 7, needsSaveFlush: true }, records: new Map() } },
      async markSaveFlushed() {},
    },
    saveStore: {
      async get() { return { bytes: Buffer.from([1]), revision: 3 } },
      async put() { return { revision: 4 } },
    },
    resolveSaveSource: async () => ({
      gameId: 'ruby',
      adapter: { materializePartyRecord: ({ boxCore, layout }) => {
        assert.deepEqual(boxCore, Buffer.alloc(80, 5))
        assert.equal(layout.pokemonSaveTitle, 'pokemon-ruby')
        return converted
      } },
      layout: { pokemonSaveTitle: 'pokemon-ruby' },
    }),
    materialize: input => {
      assert.deepEqual(input.materializePartyRecord({ boxCore: Buffer.alloc(80, 5) }), converted)
      return { bytes: Buffer.from([2]), changed: true }
    },
    onError: () => {},
  })

  assert.deepEqual(await service.flushSource({ profileId: 'profile', sourceKey: 'save:profile:ruby' }), { status: 'flushed' })
})

test('logs a persistent failed flush once per source revision with its cause', async () => {
  const errors = []
  const unsupported = new Error('Pokemon record has no compatible native representation.')
  unsupported.code = 'SAVE_MATERIALIZATION_UNSUPPORTED'
  const service = createPokemonHubSaveFlushService({
    coordinator: { async getSaveFlushPlan() { return { source: { sourceRevision: 7, needsSaveFlush: true }, records: new Map() } }, async markSaveFlushed() {} },
    saveStore: { async get() { return { bytes: Buffer.from([1]), revision: 3 } }, async put() { throw new Error('must not write') } },
    resolveSaveSource: async () => ({ gameId: 'ruby', adapter: {}, layout: {} }),
    materialize: () => { throw unsupported },
    onError: (message, details) => errors.push({ message, details }),
  })

  await service.flushSource({ profileId: 'profile', sourceKey: 'save:profile:ruby' })
  await service.flushSource({ profileId: 'profile', sourceKey: 'save:profile:ruby' })

  assert.equal(errors.length, 1)
  assert.equal(errors[0].details.code, 'SAVE_MATERIALIZATION_UNSUPPORTED')
  assert.equal(errors[0].details.message, unsupported.message)
  assert.equal(errors[0].details.sourceRevision, 7)
})
