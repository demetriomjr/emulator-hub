import { requestPlayerFrame } from './player-frame-request.mjs'

export function createGlobalPlaybackToggle({ getFrames, send, getOrigin, hostWindow, timeoutMs = 1000 }) {
  let requestSequence = 0
  let pending = Promise.resolve()

  return function toggle() {
    const next = pending.then(() => new Promise(resolve => {
      const first = getFrames()[0]
      if (!first?.contentWindow) { resolve(); return }
      const requestId = String(++requestSequence)
      const finish = () => {
        hostWindow.clearTimeout(timeout)
        hostWindow.removeEventListener('message', receive)
        resolve()
      }
      const receive = event => {
        if (event.origin !== getOrigin(first) || event.source !== first.contentWindow || event.data?.type !== 'emulator-hub:playback-state' || event.data.requestId !== requestId) return
        if (event.data.ok === false) { finish(); return }
        if (typeof event.data.paused !== 'boolean') return
        if (getFrames()[0] === first) {
          const message = { type: 'emulator-hub:set-playback', action: event.data.paused ? 'play' : 'pause' }
          for (const frame of getFrames()) send(frame, message)
        }
        finish()
      }
      const timeout = hostWindow.setTimeout(finish, timeoutMs)
      hostWindow.addEventListener('message', receive)
      try { send(first, { type: 'emulator-hub:get-playback-state', requestId }) } catch { finish() }
    }))
    pending = next.catch(() => {})
    return next
  }
}

export function createPlayerPlaybackToggle({ getFrame, getState, send }) {
  const pending = new Map()
  return sessionId => {
    const next = (pending.get(sessionId) ?? Promise.resolve()).then(async () => {
      const frame = getFrame(sessionId)
      if (!frame?.contentWindow) return false
      const state = await getState(sessionId, frame)
      if (getFrame(sessionId) !== frame || typeof state?.paused !== 'boolean') return false
      send(frame, { type: 'emulator-hub:set-playback', action: state.paused ? 'play' : 'pause' })
      return true
    }).catch(() => false)
    pending.set(sessionId, next)
    void next.then(() => { if (pending.get(sessionId) === next) pending.delete(sessionId) })
    return next
  }
}

export function applyPlayerPlayback(emulator, action, { ready, locked }) {
  if (!ready || !emulator?.gameManager || (action === 'play' && locked)) return false
  if (action !== 'play' && action !== 'pause') return false
  emulator[action]()
  return true
}

export function isEmulatorPlaying(emulator, ready) {
  return ready && Boolean(emulator?.gameManager) && emulator.paused === false
}

export async function selectPlayingSessions(sessions, getState) {
  const states = await Promise.all(sessions.map(session => Promise.resolve().then(() => getState(session)).catch(() => null)))
  return sessions.filter((_session, index) => states[index]?.paused === false)
}

export async function requestPlayerPlaybackState({ frame, browser, sessionId }) {
  const reply = await requestPlayerFrame({ frame, browser, sessionId, type: 'emulator-hub:get-playback-state', replyType: 'emulator-hub:playback-state', timeoutMs: 1000 })
  if (typeof reply.paused !== 'boolean') throw new Error('Player playback state is unavailable')
  return reply
}
