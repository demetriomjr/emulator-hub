import { pokemonHubLocationKey } from './pokemon-hub-location-key.mjs'

export function materializePokemonHubSave({ adapter, layout, bytes, source, records, materializePartyRecord = null }) {
  if (!adapter || typeof adapter.readAllSlots !== 'function' || typeof adapter.writeSlot !== 'function' || typeof adapter.id !== 'string') throw new TypeError('Pokemon save adapter cannot materialize snapshots')
  if (!source || source.adapter !== adapter.id || !Array.isArray(source.placements) || !(records instanceof Map) || !Buffer.isBuffer(bytes)) throw new TypeError('Pokemon save materialization input is invalid')

  const current = new Map(adapter.readAllSlots(bytes, layout).map(slot => [pokemonHubLocationKey(slot.location), slot.record?.representation ?? null]))
  let next = Buffer.from(bytes)
  let changed = false
  const desiredParty = orderedPartyPlacements(source.placements)
  if (desiredParty.length > 0) {
    const partyRecords = desiredParty.map(placement => representationFor(records.get(placement.pokemonInstanceId), adapter.id, placement.location, materializePartyRecord))
    const currentParty = desiredParty.map(placement => current.get(pokemonHubLocationKey(placement.location)) ?? null)
    if (!sameRepresentations(currentParty, partyRecords)) {
      if (typeof adapter.writeParty !== 'function' || !layout.party) throw materializationError('SAVE_MATERIALIZATION_UNSUPPORTED', 'Party placement changes require a verified Party writer.')
      next = adapter.writeParty(next, layout.party, partyRecords.map(record => record.bytes))
      changed = true
    }
  }
  for (const placement of source.placements) {
    if (placement.location.area === 'party') continue
    const key = pokemonHubLocationKey(placement.location)
    const currentRepresentation = current.get(key) ?? null
    const desiredRepresentation = representationFor(records.get(placement.pokemonInstanceId), adapter.id, placement.location, materializePartyRecord)
    if (placement.location.area !== 'box') throw materializationError('SAVE_MATERIALIZATION_UNSUPPORTED', 'Save location cannot be materialized.')
    if (sameRepresentation(currentRepresentation, desiredRepresentation)) continue
    next = adapter.writeSlot(next, placement.location.box, placement.location.slot, desiredRepresentation ? { bytes: desiredRepresentation.bytes } : null)
    changed = true
  }
  return { bytes: next, changed }
}

function representationFor(document, adapter, location, materializePartyRecord) {
  if (!document) return null
  const kind = location.area === 'party' ? 'party-record' : 'pc-record'
  let representation = document.representations?.find(candidate => candidate.adapter === adapter && candidate.kind === kind)
  if (!representation && kind === 'party-record' && typeof materializePartyRecord === 'function') {
    const boxRepresentation = document.representations?.find(candidate => candidate.adapter === adapter && candidate.kind === 'pc-record')
    if (boxRepresentation?.bytesBase64) {
      const partyBytes = materializePartyRecord({ boxCore: Buffer.from(boxRepresentation.bytesBase64, 'base64'), document: structuredClone(document) })
      if (!Buffer.isBuffer(partyBytes) || partyBytes.length !== 100) throw materializationError('SAVE_MATERIALIZATION_UNSUPPORTED', 'Pokemon Party runtime materialization is invalid.')
      representation = { kind, bytesBase64: partyBytes.toString('base64') }
    }
  }
  if (!representation && kind === 'pc-record') {
    const partyRepresentation = document.representations?.find(candidate => candidate.adapter === adapter && candidate.kind === 'party-record')
    if (partyRepresentation?.bytesBase64) representation = { kind, bytesBase64: Buffer.from(partyRepresentation.bytesBase64, 'base64').subarray(0, 80).toString('base64') }
  }
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

function sameRepresentations(current, desired) {
  return current.length === desired.length && current.every((record, index) => sameRepresentation(record, desired[index]))
}

function orderedPartyPlacements(placements) {
  const party = placements.filter(placement => placement.location?.area === 'party' && placement.pokemonInstanceId !== null)
    .sort((left, right) => left.location.slot - right.location.slot)
  for (let slot = 0; slot < party.length; slot += 1) {
    if (party[slot].location.slot !== slot) throw materializationError('SAVE_MATERIALIZATION_UNSUPPORTED', 'Party placement must be contiguous.')
  }
  return party
}

function materializationError(code, message) { const error = new Error(message); error.code = code; return error }
