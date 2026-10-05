import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
const module = await import('./game-rom-preparation.mjs').catch(() => ({}))
const hash = async bytes => createHash('sha256').update(bytes).digest('hex')
const romBytes = Uint8Array.from([1, 2, 3])
const patchBytes = Uint8Array.from([80,65,84,67,72,0,0,1,0,1,9,69,79,70])
async function prepare(extra = {}) {
  assert.equal(typeof module.prepareGameRom, 'function', 'Verified browser ROM preparation must exist')
  return module.prepareGameRom({ romBytes, patchBytes, romSha256: await hash(romBytes), patchSha256: await hash(patchBytes), hash, ...extra })
}
test('applies verified IPS in RAM and reports final identity without mutating original', async () => {
  const result = await prepare()
  assert.deepEqual(result.bytes, Uint8Array.from([1, 9, 3]))
  assert.equal(result.effectiveRomSha256, await hash(result.bytes))
  assert.equal(result.patchApplied, true)
  assert.equal(result.patchSha256, await hash(patchBytes))
  assert.deepEqual(romBytes, Uint8Array.from([1, 2, 3]))
})
test('ROM mismatch is fatal while IPS mismatch and format are optional skips', async () => {
  await assert.rejects(prepare({ romSha256: '0'.repeat(64) }), /ROM.*hash/)
  for (const extra of [{ patchSha256: '0'.repeat(64) }, { patchBytes: null }, { patchBytes: Uint8Array.from([1]), patchSha256: await hash(Uint8Array.from([1])) }]) {
    const result = await prepare(extra)
    assert.equal(result.patchApplied, false)
    assert.equal(result.patchSha256, null)
    assert.deepEqual(result.bytes, romBytes)
    assert.ok(result.reason)
  }
})
test('unregistered patch is never applied', async () => {
  const result = await prepare({ patchSha256: null })
  assert.equal(result.patchApplied, false)
  assert.deepEqual(result.bytes, romBytes)
})
