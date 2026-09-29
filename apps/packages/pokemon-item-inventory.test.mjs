import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

import { selectUnambiguousPokemonGen3SaveCopy } from './pokemon-gen3-save-validation.mjs'
import * as inventory from './pokemon-item-inventory.mjs'

const cases = [
  ['pokemon-ruby', [50, 20, 20, 16, 64, 46], [999, 99, 99, 99, 99, 999], 0],
  ['pokemon-sapphire', [50, 20, 20, 16, 64, 46], [999, 99, 99, 99, 99, 999], 0],
  ['pokemon-emerald', [50, 30, 30, 16, 64, 46], [999, 99, 99, 99, 99, 999], 0xc3d4],
  ['pokemon-firered', [30, 42, 30, 13, 58, 43], [999, 999, 999, 999, 999, 999], 0xc3d4],
  ['pokemon-leafgreen', [30, 42, 30, 13, 58, 43], [999, 999, 999, 999, 999, 999], 0xc3d4],
]
const areaIds = ['pc', 'items', 'key-items', 'poke-balls', 'tm-hm', 'berries']
const nativeIds = [13, 13, 275, 4, 289, 133]
const expectedKeys = ['potion', 'potion', 'eon-ticket', 'poke-ball', 'tm01-focus-punch', 'cheri-berry']
const offsets = {
  'pokemon-ruby': [0x498, 0x560, 0x5b0, 0x600, 0x640, 0x740],
  'pokemon-sapphire': [0x498, 0x560, 0x5b0, 0x600, 0x640, 0x740],
  'pokemon-emerald': [0x498, 0x560, 0x5d8, 0x650, 0x690, 0x790],
  'pokemon-firered': [0x298, 0x310, 0x3b8, 0x430, 0x464, 0x54c],
  'pokemon-leafgreen': [0x298, 0x310, 0x3b8, 0x430, 0x464, 0x54c],
}

test('reads all six areas, native stack limits, and free slots for five GBA titles', () => {
  for (const [title, capacities, stackLimits, key] of cases) {
    const save = fixture(title, key)
    areaIds.forEach((area, index) => writeItem(save, title, area, 0, nativeIds[index], 7, key))
    areaIds.forEach((area, index) => writeItem(save, title, area, 1, 0, 0, key))
    refresh(save, 0xe000)

    const result = inventory.readPokemonItemInventory(save, title)
    assert.equal(result.title, title)
    assert.deepEqual(Object.keys(result.areas), areaIds)
    areaIds.forEach((area, index) => {
      const view = result.areas[area]
      assert.equal(view.capacity, capacities[index], `${title}/${area} slots`)
      assert.equal(view.maxPerStack, stackLimits[index], `${title}/${area} stack limit`)
      assert.equal(view.freeSlots, capacities[index] - 1, `${title}/${area} empty slots`)
      assert.deepEqual(view.slots[0], { index: 0, nativeId: nativeIds[index], itemKey: expectedKeys[index], quantity: 7 })
      assert.deepEqual(view.slots[1], { index: 1, nativeId: 0, itemKey: null, quantity: 0 })
      assert.deepEqual(view.issues, [])
    })
  }
})

test('keeps unknown and title-exclusive IDs occupied without inventing semantic identity', () => {
  const ruby = fixture('pokemon-ruby', 0)
  writeItem(ruby, 'pokemon-ruby', 'items', 0, 0x34, 1, 0)
  writeItem(ruby, 'pokemon-ruby', 'items', 1, 376, 1, 0)
  refresh(ruby, 0xe000)
  const area = inventory.readPokemonItemInventory(ruby, 'pokemon-ruby').areas.items
  assert.equal(area.freeSlots, 18)
  assert.equal(area.slots[0].itemKey, null)
  assert.equal(area.slots[1].itemKey, null)
  assert.deepEqual(area.issues, [{ slot: 0, code: 'unknown-item-id' }, { slot: 1, code: 'unknown-item-id' }])

  const emerald = fixture('pokemon-emerald', 0xc3d4)
  writeItem(emerald, 'pokemon-emerald', 'key-items', 0, 376, 1, 0xc3d4)
  refresh(emerald, 0xe000)
  assert.equal(inventory.readPokemonItemInventory(emerald, 'pokemon-emerald').areas['key-items'].slots[0].itemKey, 'old-sea-map')
})

