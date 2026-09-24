import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createSnapshotStore } from './snapshot-store.mjs'

async function bundle(state, saveRevision = 0) {
  return {
    metadata: { core: 'gba', romSha256: 'a'.repeat(64), runtimeId: 'emulatorjs-4.2.3', saveRevision },
    state: new Uint8Array(state),
  }
}

test('keeps only the latest atomically replaced state snapshot with save revision metadata', async () => {
  const dataPath = await mkdtemp(join(tmpdir(), 'emulator-hub-snapshot-store-'))
  const store = createSnapshotStore({ dataPath })

  const first = await store.put('profile-may', 'pokemon-emerald', await bundle([1], 2), null, { fenceGeneration: 1 })
  const second = await store.put('profile-may', 'pokemon-emerald', await bundle([3], 3), first.revision, { fenceGeneration: 1 })
  const current = await store.get('profile-may', 'pokemon-emerald')

  assert.equal(first.revision, 1)
  assert.equal(second.revision, 2)
  assert.deepEqual([...current.state], [3])
  assert.equal(current.metadata.revision, 2)
  assert.equal(current.metadata.saveRevision, 3)
  assert.equal(current.metadata.fenceGeneration, 1)
})

test('rejects stale revisions and fenced snapshot writers without replacing the slot', async () => {
  const dataPath = await mkdtemp(join(tmpdir(), 'emulator-hub-snapshot-store-'))
  const store = createSnapshotStore({ dataPath })
  await store.put('profile-may', 'pokemon-emerald', await bundle([1]), null, { fenceGeneration: 1 })

  await assert.rejects(
    store.put('profile-may', 'pokemon-emerald', await bundle([3]), null, { fenceGeneration: 1 }),
    error => error.code === 'SNAPSHOT_REVISION_CONFLICT',
  )
  await store.advanceFence('profile-may', 'pokemon-emerald', 2)
  await assert.rejects(
    store.put('profile-may', 'pokemon-emerald', await bundle([3]), 1, { fenceGeneration: 1 }),
    error => error.code === 'SNAPSHOT_FENCE_CONFLICT',
  )
  assert.deepEqual([...(await store.get('profile-may', 'pokemon-emerald')).state], [1])
})

test('rejects a persisted bundle whose state file no longer matches metadata', async () => {
  const dataPath = await mkdtemp(join(tmpdir(), 'emulator-hub-snapshot-store-'))
  const store = createSnapshotStore({ dataPath })
  await store.put('profile-may', 'pokemon-emerald', await bundle([1]), null, { fenceGeneration: 1 })
  const metadataPath = join(dataPath, 'profile-may', 'pokemon-emerald.json')
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8'))
  await writeFile(join(dataPath, 'profile-may', metadata.stateFile), Buffer.from([9]))

  await assert.rejects(store.get('profile-may', 'pokemon-emerald'), /snapshot/i)
})

test('deletes only the matching profile and game snapshot slot', async () => {
  const dataPath = await mkdtemp(join(tmpdir(), 'emulator-hub-snapshot-store-'))
  const store = createSnapshotStore({ dataPath })
  await store.put('profile-may', 'pokemon-emerald', await bundle([1]), null, { fenceGeneration: 1 })
  await store.put('profile-leaf', 'pokemon-emerald', await bundle([3]), null, { fenceGeneration: 1 })

  await store.delete('profile-may', 'pokemon-emerald')

  assert.equal(await store.get('profile-may', 'pokemon-emerald'), null)
  assert.deepEqual([...(await store.get('profile-leaf', 'pokemon-emerald')).state], [3])
})

