import { getGen3NationalDex } from './pokemon-gen3-species.mjs'
import { selectNewestPokemonGen3SaveCopy } from './pokemon-gen3-save-validation.mjs'
import transferCapabilityProfiles from './pokemon-gen3-save-capabilities.json' with { type: 'json' }

export const pokemonGen3Adapter = Object.freeze({
  id: 'gen3-gba-v1',
  inspect(saveBytes, layout = null) {
    const newest = selectNewestCopy(saveBytes)
    return {
      saveIndex: newest.saveIndex,
      copyOffset: newest.copyOffset,
      ...(transferCapabilityProfile(layout) ? { transferCapabilities: readTransferCapabilities(saveBytes, newest, layout) } : {}),
      ...(layout?.party ? { party: inspectParty(saveBytes, newest, layout.party) } : {}),
      boxes: Array.from({ length: 14 }, (_, box) => ({
        slots: Array.from({ length: 30 }, (_, slot) => describePcSlot(readPcBytes(saveBytes, newest, box, slot))),
      })),
    }
  },
  readAllSlots(saveBytes, layout = null) {
    const newest = selectNewestCopy(saveBytes)
    const records = []
    if (layout?.party) {
      const activeSlots = readPartyCount(saveBytes, newest, layout.party)
      for (let slot = 0; slot < layout.party.slots; slot += 1) {
        const bytes = slot < activeSlots ? readPartyBytes(saveBytes, newest, layout.party, slot) : null
        records.push(nativeSlot({ kind: 'game', area: 'party', slot }, bytes, 'party-record'))
      }
    }
    for (let box = 0; box < 14; box += 1) for (let slot = 0; slot < 30; slot += 1) {
      records.push(nativeSlot({ kind: 'game', area: 'box', box, slot }, readPcBytes(saveBytes, newest, box, slot), 'pc-record'))
    }
    return records
  },
  readSlot(saveBytes, box, slot) {
    const newest = selectNewestCopy(saveBytes)
    const bytes = readPcBytes(saveBytes, newest, box, slot)
    if (bytes.every(byte => byte === 0)) return null
    const decoded = decodePcRecord(bytes)
    return { bytes: Buffer.from(bytes), ...(decoded ?? {}) }
  },
  writeSlot(saveBytes, box, slot, record) {
    const newest = selectNewestCopy(saveBytes)
    const copy = Buffer.from(saveBytes)
    let bytes = Buffer.alloc(80)
    if (record !== null) {
      if (!record || !Buffer.isBuffer(record.bytes) || record.bytes.length !== 80) throw invalidSave('A Gen III PC record is invalid.')
      bytes = record.bytes
    }
    writePcBytes(copy, newest, box, slot, bytes)
    for (const { offset: sectorOffset, sectionId } of newest.sectors.values()) {
      copy.writeUInt16LE(sectorChecksum(copy, sectorOffset, sectionId), sectorOffset + 0xff6)
    }
    return copy
  },
  writeParty(saveBytes, party, records) {
    validatePartyLayout(party)
    if (!Array.isArray(records) || records.length === 0 || records.length > party.slots) throw invalidSave('Gen III Party records are invalid.')
    const newest = selectNewestCopy(saveBytes)
    const copy = Buffer.from(saveBytes)
    const section = newest.sectors.get(party.sectionId)
    const length = party.sectionId === 13 ? 2000 : 3968
    if (!section || party.countOffset + 4 > length) throw invalidSave('Gen III Party layout is invalid.')

    for (let slot = 0; slot < party.slots; slot += 1) {
      const record = records[slot] ?? Buffer.alloc(party.recordBytes)
      if (!Buffer.isBuffer(record) || record.length !== party.recordBytes) throw invalidSave('A Gen III Party record is invalid.')
      writePartyBytes(copy, newest, party, slot, record)
    }
    copy.writeUInt32LE(records.length, section.offset + party.countOffset)
    for (const { offset: sectorOffset, sectionId } of newest.sectors.values()) {
      copy.writeUInt16LE(sectorChecksum(copy, sectorOffset, sectionId), sectorOffset + 0xff6)
    }
    return copy
  },
})

function transferCapabilityProfile(layout) {
  const title = layout?.pokemonSaveTitle
  const profile = title ? transferCapabilityProfiles.titles[title] : null
  return profile ? { game: title, ...profile } : null
}

