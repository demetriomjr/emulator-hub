export function createGameAssetStorage({ indexedDB = globalThis.indexedDB, timeoutMs = 3000 } = {}) {
  let connection, closed = false
  function connect() {
    if (closed) return Promise.reject(new Error('Asset storage closed.'))
    if (!connection) connection = new Promise((resolve, reject) => {
      if (!indexedDB) { reject(new Error('IndexedDB unavailable.')); return }
      let settled = false
      const timer = setTimeout(() => finish(new Error('Asset storage open timed out.')), timeoutMs)
      const finish = (error, database) => {
        if (settled) { database?.close(); return }
        settled = true; clearTimeout(timer)
        if (error) { database?.close(); reject(error) } else resolve(database)
      }
      let request
      try { request = indexedDB.open('emulator-hub-game-assets', 1) } catch (error) { finish(error); return }
      request.onupgradeneeded = () => request.result.createObjectStore('assets', { keyPath: 'sha256' })
      request.onsuccess = () => {
        const database = request.result
        database.onversionchange = () => { database.close(); connection = null }
        if (closed) finish(new Error('Asset storage closed.'), database)
        else finish(null, database)
      }
      request.onerror = () => finish(request.error ?? new Error('Asset storage open failed.'))
      request.onblocked = () => finish(new Error('Asset storage open blocked.'))
    })
    return connection
  }
  async function transact(mode, operation) {
    const database = await connect()
    return new Promise((resolve, reject) => {
      const tx = database.transaction('assets', mode)
      const timer = setTimeout(() => { try { tx.abort() } catch {} reject(new Error('Asset storage transaction timed out.')) }, timeoutMs)
      let request
      try { request = operation(tx.objectStore('assets')) } catch (error) { clearTimeout(timer); reject(error); return }
      tx.oncomplete = () => { clearTimeout(timer); resolve(request.result) }
      tx.onerror = tx.onabort = () => { clearTimeout(timer); reject(tx.error ?? new Error('Asset storage transaction failed.')) }
    })
  }
  return {
    get: sha256 => transact('readonly', store => store.get(sha256)),
    put: record => transact('readwrite', store => store.put(record)),
    delete: sha256 => transact('readwrite', store => store.delete(sha256)),
    close() { closed = true; connection?.then(database => database.close(), () => {}) },
  }
}
