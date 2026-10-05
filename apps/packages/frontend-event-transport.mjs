import { frontendEventEndpoint } from './frontend-events.mjs'
const transports = new WeakMap()
export function getFrontendEventTransport(browser) {
  if (!transports.has(browser)) transports.set(browser, createFrontendEventTransport({ fetch: browser.fetch?.bind(browser) }))
  return transports.get(browser)
}
export function createFrontendEventTransport({ fetch = globalThis.fetch?.bind(globalThis), capacity = 64, timeoutMs = 2000 } = {}) {
  const queue = []
  let running = false
  let disposed = false
  let dropped = 0
  let current = null
  let enabled = true, generation = 0
  async function drain() {
    if (running || disposed || !enabled) return
    running = true
    try {
      while (queue.length && !disposed && enabled) {
        const version = generation
        const record = queue.shift()
        const lost = dropped
        const controller = new AbortController()
        current = controller
        let timer
        try {
          const body = JSON.stringify({ ...record, ...(lost ? { droppedEvents: lost } : {}) })
          const timeout = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')) }, timeoutMs) })
          const response = await Promise.race([Promise.resolve().then(() => {
            if (!enabled || version !== generation) throw new Error('disabled')
            return fetch(frontendEventEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true, signal: controller.signal })
          }), timeout])
          if (!response?.ok) throw new Error('event-rejected')
          if (version === generation) dropped -= lost
        } catch { if (version === generation && enabled) dropped += 1 }
        finally { clearTimeout(timer); current = null }
      }
    } finally { running = false }
  }
  return {
    send(record) {
      if (disposed || !fetch || !enabled) return
      if (queue.length >= capacity) { dropped += 1; return }
      queue.push(record)
      void drain()
    },
    stats: () => ({ droppedEvents: dropped, queued: queue.length, running }),
    get enabled() { return enabled && !disposed },
    setEnabled(value) {
      enabled = value === true && !disposed
      if (!enabled) { generation++; queue.length = 0; dropped = 0; current?.abort() }
    },
    dispose() { disposed = true; queue.length = 0; current?.abort() },
  }
}
