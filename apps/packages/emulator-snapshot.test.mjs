import assert from 'node:assert/strict'
import test from 'node:test'
import { decodeSnapshotBundle, encodeSnapshotBundle } from './emulator-snapshot.mjs'

const metadata = {
  profileId: 'profile-may',
  gameId: 'pokemon-emerald',
  core: 'gba',
  romSha256: 'a'.repeat(64),
  runtimeId: 'emulatorjs-4.2.3',
  saveRevision: 3,
}

test('encodes and verifies state with its associated canonical save revision', async () => {
  const bundle = await encodeSnapshotBundle({
    metadata,
    state: new Uint8Array([1, 2, 3]),
  })

  const decoded = await decodeSnapshotBundle(bundle)

  assert.deepEqual([...decoded.state], [1, 2, 3])
  assert.deepEqual(decoded.metadata, {
    ...metadata,
    promptOnLaunch: true,
    stateByteLength: 3,
    sha256: '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81',
  })
  assert.equal('save' in decoded, false)
})

test('rejects a truncated snapshot envelope', async () => {
  await assert.rejects(
    decodeSnapshotBundle(new Uint8Array([0, 0, 0, 20, 123])),
    /snapshot/i,
  )
})

test('rejects a bundle whose state bytes no longer match its hash', async () => {
  const bundle = await encodeSnapshotBundle({ metadata, state: new Uint8Array([1]) })
  bundle[bundle.length - 1] = 3

  await assert.rejects(decodeSnapshotBundle(bundle), /hash/i)
})

test('rejects a snapshot with a malformed optional patch hash', async () => {
  await assert.rejects(
    encodeSnapshotBundle({ metadata: { ...metadata, patchSha256: 'not-a-hash' }, state: new Uint8Array([1]) }),
    /patch hash/i,
  )
})

test('round-trips a suppressed restore offer and defaults legacy bundles to offered', async () => {
  const suppressed = await decodeSnapshotBundle(await encodeSnapshotBundle({ metadata: { ...metadata, promptOnLaunch: false }, state: new Uint8Array([4]) }))
  const legacy = await decodeSnapshotBundle(await encodeSnapshotBundle({ metadata, state: new Uint8Array([5]) }))
  assert.equal(suppressed.metadata.promptOnLaunch, false)
  assert.equal(legacy.metadata.promptOnLaunch, true)
})

test('rejects a non-boolean restore offer field', async () => {
  await assert.rejects(encodeSnapshotBundle({ metadata: { ...metadata, promptOnLaunch: 'false' }, state: new Uint8Array([4]) }), /prompt/i)
})
