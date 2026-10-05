import assert from 'node:assert/strict'
import test from 'node:test'
const module = await import('./ips-patch.mjs').catch(() => ({}))
function api() { assert.equal(typeof module.applyIpsPatch, 'function', 'IPS browser applier must exist'); return module }
const patch = (...records) => Uint8Array.from([80, 65, 84, 67, 72, ...records.flat(), 69, 79, 70])
test('IPS writes a copy and overlapping records follow file order', () => {
  const { applyIpsPatch } = api(), original = Uint8Array.from([1, 2, 3, 4])
  assert.deepEqual(applyIpsPatch(original, patch([0, 0, 1, 0, 2, 8, 9], [0, 0, 2, 0, 1, 7])), Uint8Array.from([1, 8, 7, 4]))
  assert.deepEqual(original, Uint8Array.from([1, 2, 3, 4]))
})
test('IPS RLE, zero-filled expansion and optional truncate work on offset views', () => {
  const { applyIpsPatch } = api()
  const data = patch([0, 0, 3, 0, 0, 0, 2, 7])
  const view = Uint8Array.from([99, ...data, 99]).subarray(1, data.length + 1)
  assert.deepEqual(applyIpsPatch(Uint8Array.from([1]), view), Uint8Array.from([1, 0, 0, 7, 7]))
  assert.deepEqual(applyIpsPatch(Uint8Array.from([1, 2, 3]), Uint8Array.from([...patch(), 0, 0, 2])), Uint8Array.from([1, 2]))
})
for (const [name, bytes] of [
  ['header', [1, 2, 3]], ['missing EOF', [80,65,84,67,72]], ['short normal record', [80,65,84,67,72,0,0,0,0,2,8]],
  ['zero RLE', [...patch([0,0,0,0,0,0,0,8])]], ['short RLE', [80,65,84,67,72,0,0,0,0,0,0]],
  ['bad trailing length', [...patch(), 0]],
]) test(`rejects malformed IPS ${name}`, () => {
  const { applyIpsPatch, isValidIps } = api()
  assert.equal(isValidIps(Uint8Array.from(bytes)), false)
  assert.throws(() => applyIpsPatch(new Uint8Array(4), Uint8Array.from(bytes)), /IPS/)
})
test('output bounds are checked before any allocation or write', () => {
  const { applyIpsPatch } = api()
  assert.throws(() => applyIpsPatch(new Uint8Array(1), patch([0, 0, 9, 0, 2, 1, 2]), { maxOutputBytes: 10 }), /limit/)
  assert.throws(() => applyIpsPatch(new Uint8Array(4), Uint8Array.from([...patch(), 0, 0, 20]), { maxOutputBytes: 10 }), /limit/)
})
