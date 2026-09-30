import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createPokemonHubSaveFlushService } from './pokemon-hub-save-flush.mjs'
import { createSaveStore } from './save-store.mjs'

test('expiry cannot release a destination while another endpoint still fails publication', async () => {
 const leases = [{sourceKey:'hub:box',workspaceId:'day'}, {sourceKey:'save:may:emerald',workspaceId:'day'}]
 const released=[]
 let fail=true
 const service=createPokemonHubSaveFlushService({
  coordinator:{async listExpiredLeases(){return leases},async releaseExpiredLease(lease){released.push(lease.sourceKey)},async getSaveFlushPlan({sourceKey}){return {source:{sourceKey,needsSaveFlush:sourceKey.startsWith('save:'),sourceRevision:1,saveRevision:1},records:new Map()}},async markSaveFlushed(){}},
  saveStore:{async get(){return {bytes:Buffer.from([1]),revision:1}},async put(){if(fail)throw new Error('disk unavailable');return {revision:2}}},
  resolveSaveSource:async ({sourceKey})=>sourceKey.startsWith('save:')?{sourceProfileId:'may',gameId:'emerald',adapter:{},layout:{}}:null,
  materialize:()=>({bytes:Buffer.from([2]),changed:true}),onError(){},
 })
 await service.flushExpiredLeases()
 assert.deepEqual(released,[])
 fail=false
 await service.flushExpiredLeases()
 assert.deepEqual(released,['hub:box','save:may:emerald'])
})

test('rejecting a stale close leaves the newer save bytes, revision and writer fence intact', async t => {
  const dataPath = await mkdtemp(join(tmpdir(), 'pokemon-hub-stale-close-'))
  t.after(() => rm(dataPath, { recursive: true, force: true }))
  const saveStore = createSaveStore({ dataPath })
  await saveStore.put('may', 'emerald', Buffer.from([1]), null)
  await saveStore.put('may', 'emerald', Buffer.from([2]), 1)
  await saveStore.advanceFence('may', 'emerald', 4)
  const before = await saveStore.get('may', 'emerald')
  const service = createPokemonHubSaveFlushService({
    coordinator: {
      async getSaveFlushPlan() { return { source: { sourceRevision: 7, saveRevision: 1, needsSaveFlush: true }, records: new Map() } },
      async markSaveFlushed() { assert.fail('A rejected stale close must not acknowledge the source.') },
    },
    saveStore,
    resolveSaveSource: async () => ({ sourceProfileId: 'may', gameId: 'emerald', adapter: {}, layout: {} }),
    materialize: () => ({ bytes: Buffer.from([1]), changed: true }),
    onError() {},
  })

  assert.deepEqual(await service.flushSource({ profileId: 'old-workspace', sourceKey: 'save:may:emerald', generation: 5 }), {
    status: 'failed', code: 'SAVE_REVISION_CONFLICT',
  })
  assert.deepEqual(await saveStore.get('may', 'emerald'), before)
})

test('a stale namespace cannot roll back a newer physical save', async () => {
  let bytes = Buffer.from([2])
  const service = createPokemonHubSaveFlushService({
    coordinator: { async getSaveFlushPlan() { return { source: { sourceRevision: 7, saveRevision: 2, needsSaveFlush: true }, records: new Map() } }, async markSaveFlushed() {} },
    saveStore: { async get() { return { bytes, revision: 3 } }, async put(_profile, _game, next) { bytes = next; return { revision: 4 } } },
    resolveSaveSource: async () => ({ gameId: 'emerald', adapter: {}, layout: {} }),
    materialize: () => ({ bytes: Buffer.from([1]), changed: true }),
    onError() {},
  })
  const result = await service.flushSource({ profileId: 'old-namespace', sourceKey: 'save:profile-may:emerald' })
  assert.deepEqual(bytes, Buffer.from([2]))
  assert.deepEqual(result, { status: 'failed', code: 'SAVE_REVISION_CONFLICT' })
})

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

test('an explicit source close flushes and acknowledges the exact source revision', async () => {
  const { service, writes, flushed } = fixture()

  assert.deepEqual(await service.flushSource({ sourceKey: 'save:profile-may:emerald' }), { status: 'flushed' })
  assert.deepEqual(writes, [{ profileId: 'profile-may', gameId: 'emerald', bytes: Buffer.from([2]), revision: 3 }])
  assert.deepEqual(flushed, [{ sourceKey: 'save:profile-may:emerald', sourceRevision: 7, saveRevision: 4 }])
})

