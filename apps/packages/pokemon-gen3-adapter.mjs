const gen3SaveBytes = 0x20000

export const pokemonGen3Adapter = Object.freeze({
  id: 'gen3-gba-v1',
  inspect(saveBytes, layout = null) {
    const newest = selectNewestCopy(saveBytes)
    return {
      saveIndex: newest.saveIndex,
      copyOffset: newest.copyOffset,
      ...(layout?.party ? { party: Array.from({ length: layout.party.slots }, (_, slot) => describePartySlot(readPartyBytes(saveBytes, newest, layout.party, slot))) } : {}),
      boxes: Array.from({ length: 14 }, (_, box) => ({
        slots: Array.from({ length: 30 }, (_, slot) => describePcSlot(readPcBytes(saveBytes, newest, box, slot))),
      })),
    }
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
})

function describePcSlot(bytes) {
  if (bytes.every(byte => byte === 0)) return { occupied: false }
  const decoded = decodePcRecord(bytes)
  return { occupied: true, ...(decoded?.canonical ? { species: decoded.canonical.species, shiny: decoded.canonical.shiny } : {}) }
}

function describePartySlot(bytes) {
  if (bytes.every(byte => byte === 0)) return { occupied: false }
  return describePcSlot(bytes.subarray(0, 80))
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
  const species = growth.readUInt16LE(0)
  if (species === 0 || species > 411) return null
  const trainerId = originalTrainerId & 0xffff
  const secretId = originalTrainerId >>> 16
  const shiny = ((trainerId ^ secretId ^ (personality & 0xffff) ^ (personality >>> 16)) & 0xffff) < 8
  return {
    identity: { personality, originalTrainerId },
    canonical: { species, shiny, trainer: { trainerId, secretId } },
  }
}

const substructureOrders = [
  'GAEM', 'GAME', 'GEAM', 'GEMA', 'GMAE', 'GMEA',
  'AGEM', 'AGME', 'AEGM', 'AEMG', 'AMGE', 'AMEG',
  'EGAM', 'EGMA', 'EAGM', 'EAMG', 'EMGA', 'EMAG',
  'MGAE', 'MGEA', 'MAGE', 'MAEG', 'MEGA', 'MEAG',
]

function selectNewestCopy(saveBytes) {
  if (!Buffer.isBuffer(saveBytes) && !(saveBytes instanceof Uint8Array)) throw invalidSave('A Gen III save is required.')
  if (saveBytes.length !== gen3SaveBytes) throw invalidSave('A Gen III save must be exactly 128 KiB.')
  if (Buffer.from(saveBytes).every(byte => byte === 0xff)) throw invalidSave('A Gen III save must be initialized.')
  const copies = [readSaveCopy(saveBytes, 0), readSaveCopy(saveBytes, 0xe000)].filter(copy => copy !== null)
  if (!copies.length) throw invalidSave('A valid initialized Gen III save is required.')
  return copies.reduce((current, candidate) => candidate.saveIndex > current.saveIndex ? candidate : current)
}

function readSaveCopy(bytes, copyOffset) {
  const sectors = new Map()
  let saveIndex
  for (let physicalIndex = 0; physicalIndex < 14; physicalIndex += 1) {
    const offset = copyOffset + physicalIndex * 0x1000
    const sectionId = bytes.readUInt16LE(offset + 0xff4)
    const checksum = bytes.readUInt16LE(offset + 0xff6)
    const signature = bytes.readUInt32LE(offset + 0xff8)
    const sectorSaveIndex = bytes.readUInt32LE(offset + 0xffc)
    if (sectionId > 13 || signature !== 0x08012025 || sectors.has(sectionId) || checksum !== sectorChecksum(bytes, offset, sectionId)) return null
    if (saveIndex !== undefined && saveIndex !== sectorSaveIndex) return null
    saveIndex = sectorSaveIndex
    sectors.set(sectionId, { offset, sectionId })
  }
  return sectors.size === 14 ? { copyOffset, saveIndex, sectors } : null
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
  if (!Number.isInteger(party.sectionId) || party.sectionId < 0 || party.sectionId > 13 || !Number.isInteger(party.offset) || party.offset < 0 || !Number.isInteger(party.slots) || party.slots < 1 || !Number.isInteger(party.recordBytes) || party.recordBytes < 80 || !Number.isInteger(slot) || slot < 0 || slot >= party.slots) throw invalidSave('Gen III Party layout is invalid.')
  const section = save.sectors.get(party.sectionId)
  const offset = party.offset + slot * party.recordBytes
  const length = party.sectionId === 13 ? 2000 : 3968
  if (!section || offset + party.recordBytes > length) throw invalidSave('Gen III Party layout is invalid.')
  return Buffer.from(bytes).subarray(section.offset + offset, section.offset + offset + party.recordBytes)
}

function writePcBytes(bytes, save, box, slot, record) {
  let read = 0
  for (const span of pcSpans(save, box, slot)) { record.copy(bytes, span.offset, read, read + span.count); read += span.count }
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
