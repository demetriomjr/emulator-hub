import { frameOrigin } from './player-origin-topology.mjs'

export function requestPlayerFrame({ frame, browser, sessionId, type, replyType, details = {}, timeoutMs = 30000 }) {
  const target = frame?.contentWindow
  if (!target || typeof sessionId !== 'string' || !sessionId) return Promise.reject(new Error('Player frame is unavailable'))
  const origin = frame?.src ? frameOrigin(frame, browser.location.origin) : browser.location.origin
  const requestId = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error, result) => {
      if (settled) return
      settled = true
      browser.clearTimeout(timeout)
      browser.removeEventListener('message', receive)
      if (error) reject(error)
      else resolve(result)
    }
    const receive = event => {
      if (event.origin !== origin || event.source !== target || event.data?.type !== replyType || event.data.requestId !== requestId || event.data.sessionId !== sessionId) return
      finish(event.data.ok === true ? null : new Error(event.data.error || 'Player request failed'), event.data)
    }
    const timeout = browser.setTimeout(() => finish(new Error('Player request timed out')), timeoutMs)
    browser.addEventListener('message', receive)
    try { target.postMessage({ type, ...details, requestId, sessionId }, origin) }
    catch (error) { finish(error) }
  })
}
