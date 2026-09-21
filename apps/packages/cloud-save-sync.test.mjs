import assert from 'node:assert/strict'
import test from 'node:test'
import { createCloudSaveSynchronizer } from './cloud-save-sync.mjs'

test('uploads only when observed battery-save bytes change and exposes the acknowledged revision', async () => {
  const uploads = []
  let revision = 0
  const synchronizer = createCloudSaveSynchronizer({
    load: async () => null,
    upload: async (bytes, expectedRevision) => { uploads.push({ bytes: [...bytes], revision: expectedRevision }); return { revision: ++revision } },
    hash: async bytes => [...bytes].join(','),
  })
  await synchronizer.load()
  const bytes = new Uint8Array([1, 2, 3])
  assert.equal(await synchronizer.syncBytes(bytes), true)
  assert.equal(synchronizer.getRevision(), 1)
  assert.equal(await synchronizer.syncBytes(new Uint8Array([1, 2, 3])), false)
  assert.equal(await synchronizer.syncBytes(new Uint8Array([3, 2, 1])), true)
  assert.equal(synchronizer.getRevision(), 2)
  assert.deepEqual(uploads, [
    { bytes: [1, 2, 3], revision: null },
    { bytes: [3, 2, 1], revision: 1 },
  ])
})

test('restores cloud bytes into the core save path before sync', async () => {
  const synchronizer = createCloudSaveSynchronizer({
    load: async () => ({ bytes: new Uint8Array([9, 8]), revision: 4 }),
    upload: async () => { throw new Error('must not upload') },
    hash: async bytes => [...bytes].join(','),
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
})
