import assert from 'node:assert/strict'
import test from 'node:test'

import { getPokemonItemAreaView, getPokemonItemName } from './pokemon-item-view.mjs'

const areaIds = ['pc', 'items', 'key-items', 'poke-balls', 'tm-hm', 'berries']

function inventory(title, capacity) {
  return {
    status: 'ready', title,
    areas: Object.fromEntries(areaIds.map(id => [id, {
      capacity: id === 'items' ? capacity : 1,
      maxPerStack: 999,
      freeSlots: id === 'items' ? capacity - 1 : 1,
      slots: Array.from({ length: id === 'items' ? capacity : 1 }, (_, index) => id === 'items' && index === 0
        ? { index, nativeId: 13, itemKey: 'potion', quantity: 7 }
        : { index, nativeId: 0, itemKey: null, quantity: 0 }),
      issues: [],
    }])),
  }
}

test('projects one square per save slot, independently of the stack limit', () => {
  for (const [title, capacity] of [['pokemon-ruby', 20], ['pokemon-sapphire', 20], ['pokemon-emerald', 30], ['pokemon-firered', 42], ['pokemon-leafgreen', 42]]) {
    const view = getPokemonItemAreaView(inventory(title, capacity), 'items')
    assert.equal(view.slots.length, capacity, title)
    assert.equal(view.freeSlots, capacity - 1, title)
    assert.equal(view.slots[0].quantity, 7, title)
    assert.equal(view.areaIds.length, 6, title)
  }
})

test('keeps the six native areas in navigation order and title-specific labels', () => {
  const view = getPokemonItemAreaView(inventory('pokemon-firered', 42), 'tm-hm')
  assert.deepEqual(view.areaIds, areaIds)
  assert.equal(view.index, 4)
  assert.equal(view.label, 'TM Case')
  assert.equal(getPokemonItemAreaView(inventory('pokemon-emerald', 30), 'berries').label, 'Berries')
})

test('does not invent empty slots or item identities from incomplete data', () => {
  const incomplete = inventory('pokemon-emerald', 30)
  incomplete.areas.items.slots.pop()
  assert.equal(getPokemonItemAreaView(incomplete, 'items'), null)
  assert.equal(getPokemonItemName({ nativeId: 13, itemKey: 'potion' }), 'Potion')
  assert.equal(getPokemonItemName({ nativeId: 999, itemKey: null }), 'Item #999')
})
