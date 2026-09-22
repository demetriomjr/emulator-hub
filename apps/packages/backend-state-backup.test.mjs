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
    const backup = createBackendStateBackup({
      persistence,
      saveStore: { async listAll() { return [{ profileId: 'profile-red', gameId: 'red', revision: 3, sha256: 'abc', fenceGeneration: 2, bytes: Buffer.from([1, 2, 3]) }] } },
      backupsPath: join(root, 'backups'),
      namespace: 'emulator-hub:test',
      now: () => new Date('2026-09-22T12:34:56.000Z'),
    })
    const result = await backup.create('operator')
    assert.equal(result.recordCounts.redis, 1)
    assert.equal(result.recordCounts.saves, 1)
    const archive = await gunzipAsync(await readFile(join(root, 'backups', result.fileName)))
    const document = JSON.parse(archive)
    assert.equal(document.schemaVersion, 1)
    assert.equal(document.reason, 'operator')
    assert.equal(document.redis.records[0].key, 'profiles:game:red')
    assert.equal(document.saves[0].bytesBase64, Buffer.from([1, 2, 3]).toString('base64'))
    assert.deepEqual(await readdir(join(root, 'backups')), [result.fileName])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

