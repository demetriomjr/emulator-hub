const maximumStateBytes = 32 * 1024 * 1024
const maximumSaveBytes = 2 * 1024 * 1024

export function createLocalRuntimeRecoveryStore({ storage = createIndexedDbRecoveryStorage() } = {}) {
  return {
    async put(bundle) {
      const record = normalize(bundle)
      await storage.put(key(record.profileId, record.gameId), record)
    },
    async get(profileId, gameId) {
      const record = await storage.get(key(profileId, gameId))
      return record ? normalize(record) : null
    },
    async markRuntimeBreak(profileId, gameId) {
      const record = await storage.get(key(profileId, gameId))
      if (!record) return false
      await storage.put(key(profileId, gameId), { ...record, reason: 'runtime-break' })
      return true
    },
    async clear(profileId, gameId) { await storage.delete(key(profileId, gameId)) },
  }
}

export function createMemoryRecoveryStorage() {
  const records = new Map()
  return {
    async put(id, value) { records.set(id, structuredClone(value)) },
    async get(id) { const value = records.get(id); return value ? structuredClone(value) : null },
    async delete(id) { records.delete(id) },
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
  const { profileId, gameId, core, romSha256, runtimeId } = bundle
  if (![profileId, gameId, core, romSha256, runtimeId].every(value => typeof value === 'string' && value.length > 0) || !/^[a-f0-9]{64}$/.test(romSha256)) throw new TypeError('Recovery bundle identity is invalid.')
  if (!(bundle.state instanceof Uint8Array) || bundle.state.byteLength === 0 || bundle.state.byteLength > maximumStateBytes) throw new TypeError('Recovery state is invalid.')
  if (!(bundle.save instanceof Uint8Array) || bundle.save.byteLength === 0 || bundle.save.byteLength > maximumSaveBytes) throw new TypeError('Recovery save is invalid.')
  if (bundle.reason !== undefined && bundle.reason !== 'active' && bundle.reason !== 'runtime-break' && bundle.reason !== 'possible-recovery') throw new TypeError('Recovery reason is invalid.')
  return { profileId, gameId, core, romSha256, runtimeId, state: new Uint8Array(bundle.state), save: new Uint8Array(bundle.save), reason: bundle.reason ?? 'active' }
}

function key(profileId, gameId) { return `${profileId}\u0000${gameId}` }
