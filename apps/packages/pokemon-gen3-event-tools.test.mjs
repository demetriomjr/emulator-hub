import assert from 'node:assert/strict'
import test from 'node:test'

import { selectNewestPokemonGen3SaveCopy } from './pokemon-gen3-save-validation.mjs'
import { readPokemonGen3Flags, editPokemonGen3Flags } from './pokemon-gen3-event-flags.mjs'
import { inspectPokemonGen3Inventory, addPokemonGen3KeyItems } from './pokemon-gen3-inventory.mjs'
import eventCatalog from './pokemon-gen3-event-encounters.json' with { type: 'json' }
import { materializePokemonGen3EventGrant } from './pokemon-gen3-event-grant.mjs'
import { inspectPokemonGen3EventEligibility } from './pokemon-gen3-event-eligibility.mjs'
import { validatePokemonGen3EventCandidate } from './pokemon-gen3-event-candidate-validation.mjs'

const layouts = {
  'pokemon-ruby': { flags: 0x1220, keyItems: 0x5b0, capacity: 20, pcItems: 0x498, pcCapacity: 50, key: 0 },
  'pokemon-sapphire': { flags: 0x1220, keyItems: 0x5b0, capacity: 20, pcItems: 0x498, pcCapacity: 50, key: 0 },
  'pokemon-emerald': { flags: 0x1270, keyItems: 0x5d8, capacity: 30, pcItems: 0x498, pcCapacity: 50, key: 0x0ac },
  'pokemon-firered': { flags: 0x0ee0, keyItems: 0x3b8, capacity: 30, pcItems: 0x298, pcCapacity: 30, key: 0xf20 },
  'pokemon-leafgreen': { flags: 0x0ee0, keyItems: 0x3b8, capacity: 30, pcItems: 0x298, pcCapacity: 30, key: 0xf20 },
}

test('Gen III event catalog IDs and Key Items layouts agree with the inventory writer', () => {
  const expected = {
    'southern-island': { 'pokemon-ruby': 275, 'pokemon-sapphire': 275, 'pokemon-emerald': 275 },
    'faraway-island': { 'pokemon-emerald': 376 },
    'navel-rock': { 'pokemon-emerald': 370, 'pokemon-firered': 370, 'pokemon-leafgreen': 370 },
    'birth-island': { 'pokemon-emerald': 371, 'pokemon-firered': 371, 'pokemon-leafgreen': 371 },
  }
  assert.equal(eventCatalog.keyItemsInsertion.pocket, 'key-items')
  assert.equal(eventCatalog.keyItemsInsertion.slotBytes, 4)
  assert.equal(eventCatalog.keyItemsInsertion.quantity, 1)
  for (const event of eventCatalog.events) {
    assert.deepEqual(event.itemIdByTitle, expected[event.id])
    for (const [title, itemId] of Object.entries(event.itemIdByTitle)) {
      const profile = eventCatalog.keyItemsInsertion.layoutByTitle[title]
      assert.equal(profile.keyItemsOffset, layouts[title].keyItems)
      assert.equal(profile.keyItemsSlots, layouts[title].capacity)
      assert.equal(profile.pcItemsOffset, layouts[title].pcItems)
      assert.equal(profile.pcItemsSlots, layouts[title].pcCapacity)
      assert.equal(profile.quantityXorKeySmallBlockOffset, layouts[title].key || null)
      const edited = addPokemonGen3KeyItems(fixture(), title, [itemId])
      assert.deepEqual(inspectPokemonGen3Inventory(edited, title).keyItems.slots[0], { index: 0, itemId, quantity: 1 })
    }
  }
})

