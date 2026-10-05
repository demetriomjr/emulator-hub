import { createGameAssetCache } from './game-asset-cache.mjs'
import { createGameAssetStorage } from './game-asset-storage.mjs'
import { createGameAssetService } from './game-asset-service.mjs'

const onEvent = event => globalThis.postMessage({ type: 'event', event })
const service = createGameAssetService({ assets: createGameAssetCache({ storage: createGameAssetStorage(), onEvent }), onEvent })
globalThis.addEventListener('message', async ({ data }) => {
  if (!data || typeof data.requestId !== 'string' || !['prepare', 'prefetch'].includes(data.operation)) return
  try {
    const result = await service[data.operation](data.descriptor)
    const value = data.operation === 'prefetch' ? null : result
    globalThis.postMessage({ requestId: data.requestId, ok: true, value }, value?.bytes ? [value.bytes.buffer] : [])
  } catch (error) { globalThis.postMessage({ requestId: data.requestId, ok: false, error: error.message }) }
})
