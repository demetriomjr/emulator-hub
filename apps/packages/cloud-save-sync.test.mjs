import assert from 'node:assert/strict'
import test from 'node:test'
import { createCloudSaveSynchronizer } from './cloud-save-sync.mjs'

test('uploads only when observed battery-save bytes change and exposes the acknowledged revision', async () => {
  const uploads = []
  let revision = 0
  const events = []
  const synchronizer = createCloudSaveSynchronizer({
    load: async () => null,
    upload: async (bytes, expectedRevision, traceId) => { uploads.push({ bytes: [...bytes], revision: expectedRevision, traceId }); return { revision: ++revision } },
    hash: async bytes => [...bytes].join(','),
    logger: (event, context) => events.push({ event, context }),
  })
  await synchronizer.load()
  const bytes = new Uint8Array([1, 2, 3])
  assert.equal(await synchronizer.syncBytes(bytes, 'trace-1'), true)
  assert.equal(synchronizer.getRevision(), 1)
  assert.equal(await synchronizer.syncBytes(new Uint8Array([1, 2, 3]), 'trace-2'), false)
  assert.equal(await synchronizer.syncBytes(new Uint8Array([3, 2, 1]), 'trace-3'), true)
  assert.equal(synchronizer.getRevision(), 2)
  assert.deepEqual(uploads, [
    { bytes: [1, 2, 3], revision: null, traceId: 'trace-1' },
    { bytes: [3, 2, 1], revision: 1, traceId: 'trace-3' },
  ])
  assert.ok(events.some(({ event, context }) => event === 'save.front.deduplicated' && context.traceId === 'trace-2'))
  assert.ok(events.some(({ event, context }) => event === 'save.front.upload-accepted' && context.traceId === 'trace-1' && context.revision === 1))
  assert.ok(events.every(({ context }) => !('bytes' in context)))
})

test('restores cloud bytes into the core save path before sync', async () => {
  const events = []
  const synchronizer = createCloudSaveSynchronizer({
    load: async () => ({ bytes: new Uint8Array([9, 8]), revision: 4, traceId: 'restore-trace-1' }),
    upload: async () => { throw new Error('must not upload') },
    hash: async bytes => [...bytes].join(','),
    logger: (event, context) => events.push({ event, context }),
  })
  await synchronizer.load()
  const writes = []
  const manager = {
    getSaveFilePath: () => '/data/saves/pokemon.sav',
    FS: { writeFile: (path, bytes) => writes.push({ path, bytes: [...bytes] }) },
    loadSaveFiles: () => writes.push({ reloaded: true }),
  }
  assert.equal(await synchronizer.restore(manager), true)
  assert.deepEqual(writes, [{ path: '/data/saves/pokemon.sav', bytes: [9, 8] }, { reloaded: true }])
  assert.deepEqual(events.filter(({ event }) => event.startsWith('save.front.restore-')), [
    { event: 'save.front.restore-started', context: { traceId: 'restore-trace-1', revision: 4, sizeBytes: 2 } },
    { event: 'save.front.restore-completed', context: { traceId: 'restore-trace-1', revision: 4, sizeBytes: 2 } },
  ])
})
