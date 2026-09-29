import assert from 'node:assert/strict'
import test from 'node:test'
import { addHubItem, decodeHubItemLedger, encodeHubItemLedger, moveHubItem, removeHubItem } from './pokemon-hub-item-ledger.mjs'

const ledger = slots => ({ schemaVersion: 1, slots })

test('hub item ledger preserves gaps and merges semantic identity regardless of drop slot', () => {
  const current = ledger({ 0: { itemKey: 'potion', quantity: 7 }, 3: { itemKey: 'antidote', quantity: 2 } })
  const merged = addHubItem(current, { itemKey: 'potion', quantity: 4, toSlot: 3 })
  assert.deepEqual(merged.slots, { 0: { itemKey: 'potion', quantity: 11 }, 3: { itemKey: 'antidote', quantity: 2 } })
  const inserted = addHubItem(current, { itemKey: 'ether', quantity: 1, toSlot: 3 })
  assert.deepEqual(inserted.slots[1], { itemKey: 'ether', quantity: 1 })
  assert.deepEqual(inserted.slots[3], current.slots[3])
  assert.deepEqual(current.slots[0], { itemKey: 'potion', quantity: 7 })
})

test('hub item ledger uses an empty drop slot and leaves a gap after full withdrawal', () => {
  const current = ledger({ 0: { itemKey: 'potion', quantity: 7 }, 3: { itemKey: 'antidote', quantity: 2 } })
  const inserted = addHubItem(current, { itemKey: 'ether', quantity: 1, toSlot: 5 })
  assert.deepEqual(Object.keys(inserted.slots), ['0', '3', '5'])
  const partial = removeHubItem(inserted, { fromSlot: 0, quantity: 3 })
  assert.equal(partial.slots[0].quantity, 4)
  const removed = removeHubItem(partial, { fromSlot: 0, quantity: 4 })
  assert.deepEqual(Object.keys(removed.slots), ['3', '5'])
  assert.deepEqual(moveHubItem(removed, { fromSlot: 5, toSlot: 0 }).slots[0], { itemKey: 'ether', quantity: 1 })
})

test('hub item ledger rejects duplicate keys, unknown items and integer overflow', () => {
  assert.throws(() => encodeHubItemLedger(ledger({ 0: { itemKey: 'potion', quantity: 1 }, 2: { itemKey: 'potion', quantity: 2 } })))
  assert.throws(() => addHubItem(ledger({}), { itemKey: 'unknown-item', quantity: 1, toSlot: 0 }))
  assert.throws(() => addHubItem(ledger({ 0: { itemKey: 'potion', quantity: Number.MAX_SAFE_INTEGER } }), { itemKey: 'potion', quantity: 1, toSlot: 1 }))
  assert.deepEqual(decodeHubItemLedger(encodeHubItemLedger(ledger({ 2: { itemKey: 'potion', quantity: 10 } }))), ledger({ 2: { itemKey: 'potion', quantity: 10 } }))
})
