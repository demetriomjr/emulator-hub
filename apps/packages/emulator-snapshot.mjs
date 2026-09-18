const maximumHeaderBytes = 64 * 1024
const maximumStateBytes = 32 * 1024 * 1024
const maximumSaveBytes = 2 * 1024 * 1024
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

export async function encodeSnapshotBundle({ metadata, state, save }) {
  const stateBytes = requireBytes(state, 'Snapshot state')
  const saveBytes = requireBytes(save, 'Snapshot save')
  validateLengths(stateBytes, saveBytes)
  const header = {
    ...validateMetadata(metadata),
    stateByteLength: stateBytes.byteLength,
    saveByteLength: saveBytes.byteLength,
    sha256: await sha256(stateBytes),
    saveSha256: await sha256(saveBytes),
  }
  const headerBytes = encoder.encode(JSON.stringify(header))
  if (headerBytes.byteLength === 0 || headerBytes.byteLength > maximumHeaderBytes) throw snapshotError('SNAPSHOT_HEADER_INVALID', 'Snapshot metadata is too large.')
  const result = new Uint8Array(4 + headerBytes.byteLength + stateBytes.byteLength + saveBytes.byteLength)
  new DataView(result.buffer, result.byteOffset, 4).setUint32(0, headerBytes.byteLength)
  result.set(headerBytes, 4)
  result.set(stateBytes, 4 + headerBytes.byteLength)
  result.set(saveBytes, 4 + headerBytes.byteLength + stateBytes.byteLength)
  return result
}

export async function decodeSnapshotBundle(bundle) {
  const bytes = requireBytes(bundle, 'Snapshot bundle')
  if (bytes.byteLength < 5) throw snapshotError('SNAPSHOT_ENVELOPE_INVALID', 'Snapshot envelope is truncated.')
  const headerLength = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0)
  if (headerLength === 0 || headerLength > maximumHeaderBytes || bytes.byteLength < 4 + headerLength) throw snapshotError('SNAPSHOT_ENVELOPE_INVALID', 'Snapshot envelope header is invalid.')
  let metadata
  try { metadata = JSON.parse(decoder.decode(bytes.subarray(4, 4 + headerLength))) } catch { throw snapshotError('SNAPSHOT_ENVELOPE_INVALID', 'Snapshot envelope metadata is invalid.') }
  validateMetadata(metadata)
  if (!Number.isInteger(metadata.stateByteLength) || !Number.isInteger(metadata.saveByteLength)) throw snapshotError('SNAPSHOT_ENVELOPE_INVALID', 'Snapshot envelope lengths are invalid.')
  const payloadStart = 4 + headerLength
  const expectedLength = payloadStart + metadata.stateByteLength + metadata.saveByteLength
  if (expectedLength !== bytes.byteLength) throw snapshotError('SNAPSHOT_ENVELOPE_INVALID', 'Snapshot envelope length does not match its metadata.')
  const state = bytes.slice(payloadStart, payloadStart + metadata.stateByteLength)
  const save = bytes.slice(payloadStart + metadata.stateByteLength)
  validateLengths(state, save)
  if (!isHash(metadata.sha256) || !isHash(metadata.saveSha256)) throw snapshotError('SNAPSHOT_ENVELOPE_INVALID', 'Snapshot envelope hashes are invalid.')
  if (await sha256(state) !== metadata.sha256 || await sha256(save) !== metadata.saveSha256) throw snapshotError('SNAPSHOT_HASH_INVALID', 'Snapshot bundle hash does not match its bytes.')
  return { metadata, state, save }
}

function validateMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw snapshotError('SNAPSHOT_METADATA_INVALID', 'Snapshot metadata is invalid.')
  for (const key of ['profileId', 'gameId', 'core', 'romSha256', 'runtimeId']) {
    if (typeof metadata[key] !== 'string' || metadata[key].length === 0) throw snapshotError('SNAPSHOT_METADATA_INVALID', `Snapshot metadata ${key} is invalid.`)
  }
  if (!isHash(metadata.romSha256)) throw snapshotError('SNAPSHOT_METADATA_INVALID', 'Snapshot metadata ROM hash is invalid.')
  return metadata
}

function requireBytes(value, label) {
  if (!(value instanceof Uint8Array)) throw snapshotError('SNAPSHOT_BYTES_INVALID', `${label} must be Uint8Array bytes.`)
  return value
}

function validateLengths(state, save) {
  if (state.byteLength === 0 || state.byteLength > maximumStateBytes) throw snapshotError('SNAPSHOT_STATE_INVALID', 'Snapshot state bytes are outside the allowed size.')
  if (save.byteLength === 0 || save.byteLength > maximumSaveBytes) throw snapshotError('SNAPSHOT_SAVE_INVALID', 'Snapshot save bytes are outside the allowed size.')
}

function isHash(value) { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) }

async function sha256(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('')
}

function snapshotError(code, message) { const error = new Error(message); error.code = code; return error }
