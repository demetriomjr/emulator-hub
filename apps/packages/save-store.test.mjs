import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createSaveStore } from './save-store.mjs'

test('persists a Hub runtime-state invalidation through fence and ordinary save writes', async () => {
  const dataPath = await mkdtemp(join(tmpdir(), 'emulator-hub-save-store-'))
  try {
    const store = createSaveStore({ dataPath })
    await store.put('may', 'ruby', Buffer.from([1]), null, { fenceGeneration: 1 })
    const hub = await store.put('may', 'ruby', Buffer.from([2]), 1, { fenceGeneration: 1, invalidateRuntimeStates: true })
    assert.equal(hub.runtimeStateInvalidatedAtRevision, 2)
    await store.advanceFence('may', 'ruby', 2)
    assert.equal((await store.get('may', 'ruby')).runtimeStateInvalidatedAtRevision, 2)
    await store.put('may', 'ruby', Buffer.from([3]), 2, { fenceGeneration: 2 })
    assert.equal((await createSaveStore({ dataPath }).get('may', 'ruby')).runtimeStateInvalidatedAtRevision, 2)
  } finally {
    await rm(dataPath, { recursive: true, force: true })
  }
})

test('rejects a stale fence generation without replacing the save', async () => {
  const dataPath = await mkdtemp(join(tmpdir(), 'emulator-hub-save-store-'))
  try {
    const store = createSaveStore({ dataPath })
    await store.put('profile-may', 'pokemon-emerald', Buffer.from([1]), null, { fenceGeneration: 1 })
    await store.advanceFence('profile-may', 'pokemon-emerald', 2)

    await assert.rejects(
      () => store.put('profile-may', 'pokemon-emerald', Buffer.from([2]), 1, { fenceGeneration: 1 }),
      error => error.code === 'SAVE_FENCE_CONFLICT',
    )
    assert.deepEqual(await store.get('profile-may', 'pokemon-emerald'), {
      bytes: Buffer.from([1]), revision: 1, sha256: '4bf5122f344554c53bde2ebb8cd2b7e3d1600ad631c385a5d7cce23c7785459a', fenceGeneration: 2,
    })
  } finally {
    await rm(dataPath, { recursive: true, force: true })
  }
})

test('advancing a save fence to the already-installed generation is idempotent', async () => {
  const dataPath = await mkdtemp(join(tmpdir(), 'emulator-hub-save-store-'))
  try {
    const store = createSaveStore({ dataPath })
    await store.put('profile-may', 'pokemon-emerald', Buffer.from([1]), null, { fenceGeneration: 1 })

    const first = await store.advanceFence('profile-may', 'pokemon-emerald', 2)
    const replay = await store.advanceFence('profile-may', 'pokemon-emerald', 2)

    assert.equal(first.fenceGeneration, 2)
    assert.deepEqual(replay, first)
  } finally {
    await rm(dataPath, { recursive: true, force: true })
  }
})

test('serializes concurrent writers from separate save-store instances', async () => {
  const dataPath = await mkdtemp(join(tmpdir(), 'emulator-hub-save-store-'))
  try {
    const first = createSaveStore({ dataPath })
    const second = createSaveStore({ dataPath })
    await first.put('profile-may', 'pokemon-emerald', Buffer.from([1]), null)

    const results = await Promise.allSettled([
      first.put('profile-may', 'pokemon-emerald', Buffer.from([2]), 1),
      second.put('profile-may', 'pokemon-emerald', Buffer.from([3]), 1),
    ])

    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
    assert.equal(results.filter(result => result.status === 'rejected' && result.reason.code === 'SAVE_REVISION_CONFLICT').length, 1)
    assert.equal((await first.get('profile-may', 'pokemon-emerald')).revision, 2)
  } finally {
    await rm(dataPath, { recursive: true, force: true })
  }
})

test('allows independent game save keys to complete concurrently', async () => {
  const dataPath = await mkdtemp(join(tmpdir(), 'emulator-hub-save-store-'))
  try {
    const store = createSaveStore({ dataPath })
    const results = await Promise.all([
      store.put('profile-may', 'pokemon-red', Buffer.from([1]), null, { fenceGeneration: 1 }),
      store.put('profile-may', 'pokemon-blue', Buffer.from([2]), null, { fenceGeneration: 1 }),
      store.put('profile-june', 'pokemon-red', Buffer.from([3]), null, { fenceGeneration: 1 }),
    ])
    assert.deepEqual(results.map(result => result.revision), [1, 1, 1])
    assert.equal((await store.get('profile-may', 'pokemon-red')).bytes[0], 1)
    assert.equal((await store.get('profile-may', 'pokemon-blue')).bytes[0], 2)
    assert.equal((await store.get('profile-june', 'pokemon-red')).bytes[0], 3)
  } finally {
    await rm(dataPath, { recursive: true, force: true })
  }
})

test('fails within a bounded deadline when an orphan save lock cannot be acquired', async () => {
  const dataPath = await mkdtemp(join(tmpdir(), 'emulator-hub-save-store-'))
  let instant = 100
  try {
    const store = createSaveStore({
      dataPath,
      lockTimeoutMs: 10,
      lockRetryMs: 5,
      now: () => instant,
      wait: async milliseconds => { instant += milliseconds },
    })
    await store.put('profile-may', 'pokemon-emerald', Buffer.from([1]), null)
    await writeFile(join(dataPath, 'profile-may', 'pokemon-emerald.lock'), 'orphan')

    await assert.rejects(
      () => store.put('profile-may', 'pokemon-emerald', Buffer.from([2]), 1),
      error => error.code === 'SAVE_LOCK_TIMEOUT',
    )
    assert.equal(instant, 110)
    assert.equal((await store.get('profile-may', 'pokemon-emerald')).revision, 1)
  } finally {
    await rm(dataPath, { recursive: true, force: true })
  }
})
