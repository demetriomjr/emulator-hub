import { applyIpsPatch } from './ips-patch.mjs'

export async function sha256Bytes(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function prepareGameRom({ romBytes, patchBytes, romSha256, patchSha256, hash = sha256Bytes }) {
  if (!(romBytes instanceof Uint8Array) || await hash(romBytes) !== romSha256) throw new Error('ROM hash did not match the launch descriptor.')
  let bytes = romBytes, patchApplied = false, reason = 'patch-not-configured'
  if (patchSha256) {
    try {
      if (!(patchBytes instanceof Uint8Array)) throw new Error('patch-unavailable')
      if (await hash(patchBytes) !== patchSha256) throw new Error('patch-hash-mismatch')
      bytes = applyIpsPatch(romBytes, patchBytes)
      patchApplied = true
      reason = 'patch-applied-in-memory'
    } catch (error) { reason = error.message }
  }
  return { bytes: new Uint8Array(bytes), effectiveRomSha256: await hash(bytes), patchApplied, patchSha256: patchApplied ? patchSha256 : null, reason }
}
