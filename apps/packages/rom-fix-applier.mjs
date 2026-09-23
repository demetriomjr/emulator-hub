import { parseBytes, parseHex, validateRomFixProfile } from './rom-fix-registry.mjs'

export function applyRomFix(romBytes, profile) {
  if (!(romBytes instanceof Uint8Array)) throw new TypeError('ROM bytes must be a Uint8Array.')
  validateRomFixProfile(profile)
  if (profile.validated !== true) throw new Error('ROM fix profile is not validated.')
  if (romBytes.byteLength !== profile.size) throw new RangeError('ROM size does not match the fix profile.')

  const writes = []
  for (const [name, offsetValue] of Object.entries(profile.offsets)) {
    const offset = parseHex(offsetValue, 'offsets.' + name)
    const expected = parseBytes(profile.values[name + 'Expected'], 'values.' + name + 'Expected')
    const replacement = parseBytes(profile.values[name + 'Replacement'] ?? profile.values[name], 'values.' + name + 'Replacement')
    for (let index = 0; index < expected.length; index += 1) {
      if (romBytes[offset + index] !== expected[index]) throw new Error('ROM expected bytes mismatch at ' + name + '.')
    }
    writes.push({ offset, replacement })
  }

  const patched = new Uint8Array(romBytes)
  for (const { offset, replacement } of writes) patched.set(replacement, offset)
  return { bytes: patched, fixSha256: null }
}
