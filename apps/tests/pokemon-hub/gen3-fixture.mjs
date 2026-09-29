import itemProfiles from '../../packages/pokemon-item-save-profiles.json' with { type: 'json' }
import capabilityProfiles from '../../packages/pokemon-gen3-save-capabilities.json' with { type: 'json' }

// Synthetic Gen III save data. No personal or production save is used.
export function createEmeraldSave({ box = [25, 64, 133], secondBox = [], party = [10, 11] } = {}) {
  const bytes = Buffer.alloc(0x20000, 0xff)
  writeCopy(bytes, 0, 3)
  writeCopy(bytes, 0xe000, 7)
  const copy = 0xe000
  bytes[copy + 0x1a] = 0xda
  for (const flag of [0x861, 0x864, 0x896]) {
    const offset = 0x1270 + Math.floor(flag / 8)
    writeLargeByte(bytes, copy, offset, readLargeByte(bytes, copy, offset) | (1 << (flag % 8)))
  }
  writeLargeByte(bytes, copy, 0x139c + 0x46 * 2, 0x02)
  writeLargeByte(bytes, copy, 0x139c + 0x46 * 2 + 1, 0x03)
  bytes.writeUInt32LE(party.length, copy + 0x1000 + 0x234)
  for (const [slot, species] of party.entries()) {
    const core = pcRecord(species, 100 + slot)
    core.copy(bytes, copy + 0x1000 + 0x238 + slot * 100)
  }
  for (const [slot, species] of box.entries()) {
    if (species == null) continue
    pcRecord(species, 200 + slot).copy(bytes, copy + 0x5000 + 4 + slot * 80)
  }
  for (const [slot, species] of secondBox.entries()) {
    if (species == null) continue
    pcRecord(species, 300 + slot).copy(bytes, copy + 0x5000 + 4 + (30 + slot) * 80)
  }
  refreshChecksums(bytes, copy)
  return bytes
}

export function createItemSave(title, { areas = {}, tradeReady = true, box, party } = {}) {
  const bytes = createEmeraldSave({ ...(box ? { box } : {}), ...(party ? { party } : {}) })
  const base = 0xe000
  const capability = capabilityProfiles.titles[title]
  const inventory = itemProfiles.profiles.find(profile => profile.titles.includes(title))
  if (!capability || !inventory || !['pokemon-ruby', 'pokemon-sapphire', 'pokemon-emerald'].includes(title)) throw new TypeError('Item fixture title is invalid.')
  for (const flag of [capability.ordinaryTradeFlag, capability.gameClearFlag, capability.nationalDexFlag]) {
    const offset = capability.eventFlagBase + Math.floor(flag / 8)
    const current = readLargeByte(bytes, base, offset)
    writeLargeByte(bytes, base, offset, flag === capability.ordinaryTradeFlag && !tradeReady ? current & ~(1 << (flag % 8)) : current | (1 << (flag % 8)))
  }
  writeLargeByte(bytes, base, capability.eventWorkBase + capability.nationalDexWorkIndex * 2, capability.nationalDexWorkValue & 0xff)
  writeLargeByte(bytes, base, capability.eventWorkBase + capability.nationalDexWorkIndex * 2 + 1, capability.nationalDexWorkValue >>> 8)
  for (const area of inventory.areas) {
    for (const [slot, [nativeId, quantity]] of (areas[area.id] ?? []).entries()) {
      if (slot >= area.slots) throw new RangeError('Item fixture area is full.')
      const offset = area.logicalOffset + slot * 4
      writeLargeByte(bytes, base, offset, nativeId & 0xff)
      writeLargeByte(bytes, base, offset + 1, nativeId >>> 8)
      writeLargeByte(bytes, base, offset + 2, quantity & 0xff)
      writeLargeByte(bytes, base, offset + 3, quantity >>> 8)
    }
  }
  refreshChecksums(bytes, base)
  return bytes
}

function pcRecord(species, marker) {
  const personality = 0
  const trainer = (0x56781234 + marker) >>> 0
  const record = Buffer.alloc(80)
  record.writeUInt32LE(personality, 0)
  record.writeUInt32LE(trainer, 4)
  const decrypted = Buffer.alloc(48)
  decrypted.writeUInt16LE(species, 0)
  record.writeUInt16LE(species, 0x1c)
  const key = personality ^ trainer
  for (let offset = 0; offset < 48; offset += 4) decrypted.writeUInt32LE((decrypted.readUInt32LE(offset) ^ key) >>> 0, offset)
  decrypted.copy(record, 32)
  return record
}

function writeCopy(bytes, base, saveIndex) {
  for (let section = 0; section < 14; section += 1) {
    const offset = base + section * 0x1000
    bytes.fill(0, offset, offset + 0x1000)
    bytes.writeUInt16LE(section, offset + 0xff4)
    bytes.writeUInt32LE(0x08012025, offset + 0xff8)
    bytes.writeUInt32LE(saveIndex, offset + 0xffc)
    bytes.writeUInt16LE(checksum(bytes, offset, section), offset + 0xff6)
  }
}

function checksum(bytes, offset, section) {
  const length = section === 0 ? 3884 : section === 13 ? 2000 : 3968
  let sum = 0
  for (let index = 0; index < length; index += 4) sum = (sum + bytes.readUInt32LE(offset + index)) >>> 0
  return ((sum & 0xffff) + (sum >>> 16)) & 0xffff
}

function refreshChecksums(bytes, base) {
  for (let section = 0; section < 14; section += 1) {
    const offset = base + section * 0x1000
    bytes.writeUInt16LE(checksum(bytes, offset, section), offset + 0xff6)
  }
}

function readLargeByte(bytes, base, offset) {
  return bytes[base + (1 + Math.floor(offset / 0xf80)) * 0x1000 + offset % 0xf80]
}

function writeLargeByte(bytes, base, offset, value) {
  bytes[base + (1 + Math.floor(offset / 0xf80)) * 0x1000 + offset % 0xf80] = value
}
