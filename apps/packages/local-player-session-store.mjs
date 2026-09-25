const maximumMemberStateBytes = 32 * 1024 * 1024
const maximumMembers = 6
const triggerActions = new Set(['none', 'fast-forward', 'soft-reset', 'reset', 'save-state', 'load-state'])

export function buildCompletePlayerSessionBundle({ bundleId, sessions, captures, settings, now = Date.now() }) {
  if (!Array.isArray(sessions) || sessions.length < 1 || sessions.length > maximumMembers || !(captures instanceof Map)) return null
  const members = []
  for (const session of sessions) {
    const capture = captures.get(session.sessionId)
    if (!capture || capture.sessionId !== session.sessionId || capture.gameId !== session.gameId || capture.profileId !== session.profileId || capture.sessionRevision !== session.sessionRevision || !Number.isSafeInteger(capture.capturedAt) || capture.capturedAt > now || now - capture.capturedAt > 20_000) return null
    members.push({ ...capture, gameTitle: session.gameTitle, profileName: session.profileName, oddsResetCount: session.oddsResetCount ?? 0 })
  }
  try { return normalize({ version: 1, bundleId, capturedAt: now, expiresAt: now + 30 * 60_000, settings, members }) } catch { return null }
}

export function createLocalPlayerSessionStore({ storage, indexedDb = globalThis.indexedDB, now = () => Date.now() } = {}) {
  if (!storage) {
    try { storage = createIndexedDbPlayerSessionStorage(indexedDb) } catch (error) {
      return {
        async get() { return null },
        async list() { return [] },
        async put() { throw error },
        async clear() {},
      }
    }
  }
  let pending = Promise.resolve()
  const sequence = task => {
    const current = pending.catch(() => {}).then(task)
    pending = current.catch(() => {})
    return current
  }
  return {
    put(bundle) {
      return sequence(() => {
        const record = normalize(bundle)
        return storage.put(record.bundleId, record)
      })
    },
    get(bundleId) {
      validateBundleId(bundleId)
      return sequence(() => read(bundleId))
    },
    list() {
      return sequence(async () => {
        const bundles = []
        for (const bundleId of await storage.keys()) {
          if (typeof bundleId !== 'string' || !bundleId || bundleId === 'current') {
            await storage.delete(bundleId)
            continue
          }
          const bundle = await read(bundleId)
          if (bundle) bundles.push({ bundleId, capturedAt: bundle.capturedAt, expiresAt: bundle.expiresAt, members: bundle.members.map(({ gameId, gameTitle, profileId, profileName }) => ({ gameId, gameTitle, profileId, profileName })) })
        }
        return bundles.sort((left, right) => right.capturedAt - left.capturedAt)
      })
    },
    clear(bundleId) { validateBundleId(bundleId); return sequence(() => storage.delete(bundleId)) },
  }

  async function read(bundleId) {
    const record = await storage.get(bundleId)
    if (!record) return null
    let normalized
    try { normalized = normalize(record) } catch { await storage.delete(bundleId); return null }
    if (normalized.bundleId !== bundleId || normalized.expiresAt <= now()) { await storage.delete(bundleId); return null }
    return normalized
  }
}

export function createMemoryPlayerSessionStorage() {
  const records = new Map()
  return {
    async put(key, value) { records.set(key, structuredClone(value)) },
    async get(key) { return records.has(key) ? structuredClone(records.get(key)) : null },
    async delete(key) { records.delete(key) },
    async keys() { return [...records.keys()] },
  }
}

