export function createGameAssetWorkerClient({ worker, fallback, onEvent = () => {}, timeoutMs = 120000 }) {
  const pending = new Map()
  let currentWorker = worker, disposed = false
  const emit = event => { try { onEvent(event) } catch {} }
  function unavailable(reason) {
    currentWorker?.terminate(); currentWorker = null
    emit({ phase: 'worker-unavailable', reason })
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(Object.assign(new Error(reason), { code: 'ASSET_WORKER_UNAVAILABLE' })) }
    pending.clear()
  }
  worker?.addEventListener('error', event => { event.preventDefault?.(); unavailable('Asset worker failed.') })
  worker?.addEventListener('messageerror', () => unavailable('Asset worker message failed.'))
  worker?.addEventListener('message', ({ data }) => {
    if (data?.type === 'event') { emit(data.event); return }
    const item = pending.get(data?.requestId)
    if (!item) return
    pending.delete(data.requestId); clearTimeout(item.timer)
    if (data.ok) item.resolve(data.value)
    else item.reject(new Error(data.error || 'Asset worker operation failed.'))
  })
  async function call(operation, descriptor) {
    if (disposed) throw new Error('Asset worker client closed.')
    if (!currentWorker) return fallback[operation](descriptor)
    const requestId = crypto.randomUUID()
    try {
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => unavailable('Asset worker timed out.'), timeoutMs)
        pending.set(requestId, { timer, resolve, reject })
        try { currentWorker.postMessage({ requestId, operation, descriptor }) } catch (error) { unavailable(error.message) }
      })
    } catch (error) {
      if (error.code !== 'ASSET_WORKER_UNAVAILABLE' || disposed) throw error
      return fallback[operation](descriptor)
    }
  }
  return { prepare: descriptor => call('prepare', descriptor), prefetch: descriptor => call('prefetch', descriptor),
    dispose() { disposed = true; unavailable('Asset worker client closed.') } }
}
