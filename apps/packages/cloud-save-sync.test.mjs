import assert from 'node:assert/strict'
import test from 'node:test'
import { createCloudSaveSynchronizer } from './cloud-save-sync.mjs'
import { observeEmulatorSaveFiles } from './emulator-save-events.mjs'

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

test('runtime state bytes never replace the canonical save through polling or close flush', async () => {
  const uploads = []
  const synchronizer = createCloudSaveSynchronizer({
    load: async () => ({ bytes: new Uint8Array([9]), revision: 4 }),
    upload: async (bytes, expectedRevision) => { uploads.push({ bytes: [...bytes], expectedRevision }); return { revision: 5 } },
    hash: async bytes => [...bytes].join(','),
  })
  await synchronizer.load()
  synchronizer.ignoreRuntimeStateSave(new Uint8Array([2]))
  assert.equal(await synchronizer.syncBytes(new Uint8Array([2])), false)
  assert.equal(await synchronizer.syncBytes(new Uint8Array([2])), false)
  assert.deepEqual(uploads, [])
  assert.equal(synchronizer.getRevision(), 4)
  assert.equal(await synchronizer.syncBytes(new Uint8Array([3])), true)
  assert.deepEqual(uploads, [{ bytes: [3], expectedRevision: 4 }])
  assert.equal(await synchronizer.syncBytes(new Uint8Array([2])), false)
  assert.deepEqual(uploads, [{ bytes: [3], expectedRevision: 4 }])
})

test('save observation after a runtime restore does not upload until game save bytes change', async () => {
  const uploads = []
  const synchronizer = createCloudSaveSynchronizer({
    load: async () => ({ bytes: new Uint8Array([9]), revision: 4 }),
    upload: async bytes => { uploads.push([...bytes]); return { revision: 5 } },
    hash: async bytes => [...bytes].join(','),
  })
  await synchronizer.load()
  let onSave
  const emulator = { on(name, listener) { assert.equal(name, 'saveSaveFiles'); onSave = listener } }
  observeEmulatorSaveFiles(emulator, bytes => synchronizer.syncBytes(bytes))
  const snapshotBytes = new Uint8Array([2])
  onSave(snapshotBytes)
  synchronizer.ignoreRuntimeStateSave(snapshotBytes)
  await new Promise(resolve => setImmediate(resolve))
  onSave(new Uint8Array([2]))
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(uploads, [])
  onSave(new Uint8Array([3]))
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(uploads, [[3]])
  onSave(new Uint8Array([2]))
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(uploads, [[3]])
})

test('an unreadable runtime save blocks upload after an uncertain state load', async () => {
  const uploads = []
  const synchronizer = createCloudSaveSynchronizer({
    load: async () => ({ bytes: new Uint8Array([9]), revision: 4 }),
    upload: async bytes => { uploads.push([...bytes]); return { revision: 5 } },
    hash: async bytes => [...bytes].join(','),
  })
  await synchronizer.load()
  synchronizer.blockRuntimeSaveSync()
  assert.equal(await synchronizer.syncBytes(new Uint8Array([2])), false)
  assert.deepEqual(uploads, [])
  synchronizer.ignoreRuntimeStateSave(new Uint8Array([2]))
  assert.equal(await synchronizer.syncBytes(new Uint8Array([3])), true)
  assert.deepEqual(uploads, [[3]])
})
