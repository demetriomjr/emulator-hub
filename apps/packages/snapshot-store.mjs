import { createHash } from 'node:crypto'
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const maximumStateBytes = 32 * 1024 * 1024
export function createSnapshotStore({ dataPath, lockTimeoutMs = 5_000, lockRetryMs = 5, now = () => Date.now(), wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)) }) {
  const pending = new Map()
  const lockOptions = { lockTimeoutMs, lockRetryMs, now, wait }
  return { get, put, advanceFence, delete: remove }

  async function get(profileId, gameId, { kind = 'cloud-recovery' } = {}) {
    const paths = snapshotPaths(dataPath, profileId, gameId, kind)
    let metadata
    try { metadata = JSON.parse(await readFile(paths.metadata, 'utf8')) } catch (error) { if (error.code === 'ENOENT') return null; throw error }
    if (!Number.isInteger(metadata.saveRevision)) metadata.saveRevision = 0
    if (metadata.promptOnLaunch === undefined) metadata.promptOnLaunch = true
    if (kind === 'cloud-recovery' && metadata.kind === undefined) metadata.kind = kind
    if (kind === 'cloud-recovery' && metadata.reasonCode === undefined) metadata.reasonCode = 'legacy-unknown'
    if (metadata.capturedAt === undefined) metadata.capturedAt = metadata.createdAt
    try {
      const state = await readFile(join(paths.directory, metadata.stateFile))
      if (!validMetadata(metadata, state) || metadata.kind !== kind) throw snapshotError('SNAPSHOT_PERSISTED_INVALID', 'Persisted snapshot is invalid.')
      return { metadata, state: new Uint8Array(state) }
    } catch (error) {
      if (error.code === 'ENOENT') throw snapshotError('SNAPSHOT_PERSISTED_INVALID', 'Persisted snapshot is incomplete.')
      throw error
    }
  }

  async function put(profileId, gameId, bundle, expectedRevision, { fenceGeneration = 0, kind = 'cloud-recovery' } = {}) {
    return serialize(snapshotKey(profileId, gameId, kind), async () => {
      const paths = snapshotPaths(dataPath, profileId, gameId, kind)
      return withLock(paths.lock, async () => {
        const { metadata: supplied, state } = validateBundle(bundle, kind)
        const current = await get(profileId, gameId, { kind })
        if ((current === null && expectedRevision !== null) || (current !== null && expectedRevision !== current.metadata.revision)) throw snapshotError('SNAPSHOT_REVISION_CONFLICT', 'Snapshot revision does not match the current snapshot.')
        if (!Number.isInteger(fenceGeneration) || fenceGeneration < 0) throw snapshotError('SNAPSHOT_FENCE_INVALID', 'Snapshot fence generation is invalid.')
        if (current && fenceGeneration !== current.metadata.fenceGeneration) throw snapshotError('SNAPSHOT_FENCE_CONFLICT', 'Snapshot fence generation does not match the current snapshot.')
        const revision = Math.max(current?.metadata.revision ?? 0, await readLastRevision(paths.revision)) + 1
        const capturedAt = new Date(now()).toISOString()
        const next = {
          ...supplied,
          revision,
          fenceGeneration,
          saveRevision: supplied.saveRevision,
          byteLength: state.byteLength,
          sha256: hash(state),
          createdAt: capturedAt,
          capturedAt,
          stateFile: `${gameId}${kind === 'user-state' ? '.user-state' : ''}.${revision}.state`,
        }
        await mkdir(paths.directory, { recursive: true })
        await writeAtomically(join(paths.directory, next.stateFile), state)
        await writeAtomically(paths.metadata, JSON.stringify(next))
        await removeOldFiles(paths.directory, current?.metadata, next)
        return { revision, sha256: next.sha256, saveRevision: next.saveRevision, fenceGeneration, capturedAt }
      }, lockOptions)
    })
  }

  async function advanceFence(profileId, gameId, nextGeneration, { kind = 'cloud-recovery' } = {}) {
    return serialize(snapshotKey(profileId, gameId, kind), async () => {
      const paths = snapshotPaths(dataPath, profileId, gameId, kind)
      return withLock(paths.lock, async () => {
        if (!Number.isInteger(nextGeneration) || nextGeneration < 1) throw snapshotError('SNAPSHOT_FENCE_INVALID', 'Snapshot fence generation is invalid.')
        const current = await get(profileId, gameId, { kind })
        if (!current) throw snapshotError('SNAPSHOT_MISSING', 'Snapshot is missing.')
        if (nextGeneration < current.metadata.fenceGeneration) throw snapshotError('SNAPSHOT_FENCE_CONFLICT', 'Snapshot fence generation cannot move backwards.')
        if (nextGeneration === current.metadata.fenceGeneration) return current.metadata
        const metadata = { ...current.metadata, fenceGeneration: nextGeneration }
        await writeAtomically(paths.metadata, JSON.stringify(metadata))
        return metadata
      }, lockOptions)
    })
  }

  async function remove(profileId, gameId, { expectedRevision, fenceGeneration, kind = 'cloud-recovery' } = {}) {
    return serialize(snapshotKey(profileId, gameId, kind), async () => {
      const paths = snapshotPaths(dataPath, profileId, gameId, kind)
      return withLock(paths.lock, async () => {
        const current = await get(profileId, gameId, { kind })
        if (!current) return false
        if (expectedRevision !== undefined && current.metadata.revision !== expectedRevision) throw snapshotError('SNAPSHOT_REVISION_CONFLICT', 'Snapshot revision does not match the current snapshot.')
        if (fenceGeneration !== undefined && current.metadata.fenceGeneration !== fenceGeneration) throw snapshotError('SNAPSHOT_FENCE_CONFLICT', 'Snapshot fence generation does not match the current snapshot.')
        await writeAtomically(paths.revision, String(Math.max(current.metadata.revision, await readLastRevision(paths.revision))))
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

function validateBundle(bundle, kind) {
  if (!bundle || typeof bundle !== 'object' || !(bundle.state instanceof Uint8Array)) throw snapshotError('SNAPSHOT_INVALID', 'Snapshot bundle is invalid.')
  if (bundle.state.byteLength === 0 || bundle.state.byteLength > maximumStateBytes) throw snapshotError('SNAPSHOT_INVALID', 'Snapshot state bytes are invalid.')
  const metadata = bundle.metadata
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw snapshotError('SNAPSHOT_INVALID', 'Snapshot metadata is invalid.')
  for (const key of ['core', 'romSha256', 'runtimeId']) if (typeof metadata[key] !== 'string' || metadata[key].length === 0) throw snapshotError('SNAPSHOT_INVALID', `Snapshot metadata ${key} is invalid.`)
  if (!/^[a-f0-9]{64}$/.test(metadata.romSha256)) throw snapshotError('SNAPSHOT_INVALID', 'Snapshot ROM hash is invalid.')
  if (!Number.isInteger(metadata.saveRevision) || metadata.saveRevision < 0) throw snapshotError('SNAPSHOT_INVALID', 'Snapshot save revision is invalid.')
  if (metadata.promptOnLaunch !== undefined && typeof metadata.promptOnLaunch !== 'boolean') throw snapshotError('SNAPSHOT_INVALID', 'Snapshot promptOnLaunch is invalid.')
  if (metadata.kind !== undefined && metadata.kind !== kind) throw snapshotError('SNAPSHOT_INVALID', 'Snapshot kind does not match its slot.')
  const reasons = kind === 'user-state' ? ['user-request'] : ['periodic-recovery', 'session-close', 'legacy-unknown']
  if (metadata.reasonCode !== undefined && !reasons.includes(metadata.reasonCode)) throw snapshotError('SNAPSHOT_INVALID', 'Snapshot reason is invalid.')
  if (metadata.patchSha256 !== undefined && !/^[a-f0-9]{64}$/.test(metadata.patchSha256)) throw snapshotError('SNAPSHOT_INVALID', 'Snapshot patch hash is invalid.')
  if (metadata.originInstallationId !== undefined && (typeof metadata.originInstallationId !== 'string' || metadata.originInstallationId.length < 8 || metadata.originInstallationId.length > 128)) throw snapshotError('SNAPSHOT_INVALID', 'Snapshot origin is invalid.')
  return { metadata: { core: metadata.core, romSha256: metadata.romSha256, runtimeId: metadata.runtimeId, saveRevision: metadata.saveRevision, promptOnLaunch: metadata.promptOnLaunch ?? true, kind, reasonCode: metadata.reasonCode ?? (kind === 'user-state' ? 'user-request' : 'legacy-unknown'), ...(metadata.patchSha256 ? { patchSha256: metadata.patchSha256 } : {}), ...(metadata.originInstallationId ? { originInstallationId: metadata.originInstallationId } : {}) }, state: bundle.state }
}

function validMetadata(metadata, state) {
  return metadata && Number.isInteger(metadata.revision) && metadata.revision > 0
    && Number.isInteger(metadata.fenceGeneration) && metadata.fenceGeneration >= 0
    && Number.isInteger(metadata.byteLength) && metadata.byteLength === state.byteLength
    && Number.isInteger(metadata.saveRevision) && metadata.saveRevision >= 0
    && typeof metadata.promptOnLaunch === 'boolean'
    && ['cloud-recovery', 'user-state'].includes(metadata.kind)
    && typeof metadata.reasonCode === 'string'
    && typeof metadata.capturedAt === 'string' && Number.isFinite(Date.parse(metadata.capturedAt))
    && typeof metadata.stateFile === 'string'
    && typeof metadata.core === 'string' && typeof metadata.runtimeId === 'string'
    && /^[a-f0-9]{64}$/.test(metadata.romSha256 ?? '')
    && metadata.sha256 === hash(state)
}

function snapshotPaths(dataPath, profileId, gameId, kind) {
  if (!['cloud-recovery', 'user-state'].includes(kind)) throw snapshotError('SNAPSHOT_KIND_INVALID', 'Snapshot kind is invalid.')
  const directory = kind === 'user-state' ? join(dataPath, profileId, 'user-state') : join(dataPath, profileId)
  return { directory, metadata: join(directory, `${gameId}.json`), revision: join(directory, `${gameId}.revision`), lock: join(directory, `${gameId}.lock`) }
}

async function readLastRevision(path) {
  let value
  try { value = (await readFile(path, 'utf8')).trim() }
  catch (error) { if (error.code === 'ENOENT') return 0; throw error }
  const revision = Number(value)
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(revision)) throw snapshotError('SNAPSHOT_PERSISTED_INVALID', 'Persisted snapshot revision is invalid.')
  return revision
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
function snapshotKey(profileId, gameId, kind) { return `${profileId}\u0000${gameId}\u0000${kind}` }
function snapshotError(code, message) { const error = new Error(message); error.code = code; return error }
