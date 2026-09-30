import assert from 'node:assert/strict'
import test from 'node:test'

import { projectPokemonItemTransfers } from './pokemon-item-transfer-projection.mjs'

const empty = index => ({ index, nativeId: 0, itemKey: null, quantity: 0 })
const item = (index, nativeId, itemKey, quantity) => ({ index, nativeId, itemKey, quantity })
const source = { kind: 'item', gameId: 'ruby', profileId: 'ruby-save', area: 'items', slot: 0 }
const destination = { kind: 'item', gameId: 'sapphire', profileId: 'sapphire-save', area: 'items', slot: 0 }
const layout = (title, slots) => ({ itemInventory: { status: 'ready', title, saveRevision: 1, areas: { items: { capacity: slots.length, maxPerStack: 99, freeSlots: slots.filter(slot => !slot.nativeId).length, slots, issues: [] } } } })

test('projects queued transfers in order and removing a failed transfer restores its units', () => {
  const layouts = {
    'ruby:ruby-save': layout('pokemon-ruby', [item(0, 13, 'potion', 10), item(1, 14, 'antidote', 3), empty(2)]),
    'sapphire:sapphire-save': layout('pokemon-sapphire', [item(0, 13, 'potion', 90), empty(1), empty(2)]),
  }
  const first = { source, destination, area: 'items', itemKey: 'potion', quantity: 9, toSlot: 0 }
  const second = { source: { ...source, slot: 1 }, destination: { ...destination, slot: 1 }, area: 'items', itemKey: 'antidote', quantity: 3, toSlot: 1 }
  const projected = projectPokemonItemTransfers(layouts, [], [first, second])
  assert.deepEqual(projected.skipped, [])
  assert.equal(projected.layouts['ruby:ruby-save'].itemInventory.areas.items.slots[0].quantity, 1)
  assert.equal(projected.layouts['ruby:ruby-save'].itemInventory.areas.items.slots[1].nativeId, 0)
  assert.equal(projected.layouts['sapphire:sapphire-save'].itemInventory.areas.items.slots[0].quantity, 99)
  assert.equal(projected.layouts['sapphire:sapphire-save'].itemInventory.areas.items.slots[1].itemKey, 'antidote')
  const rolledBack = projectPokemonItemTransfers(layouts, [], [second])
  assert.equal(rolledBack.layouts['ruby:ruby-save'].itemInventory.areas.items.slots[0].quantity, 10)
  assert.equal(rolledBack.layouts['sapphire:sapphire-save'].itemInventory.areas.items.slots[0].quantity, 90)
  assert.equal(rolledBack.layouts['sapphire:sapphire-save'].itemInventory.areas.items.slots[1].quantity, 3)
  assert.equal(layouts['ruby:ruby-save'].itemInventory.areas.items.slots[0].quantity, 10)
})

test('projects save-to-Hub deposits with semantic stack merging and source compaction', () => {
  const layouts = { 'ruby:ruby-save': layout('pokemon-ruby', [item(0, 13, 'potion', 2), item(1, 14, 'antidote', 3), empty(2)]) }
  const profiles = [{ hubProfileId: 'hub-a', itemInventory: { revision: 0, schemaVersion: 1, slots: { 5: { itemKey: 'potion', quantity: 4 } } } }]
  const projected = projectPokemonItemTransfers(layouts, profiles, [{ source, destination: { kind: 'hub-item', hubProfileId: 'hub-a', slot: 0 }, area: 'items', itemKey: 'potion', quantity: 2, toSlot: 0 }])
  assert.equal(projected.layouts['ruby:ruby-save'].itemInventory.areas.items.slots[0].itemKey, 'antidote')
  assert.equal(projected.layouts['ruby:ruby-save'].itemInventory.areas.items.freeSlots, 2)
  assert.deepEqual(projected.profiles[0].itemInventory.slots, { 5: { itemKey: 'potion', quantity: 6 } })
})

test('repeated queued deposits cannot project beyond the destination stack limit', () => {
  const layouts = {
    'ruby:ruby-save': layout('pokemon-ruby', [item(0, 13, 'potion', 10), empty(1)]),
    'sapphire:sapphire-save': layout('pokemon-sapphire', [item(0, 13, 'potion', 90), empty(1)]),
  }
  const transfer = quantity => ({ source, destination, area: 'items', itemKey: 'potion', quantity, toSlot: 0 })
  const projected = projectPokemonItemTransfers(layouts, [], [transfer(4), transfer(5), transfer(1)])
  assert.equal(projected.layouts['ruby:ruby-save'].itemInventory.areas.items.slots[0].quantity, 1)
  assert.equal(projected.layouts['sapphire:sapphire-save'].itemInventory.areas.items.slots[0].quantity, 99)
  assert.equal(projected.skipped.length, 1)
})
