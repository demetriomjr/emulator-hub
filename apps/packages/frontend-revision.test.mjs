import assert from 'node:assert/strict'
import { test } from 'node:test'
import { shouldReloadForFrontendRevision } from './frontend-revision.mjs'

test('reloads only after the frontend document revision changes', () => {
  assert.equal(shouldReloadForFrontendRevision(null, 'W/"first"'), false)
  assert.equal(shouldReloadForFrontendRevision('W/"first"', 'W/"first"'), false)
  assert.equal(shouldReloadForFrontendRevision('W/"first"', 'W/"next"'), true)
  assert.equal(shouldReloadForFrontendRevision('W/"first"', null), false)
})