test('Emerald event grant includes both Mystery unlocks and every selected event flag', () => {
  const original = eligibleFixture('pokemon-emerald')
  const before = Buffer.from(original)
  const selected = eventCatalog.events.map(event => event.id)
  const edited = materializePokemonGen3EventGrant(original, 'pokemon-emerald', selected)
  const inventory = inspectPokemonGen3Inventory(edited, 'pokemon-emerald')
  assert.deepEqual(inventory.keyItems.slots.slice(0, 4).map(slot => slot.itemId), [275, 376, 370, 371])
  const granted = [0x8ac, 0x8db, 0x8b3, 0x8d6, 0x8e0, 0x8d5, 0x13a, 0x13b, 0x13c]
  assert.deepEqual(readPokemonGen3Flags(edited, 'pokemon-emerald', granted), granted.map(() => true))
  const untouched = [0x864, 0x896, 0x1ae, 0x1af, 0x1b0, 0x1db, 0x1ac, 0x1c7, 0x8d8, 0x8e1]
  assert.deepEqual(readPokemonGen3Flags(edited, 'pokemon-emerald', untouched), untouched.map(flag => flag === 0x864 || flag === 0x896))
  assert.deepEqual(original, before)
  assert.deepEqual(materializePokemonGen3EventGrant(edited, 'pokemon-emerald', selected), edited)
})

test('partial Emerald grant sets only the selected event flags plus global unlocks', () => {
  const edited = materializePokemonGen3EventGrant(eligibleFixture('pokemon-emerald'), 'pokemon-emerald', ['birth-island'])
  assert.deepEqual(readPokemonGen3Flags(edited, 'pokemon-emerald', [0x8ac, 0x8db, 0x8d5, 0x13a]), [true, true, true, true])
  assert.deepEqual(readPokemonGen3Flags(edited, 'pokemon-emerald', [0x8b3, 0x8d6, 0x8e0, 0x13b, 0x13c]), [false, false, false, false, false])
  assert.deepEqual(inspectPokemonGen3Inventory(edited, 'pokemon-emerald').keyItems.slots.slice(0, 2).map(slot => slot.itemId), [371, 0])
})

test('Ruby and Sapphire grants use Mystery Event and Eon flags without Emerald flags', () => {
  for (const title of ['pokemon-ruby', 'pokemon-sapphire']) {
    const edited = materializePokemonGen3EventGrant(eligibleFixture(title), title, ['southern-island'])
    assert.deepEqual(readPokemonGen3Flags(edited, title, [0x84c, 0x853, 0x8db]), [true, true, false])
    assert.equal(inspectPokemonGen3Inventory(edited, title).keyItems.slots[0].itemId, 275)
  }
})

test('FireRed and LeafGreen grants include their Mystery Gift, ferry, and receipt flags', () => {
  for (const title of ['pokemon-firered', 'pokemon-leafgreen']) {
    const original = eligibleFixture(title)
    writeSmall32(original, 0xe000, 0xf20, 0x5932a76b)
    refresh(original, 0xe000)
    const before = Buffer.from(original)
    const edited = materializePokemonGen3EventGrant(original, title, ['navel-rock', 'birth-island'])
    assert.deepEqual(inspectPokemonGen3Inventory(edited, title).keyItems.slots.slice(0, 2).map(slot => [slot.itemId, slot.quantity]), [[370, 1], [371, 1]])
    assert.deepEqual(readPokemonGen3Flags(edited, title, [0x839, 0x84a, 0x84b, 0x2a7, 0x2a8]), [true, true, true, true, true])
    assert.deepEqual(readPokemonGen3Flags(edited, title, [0x82c, 0x840, 0x2f0, 0x2f1]), [true, true, false, false])
    assert.deepEqual(original, before)
    assert.deepEqual(materializePokemonGen3EventGrant(edited, title, ['navel-rock', 'birth-island']), edited)
  }
})

test('partial FireRed grant leaves AuroraTicket and Birth Island locked', () => {
  const edited = materializePokemonGen3EventGrant(eligibleFixture('pokemon-firered'), 'pokemon-firered', ['navel-rock'])
  assert.deepEqual(readPokemonGen3Flags(edited, 'pokemon-firered', [0x839, 0x84a, 0x2a8]), [true, true, true])
  assert.deepEqual(readPokemonGen3Flags(edited, 'pokemon-firered', [0x84b, 0x2a7]), [false, false])
  assert.deepEqual(inspectPokemonGen3Inventory(edited, 'pokemon-firered').keyItems.slots.slice(0, 2).map(slot => slot.itemId), [370, 0])
})