function readTransferCapabilities(saveBytes, newest, layout) {
  const profile = transferCapabilityProfile(layout)
  const nationalDexUnlocked = readSmallByte(saveBytes, newest, profile.smallOffset) === profile.magic
    && readEventFlag(saveBytes, newest, profile, profile.nationalDexFlag)
    && readLargeUInt16LE(saveBytes, newest, profile.eventWorkBase + profile.nationalDexWorkIndex * 2) === profile.nationalDexWorkValue
  return {
    game: profile.game,
    ordinaryTradeReady: readEventFlag(saveBytes, newest, profile, profile.ordinaryTradeFlag) && hasTwoNonEggPartyPokemon(saveBytes, newest, layout?.party),
    nationalDexUnlocked,
    networkMachineRestored: profile.networkMachineFlag === undefined ? null : readEventFlag(saveBytes, newest, profile, profile.networkMachineFlag),
  }
}

function hasTwoNonEggPartyPokemon(saveBytes, newest, party) {
  if (!party) return false
  const count = readPartyCount(saveBytes, newest, party)
  let nonEgg = 0
  for (let slot = 0; slot < count; slot += 1) {
    const decoded = decodePcRecord(readPartyBytes(saveBytes, newest, party, slot).subarray(0, 80))
    if (decoded?.canonical && !decoded.canonical.isEgg) nonEgg += 1
  }
  return nonEgg >= 2
}

function readSmallByte(bytes, save, offset) {
  const section = save.sectors.get(0)
  if (!section || offset < 0 || offset >= 3884) throw invalidSave('Gen III Small block is invalid.')
  return Buffer.from(bytes)[section.offset + offset]
}

function readEventFlag(bytes, save, profile, flag) {
  const byte = readLargeByte(bytes, save, profile.eventFlagBase + Math.floor(flag / 8))
  return (byte & (1 << (flag % 8))) !== 0
}

function readLargeByte(bytes, save, offset) {
  const sectionId = 1 + Math.floor(offset / 0xf80)
  const localOffset = offset % 0xf80
  const section = save.sectors.get(sectionId)
  if (!section || sectionId > 4) throw invalidSave('Gen III Large block is invalid.')
  return Buffer.from(bytes)[section.offset + localOffset]
}

function readLargeUInt16LE(bytes, save, offset) {
  return readLargeByte(bytes, save, offset) | (readLargeByte(bytes, save, offset + 1) << 8)
}

function nativeSlot(location, bytes, kind) {
  if (bytes === null || bytes.subarray(0, 80).every(byte => byte === 0)) return { location, record: null }
  const decoded = decodePcRecord(bytes.subarray(0, 80))
  if (!decoded?.canonical) throw invalidSave('A populated Gen III record could not be decoded.')
  return {
    location,
    record: {
      representation: { adapter: 'gen3-gba-v1', kind, bytes: Buffer.from(bytes) },
      display: { species: decoded.canonical.species, shiny: decoded.canonical.shiny, isEgg: decoded.canonical.isEgg },
    },
  }
}

function describePcSlot(bytes) {
  if (bytes.every(byte => byte === 0)) return { occupied: false }
  const decoded = decodePcRecord(bytes)
  return { occupied: true, ...(decoded?.canonical ? { species: decoded.canonical.species, shiny: decoded.canonical.shiny, ...(decoded.canonical.isEgg ? { isEgg: true } : {}) } : {}) }
}

function describePartySlot(bytes) {
  if (bytes.every(byte => byte === 0)) return { occupied: false }
  return describePcSlot(bytes.subarray(0, 80))
}

function inspectParty(saveBytes, save, party) {
  const activeSlots = readPartyCount(saveBytes, save, party)
  return Array.from({ length: party.slots }, (_, slot) => slot < activeSlots
    ? describePartySlot(readPartyBytes(saveBytes, save, party, slot))
    : { occupied: false })
}

// Gen III PC Pokémon records contain a 48-byte encrypted payload.  We retain the
// original bytes for lossless round-tripping, but decode stable identity fields for
// Hub tracking without changing the game representation.
function decodePcRecord(bytes) {
  const personality = bytes.readUInt32LE(0)
  const originalTrainerId = bytes.readUInt32LE(4)
  const encrypted = Buffer.from(bytes.subarray(32, 80))
  const key = personality ^ originalTrainerId
  for (let offset = 0; offset < encrypted.length; offset += 4) encrypted.writeUInt32LE((encrypted.readUInt32LE(offset) ^ key) >>> 0, offset)
  const order = substructureOrders[personality % 24]
  const growth = encrypted.subarray(order.indexOf('G') * 12, order.indexOf('G') * 12 + 12)
  const misc = encrypted.subarray(order.indexOf('M') * 12, order.indexOf('M') * 12 + 12)
  const species = getGen3NationalDex(growth.readUInt16LE(0))
  if (species === null) return null
  const trainerId = originalTrainerId & 0xffff
  const secretId = originalTrainerId >>> 16
  const shiny = ((trainerId ^ secretId ^ (personality & 0xffff) ^ (personality >>> 16)) & 0xffff) < 8
  return {
    identity: { personality, originalTrainerId },
    canonical: { species, shiny, isEgg: (misc.readUInt32LE(4) & 0x40000000) !== 0, trainer: { trainerId, secretId } },
  }
}

