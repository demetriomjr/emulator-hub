import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

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

test('event save writes keep a durable preimage and preserve their receipt through later saves', async () => {
  const root = await mkdtemp(join(tmpdir(), 'emulator-hub-event-store-'))
  try {
    const store = createSaveStore({ dataPath: join(root, 'saves'), eventBackupsPath: join(root, 'event-backups') })
    const original = Buffer.from([1, 2, 3])
    await store.put('may', 'emerald', original, null, { fenceGeneration: 1 })
    const candidate = Buffer.from([4, 5, 6])
    const receipt = { romSha256: 'a'.repeat(64), recipeVersion: 1, eventIds: ['birth-island'], deliveredAt: '2026-09-26T00:00:00.000Z' }
    const saved = await store.put('may', 'emerald', candidate, 1, { fenceGeneration: 1, eventGrantReceipt: receipt, invalidateRuntimeStates: true })
    assert.equal(saved.revision, 2)
    assert.equal(saved.eventGrantReceipt.saveRevision, 2)
    assert.equal(saved.eventGrantReceipt.saveSha256, saved.sha256)
    const backups = await readdir(join(root, 'event-backups'))
    assert.equal(backups.length, 1)
    const backup = JSON.parse(await readFile(join(root, 'event-backups', backups[0]), 'utf8'))
    assert.deepEqual(Buffer.from(backup.originalBytesBase64, 'base64'), original)
    assert.equal(backup.originalMetadata.revision, 1)
    assert.equal((await store.get('may', 'emerald')).eventGrantReceipt.backupFileName, backups[0])
    await store.advanceFence('may', 'emerald', 2)
    await store.put('may', 'emerald', Buffer.from([7, 8]), 2, { fenceGeneration: 2 })
    assert.equal((await createSaveStore({ dataPath: join(root, 'saves'), eventBackupsPath: join(root, 'event-backups') }).get('may', 'emerald')).eventGrantReceipt.backupFileName, backups[0])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('event write failure after replacing bytes restores the backed-up save', async () => {
  const root = await mkdtemp(join(tmpdir(), 'emulator-hub-event-store-'))
  try {
    const dataPath = join(root, 'saves')
    const eventBackupsPath = join(root, 'event-backups')
    const original = Buffer.from([1, 2, 3])
    const ordinary = createSaveStore({ dataPath, eventBackupsPath })
    await ordinary.put('may', 'emerald', original, null)
    const failing = createSaveStore({ dataPath, eventBackupsPath, afterEventSaveReplace() { throw new Error('simulated interruption') } })
    await assert.rejects(() => failing.put('may', 'emerald', Buffer.from([4, 5, 6]), 1, {
      eventGrantReceipt: { romSha256: 'a'.repeat(64), recipeVersion: 1, eventIds: ['birth-island'], deliveredAt: '2026-09-26T00:00:00.000Z' },
    }), /simulated interruption/)
    const current = await ordinary.get('may', 'emerald')
    assert.deepEqual(current.bytes, original)
    assert.equal(current.revision, 1)
    assert.equal(current.eventGrantReceipt, undefined)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a fresh process recovers the original save after an interrupted event write', async () => {
  const root = await mkdtemp(join(tmpdir(), 'emulator-hub-event-store-'))
  try {
    const dataPath = join(root, 'saves')
    const eventBackupsPath = join(root, 'event-backups')
    const store = createSaveStore({ dataPath, eventBackupsPath })
    const original = Buffer.from([1, 2, 3])
    await store.put('may', 'emerald', original, null)
    const moduleUrl = pathToFileURL(fileURLToPath(new URL('./save-store.mjs', import.meta.url))).href
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `import { createSaveStore } from ${JSON.stringify(moduleUrl)}; const store = createSaveStore({ dataPath: ${JSON.stringify(dataPath)}, eventBackupsPath: ${JSON.stringify(eventBackupsPath)}, afterEventSaveReplace() { process.exit(23) } }); await store.put('may', 'emerald', Buffer.from([4,5,6]), 1, { eventGrantReceipt: { romSha256: '${'a'.repeat(64)}', recipeVersion: 1, eventIds: ['birth-island'], deliveredAt: '2026-09-26T00:00:00.000Z' } });`], { encoding: 'utf8' })
    assert.equal(child.status, 23, child.stderr)
    const recovered = await createSaveStore({ dataPath, eventBackupsPath }).get('may', 'emerald')
    assert.deepEqual(recovered.bytes, original)
    assert.equal(recovered.revision, 1)
    assert.equal((await readdir(eventBackupsPath)).length, 1)
    assert.equal((await readdir(join(dataPath, 'may'))).some(name => name.endsWith('.event-journal.json')), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