test('conditional snapshot deletion rejects a replaced revision and a stale lease fence', async () => {
  const dataPath = await mkdtemp(join(tmpdir(), 'emulator-hub-snapshot-store-'))
  const store = createSnapshotStore({ dataPath })
  const first = await store.put('profile-may', 'pokemon-emerald', await bundle([1]), null, { fenceGeneration: 1 })
  const replacement = await store.put('profile-may', 'pokemon-emerald', await bundle([2]), first.revision, { fenceGeneration: 1 })
  await assert.rejects(store.delete('profile-may', 'pokemon-emerald', { expectedRevision: first.revision, fenceGeneration: 1 }), error => error.code === 'SNAPSHOT_REVISION_CONFLICT')
  await store.advanceFence('profile-may', 'pokemon-emerald', 2)
  await assert.rejects(store.delete('profile-may', 'pokemon-emerald', { expectedRevision: replacement.revision, fenceGeneration: 1 }), error => error.code === 'SNAPSHOT_FENCE_CONFLICT')
  assert.deepEqual([...(await store.get('profile-may', 'pokemon-emerald')).state], [2])
  assert.equal(await store.delete('profile-may', 'pokemon-emerald', { expectedRevision: replacement.revision, fenceGeneration: 2 }), true)
  assert.equal(await store.get('profile-may', 'pokemon-emerald'), null)
})

test('persists suppressed offers and defaults legacy stored snapshots to offered', async () => {
  const dataPath = await mkdtemp(join(tmpdir(), 'emulator-hub-snapshot-store-'))
  const store = createSnapshotStore({ dataPath })
  const first = await store.put('profile-may', 'pokemon-emerald', { metadata: { ...(await bundle([1], 2)).metadata, promptOnLaunch: false }, state: new Uint8Array([1]) }, null, { fenceGeneration: 1 })
  assert.equal((await store.get('profile-may', 'pokemon-emerald')).metadata.promptOnLaunch, false)
  await store.put('profile-may', 'pokemon-emerald', await bundle([2], 2), first.revision, { fenceGeneration: 1 })
  assert.equal((await store.get('profile-may', 'pokemon-emerald')).metadata.promptOnLaunch, true)
  const metadataPath = join(dataPath, 'profile-may', 'pokemon-emerald.json')
  const legacyMetadata = JSON.parse(await readFile(metadataPath, 'utf8'))
  delete legacyMetadata.promptOnLaunch
  await writeFile(metadataPath, JSON.stringify(legacyMetadata))
  assert.equal((await store.get('profile-may', 'pokemon-emerald')).metadata.promptOnLaunch, true)
})

test('keeps explicit user states independent from cloud recovery replacement and deletion', async () => {
  const dataPath = await mkdtemp(join(tmpdir(), 'emulator-hub-snapshot-store-'))
  const store = createSnapshotStore({ dataPath })
  const user = await store.put('profile-may', 'pokemon-emerald', await bundle([7], 2), null, { fenceGeneration: 3, kind: 'user-state' })
  const cloud = await store.put('profile-may', 'pokemon-emerald', await bundle([9], 2), null, { fenceGeneration: 3, kind: 'cloud-recovery' })
  assert.equal(user.revision, 1)
  assert.equal(cloud.revision, 1)
  await store.delete('profile-may', 'pokemon-emerald', { expectedRevision: cloud.revision, fenceGeneration: 3, kind: 'cloud-recovery' })
  assert.equal(await store.get('profile-may', 'pokemon-emerald', { kind: 'cloud-recovery' }), null)
  assert.deepEqual([...(await store.get('profile-may', 'pokemon-emerald', { kind: 'user-state' })).state], [7])
  await store.advanceFence('profile-may', 'pokemon-emerald', 4, { kind: 'user-state' })
  await assert.rejects(store.delete('profile-may', 'pokemon-emerald', { expectedRevision: user.revision, fenceGeneration: 3, kind: 'user-state' }), error => error.code === 'SNAPSHOT_FENCE_CONFLICT')
})

