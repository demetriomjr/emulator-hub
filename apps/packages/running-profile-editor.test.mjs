import assert from 'node:assert/strict'
import test from 'node:test'
import { saveRunningProfileNames } from './running-profile-editor.mjs'

test('one save submits every open profile concurrently and reports each result', async () => {
  const rows = [
    { sessionId: 'a', gameId: 'red', profileId: 'p1', name: 'Red II' },
    { sessionId: 'b', gameId: 'blue', profileId: 'p2', name: 'Blue II' },
  ]
  const calls = []
  const result = await saveRunningProfileNames(rows, async (gameId, profileId, name) => {
    calls.push([gameId, profileId, name])
    if (profileId === 'p2') throw new Error('Unavailable')
    return { id: profileId, name }
  })
  assert.deepEqual(calls, [['red', 'p1', 'Red II'], ['blue', 'p2', 'Blue II']])
  assert.deepEqual(result.saved, [{ row: rows[0], updated: { id: 'p1', name: 'Red II' } }])
  assert.equal(result.failed.length, 1)
  assert.equal(result.failed[0].row, rows[1])
  assert.equal(result.failed[0].error.message, 'Unavailable')
})
