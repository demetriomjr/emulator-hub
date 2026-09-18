import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isNarrowPortraitViewport } from './mobile-viewport.mjs'

test('recognizes the iPhone portrait viewport reported by client diagnostics', () => {
  assert.equal(isNarrowPortraitViewport({ width: 390, height: 668 }), true)
  assert.equal(isNarrowPortraitViewport({ width: 668, height: 390 }), false)
  assert.equal(isNarrowPortraitViewport({ width: 900, height: 1200 }), false)
})
