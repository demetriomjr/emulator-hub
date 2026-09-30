import { createHash } from 'node:crypto'

import { projectGen3PokemonCard } from './pokemon-gen3-card-data.mjs'
import { pokemonHubLocationKey } from './pokemon-hub-location-key.mjs'

export function projectPokemonHubDetailSource({ source, records, title = null, physicalSlots = null, physicalSaveRevision = null } = {}) {
  if (!source || !Array.isArray(source.placements) || !(records instanceof Map)) throw new TypeError('Pokemon Hub detail source is invalid.')
  const details = {}
  const seen = new Set()
  for (const placement of source.placements) {
    const id = placement.pokemonInstanceId
    if (!id) continue
    const unavailable = errorCode => ({ pokemonInstanceId: id, availability: 'unavailable', sourceRevision: source.sourceRevision, recordRevision: records.get(id)?.revision ?? null, errorCode })
    if (seen.has(id)) { details[id] = unavailable('POKEMON_DETAIL_DUPLICATE_ID'); continue }
    seen.add(id)
    try {
      const record = records.get(id)
      if (!record || record.pokemonInstanceId !== id) throw detailError('POKEMON_DETAIL_RECORD_MISSING')
      if (record.placement?.sourceKey !== source.sourceKey || pokemonHubLocationKey(record.placement.location) !== pokemonHubLocationKey(placement.location)) throw detailError('POKEMON_DETAIL_PLACEMENT_MISMATCH')
      const representation = record.representations?.find(candidate => candidate.adapter === 'gen3-gba-v1' && ['pc-record', 'party-record'].includes(candidate.kind))
      if (!representation || typeof representation.bytesBase64 !== 'string') throw detailError('POKEMON_DETAIL_REPRESENTATION_MISSING')
      const native = Buffer.from(representation.bytesBase64, 'base64')
      if (native.toString('base64') !== representation.bytesBase64 || native.length !== (representation.kind === 'party-record' ? 100 : 80)) throw detailError('POKEMON_DETAIL_RECORD_INVALID')
      if (createHash('sha256').update(native).digest('hex') !== representation.sha256) throw detailError('POKEMON_DETAIL_HASH_MISMATCH')
      let bytes = native
      let kind = representation.kind
      let partyRuntimeValid = false
      if (placement.location.area === 'party' && !source.needsSaveFlush && source.saveRevision === physicalSaveRevision && physicalSlots instanceof Map) {
        const physical = physicalSlots.get(pokemonHubLocationKey(placement.location))?.record?.representation
        if (physical?.kind === 'party-record' && Buffer.from(physical.bytes).subarray(0, 80).equals(native.subarray(0, 80))) {
          bytes = Buffer.from(physical.bytes)
          kind = 'party-record'
          partyRuntimeValid = true
        }
      }
      details[id] = {
        pokemonInstanceId: id,
        availability: 'ready',
        sourceRevision: source.sourceRevision,
        recordRevision: record.revision ?? null,
        ...projectGen3PokemonCard({ bytes, kind, title, provenance: record.provenance, partyRuntimeValid }),
      }
    } catch (error) {
      details[id] = unavailable(typeof error.code === 'string' ? error.code : 'POKEMON_DETAIL_UNAVAILABLE')
    }
  }
  return details
}

function detailError(code) { const error = new Error(code); error.code = code; return error }
