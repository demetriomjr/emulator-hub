import { createHash } from 'node:crypto'
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const maximumStateBytes = 32 * 1024 * 1024
export function createSnapshotStore({ dataPath, lockTimeoutMs = 5_000, lockRetryMs = 5, now = () => Date.now(), wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)) }) {
  const pending = new Map()
  const lockOptions = { lockTimeoutMs, lockRetryMs, now, wait }
  return { get, put, advanceFence, delete: remove }

  async function get(profileId, gameId) {
    const paths = snapshotPaths(dataPath, profileId, gameId)
    let metadata
    try { metadata = JSON.parse(await readFile(paths.metadata, 'utf8')) } catch (error) { if (error.code === 'ENOENT') return null; throw error }
    if (!Number.isInteger(metadata.saveRevision)) metadata.saveRevision = 0
    if (metadata.promptOnLaunch === undefined) metadata.promptOnLaunch = true
    try {
      const state = await readFile(join(paths.directory, metadata.stateFile))
      if (!validMetadata(metadata, state)) throw snapshotError('SNAPSHOT_PERSISTED_INVALID', 'Persisted snapshot is invalid.')
      return { metadata, state: new Uint8Array(state) }
    } catch (error) {
      if (error.code === 'ENOENT') throw snapshotError('SNAPSHOT_PERSISTED_INVALID', 'Persisted snapshot is incomplete.')
      throw error
    }
  }

  async function put(profileId, gameId, bundle, expectedRevision, { fenceGeneration = 0 } = {}) {
    return serialize(snapshotKey(profileId, gameId), async () => {
      const paths = snapshotPaths(dataPath, profileId, gameId)
      return withLock(paths.lock, async () => {
        const { metadata: supplied, state } = validateBundle(bundle)
        const current = await get(profileId, gameId)
        if ((current === null && expectedRevision !== null) || (current !== null && expectedRevision !== current.metadata.revision)) throw snapshotError('SNAPSHOT_REVISION_CONFLICT', 'Snapshot revision does not match the current snapshot.')
        if (!Number.isInteger(fenceGeneration) || fenceGeneration < 0) throw snapshotError('SNAPSHOT_FENCE_INVALID', 'Snapshot fence generation is invalid.')
        if (current && fenceGeneration !== current.metadata.fenceGeneration) throw snapshotError('SNAPSHOT_FENCE_CONFLICT', 'Snapshot fence generation does not match the current snapshot.')
        const revision = (current?.metadata.revision ?? 0) + 1
        const next = {
          ...supplied,
          revision,
          fenceGeneration,
          saveRevision: supplied.saveRevision,
          byteLength: state.byteLength,
          sha256: hash(state),
          createdAt: new Date().toISOString(),
          stateFile: `${gameId}.${revision}.state`,
        }
        await mkdir(paths.directory, { recursive: true })
        await writeAtomically(join(paths.directory, next.stateFile), state)
        await writeAtomically(paths.metadata, JSON.stringify(next))
        await removeOldFiles(paths.directory, current?.metadata, next)
        return { revision, sha256: next.sha256, saveRevision: next.saveRevision, fenceGeneration }
      }, lockOptions)
    })
  }

  async function advanceFence(profileId, gameId, nextGeneration) {
    return serialize(snapshotKey(profileId, gameId), async () => {
      const paths = snapshotPaths(dataPath, profileId, gameId)
      return withLock(paths.lock, async () => {
        if (!Number.isInteger(nextGeneration) || nextGeneration < 1) throw snapshotError('SNAPSHOT_FENCE_INVALID', 'Snapshot fence generation is invalid.')
        const current = await get(profileId, gameId)
        if (!current) throw snapshotError('SNAPSHOT_MISSING', 'Snapshot is missing.')
        if (nextGeneration < current.metadata.fenceGeneration) throw snapshotError('SNAPSHOT_FENCE_CONFLICT', 'Snapshot fence generation cannot move backwards.')
        if (nextGeneration === current.metadata.fenceGeneration) return current.metadata
        const metadata = { ...current.metadata, fenceGeneration: nextGeneration }
        await writeAtomically(paths.metadata, JSON.stringify(metadata))
        return metadata
      }, lockOptions)
    })
  }

  async function remove(profileId, gameId, { expectedRevision, fenceGeneration } = {}) {
    return serialize(snapshotKey(profileId, gameId), async () => {
      const paths = snapshotPaths(dataPath, profileId, gameId)
      return withLock(paths.lock, async () => {
        const current = await get(profileId, gameId)
        if (!current) return false
        if (expectedRevision !== undefined && current.metadata.revision !== expectedRevision) throw snapshotError('SNAPSHOT_REVISION_CONFLICT', 'Snapshot revision does not match the current snapshot.')
        if (fenceGeneration !== undefined && current.metadata.fenceGeneration !== fenceGeneration) throw snapshotError('SNAPSHOT_FENCE_CONFLICT', 'Snapshot fence generation does not match the current snapshot.')
        await unlink(paths.metadata).catch(error => { if (error.code !== 'ENOENT') throw error })
        await Promise.all([current.metadata.stateFile, current.metadata.saveFile].filter(Boolean).map(name => unlink(join(paths.directory, name)).catch(error => { if (error.code !== 'ENOENT') throw error })))
        return true
      }, lockOptions)
    })
  }

  function serialize(key, operation) {
    const previous = pending.get(key) ?? Promise.resolve()
    const next = previous.then(operation, operation)
    const queued = next.finally(() => { if (pending.get(key) === queued) pending.delete(key) })
    pending.set(key, queued)
    return queued
  }
}

