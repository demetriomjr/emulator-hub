import assert from 'node:assert/strict'
import test from 'node:test'

import { getNextSaveBoxIndex, getPreviousSaveBoxIndex, getSaveBoxSlotPosition, getSavePartySlotPosition } from './pokemon-save-layout-grid.mjs'

test('numbers Party positions from one through six', () => {
  assert.deepEqual(Array.from({ length: 6 }, (_, index) => getSavePartySlotPosition(index, 6)), [1, 2, 3, 4, 5, 6])
})

test('numbers each Box continuously across its thirty positions', () => {
  assert.equal(getSaveBoxSlotPosition(0, 0, 30), 1)
  assert.equal(getSaveBoxSlotPosition(0, 29, 30), 30)
  assert.equal(getSaveBoxSlotPosition(1, 0, 30), 31)
  assert.equal(getSaveBoxSlotPosition(1, 29, 30), 60)
})

test('cycles Save Box navigation across the first and last Box', () => {
  assert.equal(getPreviousSaveBoxIndex(0, 14), 13)
  assert.equal(getNextSaveBoxIndex(13, 14), 0)
  assert.equal(getPreviousSaveBoxIndex(4, 14), 3)
  assert.equal(getNextSaveBoxIndex(4, 14), 5)
})
