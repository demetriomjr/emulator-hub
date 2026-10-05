const maximumIpsEnd = 0x100fffe

function records(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 8 || ![80, 65, 84, 67, 72].every((value, index) => bytes[index] === value)) throw new Error('Invalid IPS header.')
  const writes = []
  let cursor = 5, end = 0
  const integer = (offset, size) => {
    if (offset + size > bytes.length) throw new Error('Incomplete IPS record.')
    let value = 0
    for (let i = 0; i < size; i++) value = value * 256 + bytes[offset + i]
    return value
  }
  while (cursor + 3 <= bytes.length) {
    const offset = integer(cursor, 3)
    cursor += 3
    if (offset === 0x454f46) {
      if (![0, 3].includes(bytes.length - cursor)) throw new Error('Invalid IPS EOF trailer.')
      return { writes, end, truncate: cursor === bytes.length ? null : integer(cursor, 3) }
    }
    let length = integer(cursor, 2)
    cursor += 2
    let data, repeat
    if (length === 0) {
      length = integer(cursor, 2)
      repeat = integer(cursor + 2, 1)
      cursor += 3
      if (!length) throw new Error('Invalid IPS zero RLE length.')
    } else {
      if (cursor + length > bytes.length) throw new Error('Incomplete IPS data.')
      data = bytes.subarray(cursor, cursor + length)
      cursor += length
    }
    writes.push({ offset, length, data, repeat })
    end = Math.max(end, offset + length)
  }
  throw new Error('Missing IPS EOF.')
}

export function isValidIps(bytes) {
  try { records(bytes); return true } catch { return false }
}

export function applyIpsPatch(romBytes, patchBytes, { maxOutputBytes = Math.max(romBytes?.byteLength ?? 0, maximumIpsEnd) } = {}) {
  if (!(romBytes instanceof Uint8Array)) throw new TypeError('ROM bytes must be a Uint8Array.')
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 0) throw new RangeError('Invalid IPS output limit.')
  const { writes, end, truncate } = records(patchBytes)
  const size = truncate ?? Math.max(romBytes.length, end)
  // Check both the work extent and final size before allocation; truncate cannot
  // hide an excessive write. Writes beyond a valid truncate are discarded.
  if (Math.max(end, size) > maxOutputBytes) throw new RangeError('IPS exceeds output limit.')
  const output = new Uint8Array(size)
  output.set(romBytes.subarray(0, size))
  for (const write of writes) {
    const count = Math.min(write.length, Math.max(0, size - write.offset))
    if (!count) continue
    if (write.data) output.set(write.data.subarray(0, count), write.offset)
    else output.fill(write.repeat, write.offset, write.offset + count)
  }
  return output
}
