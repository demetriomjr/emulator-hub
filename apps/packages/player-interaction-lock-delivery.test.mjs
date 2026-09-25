import assert from 'node:assert/strict'
import { test } from 'node:test'
import { deliverPlayerInteractionLock } from './player-interaction-lock-delivery.mjs'

test('retries an unconfirmed lock or unlock and accepts the matching revision', async () => {
  let attempts = 0
  const delivered = await deliverPlayerInteractionLock({
    revision: 7,
    isCurrent: () => true,
    wait: async () => {},
    send: async () => {
      attempts += 1
      if (attempts < 3) throw new Error('timed out')
      return { revision: 7 }
    },
  })
  assert.equal(delivered, true)
  assert.equal(attempts, 3)
})

test('never retries a superseded request after its first failure', async () => {
  let current = true
  let attempts = 0
  const delivered = await deliverPlayerInteractionLock({
    revision: 4,
    isCurrent: () => current,
    wait: async () => {},
    send: async () => { attempts += 1; current = false; throw new Error('timed out') },
  })
  assert.equal(delivered, false)
  assert.equal(attempts, 1)
})

test('a stale acknowledgement does not count as a confirmed unlock', async () => {
  let attempts = 0
  const delivered = await deliverPlayerInteractionLock({
    revision: 9,
    isCurrent: () => true,
    wait: async () => {},
    send: async () => ({ revision: ++attempts === 1 ? 8 : 9 }),
  })
  assert.equal(delivered, true)
  assert.equal(attempts, 2)
})