test('reports zero and over-limit occupied quantities and refuses to edit that area', () => {
  const save = fixture('pokemon-emerald', 0xc3d4)
  writeItem(save, 'pokemon-emerald', 'items', 0, 13, 0, 0xc3d4)
  writeItem(save, 'pokemon-emerald', 'items', 1, 13, 100, 0xc3d4)
  refresh(save, 0xe000)
  const before = Buffer.from(save)
  const area = inventory.readPokemonItemInventory(save, 'pokemon-emerald').areas.items
  assert.equal(area.freeSlots, 28)
  assert.deepEqual(area.issues, [{ slot: 0, code: 'invalid-quantity' }, { slot: 1, code: 'invalid-quantity' }])
  assert.throws(() => inventory.removePokemonItemFromSave(save, 'pokemon-emerald', { area: 'items', slot: 1, quantity: 1 }), /invalid|unsafe/i)
  assert.deepEqual(save, before)
})

test('subtracts only requested units from Emerald XOR slot and preserves the source and inactive copy', () => {
  const save = fixture('pokemon-emerald', 0xc3d4)
  writeItem(save, 'pokemon-emerald', 'items', 0, 13, 10, 0xc3d4)
  refresh(save, 0xe000)
  const before = Buffer.from(save)
  const { saveBytes, removed } = inventory.removePokemonItemFromSave(save, 'pokemon-emerald', { area: 'items', slot: 0, quantity: 3 })
  assert.deepEqual(removed, { itemKey: 'potion', nativeId: 13, quantity: 3, area: 'items', slot: 0 })
  assert.equal(inventory.readPokemonItemInventory(saveBytes, 'pokemon-emerald').areas.items.slots[0].quantity, 7)
  assert.equal(saveBytes.readUInt16LE(largeAddress(0xe000, 0x560) + 2), 7 ^ 0xc3d4)
  assert.deepEqual(save, before)
  assert.deepEqual(saveBytes.subarray(0, 0xe000), before.subarray(0, 0xe000))
  assert.equal(selectUnambiguousPokemonGen3SaveCopy(saveBytes).copyOffset, 0xe000)
})

test('removes a whole PC stack, compacts the next item and increases free slots', () => {
  const save = fixture('pokemon-ruby', 0)
  writeItem(save, 'pokemon-ruby', 'pc', 0, 13, 1, 0)
  writeItem(save, 'pokemon-ruby', 'pc', 1, 4, 2, 0)
  refresh(save, 0xe000)
  const { saveBytes } = inventory.removePokemonItemFromSave(save, 'pokemon-ruby', { area: 'pc', slot: 0, quantity: 1 })
  const pc = inventory.readPokemonItemInventory(saveBytes, 'pokemon-ruby').areas.pc
  assert.deepEqual(pc.slots[0], { index: 0, nativeId: 4, itemKey: 'poke-ball', quantity: 2 })
  assert.deepEqual(pc.slots[1], { index: 1, nativeId: 0, itemKey: null, quantity: 0 })
  assert.equal(pc.freeSlots, 49)
})