test('FireRed and LeafGreen require League, complete National Dex, and restored Network Machine together', () => {
  for (const title of ['pokemon-firered', 'pokemon-leafgreen']) {
    for (let bits = 0; bits < 8; bits += 1) {
      const league = Boolean(bits & 1)
      const nationalDex = Boolean(bits & 2)
      const machine = Boolean(bits & 4)
      const save = frlgProgressFixture({ league, nationalDex, machine })
      const before = Buffer.from(save)
      assert.deepEqual(inspectPokemonGen3EventEligibility(save, title), {
        gameClear: league,
        nationalDexUnlocked: nationalDex,
        networkMachineRestored: machine,
        eligible: league && nationalDex && machine,
      })
      assert.deepEqual(save, before)
    }
  }
})

test('partial National Dex state does not qualify even after Celio repairs the machine', () => {
  const save = frlgProgressFixture({ league: true, nationalDex: true, machine: true })
  const dexFlagAddress = largeAddress(0xe000, 0xee0 + (0x840 >> 3))
  save[dexFlagAddress] &= ~1
  refresh(save, 0xe000)
  assert.deepEqual(inspectPokemonGen3EventEligibility(save, 'pokemon-firered'), {
    gameClear: true,
    nationalDexUnlocked: false,
    networkMachineRestored: true,
    eligible: false,
  })
})

test('Ruby, Sapphire, and Emerald use League and National Dex without a Network Machine gate', () => {
  for (const [title, profile] of [
    ['pokemon-ruby', { magicOffset: 0x1a, magic: 0xda, flagBase: 0x1220, dexFlag: 0x836, workOffset: 0x13cc, workValue: 0x0302, clearFlag: 0x804 }],
    ['pokemon-sapphire', { magicOffset: 0x1a, magic: 0xda, flagBase: 0x1220, dexFlag: 0x836, workOffset: 0x13cc, workValue: 0x0302, clearFlag: 0x804 }],
    ['pokemon-emerald', { magicOffset: 0x1a, magic: 0xda, flagBase: 0x1270, dexFlag: 0x896, workOffset: 0x1428, workValue: 0x0302, clearFlag: 0x864 }],
  ]) {
    const save = fixture()
    save[physicalOffset(0xe000, 0) + profile.magicOffset] = profile.magic
    save.writeUInt16LE(profile.workValue, largeAddress(0xe000, profile.workOffset))
    for (const flagId of [profile.dexFlag, profile.clearFlag]) {
      save[largeAddress(0xe000, profile.flagBase + (flagId >> 3))] |= 1 << (flagId & 7)
    }
    refresh(save, 0xe000)
    assert.deepEqual(inspectPokemonGen3EventEligibility(save, title), {
      gameClear: true,
      nationalDexUnlocked: true,
      networkMachineRestored: null,
      eligible: true,
    })
  }
})

test('event eligibility refuses unsupported titles and ambiguous save copies', () => {
  assert.throws(() => inspectPokemonGen3EventEligibility(fixture(), 'pokemon-crystal'), /unsupported/i)
  const tied = fixture({ firstIndex: 2, secondIndex: 2 })
  tied[largeAddress(0xe000, 0xee0 + (0x844 >> 3))] |= 1 << (0x844 & 7)
  refresh(tied, 0xe000)
  assert.throws(() => inspectPokemonGen3EventEligibility(tied, 'pokemon-firered'), /ambiguous/i)
})

test('event materializer refuses grants before all title-specific progression gates are met', () => {
  for (const title of Object.keys(layouts)) {
    const original = fixture()
    const before = Buffer.from(original)
    const eventId = title === 'pokemon-ruby' || title === 'pokemon-sapphire' ? 'southern-island' : 'navel-rock'
    assert.throws(() => materializePokemonGen3EventGrant(original, title, [eventId]), /eligible|progress/i)
    assert.deepEqual(original, before)
  }
  for (const title of ['pokemon-firered', 'pokemon-leafgreen']) {
    const original = frlgProgressFixture({ league: true, nationalDex: true, machine: false })
    assert.throws(() => materializePokemonGen3EventGrant(original, title, ['birth-island']), /eligible|progress/i)
    assert.deepEqual(readPokemonGen3Flags(original, title, [0x839, 0x84b, 0x2a7]), [false, false, false])
  }
})

