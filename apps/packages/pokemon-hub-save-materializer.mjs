export function materializePokemonHubSave({ adapter, layout, bytes, source, records }) {
  if (!adapter || typeof adapter.readAllSlots !== 'function' || typeof adapter.writeSlot !== 'function' || typeof adapter.id !== 'string') throw new TypeError('Pokemon save adapter cannot materialize snapshots')
  if (!source || source.adapter !== adapter.id || !Array.isArray(source.placements) || !(records instanceof Map) || !Buffer.isBuffer(bytes)) throw new TypeError('Pokemon save materialization input is invalid')

  const current = new Map(adapter.readAllSlots(bytes, layout).map(slot => [locationKey(slot.location), slot.record?.representation ?? null]))
  let next = Buffer.from(bytes)
  let changed = false
  for (const placement of source.placements) {
    const key = locationKey(placement.location)
    const currentRepresentation = current.get(key) ?? null
    const desiredRepresentation = representationFor(records.get(placement.pokemonInstanceId), adapter.id, placement.location)
    if (placement.location.area === 'party') {
      if (!sameRepresentation(currentRepresentation, desiredRepresentation)) throw materializationError('SAVE_MATERIALIZATION_UNSUPPORTED', 'Party placement changes require a verified Party writer.')
      continue
    }
    if (placement.location.area !== 'box') throw materializationError('SAVE_MATERIALIZATION_UNSUPPORTED', 'Save location cannot be materialized.')
    if (sameRepresentation(currentRepresentation, desiredRepresentation)) continue
    next = adapter.writeSlot(next, placement.location.box, placement.location.slot, desiredRepresentation ? { bytes: desiredRepresentation.bytes } : null)
    changed = true
  }
  return { bytes: next, changed }
}

function representationFor(document, adapter, location) {
  if (!document) return null
  const kind = location.area === 'party' ? 'party-record' : 'pc-record'
  const representation = document.representations?.find(candidate => candidate.adapter === adapter && candidate.kind === kind)
  if (!representation || typeof representation.bytesBase64 !== 'string') throw materializationError('SAVE_MATERIALIZATION_UNSUPPORTED', 'Pokemon record has no compatible native representation.')
  const bytes = Buffer.from(representation.bytesBase64, 'base64')
  const expectedLength = kind === 'party-record' ? 100 : 80
  if (bytes.length !== expectedLength) throw materializationError('SAVE_MATERIALIZATION_UNSUPPORTED', 'Pokemon native representation has an invalid length.')
  return { kind, bytes }
}

function sameRepresentation(current, desired) {
  if (current === null || desired === null) return current === desired
  return current.kind === desired.kind && Buffer.from(current.bytes).equals(desired.bytes)
}

function locationKey(location) { return JSON.stringify(location) }
function materializationError(code, message) { const error = new Error(message); error.code = code; return error }
