import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
const module = await import('./game-asset-cache.mjs').catch(() => ({}))
const hash = async bytes => createHash('sha256').update(bytes).digest('hex')
const bytes = Uint8Array.from([1, 2, 3])
const sha256 = await hash(bytes)
function fixture(options = {}) {
  assert.equal(typeof module.createGameAssetCache, 'function', 'Shared asset cache must exist')
  const records = new Map(), calls = [], events = []
  const storage = { async get(key) { return records.get(key) }, async put(record) { records.set(record.sha256, record) }, async delete(key) { records.delete(key) } }
  const cache = module.createGameAssetCache({ storage, hash, fetchAsset: async url => { calls.push(url); await new Promise(done => setTimeout(done, 5)); return new Uint8Array(bytes) }, onEvent: event => events.push(event), ...options })
  return { cache, records, calls, events, storage }
}
test('nine simultaneous requests share one download and independent returned buffers', async () => {
  const f = fixture()
  const results = await Promise.all(Array.from({ length: 9 }, () => f.cache.get({ sha256, url: '/roms/game' })))
  assert.equal(f.calls.length, 1)
  results[0].bytes[0] = 99
  assert.equal(results[1].bytes[0], 1)
  assert.equal((await f.cache.get({ sha256, url: '/roms/game' })).bytes[0], 1)
})
test('fresh cache owner reads verified disk bytes with no fetch', async () => {
  const f = fixture()
  await f.cache.get({ sha256, url: '/roms/game' })
  const fresh = fixture({ storage: f.storage, fetchAsset: () => { throw new Error('network forbidden') } })
  assert.equal((await fresh.cache.get({ sha256, url: '/roms/game' })).source, 'disk')
})
test('corrupt disk bytes are removed and refetched; bad network hash is never stored', async () => {
  const f = fixture()
  f.records.set(sha256, { sha256, bytes: Uint8Array.from([9]), byteLength: 1 })
  assert.deepEqual((await f.cache.get({ sha256, url: '/roms/game' })).bytes, bytes)
  assert.equal(f.calls.length, 1)
  const bad = fixture({ fetchAsset: async () => new Uint8Array([9]) })
  await assert.rejects(bad.cache.get({ sha256, url: '/roms/game' }), /hash/)
  assert.equal(bad.records.size, 0)
})
test('quota and broken IndexedDB degrade to memory without poisoned promises', async () => {
  const f = fixture({ storage: { get() { throw new Error('blocked') }, put() { throw new Error('quota') }, delete() {} } })
  await f.cache.get({ sha256, url: '/roms/game' })
  assert.equal((await f.cache.get({ sha256, url: '/roms/game' })).source, 'memory')
  assert.equal(f.calls.length, 1)
  let tries = 0
  const retry = fixture({ fetchAsset: async () => { if (++tries === 1) throw new Error('offline'); return bytes } })
  await assert.rejects(retry.cache.get({ sha256, url: '/roms/game' }), /offline/)
  await retry.cache.get({ sha256, url: '/roms/game' })
  assert.equal(tries, 2)
})
test('two owners lock and recheck disk before downloading', async () => {
  let queue = Promise.resolve(), downloads = 0
  const locks = { request(name, operation) { assert.equal(name, `game-asset:${sha256}`); const pending = queue.then(operation); queue = pending.catch(() => {}); return pending } }
  const f = fixture({ locks, fetchAsset: async () => { downloads++; await new Promise(done => setTimeout(done, 5)); return bytes } })
  const other = fixture({ locks, storage: f.storage, fetchAsset: async () => { downloads++; return bytes } })
  await Promise.all([f.cache.get({ sha256, url: '/roms/game' }), other.cache.get({ sha256, url: '/roms/game' })])
  assert.equal(downloads, 1)
})
test('logging errors never prevent an otherwise verified asset', async () => {
  const f = fixture({ onEvent() { throw new Error('logger broke') } })
  assert.deepEqual((await f.cache.get({ sha256, url: '/roms/game' })).bytes, bytes)
})