test('isolated candidate validation accepts the grant and rejects unrelated save changes', () => {
  const original = eligibleFixture('pokemon-firered')
  const candidate = materializePokemonGen3EventGrant(original, 'pokemon-firered', ['navel-rock', 'birth-island'])
  assert.deepEqual(validatePokemonGen3EventCandidate(original, candidate, 'pokemon-firered', ['navel-rock', 'birth-island']), { changed: true })
  const tampered = Buffer.from(candidate)
  tampered[physicalOffset(0xe000, 0) + 0x1c] = 1
  refresh(tampered, 0xe000)
  assert.throws(() => validatePokemonGen3EventCandidate(original, tampered, 'pokemon-firered', ['navel-rock', 'birth-island']), /unrelated/i)
  assert.deepEqual(original, eligibleFixture('pokemon-firered'))
})

test('event grant rejects unsupported requests and inventory conflicts atomically', () => {
  const original = fixture()
  const before = Buffer.from(original)
  assert.throws(() => materializePokemonGen3EventGrant(original, 'pokemon-emerald', []), /event/i)
  assert.throws(() => materializePokemonGen3EventGrant(original, 'pokemon-emerald', ['birth-island', 'birth-island']), /duplicate/i)
  assert.throws(() => materializePokemonGen3EventGrant(original, 'pokemon-ruby', ['birth-island']), /unsupported/i)
  assert.throws(() => materializePokemonGen3EventGrant(original, 'pokemon-firered', ['southern-island']), /unsupported/i)
  assert.deepEqual(original, before)

  const full = eligibleFixture('pokemon-emerald')
  for (let slot = 0; slot < 30; slot += 1) {
    const address = largeAddress(0xe000, 0x5d8 + slot * 4)
    full.writeUInt16LE(260 + slot, address)
    full.writeUInt16LE(1, address + 2)
  }
  refresh(full, 0xe000)
  const fullBefore = Buffer.from(full)
  assert.throws(() => materializePokemonGen3EventGrant(full, 'pokemon-emerald', ['faraway-island']), /space/i)
  assert.deepEqual(full, fullBefore)
  assert.deepEqual(readPokemonGen3Flags(full, 'pokemon-emerald', [0x8ac, 0x8db, 0x8d6, 0x13c]), [false, false, false, false])

  const inPc = eligibleFixture('pokemon-emerald')
  const pcAddress = largeAddress(0xe000, 0x498)
  inPc.writeUInt16LE(376, pcAddress)
  inPc.writeUInt16LE(1, pcAddress + 2)
  refresh(inPc, 0xe000)
  const pcBefore = Buffer.from(inPc)
  assert.throws(() => materializePokemonGen3EventGrant(inPc, 'pokemon-emerald', ['faraway-island']), /PC/i)
  assert.deepEqual(inPc, pcBefore)
  assert.deepEqual(readPokemonGen3Flags(inPc, 'pokemon-emerald', [0x8ac, 0x8db, 0x8d6, 0x13c]), [false, false, false, false])
})

test('flag editor changes only requested bits in newest scrambled save copy', () => {
  const original = fixture()
  const layout = layouts['pokemon-emerald']
  const address = largeAddress(0xe000, layout.flags + (0x8d6 >> 3))
  original[address] = 0b00010001
  refresh(original, 0xe000)
  const before = Buffer.from(original)

  const edited = editPokemonGen3Flags(original, 'pokemon-emerald', [
    { flagId: 0x8d6, value: true },
    { flagId: 0x8d4, value: false },
  ])

  assert.equal(edited[address], 0b01000001)
  assert.deepEqual(original, before)
  assert.deepEqual(readPokemonGen3Flags(edited, 'pokemon-emerald', [0x8d6, 0x8d4]), [true, false])
  assert.equal(selectNewestPokemonGen3SaveCopy(edited).copyOffset, 0xe000)
  assert.deepEqual(edited.subarray(0, 0xe000), original.subarray(0, 0xe000))
  assert.deepEqual(edited.subarray(0x1c000), original.subarray(0x1c000))
  assert.deepEqual(changedOffsets(before, edited), [address, physicalOffset(0xe000, 2) + 0xff6, physicalOffset(0xe000, 2) + 0xff7].sort((a, b) => a - b).filter((value, index, values) => index === 0 || value !== values[index - 1]).filter(offset => before[offset] !== edited[offset]))
})

