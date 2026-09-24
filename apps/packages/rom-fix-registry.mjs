const HASH_PATTERN = /^[a-f0-9]{64}$/
const HEX_PATTERN = /^0x[0-9a-f]+$/i

function parseHex(value, label) {
  if (typeof value !== 'string' || !HEX_PATTERN.test(value)) throw new TypeError(label + ' must be a hexadecimal value.')
  const parsed = Number.parseInt(value, 16)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new TypeError(label + ' must be a safe non-negative value.')
  return parsed
}

function parseBytes(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(label + ' must contain bytes.')
  const parts = value.trim().split(/\s+/)
  if (parts.some(part => !/^[0-9a-f]{2}$/i.test(part))) throw new TypeError(label + ' contains malformed bytes.')
  return Uint8Array.from(parts.map(part => Number.parseInt(part, 16)))
}

export function validateRomFixProfile(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) throw new TypeError('ROM fix profile must be an object.')
  if (typeof profile.validated !== 'boolean') throw new TypeError('ROM fix profile validated must be boolean.')
  if (!Number.isSafeInteger(profile.size) || profile.size <= 0) throw new TypeError('ROM fix profile size must be a positive safe integer.')
  if (!profile.offsets || typeof profile.offsets !== 'object' || Array.isArray(profile.offsets)) throw new TypeError('ROM fix profile offsets are required.')
  if (!profile.values || typeof profile.values !== 'object' || Array.isArray(profile.values)) throw new TypeError('ROM fix profile values are required.')

  for (const [name, value] of Object.entries(profile.offsets)) {
    const offset = parseHex(value, 'offsets.' + name)
    if (offset >= profile.size) throw new RangeError('offsets.' + name + ' exceeds ROM size.')
    const expected = profile.values[name + 'Expected']
    const replacement = profile.values[name + 'Replacement'] ?? profile.values[name]
    if (expected === undefined || replacement === undefined) throw new TypeError('values for offsets.' + name + ' are incomplete.')
    const expectedBytes = parseBytes(expected, 'values.' + name + 'Expected')
    const replacementBytes = parseBytes(replacement, 'values.' + name + 'Replacement')
    if (expectedBytes.length !== replacementBytes.length) throw new RangeError('values.' + name + ' replacement length differs from expected length.')
    if (offset + expectedBytes.length > profile.size) throw new RangeError('values.' + name + ' exceeds ROM size.')
  }

  return true
}

export function getRomFixProfile(catalog, sha256, { requireValidated = true } = {}) {
  if (!catalog || typeof catalog !== 'object' || typeof sha256 !== 'string' || !HASH_PATTERN.test(sha256)) return null
  const profile = catalog[sha256]
  if (!profile) return null
  validateRomFixProfile(profile)
  if (requireValidated && profile.validated !== true) return null
  return { sha256, ...structuredClone(profile) }
}

export { parseBytes, parseHex }