test('reads legacy remote data as unknown cloud recovery and preserves its capture time', async () => {
  const dataPath = await mkdtemp(join(tmpdir(), 'emulator-hub-snapshot-store-'))
  const store = createSnapshotStore({ dataPath })
  await store.put('profile-may', 'pokemon-emerald', await bundle([4], 1), null, { fenceGeneration: 2 })
  const path = join(dataPath, 'profile-may', 'pokemon-emerald.json')
  const legacy = JSON.parse(await readFile(path, 'utf8'))
  delete legacy.kind
  delete legacy.reasonCode
  await writeFile(path, JSON.stringify(legacy))
  const before = await store.get('profile-may', 'pokemon-emerald', { kind: 'cloud-recovery' })
  assert.equal(before.metadata.kind, 'cloud-recovery')
  assert.equal(before.metadata.reasonCode, 'legacy-unknown')
  assert.equal(before.metadata.capturedAt, legacy.createdAt)
  await store.advanceFence('profile-may', 'pokemon-emerald', 3, { kind: 'cloud-recovery' })
  const migrated = JSON.parse(await readFile(path, 'utf8'))
  assert.equal(migrated.kind, 'cloud-recovery')
  assert.equal(migrated.reasonCode, 'legacy-unknown')
  assert.equal(migrated.createdAt, legacy.createdAt)
  assert.equal(migrated.stateFile, legacy.stateFile)
})

test('persists patch identity, capture reason and installation provenance for new typed states', async () => {
  const dataPath = await mkdtemp(join(tmpdir(), 'emulator-hub-snapshot-store-'))
  const store = createSnapshotStore({ dataPath })
  await store.put('profile-may', 'pokemon-emerald', { metadata: { ...(await bundle([1], 3)).metadata, kind: 'user-state', reasonCode: 'user-request', patchSha256: 'b'.repeat(64), originInstallationId: 'installation-123' }, state: new Uint8Array([1]) }, null, { fenceGeneration: 1, kind: 'user-state' })
  const current = await store.get('profile-may', 'pokemon-emerald', { kind: 'user-state' })
  assert.equal(current.metadata.patchSha256, 'b'.repeat(64))
  assert.equal(current.metadata.reasonCode, 'user-request')
  assert.equal(current.metadata.originInstallationId, 'installation-123')
  assert.ok(Number.isFinite(Date.parse(current.metadata.capturedAt)))
})

test('typed user file names cannot collide with a different legacy game ID', async () => {
  const dataPath = await mkdtemp(join(tmpdir(), 'emulator-hub-snapshot-store-'))
  const store = createSnapshotStore({ dataPath })
  await store.put('profile-may', 'game', await bundle([1]), null, { fenceGeneration: 1, kind: 'user-state' })
  await store.put('profile-may', 'game.user-state', await bundle([2]), null, { fenceGeneration: 1, kind: 'cloud-recovery' })
  assert.deepEqual([...(await store.get('profile-may', 'game', { kind: 'user-state' })).state], [1])
  assert.deepEqual([...(await store.get('profile-may', 'game.user-state', { kind: 'cloud-recovery' })).state], [2])
})

test('a deleted slot never reuses its revision, so a stale candidate cannot delete its replacement', async () => {
  const dataPath = await mkdtemp(join(tmpdir(), 'emulator-hub-snapshot-store-'))
  const store = createSnapshotStore({ dataPath })
  const first = await store.put('profile-may', 'pokemon-emerald', await bundle([1]), null, { fenceGeneration: 1 })
  await store.delete('profile-may', 'pokemon-emerald', { expectedRevision: first.revision, fenceGeneration: 1 })
  const replacement = await store.put('profile-may', 'pokemon-emerald', await bundle([2]), null, { fenceGeneration: 1 })
  assert.ok(replacement.revision > first.revision)
  await assert.rejects(store.delete('profile-may', 'pokemon-emerald', { expectedRevision: first.revision, fenceGeneration: 1 }), error => error.code === 'SNAPSHOT_REVISION_CONFLICT')
  assert.deepEqual([...(await store.get('profile-may', 'pokemon-emerald')).state], [2])
  const restarted = createSnapshotStore({ dataPath })
  await restarted.delete('profile-may', 'pokemon-emerald', { expectedRevision: replacement.revision, fenceGeneration: 1 })
  const third = await restarted.put('profile-may', 'pokemon-emerald', await bundle([3]), null, { fenceGeneration: 1 })
  assert.ok(third.revision > replacement.revision)
})