test('flag tool honors title-specific bases and last valid bit', () => {
  for (const title of Object.keys(layouts)) {
    const original = fixture()
    const maxFlag = title === 'pokemon-emerald' ? 2399 : 2303
    const edited = editPokemonGen3Flags(original, title, [{ flagId: maxFlag, value: true }])
    assert.deepEqual(readPokemonGen3Flags(edited, title, [0, maxFlag]), [false, true])
    assert.equal(edited[largeAddress(0xe000, layouts[title].flags + (maxFlag >> 3))] & 0x80, 0x80)
    assert.throws(() => editPokemonGen3Flags(original, title, [{ flagId: maxFlag + 1, value: true }]), /flag/i)
  }
})

test('flag tool rejects duplicate edits and disagreeing equal-index save copies', () => {
  const original = fixture()
  assert.throws(() => editPokemonGen3Flags(original, 'pokemon-emerald', [{ flagId: 1, value: true }, { flagId: 1, value: false }]), /duplicate/i)
  assert.throws(() => editPokemonGen3Flags(original, 'pokemon-emerald', [{ flagId: 1, value: 1 }]), /boolean/i)
  const tied = fixture({ firstIndex: 2, secondIndex: 2 })
  tied[largeAddress(0xe000, 0x1270)] = 1
  refresh(tied, 0xe000)
  assert.throws(() => editPokemonGen3Flags(tied, 'pokemon-emerald', [{ flagId: 1, value: true }]), /ambiguous/i)
})

test('editors reject a changing edit when identical copies share the same save index', () => {
  const tied = fixture({ firstIndex: 2, secondIndex: 2 })
  const before = Buffer.from(tied)
  assert.throws(() => editPokemonGen3Flags(tied, 'pokemon-emerald', [{ flagId: 1, value: true }]), /ambiguous/i)
  assert.throws(() => addPokemonGen3KeyItems(tied, 'pokemon-emerald', [275]), /ambiguous/i)
  assert.deepEqual(tied, before)
  assert.deepEqual(editPokemonGen3Flags(tied, 'pokemon-emerald', []), tied)
})

test('inventory editor writes encoded Key Item quantities only for missing items', () => {
  const original = fixture()
  const securityKey = 0xabcd1234
  writeSmall32(original, 0xe000, 0x0ac, securityKey)
  const oldMapSlot = largeAddress(0xe000, 0x5d8)
  original.writeUInt16LE(376, oldMapSlot)
  original.writeUInt16LE(1 ^ 0x1234, oldMapSlot + 2)
  original.writeUInt16LE(0x1234, oldMapSlot + 6) // encoded zero in the next empty slot
  refresh(original, 0xe000)
  const before = Buffer.from(original)

  const edited = addPokemonGen3KeyItems(original, 'pokemon-emerald', [275, 370, 371, 376])

  assert.deepEqual(original, before)
  assert.equal(edited.readUInt16LE(oldMapSlot), 376)
  assert.equal(edited.readUInt16LE(oldMapSlot + 2), 1 ^ 0x1234)
  for (const [index, itemId] of [275, 370, 371].entries()) {
    const address = largeAddress(0xe000, 0x5d8 + (index + 1) * 4)
    assert.equal(edited.readUInt16LE(address), itemId)
    assert.equal(edited.readUInt16LE(address + 2), 1 ^ 0x1234)
  }
  const inspected = inspectPokemonGen3Inventory(edited, 'pokemon-emerald')
  assert.deepEqual(inspected.keyItems.slots.slice(0, 4).map(slot => [slot.itemId, slot.quantity]), [[376, 1], [275, 1], [370, 1], [371, 1]])
  assert.equal(inspected.keyItems.freeSlots, 26)
  assert.deepEqual(addPokemonGen3KeyItems(edited, 'pokemon-emerald', [275, 370, 371, 376]), edited)
  assert.deepEqual(edited.subarray(0, 0xe000), original.subarray(0, 0xe000))
  const allowed = new Set([physicalOffset(0xe000, 1) + 0xff6, physicalOffset(0xe000, 1) + 0xff7])
  for (let index = 1; index < 4; index += 1) {
    const address = oldMapSlot + index * 4
    for (let byte = 0; byte < 4; byte += 1) allowed.add(address + byte)
  }
  assert.equal(changedOffsets(before, edited).every(offset => allowed.has(offset)), true)
})

