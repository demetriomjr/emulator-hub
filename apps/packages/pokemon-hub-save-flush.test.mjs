import assert from 'node:assert/strict'
import test from 'node:test'

import { createPokemonHubSaveFlushService } from './pokemon-hub-save-flush.mjs'

function fixture({ materialize = () => ({ bytes: Buffer.from([2]), changed: true }) } = {}) {
  let instant = 0
  const writes = []
  const flushed = []
  const coordinator = {
    async getSaveFlushPlan() { return { source: { sourceKey: 'save:profile-may:emerald' }, records: new Map() } },
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
    now: () => instant,
    schedule: () => null,
    cancel: () => {},
  })
  return { service, writes, flushed, setTime: value => { instant = value } }
}

test('flushes a dirty save source no earlier than five seconds after its first accepted change', async () => {
  const { service, writes, flushed, setTime } = fixture()

  service.markDirty({ profileId: 'profile-may', sourceKey: 'save:profile-may:emerald' })
  await service.flushDue()
  setTime(5_000)
  await service.flushDue()

  assert.deepEqual(writes, [{ profileId: 'profile-may', gameId: 'emerald', bytes: Buffer.from([2]), revision: 3 }])
  assert.deepEqual(flushed, [{ profileId: 'profile-may', sourceKey: 'save:profile-may:emerald', saveRevision: 4 }])
})

test('does not rewrite a save but acknowledges its durable flush when materialization produced identical bytes', async () => {
  const { service, writes, flushed, setTime } = fixture({ materialize: () => ({ bytes: Buffer.from([1]), changed: false }) })

  service.markDirty({ profileId: 'profile-may', sourceKey: 'save:profile-may:emerald' })
  setTime(5_000)
  await service.flushDue()

  assert.equal(writes.length, 0)
  assert.deepEqual(flushed, [{ profileId: 'profile-may', sourceKey: 'save:profile-may:emerald', saveRevision: 3 }])
  assert.equal(service.isDirty({ profileId: 'profile-may', sourceKey: 'save:profile-may:emerald' }), false)
})

test('retains a newer dirty snapshot queued while an older flush is running', async () => {
  let service
  let run = 0
  const fixtureValue = fixture({ materialize: () => {
    run += 1
    if (run === 1) service.markDirty({ profileId: 'profile-may', sourceKey: 'save:profile-may:emerald' })
    return { bytes: Buffer.from([2]), changed: true }
  } })
  service = fixtureValue.service

  service.markDirty({ profileId: 'profile-may', sourceKey: 'save:profile-may:emerald' })
  fixtureValue.setTime(5_000)
  await service.flushDue()

  assert.equal(service.isDirty({ profileId: 'profile-may', sourceKey: 'save:profile-may:emerald' }), true)
})

test('runs the scheduled flush without exposing a timer callback failure', async () => {
  let instant = 0
  let scheduled
  let writes = 0
  const service = createPokemonHubSaveFlushService({
    coordinator: { async getSaveFlushPlan() { return { source: { sourceKey: 'save:profile-may:emerald' }, records: new Map() } }, async markSaveFlushed() {} },
    saveStore: { async get() { return { bytes: Buffer.from([1]), revision: 3 } }, async put() { writes += 1; return { revision: 4 } }, },
    resolveSaveSource: async () => ({ gameId: 'emerald', adapter: {}, layout: {} }),
    materialize: () => ({ bytes: Buffer.from([2]), changed: true }),
    now: () => instant,
    schedule: callback => { scheduled = callback; return { unref() {} } },
    cancel: () => {},
    onError: error => { throw error },
  })

  service.markDirty({ profileId: 'profile-may', sourceKey: 'save:profile-may:emerald' })
  instant = 5_000
  scheduled()
  await new Promise(resolve => setImmediate(resolve))

  assert.equal(writes, 1)
})

test('flushes an expired leased source before releasing it to another workspace', async () => {
  const released = []
  const coordinator = {
    async getSaveFlushPlan() { return { source: { sourceKey: 'save:profile-may:emerald' }, records: new Map() } },
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
    async getSaveFlushPlan() { return { source: { sourceKey: 'save:profile-may:emerald', needsSaveFlush: true }, records: new Map() } },
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
  assert.deepEqual(flushed, [{ profileId: 'profile-may', sourceKey: 'save:profile-may:emerald', saveRevision: 4 }])
  assert.equal(released.length, 1)
})
