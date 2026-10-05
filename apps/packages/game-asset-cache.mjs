import { sha256Bytes } from './game-rom-preparation.mjs'

export function createGameAssetCache({ storage, fetchAsset = downloadAsset, hash = sha256Bytes, locks = globalThis.navigator?.locks, onEvent = () => {}, maxMemoryBytes = 64 * 1024 * 1024 }) {
  const pending = new Map(), memory = new Map()
  let memoryBytes = 0
  const emit = event => { try { onEvent(event) } catch {} }
  const copy = (bytes, source) => ({ bytes: new Uint8Array(bytes), source })
  function remember(sha256, bytes) {
    if (bytes.length > maxMemoryBytes) return
    while (memoryBytes + bytes.length > maxMemoryBytes && memory.size) {
      const oldest = memory.keys().next().value
      memoryBytes -= memory.get(oldest).length
      memory.delete(oldest)
    }
    memory.set(sha256, bytes)
    memoryBytes += bytes.length
  }
  async function load({ sha256, url }) {
    let disk
    try { disk = await storage?.get(sha256) } catch (error) { emit({ phase: 'storage-unavailable', reason: error.message }) }
    if (disk) {
      if (disk.bytes instanceof Uint8Array && disk.byteLength === disk.bytes.length && await hash(disk.bytes) === sha256) {
        remember(sha256, disk.bytes)
        emit({ phase: 'asset-ready', assetSource: 'disk', assetSha256: sha256, assetBytes: disk.bytes.length })
        return { bytes: disk.bytes, source: 'disk' }
      }
      emit({ phase: 'cache-corrupt', assetSha256: sha256 })
      try { await storage.delete(sha256) } catch {}
    }
    emit({ phase: 'download-started', assetSha256: sha256 })
    const bytes = new Uint8Array(await fetchAsset(url))
    if (await hash(bytes) !== sha256) throw new Error('Asset hash did not match the descriptor.')
    try { await storage?.put({ sha256, bytes, byteLength: bytes.length }) } catch (error) { emit({ phase: 'storage-unavailable', reason: error.message }) }
    remember(sha256, bytes)
    emit({ phase: 'asset-ready', assetSource: 'network', assetSha256: sha256, assetBytes: bytes.length })
    return { bytes, source: 'network' }
  }
  return {
    async get(asset) {
      if (!/^[a-f0-9]{64}$/.test(asset.sha256 ?? '') || typeof asset.url !== 'string' || !asset.url) throw new Error('Invalid asset descriptor.')
      if (memory.has(asset.sha256)) {
        const bytes = memory.get(asset.sha256)
        memory.delete(asset.sha256); memory.set(asset.sha256, bytes)
        emit({ phase: 'asset-ready', assetSource: 'memory', assetSha256: asset.sha256, assetBytes: bytes.length })
        return copy(bytes, 'memory')
      }
      if (!pending.has(asset.sha256)) {
        const work = locks?.request ? locks.request(`game-asset:${asset.sha256}`, () => load(asset)) : load(asset)
        const promise = Promise.resolve(work).finally(() => pending.delete(asset.sha256))
        pending.set(asset.sha256, promise)
      }
      const result = await pending.get(asset.sha256)
      return copy(result.bytes, result.source)
    },
    clearMemory() { memory.clear(); memoryBytes = 0 },
  }
}

export async function downloadAsset(url) {
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(60000) })
  if (!response.ok) throw new Error(`Asset request failed (${response.status})`)
  return new Uint8Array(await response.arrayBuffer())
}
