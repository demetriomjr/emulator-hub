import assert from 'node:assert/strict'
import test from 'node:test'

import { parseExpectedRevisions, parseHubLocation } from './pokemon-hub-model.mjs'

test('accepts bounded Hub and game locations', () => {
  assert.deepEqual(parseHubLocation({ kind: 'hub', slot: 0 }), { kind: 'hub', slot: 0 })
  assert.deepEqual(
    parseHubLocation({ kind: 'game', gameId: 'pokemon-emerald', box: 13, slot: 29 }),
    { kind: 'game', gameId: 'pokemon-emerald', box: 13, slot: 29 },
  )
})

test('rejects locations outside Hub and Gen III PC bounds', () => {
  assert.throws(() => parseHubLocation({ kind: 'hub', slot: 30 }), /location/i)
  assert.throws(() => parseHubLocation({ kind: 'game', gameId: '../emerald', box: 0, slot: 0 }), /location/i)
  assert.throws(() => parseHubLocation({ kind: 'game', gameId: 'pokemon-emerald', box: 14, slot: 0 }), /location/i)
})

test('accepts positive game revisions and a non-negative Hub epoch', () => {
  assert.deepEqual(parseExpectedRevisions({ 'pokemon-emerald': 4 }, 0), {
    gameRevisions: { 'pokemon-emerald': 4 },
    hubEpoch: 0,
  })
  assert.throws(() => parseExpectedRevisions({ '../emerald': 4 }, 0), /revision/i)
  assert.throws(() => parseExpectedRevisions({ 'pokemon-emerald': 0 }, 0), /revision/i)
  assert.throws(() => parseExpectedRevisions({}, -1), /revision/i)
})