export function createIndexedDbPlayerSessionStorage(indexedDb = globalThis.indexedDB) {
  if (!indexedDb) throw new Error('IndexedDB is unavailable for interrupted player sessions.')
  const database = new Promise((resolve, reject) => {
    const request = indexedDb.open('emulator-hub-player-session', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('bundles')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  const transaction = (mode, operation) => database.then(db => new Promise((resolve, reject) => {
    const tx = db.transaction('bundles', mode)
    const request = operation(tx.objectStore('bundles'))
    let value
    request.onsuccess = () => { value = request.result }
    tx.oncomplete = () => resolve(value)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('Player session storage transaction was aborted.'))
  }))
  return {
    put: (key, value) => transaction('readwrite', store => store.put(value, key)),
    get: key => transaction('readonly', store => store.get(key)),
    delete: key => transaction('readwrite', store => store.delete(key)),
    keys: () => transaction('readonly', store => store.getAllKeys()),
  }
}

function validateBundleId(bundleId) {
  if (typeof bundleId !== 'string' || !bundleId) throw new TypeError('Player session bundle ID is invalid.')
}

function normalize(bundle) {
  if (bundle?.version !== 1) throw new TypeError('Player session bundle version is invalid.')
  if (!bundle || typeof bundle !== 'object' || typeof bundle.bundleId !== 'string' || !bundle.bundleId || !Number.isSafeInteger(bundle.capturedAt) || !Number.isSafeInteger(bundle.expiresAt) || bundle.expiresAt <= bundle.capturedAt) throw new TypeError('Player session bundle is invalid.')
  if (bundle.expiresAt !== bundle.capturedAt + 30 * 60_000) throw new TypeError('Player session bundle expiry is invalid.')
  if (!Array.isArray(bundle.members) || bundle.members.length < 1 || bundle.members.length > maximumMembers) throw new TypeError('Player session member count is invalid.')
  if (!bundle.settings || typeof bundle.settings !== 'object' || typeof bundle.settings.fastForwardEnabled !== 'boolean' || !Number.isFinite(bundle.settings.fastForwardSpeed) || bundle.settings.fastForwardSpeed < 1.5 || bundle.settings.fastForwardSpeed > 5 || typeof bundle.settings.muted !== 'boolean' || typeof bundle.settings.oddsManipulatorEnabled !== 'boolean' || !triggerActions.has(bundle.settings.triggerActions?.l2) || !triggerActions.has(bundle.settings.triggerActions?.r2)) throw new TypeError('Player session settings are invalid.')
  const identities = new Set()
  const sessionIds = new Set()
  const members = bundle.members.map(member => {
    if (!member || typeof member !== 'object' || ![member.sessionId, member.gameId, member.profileId, member.core, member.runtimeId].every(value => typeof value === 'string' && value.length > 0) || !/^[a-f0-9]{64}$/.test(member.romSha256) || (member.patchSha256 !== undefined && !/^[a-f0-9]{64}$/.test(member.patchSha256)) || !Number.isSafeInteger(member.sessionRevision) || member.sessionRevision < 1 || !Number.isSafeInteger(member.saveRevision) || member.saveRevision < 0 || !Number.isSafeInteger(member.capturedAt) || !Number.isSafeInteger(member.oddsResetCount) || member.oddsResetCount < 0) throw new TypeError('Player session member is invalid.')
    if (!(member.state instanceof Uint8Array) || member.state.byteLength < 1 || member.state.byteLength > maximumMemberStateBytes) throw new TypeError('Player session state is invalid.')
    if (member.capturedAt > bundle.capturedAt || bundle.capturedAt - member.capturedAt > 20_000) throw new TypeError('Player session capture time is invalid.')
    const identity = `${member.gameId}\0${member.profileId}`
    if (identities.has(identity) || sessionIds.has(member.sessionId)) throw new TypeError('Duplicate player session profile or ID.')
    identities.add(identity)
    sessionIds.add(member.sessionId)
    return { ...member, state: new Uint8Array(member.state) }
  })
  if (typeof bundle.settings.focusedSessionId !== 'string' || !sessionIds.has(bundle.settings.focusedSessionId)) throw new TypeError('Player session focus is invalid.')
  return { version: 1, bundleId: bundle.bundleId, capturedAt: bundle.capturedAt, expiresAt: bundle.expiresAt, settings: structuredClone(bundle.settings), members }
}
