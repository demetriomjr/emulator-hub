import assert from 'node:assert/strict'
import test from 'node:test'

import { pokemonGen3Adapter } from './pokemon-gen3-adapter.mjs'

test('identifies its adapter ID and rejects non-128KiB saves', () => {
  assert.equal(pokemonGen3Adapter.id, 'gen3-gba-v1')
  assert.throws(() => pokemonGen3Adapter.inspect(Buffer.alloc(0x20000 - 1)), /save/i)
  assert.throws(() => pokemonGen3Adapter.inspect(Buffer.alloc(0x20000 + 1)), /save/i)
})

test('rejects an all-erased Gen III save as uninitialized', () => {
  assert.throws(() => pokemonGen3Adapter.inspect(Buffer.alloc(0x20000, 0xff)), /initialized/i)
})

test('selects the newest valid Gen III save copy from ordered sector IDs', () => {
  const bytes = buildGen3Save({ firstIndex: 3, secondIndex: 7 })

  const inspected = pokemonGen3Adapter.inspect(bytes)

  assert.equal(inspected.saveIndex, 7)
  assert.equal(inspected.copyOffset, 0xe000)
  assert.equal(inspected.boxes.length, 14)
  assert.equal(inspected.boxes.every(box => box.slots.length === 30), true)
})

test('rejects a save when both Gen III copies have a bad sector checksum', () => {
  const bytes = buildGen3Save({ firstIndex: 3, secondIndex: 7 })
  bytes[0x20] ^= 0xff
  bytes[0xe000 + 0x20] ^= 0xff

  assert.throws(() => pokemonGen3Adapter.inspect(bytes), /valid/i)
})

test('reads and rewrites one raw PC record in the newest valid copy', () => {
  const bytes = buildGen3Save({ firstIndex: 3, secondIndex: 7 })
  const record = Buffer.alloc(80, 0)
  record[0] = 0x42
  writePcRecord(bytes, 0xe000, 1, 2, record)
  refreshCopyChecksums(bytes, 0xe000)

  assert.deepEqual(pokemonGen3Adapter.readSlot(bytes, 1, 2).bytes, record)
  const rewritten = pokemonGen3Adapter.writeSlot(bytes, 1, 2, null)
  assert.equal(pokemonGen3Adapter.readSlot(rewritten, 1, 2), null)
  assert.deepEqual(pokemonGen3Adapter.readSlot(bytes, 1, 2).bytes, record)
})

test('moves a PC record that crosses a logical sector boundary without touching sector footers', () => {
  const bytes = buildGen3Save({ firstIndex: 3, secondIndex: 7 })
  const record = Buffer.alloc(80, 0x7a)
  writePcRecord(bytes, 0xe000, 1, 19, record)
  refreshCopyChecksums(bytes, 0xe000)

  assert.deepEqual(pokemonGen3Adapter.readSlot(bytes, 1, 19).bytes, record)
  const rewritten = pokemonGen3Adapter.writeSlot(bytes, 1, 19, null)
  assert.equal(pokemonGen3Adapter.readSlot(rewritten, 1, 19), null)
  assert.equal(rewritten.readUInt32LE(0xe000 + 5 * 0x1000 + 0xff8), 0x08012025)
})

test('projects occupied PC slots during inspection without exposing raw bytes', () => {
  const bytes = buildGen3Save({ firstIndex: 3, secondIndex: 7 })
  writePcRecord(bytes, 0xe000, 0, 0, Buffer.alloc(80, 0x33))
  refreshCopyChecksums(bytes, 0xe000)

  const inspection = pokemonGen3Adapter.inspect(bytes)

  assert.deepEqual(inspection.boxes[0].slots[0], { occupied: true })
  assert.deepEqual(inspection.boxes[0].slots[1], { occupied: false })
})