test('rejects RSE key items and HMs while allowing TMs to leave a copied save', () => {
  for (const [title, , , key] of cases.slice(0, 3)) {
    const save = fixture(title, key)
    writeItem(save, title, 'key-items', 0, 275, 1, key)
    writeItem(save, title, 'tm-hm', 0, 339, 1, key)
    writeItem(save, title, 'tm-hm', 1, 289, 3, key)
    refresh(save, 0xe000)
    const before = Buffer.from(save)
    for (const area of [{ area: 'key-items', slot: 0 }, { area: 'tm-hm', slot: 0 }]) {
      assert.throws(() => inventory.removePokemonItemFromSave(save, title, { ...area, quantity: 1 }), /transfer|blocked|forbidden/i)
      assert.deepEqual(save, before)
    }
    const result = inventory.removePokemonItemFromSave(save, title, { area: 'tm-hm', slot: 1, quantity: 1 })
    assert.equal(result.removed.itemKey, 'tm01-focus-punch')
    assert.equal(inventory.readPokemonItemInventory(result.saveBytes, title).areas['tm-hm'].slots[1].quantity, 2)
    assert.deepEqual(save, before)
  }
})

test('does not authorize FireRed and LeafGreen transfers before their policy is defined', () => {
  for (const title of ['pokemon-firered', 'pokemon-leafgreen']) {
    const save = fixture(title, 0xc3d4)
    writeItem(save, title, 'items', 0, 13, 1, 0xc3d4)
    refresh(save, 0xe000)
    const before = Buffer.from(save)
    assert.throws(() => inventory.removePokemonItemFromSave(save, title, { area: 'items', slot: 0, quantity: 1 }), /blocked by policy/i)
    assert.deepEqual(save, before)
  }
})

test('does not transfer an HM or key item even if it appears in the PC', () => {
  const save = fixture('pokemon-emerald', 0xc3d4)
  writeItem(save, 'pokemon-emerald', 'pc', 0, 339, 1, 0xc3d4)
  writeItem(save, 'pokemon-emerald', 'pc', 1, 262, 1, 0xc3d4)
  refresh(save, 0xe000)
  const before = Buffer.from(save)
  for (const slot of [0, 1]) assert.throws(() => inventory.removePokemonItemFromSave(save, 'pokemon-emerald', { area: 'pc', slot, quantity: 1 }), /blocked by policy/i)
  assert.deepEqual(save, before)
})

test('swaps two occupied item slots without changing quantities in Ruby, Sapphire and Emerald', () => {
  for (const [title, , , key] of cases.slice(0, 3)) {
    const save = fixture(title, key)
    for (const [slot, nativeId, quantity] of [[0, 13, 7], [1, 4, 3], [2, 14, 5]]) writeItem(save, title, 'items', slot, nativeId, quantity, key)
    refresh(save, 0xe000)
    const before = Buffer.from(save)
    const result = inventory.reorderPokemonItemsInSave(save, title, { area: 'items', fromSlot: 0, toSlot: 2 })
    assert.equal(result.changed, true)
    assert.deepEqual(inventory.readPokemonItemInventory(result.saveBytes, title).areas.items.slots.slice(0, 4).map(slot => [slot.itemKey, slot.quantity]), [
      ['antidote', 5], ['poke-ball', 3], ['potion', 7], [null, 0],
    ])
    assert.deepEqual(save, before)
    assert.equal(selectUnambiguousPokemonGen3SaveCopy(result.saveBytes).copyOffset, 0xe000)
    assert.deepEqual(result.saveBytes.subarray(0, 0xe000), before.subarray(0, 0xe000))
  }
})

test('dropping onto an empty slot moves the item to the occupied end without gaps', () => {
  const save = fixture('pokemon-emerald', 0xc3d4)
  for (const [slot, nativeId] of [[0, 13], [1, 4], [2, 14], [3, 15]]) writeItem(save, 'pokemon-emerald', 'items', slot, nativeId, slot + 1, 0xc3d4)
  refresh(save, 0xe000)
  const before = Buffer.from(save)
  const result = inventory.reorderPokemonItemsInSave(save, 'pokemon-emerald', { area: 'items', fromSlot: 2, toSlot: 29 })
  const area = inventory.readPokemonItemInventory(result.saveBytes, 'pokemon-emerald').areas.items
  assert.deepEqual(area.slots.slice(0, 5).map(slot => [slot.nativeId, slot.quantity]), [[13, 1], [4, 2], [15, 4], [14, 3], [0, 0]])
  assert.equal(area.freeSlots, 26)
  assert.deepEqual(save, before)
  assert.equal(selectUnambiguousPokemonGen3SaveCopy(result.saveBytes).copyOffset, 0xe000)
})

