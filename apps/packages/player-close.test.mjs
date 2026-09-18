import assert from 'node:assert/strict'
import { test } from 'node:test'

import { closePlayerAfterSaveAttempts } from './player-close.mjs'

test('closes the player after every save attempt settles even when one save fails', async () => {
  const closed = []

  const result = await closePlayerAfterSaveAttempts({
    saveAttempts: [Promise.resolve(), Promise.reject(new Error('iframe timeout'))],
    close: () => closed.push('closed'),
  })

  assert.deepEqual(closed, ['closed'])
  assert.equal(result.failures.length, 1)
  assert.equal(result.failures[0].message, 'iframe timeout')
})