const substructureOrders = [
  'GAEM', 'GAME', 'GEAM', 'GEMA', 'GMAE', 'GMEA',
  'AGEM', 'AGME', 'AEGM', 'AEMG', 'AMGE', 'AMEG',
  'EGAM', 'EGMA', 'EAGM', 'EAMG', 'EMGA', 'EMAG',
  'MGAE', 'MGEA', 'MAGE', 'MAEG', 'MEGA', 'MEAG',
]

function selectNewestCopy(saveBytes) {
  return selectNewestPokemonGen3SaveCopy(saveBytes)
}

function pcSpans(save, box, slot) {
  if (!Number.isInteger(box) || box < 0 || box >= 14 || !Number.isInteger(slot) || slot < 0 || slot >= 30) throw invalidSave('Gen III PC slot is invalid.')
  let offset = 4 + (box * 30 + slot) * 80
  for (let sectionId = 5; sectionId <= 13; sectionId += 1) {
    const length = sectionId === 13 ? 2000 : 3968
    if (offset >= length) { offset -= length; continue }
    const count = Math.min(80, length - offset)
    const spans = [{ offset: save.sectors.get(sectionId).offset + offset, count }]
    if (count < 80) spans.push({ offset: save.sectors.get(sectionId + 1).offset, count: 80 - count })
    return spans
  }
  throw invalidSave('Gen III PC slot is invalid.')
}

function readPcBytes(bytes, save, box, slot) {
  const result = Buffer.alloc(80)
  let written = 0
  for (const span of pcSpans(save, box, slot)) { Buffer.from(bytes).copy(result, written, span.offset, span.offset + span.count); written += span.count }
  return result
}

function readPartyBytes(bytes, save, party, slot) {
  validatePartyLayout(party)
  const section = save.sectors.get(party.sectionId)
  const offset = party.offset + slot * party.recordBytes
  const length = party.sectionId === 13 ? 2000 : 3968
  if (!section || offset + party.recordBytes > length) throw invalidSave('Gen III Party layout is invalid.')
  return Buffer.from(bytes).subarray(section.offset + offset, section.offset + offset + party.recordBytes)
}

function readPartyCount(bytes, save, party) {
  validatePartyLayout(party)
  const section = save.sectors.get(party.sectionId)
  const length = party.sectionId === 13 ? 2000 : 3968
  if (!section || party.countOffset + 4 > length) throw invalidSave('Gen III Party layout is invalid.')
  const count = Buffer.from(bytes).readUInt32LE(section.offset + party.countOffset)
  if (count > party.slots) throw invalidSave('Gen III Party count is invalid.')
  return count
}

function validatePartyLayout(party) {
  if (!Number.isInteger(party.sectionId) || party.sectionId < 0 || party.sectionId > 13 || !Number.isInteger(party.countOffset) || party.countOffset < 0 || !Number.isInteger(party.offset) || party.offset < 0 || !Number.isInteger(party.slots) || party.slots < 1 || !Number.isInteger(party.recordBytes) || party.recordBytes < 80) throw invalidSave('Gen III Party layout is invalid.')
}

function writePcBytes(bytes, save, box, slot, record) {
  let read = 0
  for (const span of pcSpans(save, box, slot)) { record.copy(bytes, span.offset, read, read + span.count); read += span.count }
}

function writePartyBytes(bytes, save, party, slot, record) {
  validatePartyLayout(party)
  const section = save.sectors.get(party.sectionId)
  const length = party.sectionId === 13 ? 2000 : 3968
  const offset = party.offset + slot * party.recordBytes
  if (!section || offset + party.recordBytes > length) throw invalidSave('Gen III Party layout is invalid.')
  record.copy(bytes, section.offset + offset)
}

function sectorChecksum(bytes, offset, sectionId) {
  const length = sectionId === 0 ? 3884 : sectionId === 13 ? 2000 : 3968
  let sum = 0
  for (let index = 0; index < length; index += 4) sum = (sum + bytes.readUInt32LE(offset + index)) >>> 0
  return ((sum & 0xffff) + (sum >>> 16)) & 0xffff
}

function invalidSave(message) {
  const error = new Error(message)
  error.code = 'SAVE_UNSUPPORTED'
  return error
}
