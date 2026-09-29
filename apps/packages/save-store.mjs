import { createHash, randomUUID } from 'node:crypto'
import { access, mkdir, open, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const maximumSaveBytes = 2 * 1024 * 1024

export function createSaveStore({ dataPath, eventBackupsPath = null, afterEventSaveReplace = null, afterFirstPairSaveReplace = null, lockTimeoutMs = 5_000, lockRetryMs = 5, now = () => Date.now(), wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)) }) {
  if (!Number.isFinite(lockTimeoutMs) || lockTimeoutMs < 0) throw new TypeError('Save lock timeout is invalid.')
  if (!Number.isFinite(lockRetryMs) || lockRetryMs <= 0) throw new TypeError('Save lock retry interval is invalid.')
  const pending = new Map()
  const lockOptions = { lockTimeoutMs, lockRetryMs, now, wait }
  const pairJournalDirectory = join(dataPath, '.item-transfer-journals')
  let recoveryInFlight = null
  return {
    get,
    putPair,
    async listAll() {
      let profiles
      try { profiles = await readdir(dataPath, { withFileTypes: true }) } catch (error) { if (error.code === 'ENOENT') return []; throw error }
      const saves = []
      for (const profileEntry of profiles) {
        if (!profileEntry.isDirectory()) continue
        let files
        try { files = await readdir(join(dataPath, profileEntry.name)) } catch (error) { if (error.code === 'ENOENT') continue; throw error }
        for (const file of files) {
          if (!file.endsWith('.sav')) continue
          const gameId = file.slice(0, -'.sav'.length)
          const saved = await get(profileEntry.name, gameId)
          if (saved !== null) saves.push({ profileId: profileEntry.name, gameId, ...saved })
        }
      }
      return saves
    },
    async put(profileId, gameId, bytes, expectedRevision, { fenceGeneration = 0, invalidateRuntimeStates = false, eventGrantReceipt = null, beforeCommit = null } = {}) {
      await recoverPairJournals()
      return serialize(saveKey(profileId, gameId), async () => {
      const paths = savePaths(dataPath, profileId, gameId)
      return withSaveLock(paths, async () => {
      await recoverEventJournal(paths)
      if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > maximumSaveBytes) {
        const error = new Error('Save bytes must be between 1 byte and 2 MiB.')
        error.code = 'SAVE_INVALID'
        throw error
      }
      if (!Number.isInteger(fenceGeneration) || fenceGeneration < 0) throw saveError('SAVE_FENCE_INVALID', 'Save fence generation is invalid.')
      const current = await readCurrent(paths)
      if ((current === null && expectedRevision !== null) || (current !== null && expectedRevision !== current.revision)) {
        throw saveError('SAVE_REVISION_CONFLICT', 'Save revision does not match the current save.')
      }
      if (current && fenceGeneration !== current.fenceGeneration) throw saveError('SAVE_FENCE_CONFLICT', 'Save fence generation does not match the current save.')
      if (beforeCommit !== null) {
        if (typeof beforeCommit !== 'function') throw saveError('SAVE_PRECONDITION_INVALID', 'Save precondition is invalid.')
        await beforeCommit()
      }
      const revision = (current?.revision ?? 0) + 1
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      await mkdir(dirname(paths.bytes), { recursive: true })
      const runtimeStateInvalidatedAtRevision = invalidateRuntimeStates ? revision : current?.runtimeStateInvalidatedAtRevision
      let receipt = current?.eventGrantReceipt
      let backupFileName = null
      if (eventGrantReceipt !== null) {
        validateNewEventGrantReceipt(eventGrantReceipt)
        if (!current || typeof eventBackupsPath !== 'string' || !eventBackupsPath) throw saveError('SAVE_EVENT_BACKUP_UNAVAILABLE', 'Event save backup is unavailable.')
        backupFileName = `event-${createHash('sha256').update(saveKey(profileId, gameId)).digest('hex').slice(0, 16)}-${randomUUID()}.json`
        receipt = { ...eventGrantReceipt, saveRevision: revision, saveSha256: sha256, backupFileName }
      }
      const metadata = { revision, sha256, fenceGeneration, ...(runtimeStateInvalidatedAtRevision ? { runtimeStateInvalidatedAtRevision } : {}), ...(receipt ? { eventGrantReceipt: receipt } : {}) }
      if (eventGrantReceipt !== null) {
        const originalMetadata = JSON.parse(await readFile(paths.metadata, 'utf8'))
        const preimage = { schemaVersion: 1, profileId, gameId, originalBytesBase64: current.bytes.toString('base64'), originalMetadata, targetRevision: revision, targetSha256: sha256 }
        await mkdir(eventBackupsPath, { recursive: true })
        const backupPath = join(eventBackupsPath, backupFileName)
        await writeDurableFile(backupPath, JSON.stringify(preimage))
        const backedUp = JSON.parse(await readFile(backupPath, 'utf8'))
        if (backedUp.originalMetadata?.sha256 !== current.sha256 || Buffer.from(backedUp.originalBytesBase64 ?? '', 'base64').compare(current.bytes) !== 0) throw saveError('SAVE_EVENT_BACKUP_INVALID', 'Event save backup could not be verified.')
        await writeDurableFile(paths.eventJournal, JSON.stringify(preimage))
      }
      try {
        await writeAtomically(paths.bytes, bytes, eventGrantReceipt !== null)
        if (eventGrantReceipt !== null) await afterEventSaveReplace?.()
        await writeAtomically(paths.metadata, JSON.stringify(metadata), eventGrantReceipt !== null)
        if (eventGrantReceipt !== null) {
          const verified = await readCurrent(paths)
          if (verified?.sha256 !== sha256 || verified.revision !== revision || verified.eventGrantReceipt?.saveSha256 !== sha256) throw saveError('SAVE_EVENT_VERIFY_FAILED', 'Event save write could not be verified.')
          await unlink(paths.eventJournal)
        }
      } catch (error) {
        if (eventGrantReceipt !== null) await recoverEventJournal(paths)
        throw error
      }
      return { revision, sha256, fenceGeneration, ...(runtimeStateInvalidatedAtRevision ? { runtimeStateInvalidatedAtRevision } : {}), ...(receipt ? { eventGrantReceipt: receipt } : {}) }
      }, lockOptions)
      })
    },
    async advanceFence(profileId, gameId, nextGeneration) {
      await recoverPairJournals()
      return serialize(saveKey(profileId, gameId), async () => {
        const paths = savePaths(dataPath, profileId, gameId)
        return withSaveLock(paths, async () => {
        if (!Number.isInteger(nextGeneration) || nextGeneration < 1) throw saveError('SAVE_FENCE_INVALID', 'Save fence generation is invalid.')
        await recoverEventJournal(paths)
        const current = await readCurrent(paths)
        if (!current) throw saveError('SAVE_MISSING', 'Save is missing.')
        if (nextGeneration < current.fenceGeneration) throw saveError('SAVE_FENCE_CONFLICT', 'Save fence generation cannot move backwards.')
        if (nextGeneration === current.fenceGeneration) return current
        await writeAtomically(paths.metadata, JSON.stringify({ revision: current.revision, sha256: current.sha256, fenceGeneration: nextGeneration, ...(current.runtimeStateInvalidatedAtRevision ? { runtimeStateInvalidatedAtRevision: current.runtimeStateInvalidatedAtRevision } : {}), ...(current.eventGrantReceipt ? { eventGrantReceipt: current.eventGrantReceipt } : {}) }))
        return { ...current, fenceGeneration: nextGeneration }
        }, lockOptions)
      })
    },
  }

  async function putPair(entries, { beforeCommit = null } = {}) {
    if (!Array.isArray(entries) || entries.length !== 2 || entries.some(entry => !entry || !Buffer.isBuffer(entry.bytes)
      || entry.bytes.length === 0 || entry.bytes.length > maximumSaveBytes || !Number.isInteger(entry.expectedRevision)
      || entry.expectedRevision < 1 || !Number.isInteger(entry.fenceGeneration) || entry.fenceGeneration < 0)
      || saveKey(entries[0].profileId, entries[0].gameId) === saveKey(entries[1].profileId, entries[1].gameId)) {
      throw saveError('SAVE_PAIR_INVALID', 'Save pair request is invalid.')
    }
    await recoverPairJournals()
    const paths = entries.map(entry => savePaths(dataPath, entry.profileId, entry.gameId))
    return withPairLocks(paths, async () => {
      const current = await Promise.all(paths.map(async path => { await recoverEventJournal(path); return readCurrent(path) }))
      for (let index = 0; index < 2; index++) {
        if (current[index]?.revision !== entries[index].expectedRevision) throw saveError('SAVE_REVISION_CONFLICT', 'Save revision does not match the current save.')
        if (current[index].fenceGeneration !== entries[index].fenceGeneration) throw saveError('SAVE_FENCE_CONFLICT', 'Save fence generation does not match the current save.')
      }
      if (beforeCommit !== null) {
        if (typeof beforeCommit !== 'function') throw saveError('SAVE_PRECONDITION_INVALID', 'Save pair precondition is invalid.')
        await beforeCommit()
      }
      const targets = entries.map((entry, index) => {
        const revision = current[index].revision + 1
        const sha256 = createHash('sha256').update(entry.bytes).digest('hex')
        return { profileId: entry.profileId, gameId: entry.gameId, originalRevision: current[index].revision,
          originalSha256: current[index].sha256, bytesBase64: entry.bytes.toString('base64'),
          metadata: { revision, sha256, fenceGeneration: entry.fenceGeneration, runtimeStateInvalidatedAtRevision: revision,
            ...(current[index].eventGrantReceipt ? { eventGrantReceipt: current[index].eventGrantReceipt } : {}) } }
      })
      await mkdir(pairJournalDirectory, { recursive: true })
      const journalPath = join(pairJournalDirectory, `${randomUUID()}.json`)
      await writeAtomically(journalPath, JSON.stringify({ schemaVersion: 1, targets }), true)
      for (let index = 0; index < 2; index++) {
        await writeAtomically(paths[index].bytes, entries[index].bytes, true)
        if (index === 0) await afterFirstPairSaveReplace?.()
        await writeAtomically(paths[index].metadata, JSON.stringify(targets[index].metadata), true)
      }
      await unlink(journalPath)
      return targets.map(target => ({ ...target.metadata }))
    })
  }

  async function recoverPairJournals() {
    if (recoveryInFlight) return recoveryInFlight
    recoveryInFlight = (async () => {
      let files
      try { files = await readdir(pairJournalDirectory) }
      catch (error) { if (error.code === 'ENOENT') return; throw error }
      for (const file of files.filter(name => /^[0-9a-f-]{36}\.json$/.test(name))) {
        const journalPath = join(pairJournalDirectory, file)
        let journal
        try { journal = JSON.parse(await readFile(journalPath, 'utf8')) }
        catch (error) { if (error.code === 'ENOENT') continue; throw saveError('SAVE_PAIR_JOURNAL_INVALID', 'Item transfer journal is invalid.') }
        if (journal.schemaVersion !== 1 || !Array.isArray(journal.targets) || journal.targets.length !== 2) throw saveError('SAVE_PAIR_JOURNAL_INVALID', 'Item transfer journal is invalid.')
        const paths = journal.targets.map(target => savePaths(dataPath, target.profileId, target.gameId))
        await withPairLocks(paths, async () => {
          if (!await fileExists(journalPath)) return
          for (let index = 0; index < 2; index++) {
            const target = journal.targets[index]
            const bytes = Buffer.from(target.bytesBase64 ?? '', 'base64')
            if (!validMetadata(target.metadata, bytes) || target.metadata.revision !== target.originalRevision + 1) throw saveError('SAVE_PAIR_JOURNAL_INVALID', 'Item transfer journal is invalid.')
            const currentBytes = await readFile(paths[index].bytes)
            const currentHash = createHash('sha256').update(currentBytes).digest('hex')
            if (currentHash !== target.originalSha256 && currentHash !== target.metadata.sha256) throw saveError('SAVE_PAIR_JOURNAL_CONFLICT', 'Item transfer journal conflicts with the save.')
            await writeAtomically(paths[index].bytes, bytes, true)
            await writeAtomically(paths[index].metadata, JSON.stringify(target.metadata), true)
          }
          await unlink(journalPath)
        })
      }
    })().finally(() => { recoveryInFlight = null })
    return recoveryInFlight
  }

  async function withPairLocks(paths, operation) {
    const sorted = [...paths].sort((left, right) => left.lock.localeCompare(right.lock))
    return withSaveLock(sorted[0], () => withSaveLock(sorted[1], operation, lockOptions), lockOptions)
  }

  async function get(profileId, gameId) {
    await recoverPairJournals()
    const paths = savePaths(dataPath, profileId, gameId)
    return withSaveLock(paths, async () => { await recoverEventJournal(paths); return readCurrent(paths) }, lockOptions)
  }
  async function readCurrent(paths) {
    try {
      const [bytes, metadataSource] = await Promise.all([readFile(paths.bytes), readFile(paths.metadata, 'utf8')])
      const metadata = JSON.parse(metadataSource)
      if (!validMetadata(metadata, bytes)) throw new Error('Save metadata is invalid.')
      return { bytes, revision: metadata.revision, sha256: metadata.sha256, fenceGeneration: metadata.fenceGeneration ?? 0, ...(metadata.runtimeStateInvalidatedAtRevision ? { runtimeStateInvalidatedAtRevision: metadata.runtimeStateInvalidatedAtRevision } : {}), ...(metadata.eventGrantReceipt ? { eventGrantReceipt: metadata.eventGrantReceipt } : {}) }
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
    eventJournal: join(dataPath, profileId, `${gameId}.event-journal.json`),
  }
}

