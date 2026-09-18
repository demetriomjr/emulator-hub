import { createHash } from 'node:crypto'
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const maximumSaveBytes = 2 * 1024 * 1024

export function createSaveStore({ dataPath, lockTimeoutMs = 5_000, lockRetryMs = 5, now = () => Date.now(), wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)) }) {
  if (!Number.isFinite(lockTimeoutMs) || lockTimeoutMs < 0) throw new TypeError('Save lock timeout is invalid.')
  if (!Number.isFinite(lockRetryMs) || lockRetryMs <= 0) throw new TypeError('Save lock retry interval is invalid.')
  const pending = new Map()
  const lockOptions = { lockTimeoutMs, lockRetryMs, now, wait }
  return {
    get,
    async put(profileId, gameId, bytes, expectedRevision, { fenceGeneration = 0 } = {}) {
      return serialize(saveKey(profileId, gameId), async () => {
      const paths = savePaths(dataPath, profileId, gameId)
      return withSaveLock(paths, async () => {
      if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > maximumSaveBytes) {
        const error = new Error('Save bytes must be between 1 byte and 2 MiB.')
        error.code = 'SAVE_INVALID'
        throw error
      }
      if (!Number.isInteger(fenceGeneration) || fenceGeneration < 0) throw saveError('SAVE_FENCE_INVALID', 'Save fence generation is invalid.')
      const current = await get(profileId, gameId)
      if ((current === null && expectedRevision !== null) || (current !== null && expectedRevision !== current.revision)) {
        throw saveError('SAVE_REVISION_CONFLICT', 'Save revision does not match the current save.')
      }
      if (current && fenceGeneration !== current.fenceGeneration) throw saveError('SAVE_FENCE_CONFLICT', 'Save fence generation does not match the current save.')
      const revision = (current?.revision ?? 0) + 1
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      await mkdir(dirname(paths.bytes), { recursive: true })
      await writeAtomically(paths.bytes, bytes)
      await writeAtomically(paths.metadata, JSON.stringify({ revision, sha256, fenceGeneration }))
      return { revision, sha256, fenceGeneration }
      }, lockOptions)
      })
    },
    async advanceFence(profileId, gameId, nextGeneration) {
      return serialize(saveKey(profileId, gameId), async () => {
        const paths = savePaths(dataPath, profileId, gameId)
        return withSaveLock(paths, async () => {
        if (!Number.isInteger(nextGeneration) || nextGeneration < 1) throw saveError('SAVE_FENCE_INVALID', 'Save fence generation is invalid.')
        const current = await get(profileId, gameId)
        if (!current) throw saveError('SAVE_MISSING', 'Save is missing.')
        if (nextGeneration < current.fenceGeneration) throw saveError('SAVE_FENCE_CONFLICT', 'Save fence generation cannot move backwards.')
        if (nextGeneration === current.fenceGeneration) return current
        await writeAtomically(paths.metadata, JSON.stringify({ revision: current.revision, sha256: current.sha256, fenceGeneration: nextGeneration }))
        return { ...current, fenceGeneration: nextGeneration }
        }, lockOptions)
      })
    },
  }

  async function get(profileId, gameId) {
    const paths = savePaths(dataPath, profileId, gameId)
    try {
      const [bytes, metadataSource] = await Promise.all([readFile(paths.bytes), readFile(paths.metadata, 'utf8')])
      const metadata = JSON.parse(metadataSource)
      if (!validMetadata(metadata, bytes)) throw new Error('Save metadata is invalid.')
      return { bytes, revision: metadata.revision, sha256: metadata.sha256, fenceGeneration: metadata.fenceGeneration ?? 0 }
    } catch (error) {
      if (error.code === 'ENOENT') return null
      throw error
    }
  }
  async function serialize(key, operation) {
    const previous = pending.get(key) ?? Promise.resolve()
    const next = previous.then(operation, operation)
    const queued = next.finally(() => { if (pending.get(key) === queued) pending.delete(key) })
    pending.set(key, queued)
    return queued
  }
}

function savePaths(dataPath, profileId, gameId) {
  return {
    bytes: join(dataPath, profileId, `${gameId}.sav`),
    metadata: join(dataPath, profileId, `${gameId}.json`),
    lock: join(dataPath, profileId, `${gameId}.lock`),
  }
}

function validMetadata(metadata, bytes) {
  return metadata && Number.isInteger(metadata.revision) && metadata.revision > 0
    && typeof metadata.sha256 === 'string' && /^[a-f0-9]{64}$/.test(metadata.sha256)
    && (metadata.fenceGeneration === undefined || Number.isInteger(metadata.fenceGeneration) && metadata.fenceGeneration >= 0)
    && createHash('sha256').update(bytes).digest('hex') === metadata.sha256
}

async function writeAtomically(path, data) {
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, data)
  await rename(temporary, path)
}
async function withSaveLock(paths, operation, { lockTimeoutMs, lockRetryMs, now, wait }) {
  await mkdir(dirname(paths.lock), { recursive: true })
  const deadline = now() + lockTimeoutMs
  let handle
  while (!handle) {
    try { handle = await open(paths.lock, 'wx') }
    catch (error) {
      if (error.code !== 'EEXIST') throw error
      if (now() >= deadline) throw saveError('SAVE_LOCK_TIMEOUT', 'Save lock could not be acquired before the deadline.')
      await wait(Math.min(lockRetryMs, Math.max(0, deadline - now())))
    }
  }
  try { return await operation() }
  finally {
    await handle.close()
    await unlink(paths.lock).catch(error => { if (error.code !== 'ENOENT') throw error })
  }
}
function saveKey(profileId, gameId) { return `${profileId}\u0000${gameId}` }
function saveError(code, message) { const error = new Error(message); error.code = code; return error }