test('key items can be reordered while TM/HM and Berries cannot', () => {
  const save = fixture('pokemon-emerald', 0xc3d4)
  writeItem(save, 'pokemon-emerald', 'key-items', 0, 262, 1, 0xc3d4)
  writeItem(save, 'pokemon-emerald', 'key-items', 1, 263, 1, 0xc3d4)
  writeItem(save, 'pokemon-emerald', 'tm-hm', 0, 289, 1, 0xc3d4)
  writeItem(save, 'pokemon-emerald', 'berries', 0, 133, 1, 0xc3d4)
  refresh(save, 0xe000)
  const before = Buffer.from(save)
  const result = inventory.reorderPokemonItemsInSave(save, 'pokemon-emerald', { area: 'key-items', fromSlot: 0, toSlot: 1 })
  assert.deepEqual(result.saveBytes.readUInt16LE(largeAddress(0xe000, offsets['pokemon-emerald'][2])), 263)
  for (const area of ['tm-hm', 'berries']) assert.throws(() => inventory.reorderPokemonItemsInSave(save, 'pokemon-emerald', { area, fromSlot: 0, toSlot: 1 }), /reorder|policy/i)
  assert.deepEqual(save, before)
})

test('reorder refuses a gapped area and a stale or invalid slot request without mutating the input', () => {
  const save = fixture('pokemon-ruby', 0)
  writeItem(save, 'pokemon-ruby', 'items', 0, 13, 1, 0)
  writeItem(save, 'pokemon-ruby', 'items', 2, 14, 1, 0)
  refresh(save, 0xe000)
  const before = Buffer.from(save)
  for (const request of [{ area: 'items', fromSlot: 0, toSlot: 2 }, { area: 'items', fromSlot: -1, toSlot: 1 }, { area: 'items', fromSlot: 0, toSlot: 20 }]) {
    assert.throws(() => inventory.reorderPokemonItemsInSave(save, 'pokemon-ruby', request))
  }
  assert.deepEqual(save, before)
  const compact = fixture('pokemon-ruby', 0)
  writeItem(compact, 'pokemon-ruby', 'items', 0, 13, 1, 0)
  refresh(compact, 0xe000)
  assert.equal(inventory.reorderPokemonItemsInSave(compact, 'pokemon-ruby', { area: 'items', fromSlot: 0, toSlot: 10 }).changed, false)
  assert.throws(() => inventory.reorderPokemonItemsInSave(compact, 'pokemon-firered', { area: 'items', fromSlot: 0, toSlot: 1 }), /reorder|policy/i)
})

test('transfers a partial stack across RSE saves and honors the destination stack limit', () => {
  const ruby = fixture('pokemon-ruby', 0)
  const sapphire = fixture('pokemon-sapphire', 0)
  writeItem(ruby, 'pokemon-ruby', 'items', 0, 13, 10, 0)
  writeItem(sapphire, 'pokemon-sapphire', 'items', 0, 13, 90, 0)
  refresh(ruby, 0xe000); refresh(sapphire, 0xe000)
  const result = inventory.transferPokemonItemsBetweenSaves(ruby, 'pokemon-ruby', sapphire, 'pokemon-sapphire', { area: 'items', fromSlot: 0, toSlot: 1, quantity: 9 })
  assert.equal(result.maxQuantity, 9)
  assert.deepEqual(inventory.readPokemonItemInventory(result.sourceSaveBytes, 'pokemon-ruby').areas.items.slots[0].quantity, 1)
  assert.deepEqual(inventory.readPokemonItemInventory(result.destinationSaveBytes, 'pokemon-sapphire').areas.items.slots[0].quantity, 99)
  assert.throws(() => inventory.transferPokemonItemsBetweenSaves(ruby, 'pokemon-ruby', sapphire, 'pokemon-sapphire', { area: 'items', fromSlot: 0, quantity: 10 }))
  assert.deepEqual(inventory.readPokemonItemInventory(ruby, 'pokemon-ruby').areas.items.slots[0].quantity, 10)
})