test('projects the six configured Party positions without exposing native bytes', () => {
  const bytes = buildGen3Save({ firstIndex: 3, secondIndex: 7 })
  const record = buildPcRecord({ personality: 0, originalTrainerId: 0x56781234, species: 25 })
  writePartyCount(bytes, 0xe000, 0x234, 1)
  writePartyRecord(bytes, 0xe000, 0x238, 0, record)
  refreshCopyChecksums(bytes, 0xe000)

  const inspection = pokemonGen3Adapter.inspect(bytes, { party: { sectionId: 1, countOffset: 0x234, offset: 0x238, slots: 6, recordBytes: 100 } })

  assert.deepEqual(inspection.party, [
    { occupied: true, species: 25, shiny: false },
    ...Array.from({ length: 5 }, () => ({ occupied: false })),
  ])
})

test('uses the Party count to exclude stale records after the active party', () => {
  const bytes = buildGen3Save({ firstIndex: 3, secondIndex: 7 })
  writePartyCount(bytes, 0xe000, 0x234, 1)
  writePartyRecord(bytes, 0xe000, 0x238, 0, buildPcRecord({ personality: 0, originalTrainerId: 0x56781234, species: 64 }))
  writePartyRecord(bytes, 0xe000, 0x238, 1, buildPcRecord({ personality: 1, originalTrainerId: 0x56781234, species: 385 }))
  refreshCopyChecksums(bytes, 0xe000)

  const inspection = pokemonGen3Adapter.inspect(bytes, { party: { sectionId: 1, countOffset: 0x234, offset: 0x238, slots: 6, recordBytes: 100 } })

  assert.deepEqual(inspection.party, [
    { occupied: true, species: 64, shiny: false },
    ...Array.from({ length: 5 }, () => ({ occupied: false })),
  ])
})

test('converts native Generation III species IDs to National Dex identifiers for display', () => {
  const bytes = buildGen3Save({ firstIndex: 3, secondIndex: 7 })
  writePartyCount(bytes, 0xe000, 0x234, 4)
  for (const [slot, species] of [64, 277, 394, 409].entries()) {
    writePartyRecord(bytes, 0xe000, 0x238, slot, buildPcRecord({ personality: 0, originalTrainerId: 0x56781234, species }))
  }
  refreshCopyChecksums(bytes, 0xe000)

  const inspection = pokemonGen3Adapter.inspect(bytes, { party: { sectionId: 1, countOffset: 0x234, offset: 0x238, slots: 6, recordBytes: 100 } })

  assert.deepEqual(inspection.party.map(slot => slot.species), [64, 252, 282, 385, undefined, undefined])
})

test('decodes stable Gen III identity fields while retaining the native record', () => {
  const bytes = buildGen3Save({ firstIndex: 3, secondIndex: 7 })
  const record = buildPcRecord({ personality: 0, originalTrainerId: 0x56781234, species: 25 })
  writePcRecord(bytes, 0xe000, 0, 0, record)
  refreshCopyChecksums(bytes, 0xe000)

  const decoded = pokemonGen3Adapter.readSlot(bytes, 0, 0)

  assert.equal(decoded.canonical.species, 25)
  assert.deepEqual(decoded.identity, { personality: 0, originalTrainerId: 0x56781234 })
  assert.deepEqual(pokemonGen3Adapter.inspect(bytes).boxes[0].slots[0], { occupied: true, species: 25, shiny: false })
  assert.deepEqual(decoded.bytes, record)
})

test('decodes a valid encrypted record whose XOR result has the high bit set', () => {
  const bytes = buildGen3Save({ firstIndex: 3, secondIndex: 7 })
  const record = buildPcRecord({ personality: 0, originalTrainerId: 0x80000000, species: 25, marker: 0x80000000 })
  writePcRecord(bytes, 0xe000, 0, 0, record)
  refreshCopyChecksums(bytes, 0xe000)

  assert.deepEqual(pokemonGen3Adapter.inspect(bytes).boxes[0].slots[0], { occupied: true, species: 25, shiny: false })
})