function validateBundle(bundle) {
  if (!bundle || typeof bundle !== 'object' || !(bundle.state instanceof Uint8Array)) throw snapshotError('SNAPSHOT_INVALID', 'Snapshot bundle is invalid.')
  if (bundle.state.byteLength === 0 || bundle.state.byteLength > maximumStateBytes) throw snapshotError('SNAPSHOT_INVALID', 'Snapshot state bytes are invalid.')
  const metadata = bundle.metadata
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw snapshotError('SNAPSHOT_INVALID', 'Snapshot metadata is invalid.')
  for (const key of ['core', 'romSha256', 'runtimeId']) if (typeof metadata[key] !== 'string' || metadata[key].length === 0) throw snapshotError('SNAPSHOT_INVALID', `Snapshot metadata ${key} is invalid.`)
  if (!/^[a-f0-9]{64}$/.test(metadata.romSha256)) throw snapshotError('SNAPSHOT_INVALID', 'Snapshot ROM hash is invalid.')
  if (!Number.isInteger(metadata.saveRevision) || metadata.saveRevision < 0) throw snapshotError('SNAPSHOT_INVALID', 'Snapshot save revision is invalid.')
  if (metadata.promptOnLaunch !== undefined && typeof metadata.promptOnLaunch !== 'boolean') throw snapshotError('SNAPSHOT_INVALID', 'Snapshot promptOnLaunch is invalid.')
  return { metadata: { core: metadata.core, romSha256: metadata.romSha256, runtimeId: metadata.runtimeId, saveRevision: metadata.saveRevision, promptOnLaunch: metadata.promptOnLaunch ?? true }, state: bundle.state }
}

function validMetadata(metadata, state) {
  return metadata && Number.isInteger(metadata.revision) && metadata.revision > 0
    && Number.isInteger(metadata.fenceGeneration) && metadata.fenceGeneration >= 0
    && Number.isInteger(metadata.byteLength) && metadata.byteLength === state.byteLength
    && Number.isInteger(metadata.saveRevision) && metadata.saveRevision >= 0
    && typeof metadata.promptOnLaunch === 'boolean'
    && typeof metadata.stateFile === 'string'
    && typeof metadata.core === 'string' && typeof metadata.runtimeId === 'string'
    && /^[a-f0-9]{64}$/.test(metadata.romSha256 ?? '')
    && metadata.sha256 === hash(state)
}

function snapshotPaths(dataPath, profileId, gameId) {
  const directory = join(dataPath, profileId)
  return { directory, metadata: join(directory, `${gameId}.json`), lock: join(directory, `${gameId}.lock`) }
}

async function writeAtomically(path, data) {
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, data)
  await rename(temporary, path)
}

async function removeOldFiles(directory, previous, next) {
  if (!previous) return
  for (const name of [previous.stateFile, previous.saveFile]) {
    if (name && name !== next.stateFile && name !== next.saveFile) await unlink(join(directory, name)).catch(error => { if (error.code !== 'ENOENT') throw error })
  }
}

async function withLock(path, operation, { lockTimeoutMs, lockRetryMs, now, wait }) {
  await mkdir(dirname(path), { recursive: true })
  const deadline = now() + lockTimeoutMs
  let handle
  while (!handle) {
    try { handle = await open(path, 'wx') }
    catch (error) {
      if (error.code !== 'EEXIST') throw error
      if (now() >= deadline) throw snapshotError('SNAPSHOT_LOCK_TIMEOUT', 'Snapshot lock could not be acquired before the deadline.')
      await wait(Math.min(lockRetryMs, Math.max(0, deadline - now())))
    }
  }
  try { return await operation() }
  finally { await handle.close(); await unlink(path).catch(error => { if (error.code !== 'ENOENT') throw error }) }
}

function hash(bytes) { return createHash('sha256').update(bytes).digest('hex') }
function snapshotKey(profileId, gameId) { return `${profileId}\u0000${gameId}` }
function snapshotError(code, message) { const error = new Error(message); error.code = code; return error }
