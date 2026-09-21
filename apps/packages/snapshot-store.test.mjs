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