test('extracts complete native Party and PC records for backend-only adoption', () => {
  const bytes = buildGen3Save({ firstIndex: 3, secondIndex: 7 })
  const partyRecord = Buffer.alloc(100, 0xab)
  buildPcRecord({ personality: 0, originalTrainerId: 0x56781234, species: 25 }).copy(partyRecord)
  writePartyCount(bytes, 0xe000, 0x234, 1)
  writePartyRecord(bytes, 0xe000, 0x238, 0, partyRecord)
  writePcRecord(bytes, 0xe000, 0, 0, buildPcRecord({ personality: 0, originalTrainerId: 0x56781234, species: 64 }))
  refreshCopyChecksums(bytes, 0xe000)

  const records = pokemonGen3Adapter.readAllSlots(bytes, { party: { sectionId: 1, countOffset: 0x234, offset: 0x238, slots: 6, recordBytes: 100 } })

  assert.deepEqual(records[0].record.display, { species: 25, shiny: false })
  assert.equal(records[0].record.representation.kind, 'party-record')
  assert.deepEqual(records[0].record.representation.bytes, partyRecord)
  const pc = records.find(slot => slot.location.area === 'box' && slot.location.box === 0 && slot.location.slot === 0)
  assert.equal(pc.record.representation.kind, 'pc-record')
  assert.equal(pc.record.display.species, 64)
  assert.equal(records.find(slot => slot.location.area === 'party' && slot.location.slot === 1).record, null)
})

function buildGen3Save({ firstIndex, secondIndex }) {
  const bytes = Buffer.alloc(0x20000, 0xff)
  writeCopy(bytes, 0, firstIndex)
  writeCopy(bytes, 0xe000, secondIndex)
  return bytes
}

function writeCopy(bytes, copyOffset, saveIndex) {
  for (let sectionId = 0; sectionId < 14; sectionId += 1) {
    const offset = copyOffset + sectionId * 0x1000
    bytes.fill(0, offset, offset + 0x1000)
    bytes.writeUInt16LE(sectionId, offset + 0xff4)
    bytes.writeUInt32LE(0x08012025, offset + 0xff8)
    bytes.writeUInt32LE(saveIndex, offset + 0xffc)
    bytes.writeUInt16LE(gen3Checksum(bytes, offset, sectionId), offset + 0xff6)
  }
}

function gen3Checksum(bytes, offset, sectionId) {
  const length = sectionId === 0 ? 3884 : sectionId === 13 ? 2000 : 3968
  let sum = 0
  for (let index = 0; index < length; index += 4) sum = (sum + bytes.readUInt32LE(offset + index)) >>> 0
  return ((sum & 0xffff) + (sum >>> 16)) & 0xffff
}

function writePcRecord(bytes, copyOffset, box, slot, record) {
  let offset = 4 + (box * 30 + slot) * 80
  for (let sectionId = 5; sectionId <= 13; sectionId += 1) {
    const length = sectionId === 13 ? 2000 : 3968
    if (offset >= length) { offset -= length; continue }
    const count = Math.min(record.length, length - offset)
    record.copy(bytes, copyOffset + sectionId * 0x1000 + offset, 0, count)
    if (count === record.length) return
    record = record.subarray(count)
    offset = 0
  }
  throw new Error('PC record was outside fixture.')
}

function writePartyRecord(bytes, copyOffset, partyOffset, slot, record) {
  record.copy(bytes, copyOffset + 0x1000 + partyOffset + slot * 100)
}

function writePartyCount(bytes, copyOffset, partyCountOffset, count) {
  bytes.writeUInt32LE(count, copyOffset + 0x1000 + partyCountOffset)
}

function refreshCopyChecksums(bytes, copyOffset) {
  for (let sectionId = 0; sectionId < 14; sectionId += 1) {
    const offset = copyOffset + sectionId * 0x1000
    bytes.writeUInt16LE(gen3Checksum(bytes, offset, sectionId), offset + 0xff6)
  }
}

function buildPcRecord({ personality, originalTrainerId, species, marker = 0 }) {
  const record = Buffer.alloc(80)
  record.writeUInt32LE(personality, 0)
  record.writeUInt32LE(originalTrainerId, 4)
  const decrypted = Buffer.alloc(48)
  decrypted.writeUInt16LE(species, 0)
  decrypted.writeUInt32LE(marker, 4)
  const key = personality ^ originalTrainerId
  for (let offset = 0; offset < decrypted.length; offset += 4) decrypted.writeUInt32LE((decrypted.readUInt32LE(offset) ^ key) >>> 0, offset)
  decrypted.copy(record, 32)
  return record
}