test('inventory editor follows Ruby/Sapphire plain quantities and FireRed/LeafGreen XOR keys', () => {
  for (const title of ['pokemon-ruby', 'pokemon-sapphire']) {
    const edited = addPokemonGen3KeyItems(fixture(), title, [275])
    const address = largeAddress(0xe000, 0x5b0)
    assert.equal(edited.readUInt16LE(address), 275)
    assert.equal(edited.readUInt16LE(address + 2), 1)
  }
  for (const title of ['pokemon-firered', 'pokemon-leafgreen']) {
    const original = fixture()
    writeSmall32(original, 0xe000, 0xf20, 0x4422cafe)
    refresh(original, 0xe000)
    const edited = addPokemonGen3KeyItems(original, title, [370, 371])
    const address = largeAddress(0xe000, 0x3b8)
    assert.equal(edited.readUInt16LE(address), 370)
    assert.equal(edited.readUInt16LE(address + 2), 1 ^ 0xcafe)
    assert.equal(edited.readUInt16LE(address + 4), 371)
  }
})

test('inventory editor refuses a full pocket or duplicate item in PC without touching input', () => {
  const full = fixture()
  for (let slot = 0; slot < 30; slot += 1) {
    const address = largeAddress(0xe000, 0x5d8 + slot * 4)
    full.writeUInt16LE(260 + slot, address)
    full.writeUInt16LE(1, address + 2)
  }
  refresh(full, 0xe000)
  const before = Buffer.from(full)
  assert.throws(() => addPokemonGen3KeyItems(full, 'pokemon-emerald', [370]), /full|space/i)
  assert.deepEqual(full, before)

  const inPc = fixture()
  const pcAddress = largeAddress(0xe000, 0x498)
  inPc.writeUInt16LE(370, pcAddress)
  inPc.writeUInt16LE(1, pcAddress + 2)
  refresh(inPc, 0xe000)
  assert.throws(() => addPokemonGen3KeyItems(inPc, 'pokemon-emerald', [370]), /PC/i)
  assert.equal(inspectPokemonGen3Inventory(inPc, 'pokemon-emerald').pcItems.slots[0].quantity, 1)
})

test('inventory editor rejects unsupported items, bad quantities, and duplicates', () => {
  const original = fixture()
  assert.throws(() => addPokemonGen3KeyItems(original, 'pokemon-ruby', [376]), /unsupported/i)
  assert.throws(() => addPokemonGen3KeyItems(original, 'pokemon-emerald', [370, 370]), /duplicate/i)
  const malformed = fixture()
  const address = largeAddress(0xe000, 0x5d8)
  malformed.writeUInt16LE(275, address)
  malformed.writeUInt16LE(2, address + 2)
  refresh(malformed, 0xe000)
  assert.throws(() => addPokemonGen3KeyItems(malformed, 'pokemon-emerald', [370]), /quantity/i)
})

test('both tools reject invalid saves before returning an edit', () => {
  const broken = fixture()
  broken[0x123] ^= 0xff
  broken[0xe000 + 0x123] ^= 0xff
  assert.throws(() => editPokemonGen3Flags(broken, 'pokemon-emerald', [{ flagId: 1, value: true }]), /valid/i)
  assert.throws(() => addPokemonGen3KeyItems(broken, 'pokemon-emerald', [275]), /valid/i)
  assert.throws(() => inspectPokemonGen3Inventory(Buffer.alloc(12), 'pokemon-emerald'), /128|save/i)
})

