import assert from 'node:assert/strict'
import test from 'node:test'

import { createPokemonGen3EventBatchDelivery } from './pokemon-gen3-event-batch-delivery.mjs'

test('backs up all saves before attempting candidates and continues after individual failures', async () => {
  const order = []
  const batch = createPokemonGen3EventBatchDelivery({
    backupService: { async create(reason) { order.push(`backup:${reason}`); return { fileName: 'all-saves.json.gz' } } },
    saveStore: { async listAll() { order.push('list'); return [{ profileId: 'p1', gameId: 'emerald' }, { profileId: 'p2', gameId: 'emerald' }, { profileId: 'orphan', gameId: 'emerald' }] } },
    profileStore: { async get(_gameId, profileId) { return profileId === 'orphan' ? null : { id: profileId } } },
    eventDeliveryService: { async attempt({ profileId }) { order.push(`attempt:${profileId}`); if (profileId === 'p1') throw Object.assign(new Error('broken save'), { code: 'SAVE_INVALID' }); return { status: 'delivered', revision: 2 } } },
  })
  const result = await batch.run()
  assert.deepEqual(order, ['backup:gen3-event-delivery', 'list', 'attempt:p1', 'attempt:p2'])
  assert.deepEqual(result.results, [
    { profileId: 'p1', gameId: 'emerald', status: 'skipped', code: 'SAVE_INVALID' },
    { profileId: 'p2', gameId: 'emerald', status: 'delivered', revision: 2 },
    { profileId: 'orphan', gameId: 'emerald', status: 'profile-missing' },
  ])
  assert.deepEqual(result.counts, { scanned: 3, delivered: 1, skipped: 1, 'profile-missing': 1 })
})

test('backup failure prevents every event attempt', async () => {
  let listed = false
  let attempted = false
  const batch = createPokemonGen3EventBatchDelivery({
    backupService: { async create() { throw new Error('backup unavailable') } },
    saveStore: { async listAll() { listed = true; return [] } },
    profileStore: { async get() { return {} } },
    eventDeliveryService: { async attempt() { attempted = true } },
  })
  await assert.rejects(batch.run(), /backup unavailable/)
  assert.equal(listed, false)
  assert.equal(attempted, false)
})

test('rejects a second run while the first backup is still in progress', async () => {
  let releaseBackup
  let backups = 0
  const batch = createPokemonGen3EventBatchDelivery({
    backupService: { create: () => ++backups === 1 ? new Promise(resolve => { releaseBackup = resolve }) : Promise.resolve({ fileName: 'next.json.gz' }) },
    saveStore: { async listAll() { return [] } },
    profileStore: { async get() { return {} } },
    eventDeliveryService: { async attempt() {} },
  })
  const first = batch.run()
  await assert.rejects(batch.run(), error => error.code === 'EVENT_BATCH_RUNNING')
  releaseBackup({ fileName: 'all-saves.json.gz' })
  await first
  assert.equal((await batch.run()).backup.fileName, 'next.json.gz')
})
