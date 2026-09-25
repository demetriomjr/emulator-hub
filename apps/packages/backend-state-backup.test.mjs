import assert from 'node:assert/strict'
import { gunzip } from 'node:zlib'
import { promisify } from 'node:util'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createMemoryRedisPersistence } from './redis-persistence.mjs'
import { createBackendStateBackup } from './backend-state-backup.mjs'

const gunzipAsync = promisify(gunzip)

test('writes a complete atomic backend state archive', async () => {
  const root = await mkdtemp(join(tmpdir(), 'emulator-hub-backup-'))
  try {
    const persistence = createMemoryRedisPersistence({ namespace: 'emulator-hub:test' })
    await persistence.set('profiles:game:red', JSON.stringify([{ id: 'profile-red', name: 'Red' }]))
    await persistence.addToSet('pokemon-hub:workspace-lease', 'session-a')
    await persistence.addToSortedSet('pokemon-hub:expiring-lease', 'session-a', 1234)
    const backup = createBackendStateBackup({
      persistence,
      saveStore: { async listAll() { return [{ profileId: 'profile-red', gameId: 'red', revision: 3, sha256: 'abc', fenceGeneration: 2, bytes: Buffer.from([1, 2, 3]) }] } },
      backupsPath: join(root, 'backups'),
      namespace: 'emulator-hub:test',
      now: () => new Date('2026-09-22T12:34:56.000Z'),
    })
    const result = await backup.create('operator')
    assert.equal(result.recordCounts.redis, 3)
    assert.equal(result.recordCounts.saves, 1)
    const archive = await gunzipAsync(await readFile(join(root, 'backups', result.fileName)))
    const document = JSON.parse(archive)
    assert.equal(document.schemaVersion, 1)
    assert.equal(document.reason, 'operator')
    assert.deepEqual(document.redis.records.find(record => record.key === 'profiles:game:red'), {
      key: 'profiles:game:red', value: JSON.stringify([{ id: 'profile-red', name: 'Red' }]),
    })
    assert.deepEqual(document.redis.records.find(record => record.key === 'pokemon-hub:workspace-lease'), {
      key: 'pokemon-hub:workspace-lease', type: 'set', value: ['session-a'],
    })
    assert.deepEqual(document.redis.records.find(record => record.key === 'pokemon-hub:expiring-lease'), {
      key: 'pokemon-hub:expiring-lease', type: 'zset', value: [{ value: 'session-a', score: 1234 }],
    })
    assert.equal(document.saves[0].bytesBase64, Buffer.from([1, 2, 3]).toString('base64'))
    assert.deepEqual(await readdir(join(root, 'backups')), [result.fileName])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('rejects unsupported Redis key types instead of writing an incomplete archive', async () => {
  const root = await mkdtemp(join(tmpdir(), 'emulator-hub-backup-'))
  try {
    const persistence = createMemoryRedisPersistence()
    await persistence.set('future:hash', 'placeholder')
    persistence.type = async () => 'hash'
    const backup = createBackendStateBackup({ persistence, saveStore: { async listAll() { return [] } }, backupsPath: root })
    await assert.rejects(backup.create('startup'), /Cannot back up Redis key type: hash/)
    assert.deepEqual(await readdir(root), [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
