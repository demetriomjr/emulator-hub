import { createHash } from 'node:crypto'
import { gzip } from 'node:zlib'
import { promisify } from 'node:util'
import { mkdir, open, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const gzipAsync = promisify(gzip)

export function createBackendStateBackup({ persistence, saveStore, backupsPath, namespace = null, now = () => new Date() } = {}) {
  if (!persistence || typeof persistence.keys !== 'function' || typeof persistence.get !== 'function') throw new TypeError('Backup persistence is required.')
  if (!saveStore || typeof saveStore.listAll !== 'function') throw new TypeError('Backup save store is required.')
  if (typeof backupsPath !== 'string' || backupsPath.length === 0) throw new TypeError('Backup path is required.')
  let queue = Promise.resolve()
  return { create: reason => {
    const operation = queue.then(() => create(reason))
    queue = operation.catch(() => {})
    return operation
  } }

  async function create(reason = 'operator') {
    const createdAt = new Date(now()).toISOString()
    const keys = [...await persistence.keys('')].sort()
    const records = []
    for (const key of keys) records.push({ key, value: await persistence.get(key) })
    const saves = (await saveStore.listAll()).map(save => ({
      profileId: save.profileId,
      gameId: save.gameId,
      revision: save.revision,
      sha256: save.sha256,
      fenceGeneration: save.fenceGeneration ?? 0,
      bytesBase64: Buffer.from(save.bytes).toString('base64'),
    }))
    const document = { schemaVersion: 1, createdAt, reason, redis: { namespace, records }, saves }
    const compressed = await gzipAsync(JSON.stringify(document))
    const digest = createHash('sha256').update(compressed).digest('hex')
    await mkdir(dirname(join(backupsPath, 'placeholder')), { recursive: true })
    const fileName = `backend-state-${createdAt.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}-${digest.slice(0, 12)}.json.gz`
    const target = join(backupsPath, fileName)
    const temporary = `${target}.${process.pid}.tmp`
    try {
      await writeFile(temporary, compressed, { flag: 'wx' })
      const handle = await open(temporary, 'r+')
      try { await handle.sync() } finally { await handle.close() }
      await rename(temporary, target)
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => {})
      throw error
    }
    return { schemaVersion: 1, createdAt, reason, fileName, sizeBytes: compressed.length, sha256: digest, recordCounts: { redis: records.length, saves: saves.length } }
  }
}

