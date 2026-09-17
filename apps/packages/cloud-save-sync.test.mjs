import assert from 'node:assert/strict'
import test from 'node:test'
import { createCloudSaveSynchronizer } from './cloud-save-sync.mjs'

test('uploads only when flushed local save bytes change', async () => {
  const uploads = []
  const synchronizer = createCloudSaveSynchronizer({
    load: async () => null,
    upload: async (bytes, revision) => { uploads.push({ bytes: [...bytes], revision }); return { revision: 1 } },
    hash: async bytes => [...bytes].join(','),
  })
  await synchronizer.load()
  const manager = { getSaveFile: () => new Uint8Array([1, 2, 3]) }
  assert.equal(await synchronizer.sync(manager), true)
  assert.equal(await synchronizer.sync(manager), false)
  assert.deepEqual(uploads, [{ bytes: [1, 2, 3], revision: null }])
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
