const requestType = 'emulator-hub:game-asset-request'
const responseType = 'emulator-hub:game-asset-response'
function failure(message, code) { return Object.assign(new Error(message), { code }) }

export function createPlayerOriginAssetClient({ browser, parent, hubOrigin, sessionId, profileId, gameId, generation, timeoutMs = 30000 }) {
  const pending = new Map()
  let disposed = false
  const receive = event => {
    const message = event.data
    if (event.source !== parent || event.origin !== hubOrigin || message?.type !== responseType || message.sessionId !== sessionId) return
    const request = pending.get(message.requestId)
    if (!request) return
    pending.delete(message.requestId); browser.clearTimeout(request.timer)
    if (message.ok) request.resolve(message.value)
    else request.reject(failure(message.error || 'Asset operation failed.', message.code))
  }
  browser.addEventListener('message', receive)
  const call = (operation, launchToken) => {
    if (disposed) return Promise.reject(failure('Asset bridge closed.', 'ASSET_BRIDGE_CLOSED'))
    const requestId = crypto.randomUUID()
    return new Promise((resolve, reject) => {
      const timer = browser.setTimeout(() => { pending.delete(requestId); reject(failure('Asset bridge timed out.', 'ASSET_BRIDGE_UNAVAILABLE')) }, timeoutMs)
      pending.set(requestId, { resolve, reject, timer })
      try { parent.postMessage({ type: requestType, requestId, sessionId, profileId, gameId, generation, operation, launchToken }, hubOrigin) }
      catch (error) { pending.delete(requestId); browser.clearTimeout(timer); reject(failure(error.message, 'ASSET_BRIDGE_UNAVAILABLE')) }
    })
  }
  return {
    getLaunch: () => call('get-launch'), prepareRom: launchToken => call('prepare-rom', launchToken),
    dispose() {
      disposed = true; browser.removeEventListener('message', receive)
      for (const request of pending.values()) { browser.clearTimeout(request.timer); request.reject(failure('Asset bridge closed.', 'ASSET_BRIDGE_CLOSED')) }
      pending.clear()
    },
  }
}

export function createPlayerAssetRequestHandler({ launchLoader, preparation, isCurrent = () => true }) {
  const launches = new Map()
  async function respond(event, { frame, session, origin }) {
    const message = event.data
    if (event.source !== frame?.contentWindow || event.origin !== origin || message?.type !== requestType || !session ||
      message.sessionId !== session.sessionId || message.profileId !== session.profileId || message.gameId !== session.gameId || message.generation !== session.leaseGeneration ||
      typeof message.requestId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(message.requestId) || !['get-launch', 'prepare-rom'].includes(message.operation) || !isCurrent(session, frame)) return false
    let value, error
    try {
      if (message.operation === 'get-launch') {
        const marker = { launchToken: crypto.randomUUID(), generation: session.leaseGeneration }
        launches.set(session.sessionId, marker)
        const launch = await launchLoader(session)
        if (launches.get(session.sessionId) !== marker || !isCurrent(session, frame)) return true
        marker.launch = launch
        value = { launch, launchToken: marker.launchToken }
      } else {
        const saved = launches.get(session.sessionId)
        if (!saved?.launch || saved.launchToken !== message.launchToken || saved.generation !== session.leaseGeneration) throw new Error('Invalid asset launch token.')
        value = await preparation.prepare(saved.launch)
        if (launches.get(session.sessionId) !== saved) return true
        value = { ...value, bytes: new Uint8Array(value.bytes) }
      }
    } catch (cause) { error = cause }
    if (!isCurrent(session, frame)) { launches.delete(session.sessionId); return true }
    const reply = { type: responseType, requestId: message.requestId, sessionId: session.sessionId, ok: !error, value, ...(error ? { error: error.message, code: error.code } : {}) }
    try { frame.contentWindow.postMessage(reply, origin, value?.bytes ? [value.bytes.buffer] : []) } catch {}
    return true
  }
  respond.retainSessions = ids => { for (const id of launches.keys()) if (!ids.has(id)) launches.delete(id) }
  return respond
}
