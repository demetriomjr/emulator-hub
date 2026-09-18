import assert from 'node:assert/strict'
import test from 'node:test'
import { decodeSnapshotBundle, encodeSnapshotBundle } from './emulator-snapshot.mjs'

const metadata = {
  profileId: 'profile-may',
  gameId: 'pokemon-emerald',
  core: 'gba',
  romSha256: 'a'.repeat(64),
  runtimeId: 'emulatorjs-4.2.3',
}

test('encodes and verifies a raw state with its capture-time save', async () => {
  const bundle = await encodeSnapshotBundle({
    metadata,
    state: new Uint8Array([1, 2, 3]),
    save: new Uint8Array([4, 5]),
  })

  const decoded = await decodeSnapshotBundle(bundle)

  assert.deepEqual([...decoded.state], [1, 2, 3])
  assert.deepEqual([...decoded.save], [4, 5])
  assert.deepEqual(decoded.metadata, {
    ...metadata,
    stateByteLength: 3,
    saveByteLength: 2,
    sha256: '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81',
    saveSha256: '2fa1b377bf67309f65e5e7bc9d924345ca648dec4e601a398a9cb497dcba3765',
  })
})

test('rejects a truncated snapshot envelope', async () => {
  await assert.rejects(
    decodeSnapshotBundle(new Uint8Array([0, 0, 0, 20, 123])),
    /snapshot/i,
  )
})

test('rejects a bundle whose state bytes no longer match its hash', async () => {
  const bundle = await encodeSnapshotBundle({ metadata, state: new Uint8Array([1]), save: new Uint8Array([2]) })
  bundle[bundle.length - 1] = 3

  await assert.rejects(decodeSnapshotBundle(bundle), /hash/i)
})
