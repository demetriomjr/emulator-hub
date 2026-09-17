import assert from 'node:assert/strict'
import { test } from 'node:test'

import { getProfilePickerPlacement } from './profile-picker-placement.mjs'

test('places a low card profile picker upward within the available viewport space', () => {
  assert.deepEqual(getProfilePickerPlacement({ left: 1432, top: 617, bottom: 665 }, { width: 1920, height: 900 }), {
    left: 1432,
    bottom: 295,
    maxHeight: 601,
  })
})

test('places a high card profile picker downward within the available viewport space', () => {
  assert.deepEqual(getProfilePickerPlacement({ left: 292, top: 200, bottom: 248 }, { width: 1920, height: 900 }), {
    left: 292,
    top: 260,
    maxHeight: 636,
  })
})

test('keeps the profile picker centered on a narrow viewport', () => {
  assert.equal(getProfilePickerPlacement({ left: 56, top: 300 }, { width: 390, height: 844 }), null)
})
