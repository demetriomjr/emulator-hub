import { prepareGameRom, sha256Bytes } from './game-rom-preparation.mjs'

export function createGameAssetService({ assets, hash = sha256Bytes, onEvent = () => {}, maxPreparedBytes = 64 * 1024 * 1024, patchTimeoutMs = 5000 }) {
  const pending = new Map(), prepared = new Map()
  let preparedBytes = 0
  const emit = event => { try { onEvent(event) } catch {} }
  const parts = descriptor => ({ rom: { sha256: descriptor.romSha256, url: descriptor.romUrl }, patch: descriptor.patchUrl && descriptor.patchSha256 ? { sha256: descriptor.patchSha256, url: descriptor.patchUrl } : null })
  function optionalPatch(patch) {
    if (!patch) return Promise.resolve(null)
    return new Promise(resolve => {
      const timer = setTimeout(() => resolve({ error: new Error('Optional patch timed out.') }), patchTimeoutMs)
      Promise.resolve().then(() => assets.get(patch)).then(result => { clearTimeout(timer); resolve(result) }, error => { clearTimeout(timer); resolve({ error }) })
    })
  }
  return {
    async prefetch(descriptor) {
      const { rom, patch } = parts(descriptor)
      const results = await Promise.allSettled([assets.get(rom), ...(patch ? [assets.get(patch)] : [])])
      for (const result of results) if (result.status === 'rejected') emit({ phase: 'prefetch-failed', reason: result.reason.message })
      return results.map(result => ({ status: result.status }))
    },
    async prepare(descriptor) {
      const { rom, patch } = parts(descriptor)
      const key = `${descriptor.romSha256}:${patch?.sha256 ?? ''}:ips-v1`
      if (prepared.has(key)) {
        const result = prepared.get(key)
        return { ...result, bytes: new Uint8Array(result.bytes), assetSource: 'memory' }
      }
      if (!pending.has(key)) pending.set(key, (async () => {
        const [original, patchResult] = await Promise.all([assets.get(rom), optionalPatch(patch)])
        const result = await prepareGameRom({ romBytes: original.bytes, patchBytes: patchResult?.bytes, romSha256: descriptor.romSha256, patchSha256: patch?.sha256, hash })
        if (Boolean(descriptor.patchUrl) !== Boolean(descriptor.patchSha256)) result.reason = 'incomplete-patch-config'
        if (patchResult?.error) result.reason = patchResult.error.message
        result.assetSource = original.source
        if (result.patchApplied || !patch) {
          while (preparedBytes + result.bytes.length > maxPreparedBytes && prepared.size) {
            const oldest = prepared.keys().next().value
            preparedBytes -= prepared.get(oldest).bytes.length; prepared.delete(oldest)
          }
          if (result.bytes.length <= maxPreparedBytes) { prepared.set(key, result); preparedBytes += result.bytes.length }
        }
        emit({ phase: 'rom-prepared', romSha256: descriptor.romSha256, patchSha256: result.patchSha256, patchApplied: result.patchApplied, effectiveRomSha256: result.effectiveRomSha256, assetSource: result.assetSource, reason: result.reason, assetBytes: result.bytes.length })
        return result
      })().finally(() => pending.delete(key)))
      const result = await pending.get(key)
      return { ...result, bytes: new Uint8Array(result.bytes) }
    },
  }
}