function validMetadata(metadata, bytes) {
  return metadata && Number.isInteger(metadata.revision) && metadata.revision > 0
    && typeof metadata.sha256 === 'string' && /^[a-f0-9]{64}$/.test(metadata.sha256)
    && (metadata.fenceGeneration === undefined || Number.isInteger(metadata.fenceGeneration) && metadata.fenceGeneration >= 0)
    && (metadata.runtimeStateInvalidatedAtRevision === undefined || Number.isInteger(metadata.runtimeStateInvalidatedAtRevision) && metadata.runtimeStateInvalidatedAtRevision > 0 && metadata.runtimeStateInvalidatedAtRevision <= metadata.revision)
    && (metadata.eventGrantReceipt === undefined || validEventGrantReceipt(metadata.eventGrantReceipt, metadata.revision))
    && createHash('sha256').update(bytes).digest('hex') === metadata.sha256
}

function validEventGrantReceipt(receipt, revision) {
  return receipt && typeof receipt.romSha256 === 'string' && /^[a-f0-9]{64}$/.test(receipt.romSha256)
    && Number.isInteger(receipt.recipeVersion) && receipt.recipeVersion > 0
    && Array.isArray(receipt.eventIds) && receipt.eventIds.length > 0 && receipt.eventIds.every(id => typeof id === 'string' && id.length > 0)
    && typeof receipt.deliveredAt === 'string' && Number.isFinite(Date.parse(receipt.deliveredAt))
    && Number.isInteger(receipt.saveRevision) && receipt.saveRevision > 0 && receipt.saveRevision <= revision
    && typeof receipt.saveSha256 === 'string' && /^[a-f0-9]{64}$/.test(receipt.saveSha256)
    && typeof receipt.backupFileName === 'string' && /^event-[a-f0-9]{16}-[0-9a-f-]{36}\.json$/.test(receipt.backupFileName)
}