test('does not rewrite a save but acknowledges its durable flush when materialization produced identical bytes', async () => {
  const { service, writes, flushed } = fixture({ materialize: () => ({ bytes: Buffer.from([1]), changed: false }) })

  await service.flushSource({ sourceKey: 'save:profile-may:emerald' })

  assert.equal(writes.length, 0)
  assert.deepEqual(flushed, [{ sourceKey: 'save:profile-may:emerald', sourceRevision: 7, saveRevision: 3 }])
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

  await service.flushSource({ sourceKey: 'save:profile-may:emerald' })

  assert.deepEqual(writes, [{ profileId: 'profile-may', gameId: 'emerald', bytes: Buffer.from([2]), revision: 3, options: { fenceGeneration: 8, invalidateRuntimeStates: true } }])
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

  await service.flushSource({ sourceKey: 'save:profile-may:emerald', generation: 5 })

  assert.deepEqual(calls, [
    ['fence', 'profile-may', 'emerald', 5],
    ['put', 'profile-may', 'emerald', 3, { fenceGeneration: 5, invalidateRuntimeStates: true }],
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

  await service.flushSource({ sourceKey: 'save:profile-may:emerald', generation: 1 })

  assert.deepEqual(calls, [['fence', 9], ['put', 9]])
})

test('flushes an expired leased source before releasing it to another workspace', async () => {
  const released = []
  const coordinator = {
    async getSaveFlushPlan() { return { source: { sourceKey: 'save:profile-may:emerald', sourceRevision: 7 }, records: new Map() } },
    async markSaveFlushed() {},
    async listExpiredLeases() { return [{ sourceKey: 'save:profile-may:emerald', workspaceId: 'workspace-a', sourceSessionId: 'session-a', leaseToken: 'secret' }] },
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

  await service.flushExpiredLeases()

  assert.equal(released.length, 1)
})

test('recovers a durable pending flush after a backend restart', async () => {
  const released = []
  const flushed = []
  const coordinator = {
    async getSaveFlushPlan() { return { source: { sourceKey: 'save:profile-may:emerald', sourceRevision: 7, needsSaveFlush: true }, records: new Map() } },
    async markSaveFlushed(value) { flushed.push(value) },
    async listExpiredLeases() { return [{ sourceKey: 'save:profile-may:emerald', workspaceId: 'workspace-a', sourceSessionId: 'session-a', leaseToken: 'secret' }] },
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
  assert.deepEqual(flushed, [{ sourceKey: 'save:profile-may:emerald', sourceRevision: 7, saveRevision: 4 }])
  assert.equal(released.length, 1)
})

test('invalidates automatic recovery but preserves a user state after a changed Hub save', async () => {
  const calls = []
  const service = createPokemonHubSaveFlushService({
    coordinator: {
      async getSaveFlushPlan() { return { source: { sourceRevision: 7, needsSaveFlush: true }, records: new Map() } },
      async markSaveFlushed() { calls.push('ack') },
    },
    saveStore: {
      async get() { return { bytes: Buffer.from([1]), revision: 3 } },
      async put(profileId, gameId, bytes, revision, options) { calls.push(['put', profileId, gameId, options]); return { revision: 4 } },
    },
    snapshotStore: { async delete(profileId, gameId, options) { calls.push(['delete', profileId, gameId, options.kind]) } },
    resolveSaveSource: async () => ({ sourceProfileId: 'actual-source', gameId: 'ruby', adapter: {}, layout: {} }),
    materialize: () => ({ bytes: Buffer.from([2]), changed: true }),
  })
  assert.deepEqual(await service.flushSource({ profileId: 'hub-profile', sourceKey: 'save:actual-source:ruby' }), { status: 'flushed' })
  assert.deepEqual(calls, [
    ['put', 'actual-source', 'ruby', { fenceGeneration: 0, invalidateRuntimeStates: true }],
    ['delete', 'actual-source', 'ruby', 'cloud-recovery'],
    'ack',
  ])
})

test('snapshot deletion failure leaves the Hub flush unacknowledged for retry', async () => {
  let attempts = 0
  const acknowledged = []
  const service = createPokemonHubSaveFlushService({
    coordinator: {
      async getSaveFlushPlan() { return { source: { sourceRevision: 7, needsSaveFlush: true }, records: new Map() } },
      async markSaveFlushed(value) { acknowledged.push(value) },
    },
    saveStore: { async get() { return { bytes: Buffer.from([2]), revision: 4 } }, async put() { throw new Error('unexpected rewrite') } },
    snapshotStore: { async delete() { if (++attempts === 1) throw new Error('storage unavailable') } },
    resolveSaveSource: async () => ({ gameId: 'ruby', adapter: {}, layout: {} }),
    materialize: () => ({ bytes: Buffer.from([2]), changed: false }),
    onError: () => {},
  })
  assert.equal((await service.flushSource({ profileId: 'profile', sourceKey: 'save:profile:ruby' })).status, 'failed')
  assert.deepEqual(acknowledged, [])
  assert.equal((await service.flushSource({ profileId: 'profile', sourceKey: 'save:profile:ruby' })).status, 'unchanged')
  assert.equal(acknowledged.length, 1)
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
