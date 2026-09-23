import assert from 'node:assert/strict'
import test from 'node:test'
import { applyRomFix } from './rom-fix-applier.mjs'

const profile = {
  sha256: 'a'.repeat(64),
  validated: true,
  size: 8,
  offsets: { hook: '0x00000004' },
  values: {
    hookExpected: '10 20',
    hookReplacement: '30 40',
  },
}

test('patches a private copy and leaves the original ROM unchanged', () => {
  const original = Uint8Array.from([0, 1, 2, 3, 0x10, 0x20, 6, 7])
  const result = applyRomFix(original, profile)

  assert.deepEqual([...original], [0, 1, 2, 3, 0x10, 0x20, 6, 7])
  assert.deepEqual([...result.bytes], [0, 1, 2, 3, 0x30, 0x40, 6, 7])
  assert.notEqual(result.bytes, original)
  assert.equal(result.fixSha256, null)
})

test('rejects a preimage mismatch before writing anything', () => {
  const original = Uint8Array.from([0, 1, 2, 3, 0x99, 0x20, 6, 7])
  assert.throws(() => applyRomFix(original, profile), /expected bytes/i)
  assert.deepEqual([...original], [0, 1, 2, 3, 0x99, 0x20, 6, 7])
})

test('rejects a ROM with the wrong size', () => {
  assert.throws(() => applyRomFix(new Uint8Array(7), profile), /size/i)
})

test('rejects a recipe whose replacement length differs', () => {
  assert.throws(() => applyRomFix(new Uint8Array(8), {
    ...profile,
    values: { hookExpected: '10 20', hookReplacement: '30' },
  }), /length/i)
})