test('editors use the only valid save copy and preserve invalid copy bytes', () => {
  const original = fixture()
  original[physicalOffset(0xe000, 2) + 3] ^= 0xff
  const before = Buffer.from(original)

  const withFlag = editPokemonGen3Flags(original, 'pokemon-emerald', [{ flagId: 0x8d6, value: true }])
  const withItem = addPokemonGen3KeyItems(withFlag, 'pokemon-emerald', [376])

  assert.equal(selectNewestPokemonGen3SaveCopy(withItem).copyOffset, 0)
  assert.deepEqual(withItem.subarray(0xe000), before.subarray(0xe000))
  assert.deepEqual(readPokemonGen3Flags(withItem, 'pokemon-emerald', [0x8d6]), [true])
  assert.equal(inspectPokemonGen3Inventory(withItem, 'pokemon-emerald').keyItems.slots[0].itemId, 376)
  assert.deepEqual(original, before)
})

function fixture({ firstIndex = 1, secondIndex = 2 } = {}) {
  const bytes = Buffer.alloc(0x20000)
  for (const [copy, index] of [[0, firstIndex], [0xe000, secondIndex]]) {
    for (let section = 0; section < 14; section += 1) {
      const offset = physicalOffset(copy, section)
      bytes.writeUInt16LE(section, offset + 0xff4)
      bytes.writeUInt32LE(0x08012025, offset + 0xff8)
      bytes.writeUInt32LE(index, offset + 0xffc)
    }
    refresh(bytes, copy)
  }
  return bytes
}

function physicalOffset(copy, section) { return copy + ((section * 5 + 3) % 14) * 0x1000 }
function largeAddress(copy, offset) { return physicalOffset(copy, 1 + Math.floor(offset / 0xf80)) + offset % 0xf80 }
function writeSmall32(bytes, copy, offset, value) { bytes.writeUInt32LE(value, physicalOffset(copy, 0) + offset) }
function frlgProgressFixture({ league, nationalDex, machine }) {
  const bytes = fixture()
  if (nationalDex) {
    bytes[physicalOffset(0xe000, 0) + 0x1b] = 0xb9
    bytes.writeUInt16LE(0x6258, largeAddress(0xe000, 0x109c))
  }
  for (const [enabled, flagId] of [[league, 0x82c], [nationalDex, 0x840], [machine, 0x844]]) {
    if (enabled) bytes[largeAddress(0xe000, 0xee0 + (flagId >> 3))] |= 1 << (flagId & 7)
  }
  refresh(bytes, 0xe000)
  return bytes
}
function eligibleFixture(title) {
  if (title === 'pokemon-firered' || title === 'pokemon-leafgreen') return frlgProgressFixture({ league: true, nationalDex: true, machine: true })
  const profile = title === 'pokemon-emerald'
    ? { flagBase: 0x1270, dexFlag: 0x896, clearFlag: 0x864, workOffset: 0x1428 }
    : { flagBase: 0x1220, dexFlag: 0x836, clearFlag: 0x804, workOffset: 0x13cc }
  const bytes = fixture()
  bytes[physicalOffset(0xe000, 0) + 0x1a] = 0xda
  bytes.writeUInt16LE(0x0302, largeAddress(0xe000, profile.workOffset))
  for (const flagId of [profile.dexFlag, profile.clearFlag]) {
    bytes[largeAddress(0xe000, profile.flagBase + (flagId >> 3))] |= 1 << (flagId & 7)
  }
  refresh(bytes, 0xe000)
  return bytes
}
function refresh(bytes, copy) {
  for (let section = 0; section < 14; section += 1) {
    const start = physicalOffset(copy, section)
    const length = section === 0 ? 3884 : section === 13 ? 2000 : 3968
    let sum = 0
    for (let offset = 0; offset < length; offset += 4) sum = (sum + bytes.readUInt32LE(start + offset)) >>> 0
    bytes.writeUInt16LE(((sum & 0xffff) + (sum >>> 16)) & 0xffff, start + 0xff6)
  }
}
function changedOffsets(before, after) {
  const result = []
  for (let index = 0; index < before.length; index += 1) if (before[index] !== after[index]) result.push(index)
  return result
}
