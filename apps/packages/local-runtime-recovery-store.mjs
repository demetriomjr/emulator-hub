const maximumStateBytes = 32 * 1024 * 1024

export function createLocalRuntimeRecoveryStore({ storage = createIndexedDbRecoveryStorage() } = {}) {
  return {
    async put(bundle) {
      const record = normalize({ ...bundle, candidateId: createCandidateId(), capturedAt: new Date().toISOString() })
      await storage.put(key(record.profileId, record.gameId), record)
    },
    async get(profileId, gameId) {
      const storageKey = key(profileId, gameId)
      const record = await storage.get(storageKey)
      if (!record) return null
      const normalized = normalize({ ...record, candidateId: record.candidateId ?? createCandidateId() })
      if (!record.candidateId) await storage.put(storageKey, normalized)
      return normalized
    },
    async markRuntimeBreak(profileId, gameId) {
      const record = await storage.get(key(profileId, gameId))
      if (!record) return false
      await storage.put(key(profileId, gameId), { ...record, reason: 'runtime-break' })
      return true
    },
    async clear(profileId, gameId) { await storage.delete(key(profileId, gameId)) },
    async deleteIfMatches(profileId, gameId, candidateId) {
      if (typeof candidateId !== 'string' || candidateId.length === 0) return false
      return storage.deleteIfMatches(key(profileId, gameId), candidateId)
    },
  }
}

export function createMemoryRecoveryStorage() {
  const records = new Map()
  return {
    async put(id, value) { records.set(id, structuredClone(value)) },
    async get(id) { const value = records.get(id); return value ? structuredClone(value) : null },
    async delete(id) { records.delete(id) },
    async deleteIfMatches(id, candidateId) {
      if (records.get(id)?.candidateId !== candidateId) return false
      records.delete(id)
      return true
    },
  }
}

export function createIndexedDbRecoveryStorage(indexedDb = globalThis.indexedDB) {
  if (!indexedDb) throw new Error('IndexedDB is unavailable for local recovery.')
  const database = new Promise((resolve, reject) => {
    const request = indexedDb.open('emulator-hub-local-recovery', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('bundles')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return {
    async put(id, value) { await transaction(database, 'readwrite', store => store.put(structuredClone(value), id)) },
    async get(id) { const value = await transaction(database, 'readonly', store => store.get(id)); return value ? structuredClone(value) : null },
    async delete(id) { await transaction(database, 'readwrite', store => store.delete(id)) },
    async deleteIfMatches(id, candidateId) {
      return database.then(db => new Promise((resolve, reject) => {
        const tx = db.transaction('bundles', 'readwrite')
        const store = tx.objectStore('bundles')
        const request = store.get(id)
        let deleted = false
        request.onsuccess = () => {
          if (request.result?.candidateId === candidateId) {
            store.delete(id)
            deleted = true
          }
        }
        tx.oncomplete = () => resolve(deleted)
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error ?? new Error('Local recovery deletion was aborted.'))
      }))
    },
  }
}

function transaction(database, mode, operation) {
  return database.then(db => new Promise((resolve, reject) => {
    const request = operation(db.transaction('bundles', mode).objectStore('bundles'))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  }))
}

function normalize(bundle) {
  if (!bundle || typeof bundle !== 'object') throw new TypeError('Recovery bundle is invalid.')
  const { profileId, gameId, core, romSha256, runtimeId, patchSha256, candidateId, capturedAt } = bundle
  if (![profileId, gameId, core, romSha256, runtimeId].every(value => typeof value === 'string' && value.length > 0) || !/^[a-f0-9]{64}$/.test(romSha256)) throw new TypeError('Recovery bundle identity is invalid.')
  if (!(bundle.state instanceof Uint8Array) || bundle.state.byteLength === 0 || bundle.state.byteLength > maximumStateBytes) throw new TypeError('Recovery state is invalid.')
  if (bundle.reason !== undefined && bundle.reason !== 'active' && bundle.reason !== 'runtime-break' && bundle.reason !== 'possible-recovery') throw new TypeError('Recovery reason is invalid.')
  if (candidateId !== undefined && (typeof candidateId !== 'string' || candidateId.length === 0 || candidateId.length > 128)) throw new TypeError('Recovery candidate ID is invalid.')
  if (capturedAt !== undefined && (typeof capturedAt !== 'string' || !Number.isFinite(Date.parse(capturedAt)))) throw new TypeError('Recovery capture time is invalid.')
  if (patchSha256 !== undefined && (typeof patchSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(patchSha256))) throw new TypeError('Recovery patch hash is invalid.')
  return { profileId, gameId, core, romSha256, runtimeId, ...(patchSha256 ? { patchSha256 } : {}), ...(candidateId ? { candidateId } : {}), ...(capturedAt ? { capturedAt } : {}), state: new Uint8Array(bundle.state), reason: bundle.reason ?? 'active' }
}

function key(profileId, gameId) { return `${profileId}\u0000${gameId}` }

function createCandidateId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  if (typeof globalThis.crypto?.getRandomValues !== 'function') throw new Error('Secure randomness is unavailable for local recovery identity.')
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
  return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('')
}
