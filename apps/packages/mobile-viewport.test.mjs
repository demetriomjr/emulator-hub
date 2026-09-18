import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isMobileLandscapeViewport, isNarrowPortraitViewport } from './mobile-viewport.mjs'

test('recognizes the iPhone portrait viewport reported by client diagnostics', () => {
  assert.equal(isNarrowPortraitViewport({ width: 390, height: 668 }), true)
  assert.equal(isNarrowPortraitViewport({ width: 668, height: 390 }), false)
  assert.equal(isNarrowPortraitViewport({ width: 900, height: 1200 }), false)
})

test('recognizes the landscape player viewport used for mobile-only player actions', () => {
  assert.equal(isMobileLandscapeViewport({ width: 844, height: 390 }), true)
  assert.equal(isMobileLandscapeViewport({ width: 390, height: 844 }), false)
  assert.equal(isMobileLandscapeViewport({ width: 1920, height: 1080 }), false)
})