test('adds a Hub item to the matching Emerald stack using its semantic key and native quantity encoding', () => {
  const save = fixture('pokemon-emerald', 0xc3d4)
  writeItem(save, 'pokemon-emerald', 'items', 0, 13, 98, 0xc3d4)
  refresh(save, 0xe000)
  const before = Buffer.from(save)
  const result = inventory.addPokemonItemToSave(save, 'pokemon-emerald', { area: 'items', itemKey: 'potion', quantity: 1, toSlot: 1 })
  assert.equal(inventory.readPokemonItemInventory(result.saveBytes, 'pokemon-emerald').areas.items.slots[0].quantity, 99)
  assert.deepEqual(save, before)
  assert.throws(() => inventory.addPokemonItemToSave(save, 'pokemon-emerald', { area: 'items', itemKey: 'potion', quantity: 2 }))
})

test('adds a Hub item in a free Ruby Bag slot and rejects full areas and blocked items', () => {
  const save = fixture('pokemon-ruby', 0)
  writeItem(save, 'pokemon-ruby', 'items', 0, 14, 1, 0)
  refresh(save, 0xe000)
  const inserted = inventory.addPokemonItemToSave(save, 'pokemon-ruby', { area: 'items', itemKey: 'potion', quantity: 3, toSlot: 0 })
  assert.deepEqual(inventory.readPokemonItemInventory(inserted.saveBytes, 'pokemon-ruby').areas.items.slots.slice(0, 3).map(slot => slot.itemKey), ['potion', 'antidote', null])
  assert.throws(() => inventory.addPokemonItemToSave(save, 'pokemon-ruby', { area: 'key-items', itemKey: 'mach-bike', quantity: 1 }))
  assert.throws(() => inventory.addPokemonItemToSave(save, 'pokemon-ruby', { area: 'items', itemKey: 'tm01-focus-punch', quantity: 1 }))
  assert.throws(() => inventory.addPokemonItemToSave(save, 'pokemon-ruby', { area: 'items', itemKey: 'poke-ball', quantity: 1 }))
  const full = fixture('pokemon-ruby', 0)
  for (let slot = 0; slot < 20; slot++) writeItem(full, 'pokemon-ruby', 'items', slot, 14 + slot, 1, 0)
  refresh(full, 0xe000)
  assert.throws(() => inventory.addPokemonItemToSave(full, 'pokemon-ruby', { area: 'items', itemKey: 'potion', quantity: 1 }))
})

test('whole save-to-Hub withdrawal compacts the source area without changing other items', () => {
  const save = fixture('pokemon-ruby', 0)
  writeItem(save, 'pokemon-ruby', 'items', 0, 13, 1, 0)
  writeItem(save, 'pokemon-ruby', 'items', 1, 14, 4, 0)
  refresh(save, 0xe000)
  const result = inventory.removePokemonItemFromSave(save, 'pokemon-ruby', { area: 'items', slot: 0, quantity: 1 })
  assert.deepEqual(inventory.readPokemonItemInventory(result.saveBytes, 'pokemon-ruby').areas.items.slots.slice(0, 3).map(slot => slot.itemKey), ['antidote', null, null])
  assert.equal(inventory.readPokemonItemInventory(result.saveBytes, 'pokemon-ruby').areas.items.slots[0].quantity, 4)
})

