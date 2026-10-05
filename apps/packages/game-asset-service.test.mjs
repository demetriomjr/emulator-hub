import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
const module = await import('./game-asset-service.mjs').catch(() => ({}))
const hash = async bytes => createHash('sha256').update(bytes).digest('hex')
const rom = Uint8Array.from([1, 2, 3]), patch = Uint8Array.from([80,65,84,67,72,0,0,1,0,1,8,69,79,70])
const descriptor = { romUrl: '/roms/game', romSha256: await hash(rom), patchUrl: '/roms/game/patch', patchSha256: await hash(patch) }
function service(get) {
  assert.equal(typeof module.createGameAssetService, 'function', 'Worker asset service must exist')
  return module.createGameAssetService({ assets: { get }, hash })
}
test('prefetch and launch share assets; preparation is single and returns isolated bytes', async () => {
  const requests = []
  const owner = service(async asset => { requests.push(asset.url); return { bytes: asset.url.endsWith('/patch') ? patch : rom, source: 'memory' } })
  const prepared = await Promise.all(Array.from({ length: 9 }, () => owner.prepare(descriptor)))
  assert.equal(requests.length, 2)
  assert.equal(prepared[0].patchApplied, true)
  prepared[0].bytes[1] = 99
  assert.equal(prepared[1].bytes[1], 8)
  assert.deepEqual(rom, Uint8Array.from([1,2,3]))
})
test('unavailable patch does not poison later successful preparation', async () => {
  let offline = true
  const owner = service(async asset => { if (asset.url.endsWith('/patch') && offline) throw new Error('offline'); return { bytes: asset.url.endsWith('/patch') ? patch : rom, source: 'network' } })
  assert.equal((await owner.prepare(descriptor)).patchApplied, false)
  offline = false
  assert.equal((await owner.prepare(descriptor)).patchApplied, true)
})
test('removing patch from descriptor ignores cached prepared version', async () => {
  const owner = service(async asset => ({ bytes: asset.url.endsWith('/patch') ? patch : rom, source: 'disk' }))
  assert.equal((await owner.prepare(descriptor)).patchApplied, true)
  assert.deepEqual((await owner.prepare({ romSha256: descriptor.romSha256, romUrl: descriptor.romUrl })).bytes, rom)
})
test('incomplete patch descriptor cannot reuse a previously applied patch', async () => {
  const owner = service(async asset => ({ bytes: asset.url.endsWith('/patch') ? patch : rom, source: 'disk' }))
  assert.equal((await owner.prepare(descriptor)).patchApplied, true)
  const result = await owner.prepare({ ...descriptor, patchUrl: undefined })
  assert.equal(result.patchApplied, false)
  assert.deepEqual(result.bytes, rom)
})
test('a stalled optional patch cannot block a verified ROM', async () => {
  const owner = module.createGameAssetService({ assets: { get: async asset => asset.url.endsWith('/patch') ? new Promise(() => {}) : { bytes: rom, source: 'disk' } }, hash, patchTimeoutMs: 5 })
  const result = await owner.prepare(descriptor)
  assert.equal(result.patchApplied, false)
  assert.deepEqual(result.bytes, rom)
  assert.match(result.reason, /timed out/)
})
