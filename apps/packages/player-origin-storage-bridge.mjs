const requestType = 'emulator-hub:local-storage-request'
const responseType = 'emulator-hub:local-storage-response'

export function createPlayerOriginStorageClient({ browser, parent, hubOrigin, sessionId, profileId, gameId, timeoutMs = 30000 }) {
  const key = `${profileId}\0${gameId}`
  const pending = new Map()
  const receive = event => {
    const message = event.data
    if (event.source !== parent || event.origin !== hubOrigin || message?.type !== responseType || message.sessionId !== sessionId) return
    const request = pending.get(message.requestId)
    if (!request) return
    pending.delete(message.requestId)
    browser.clearTimeout(request.timer)
    if (message.ok) request.resolve(message.value)
    else request.reject(new Error(message.error || 'Local recovery storage failed'))
  }
  browser.addEventListener('message', receive)
  const call = (operation, storageKey, value, candidateId, resume) => {
    if (storageKey !== undefined && storageKey !== key) return Promise.reject(new Error('Local recovery key does not match this player'))
    const requestId = crypto.randomUUID()
    return new Promise((resolve, reject) => {
      const timer = browser.setTimeout(() => {
        pending.delete(requestId)
        reject(new Error('Local recovery storage timed out'))
      }, timeoutMs)
      pending.set(requestId, { resolve, reject, timer })
      try { parent.postMessage({ type: requestType, requestId, sessionId, operation, key: storageKey, value, candidateId, ...resume }, hubOrigin) }
      catch (error) { browser.clearTimeout(timer); pending.delete(requestId); reject(error) }
    })
  }
  return {
    storage: {
      put: (storageKey, value) => call('put', storageKey, value),
      get: storageKey => call('get', storageKey),
      delete: storageKey => call('delete', storageKey),
      deleteIfMatches: (storageKey, candidateId) => call('deleteIfMatches', storageKey, undefined, candidateId),
    },
    getInstallationIdentity: () => call('installation-identity'),
    getResumeCheckpoint: (bundleId, originalSessionId) => call('resume-checkpoint', key, undefined, undefined, { bundleId, originalSessionId }),
    dispose() {
      browser.removeEventListener?.('message', receive)
      for (const request of pending.values()) { browser.clearTimeout(request.timer); request.reject(new Error('Player storage bridge closed')) }
      pending.clear()
    },
  }
}

export async function respondToPlayerStorageRequest(event, { frame, session, storage, resumeStore, installationIdentity, origin }) {
  const message = event.data
  if (message?.type !== requestType || typeof message.requestId !== 'string' || !message.requestId || message.sessionId !== session?.sessionId) return false
  const key = `${session.profileId}\0${session.gameId}`
  const operation = message.operation
  if (operation !== 'installation-identity' && message.key !== key) return false
  if (!['put', 'get', 'delete', 'deleteIfMatches', 'installation-identity', 'resume-checkpoint'].includes(operation)) return false
  if (operation === 'resume-checkpoint' && (message.bundleId !== session.resumeBundleId || message.originalSessionId !== session.resumeOriginalSessionId)) return false
  let value
  let error
  try {
    switch (operation) {
      case 'put': value = await storage.put(key, message.value); break
      case 'get': value = await storage.get(key); break
      case 'delete': value = await storage.delete(key); break
      case 'deleteIfMatches': value = await storage.deleteIfMatches(key, message.candidateId); break
      case 'installation-identity': value = installationIdentity; break
      case 'resume-checkpoint': {
        const bundle = await resumeStore.get(message.bundleId)
        value = bundle?.bundleId === message.bundleId
          ? bundle.members.find(member => member.sessionId === message.originalSessionId && member.profileId === session.profileId && member.gameId === session.gameId) ?? null
          : null
        if (!value) throw new Error('Interrupted session checkpoint is unavailable.')
        break
      }
    }
  } catch (cause) { error = cause }
  frame.contentWindow?.postMessage({ type: responseType, requestId: message.requestId, sessionId: session.sessionId, ok: !error, value, ...(error ? { error: error.message } : {}) }, origin)
  return true
}