test('whole-stack transfer compacts the source and appends to the destination without gaps', () => {
  const emerald = fixture('pokemon-emerald', 0xc3d4)
  const ruby = fixture('pokemon-ruby', 0)
  for (const [slot, nativeId] of [[0, 13], [1, 14], [2, 15]]) writeItem(emerald, 'pokemon-emerald', 'items', slot, nativeId, slot + 1, 0xc3d4)
  writeItem(ruby, 'pokemon-ruby', 'items', 0, 19, 1, 0)
  refresh(emerald, 0xe000); refresh(ruby, 0xe000)
  const result = inventory.transferPokemonItemsBetweenSaves(emerald, 'pokemon-emerald', ruby, 'pokemon-ruby', { area: 'items', fromSlot: 1, quantity: 2 })
  assert.deepEqual(inventory.readPokemonItemInventory(result.sourceSaveBytes, 'pokemon-emerald').areas.items.slots.slice(0, 3).map(slot => slot.itemKey), ['potion', 'burn-heal', null])
  assert.deepEqual(inventory.readPokemonItemInventory(result.destinationSaveBytes, 'pokemon-ruby').areas.items.slots.slice(0, 3).map(slot => slot.itemKey), ['full-restore', 'antidote', null])
  assert.equal(selectUnambiguousPokemonGen3SaveCopy(result.sourceSaveBytes).copyOffset, 0xe000)
  assert.equal(selectUnambiguousPokemonGen3SaveCopy(result.destinationSaveBytes).copyOffset, 0xe000)
})

test('inserts a new ordinary item at the drop position and shifts occupied slots without gaps', () => {
  const source = fixture('pokemon-ruby', 0)
  const destination = fixture('pokemon-sapphire', 0)
  writeItem(source, 'pokemon-ruby', 'pc', 0, 13, 2, 0)
  writeItem(destination, 'pokemon-sapphire', 'pc', 0, 14, 1, 0)
  writeItem(destination, 'pokemon-sapphire', 'pc', 1, 19, 1, 0)
  refresh(source, 0xe000); refresh(destination, 0xe000)
  const result = inventory.transferPokemonItemsBetweenSaves(source, 'pokemon-ruby', destination, 'pokemon-sapphire',
    { area: 'pc', fromSlot: 0, toSlot: 0, quantity: 2 })
  assert.deepEqual(inventory.readPokemonItemInventory(result.destinationSaveBytes, 'pokemon-sapphire').areas.pc.slots.slice(0, 4).map(slot => slot.nativeId), [13, 14, 19, 0])
})

test('cross-save transfer refuses HMs, key items, full stacks and gapped inventories', () => {
  const source = fixture('pokemon-emerald', 0xc3d4)
  const destination = fixture('pokemon-ruby', 0)
  writeItem(source, 'pokemon-emerald', 'tm-hm', 0, 339, 1, 0xc3d4)
  writeItem(source, 'pokemon-emerald', 'key-items', 0, 262, 1, 0xc3d4)
  writeItem(source, 'pokemon-emerald', 'items', 0, 13, 1, 0xc3d4)
  writeItem(destination, 'pokemon-ruby', 'items', 0, 13, 99, 0)
  refresh(source, 0xe000); refresh(destination, 0xe000)
  for (const area of ['tm-hm', 'key-items', 'items']) assert.throws(() => inventory.transferPokemonItemsBetweenSaves(source, 'pokemon-emerald', destination, 'pokemon-ruby', { area, fromSlot: 0, quantity: 1 }))
  const gapped = Buffer.from(destination)
  writeItem(gapped, 'pokemon-ruby', 'items', 2, 14, 1, 0)
  refresh(gapped, 0xe000)
  assert.throws(() => inventory.transferPokemonItemsBetweenSaves(source, 'pokemon-emerald', gapped, 'pokemon-ruby', { area: 'items', fromSlot: 0, quantity: 1 }))
})

