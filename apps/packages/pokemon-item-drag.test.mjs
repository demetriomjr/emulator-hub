import test from 'node:test'
import assert from 'node:assert/strict'
import { getPokemonItemReorderIntent, getPokemonItemTransferIntent } from './pokemon-item-drag.mjs'

const slots = Array.from({ length: 5 }, (_, index) => ({ index, nativeId: index < 3 ? index + 1 : 0, itemKey: index < 3 ? 'potion' : null }))
const inventory = { status: 'ready', title: 'pokemon-emerald', saveRevision: 7, areas: { items: { slots, issues: [] }, berries: { slots, issues: [] } } }
const source = { kind: 'item', gameId: 'emerald', profileId: 'may', area: 'items', slot: 0 }

test('forms a reorder intent for an occupied swap and an empty tail drop', () => {
  assert.deepEqual(getPokemonItemReorderIntent(source, { ...source, slot: 1 }, inventory), { area: 'items', fromSlot: 0, toSlot: 1, expectedSaveRevision: 7 })
  assert.deepEqual(getPokemonItemReorderIntent(source, { ...source, slot: 4 }, inventory), { area: 'items', fromSlot: 0, toSlot: 4, expectedSaveRevision: 7 })
})

test('ignores blocked areas, other saves, empty sources and invalid inventories', () => {
  assert.equal(getPokemonItemReorderIntent(source, { ...source, area: 'berries' }, inventory), null)
  assert.equal(getPokemonItemReorderIntent(source, { ...source, profileId: 'brendan' }, inventory), null)
  assert.equal(getPokemonItemReorderIntent({ ...source, slot: 4 }, source, inventory), null)
  assert.equal(getPokemonItemReorderIntent(source, { ...source, slot: 0 }, inventory), null)
  assert.equal(getPokemonItemReorderIntent(source, { ...source, slot: 2 }, { ...inventory, title: 'pokemon-firered' }), null)
  assert.equal(getPokemonItemReorderIntent(source, { ...source, slot: 2 }, { ...inventory, areas: { items: { slots: [slots[0], slots[3], slots[2], slots[4], slots[4]], issues: [] } } }), null)
})

test('previews a cross-save item transfer using the source area even when the destination tab differs', () => {
  const sourceLayout = { itemInventory: { ...inventory, title: 'pokemon-ruby', areas: { items: { slots: [{ ...slots[0], quantity: 10 }, ...slots.slice(1)], issues: [] } } }, transferCapabilities: { ordinaryTradeReady: true } }
  const destinationLayout = { itemInventory: { status: 'ready', title: 'pokemon-sapphire', saveRevision: 9,
    areas: { items: { slots: [{ index: 0, nativeId: 13, itemKey: 'potion', quantity: 90 }, { index: 1, nativeId: 0, itemKey: null, quantity: 0 }], maxPerStack: 99, issues: [] } } },
    transferCapabilities: { ordinaryTradeReady: true } }
  const sourceLocation = { ...source, area: 'items', slot: 0 }
  const destinationLocation = { ...source, gameId: 'sapphire', profileId: 'brendan', area: 'pc', slot: 0 }
  const preview = getPokemonItemTransferIntent(sourceLocation, destinationLocation, sourceLayout, destinationLayout)
  assert.equal(preview.area, 'items')
  assert.equal(preview.maxQuantity, 9)
  assert.equal(preview.destinationExisting, 90)
  assert.equal(preview.itemKey, 'potion')
})

test('cross-save item preview refuses a blocked trade, HM and full destination', () => {
  const sourceLayout = { itemInventory: { ...inventory, title: 'pokemon-ruby' }, transferCapabilities: { ordinaryTradeReady: false } }
  const destinationLayout = { itemInventory: { ...inventory, title: 'pokemon-sapphire' }, transferCapabilities: { ordinaryTradeReady: true } }
  const destinationLocation = { ...source, gameId: 'sapphire', profileId: 'brendan' }
  assert.equal(getPokemonItemTransferIntent(source, destinationLocation, sourceLayout, destinationLayout), null)
  const hmLayout = { ...sourceLayout, itemInventory: { ...sourceLayout.itemInventory, areas: { 'tm-hm': { slots: [{ index: 0, nativeId: 339, itemKey: 'hm01-cut', quantity: 1 }], issues: [] } } } }
  assert.equal(getPokemonItemTransferIntent({ ...source, area: 'tm-hm' }, destinationLocation, hmLayout, destinationLayout), null)
})