function validateNewEventGrantReceipt(receipt) {
  if (!receipt || typeof receipt !== 'object' || !validEventGrantReceipt({ ...receipt, saveRevision: 1, saveSha256: '0'.repeat(64), backupFileName: `event-${'0'.repeat(16)}-00000000-0000-0000-0000-000000000000.json` }, 1)) {
    throw saveError('SAVE_EVENT_RECEIPT_INVALID', 'Event delivery receipt is invalid.')
  }
}

async function writeAtomically(path, data, durable = false) {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    if (durable) await writeDurableFile(temporary, data)
    else await writeFile(temporary, data)
    await rename(temporary, path)
  } catch (error) {
    await unlink(temporary).catch(() => {})
    throw error
  }
}

async function writeDurableFile(path, data) {
  const handle = await open(path, 'wx')
  try { await handle.writeFile(data); await handle.sync() }
  finally { await handle.close() }
}

async function fileExists(path) {
  try { await access(path); return true }
  catch (error) { if (error.code === 'ENOENT') return false; throw error }
}

async function recoverEventJournal(paths) {
  let source
  try { source = await readFile(paths.eventJournal, 'utf8') }
  catch (error) { if (error.code === 'ENOENT') return; throw error }
  let journal
  try { journal = JSON.parse(source) } catch { throw saveError('SAVE_EVENT_JOURNAL_INVALID', 'Event save journal is invalid.') }
  const original = Buffer.from(journal.originalBytesBase64 ?? '', 'base64')
  if (journal.schemaVersion !== 1 || !validMetadata(journal.originalMetadata, original) || !Number.isInteger(journal.targetRevision) || !/^[a-f0-9]{64}$/.test(journal.targetSha256 ?? '')) {
    throw saveError('SAVE_EVENT_JOURNAL_INVALID', 'Event save journal is invalid.')
  }
  const bytes = await readFile(paths.bytes)
  const hash = createHash('sha256').update(bytes).digest('hex')
  if (hash !== journal.originalMetadata.sha256 && hash !== journal.targetSha256) throw saveError('SAVE_EVENT_JOURNAL_CONFLICT', 'Event save journal cannot recover unexpected bytes.')
  let metadata
  try { metadata = JSON.parse(await readFile(paths.metadata, 'utf8')) } catch { metadata = null }
  if (hash === journal.targetSha256 && validMetadata(metadata, bytes) && metadata.revision === journal.targetRevision && metadata.eventGrantReceipt?.saveSha256 === hash) {
    await unlink(paths.eventJournal)
    return
  }
  await writeAtomically(paths.bytes, original, true)
  await writeAtomically(paths.metadata, JSON.stringify(journal.originalMetadata), true)
  const [recoveredBytes, recoveredMetadataSource] = await Promise.all([readFile(paths.bytes), readFile(paths.metadata, 'utf8')])
  if (!validMetadata(JSON.parse(recoveredMetadataSource), recoveredBytes)) throw saveError('SAVE_EVENT_RECOVERY_FAILED', 'Event save preimage could not be restored.')
  await unlink(paths.eventJournal)
}
async function withSaveLock(paths, operation, { lockTimeoutMs, lockRetryMs, now, wait }) {
  await mkdir(dirname(paths.lock), { recursive: true })
  const deadline = now() + lockTimeoutMs
  let handle
  while (!handle) {
    try {
      handle = await open(paths.lock, 'wx')
      try {
        await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }))
        await handle.sync()
      } catch (error) {
        await handle.close()
        await unlink(paths.lock).catch(() => {})
        throw error
      }
    }
    catch (error) {
      if (error.code !== 'EEXIST' && !(process.platform === 'win32' && error.code === 'EPERM')) throw error
      if (error.code === 'EEXIST' && await reclaimDeadSaveLock(paths.lock)) continue
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
async function reclaimDeadSaveLock(path) {
  let source
  try { source = await readFile(path, 'utf8') }
  catch (error) {
    if (error.code === 'ENOENT') return true
    if (process.platform === 'win32' && error.code === 'EPERM') return false
    throw error
  }
  let owner
  try { owner = JSON.parse(source) } catch { return false }
  if (!Number.isInteger(owner.pid) || owner.pid < 1 || owner.pid === process.pid) return false
  try { process.kill(owner.pid, 0); return false }
  catch (error) { if (error.code !== 'ESRCH') return false }
  try {
    if (await readFile(path, 'utf8') !== source) return false
    await unlink(path)
    return true
  } catch (error) {
    if (error.code === 'ENOENT') return true
    if (process.platform === 'win32' && error.code === 'EPERM') return false
    throw error
  }
}
function saveKey(profileId, gameId) { return `${profileId}\u0000${gameId}` }
function saveError(code, message) { const error = new Error(message); error.code = code; return error }