test('rejects invalid requests and ambiguous saves without changing input', () => {
  const save = fixture('pokemon-firered', 0xc3d4)
  writeItem(save, 'pokemon-firered', 'items', 0, 13, 5, 0xc3d4)
  refresh(save, 0xe000)
  const before = Buffer.from(save)
  const badRequests = [
    ['pokemon-crystal', { area: 'items', slot: 0, quantity: 1 }],
    ['pokemon-firered', { area: 'missing', slot: 0, quantity: 1 }],
    ['pokemon-firered', { area: 'items', slot: -1, quantity: 1 }],
    ['pokemon-firered', { area: 'items', slot: 42, quantity: 1 }],
    ['pokemon-firered', { area: 'items', slot: 0, quantity: 0 }],
    ['pokemon-firered', { area: 'items', slot: 0, quantity: 6 }],
    ['pokemon-firered', { area: 'items', slot: 1, quantity: 1 }],
  ]
  for (const [title, request] of badRequests) assert.throws(() => inventory.removePokemonItemFromSave(save, title, request))
  assert.deepEqual(save, before)

  const tied = Buffer.from(save)
  for (let section = 0; section < 14; section++) tied.writeUInt32LE(2, physicalOffset(0, section) + 0xffc)
  assert.throws(() => inventory.readPokemonItemInventory(tied, 'pokemon-firered'), /ambiguous/i)
  assert.throws(() => inventory.removePokemonItemFromSave(tied, 'pokemon-firered', { area: 'items', slot: 0, quantity: 1 }), /ambiguous/i)
})

const rubyFixture = new URL('../../test-data/Pokemon Ruby.sav', import.meta.url)
test('reads and removes an item from an in-memory copy of the real Ruby fixture', { skip: !existsSync(rubyFixture) }, () => {
  const originalFile = readFileSync(rubyFixture)
  const save = Buffer.from(originalFile.subarray(0, 0x20000))
  const before = Buffer.from(save)
  const pc = inventory.readPokemonItemInventory(save, 'pokemon-ruby').areas.pc
  assert.deepEqual(pc.slots[0], { index: 0, nativeId: 13, itemKey: 'potion', quantity: 1 })
  const { saveBytes } = inventory.removePokemonItemFromSave(save, 'pokemon-ruby', { area: 'pc', slot: 0, quantity: 1 })
  assert.equal(inventory.readPokemonItemInventory(saveBytes, 'pokemon-ruby').areas.pc.freeSlots, pc.freeSlots + 1)
  assert.deepEqual(save, before)
  assert.deepEqual(readFileSync(rubyFixture), originalFile)
})

function fixture(title, key) {
  const bytes = Buffer.alloc(0x20000)
  for (const [copy, saveIndex] of [[0, 1], [0xe000, 2]]) {
    for (let section = 0; section < 14; section++) {
      const offset = physicalOffset(copy, section)
      bytes.writeUInt16LE(section, offset + 0xff4)
      bytes.writeUInt32LE(0x08012025, offset + 0xff8)
      bytes.writeUInt32LE(saveIndex, offset + 0xffc)
    }
    if (key) bytes.writeUInt32LE(0xa1b2c3d4, physicalOffset(copy, 0) + (title === 'pokemon-emerald' ? 0x0ac : 0x0f20))
    refresh(bytes, copy)
  }
  return bytes
}

function writeItem(bytes, title, area, slot, nativeId, quantity, key) {
  const offset = offsets[title][areaIds.indexOf(area)] + slot * 4
  const address = largeAddress(0xe000, offset)
  bytes.writeUInt16LE(nativeId, address)
  bytes.writeUInt16LE(area === 'pc' ? quantity : quantity ^ key, address + 2)
}

function physicalOffset(copy, section) { return copy + ((section * 5 + 3) % 14) * 0x1000 }
function largeAddress(copy, offset) { return physicalOffset(copy, 1 + Math.floor(offset / 0xf80)) + offset % 0xf80 }
function refresh(bytes, copy) {
  for (let section = 0; section < 14; section++) {
    const start = physicalOffset(copy, section)
    const length = section === 0 ? 3884 : section === 13 ? 2000 : 3968
    let sum = 0
    for (let offset = 0; offset < length; offset += 4) sum = (sum + bytes.readUInt32LE(start + offset)) >>> 0
    bytes.writeUInt16LE(((sum & 0xffff) + (sum >>> 16)) & 0xffff, start + 0xff6)
  }
}
