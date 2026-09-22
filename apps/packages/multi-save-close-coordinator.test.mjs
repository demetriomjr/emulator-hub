import test from 'node:test'
import assert from 'node:assert/strict'
import { createMultiSaveCloseCoordinator } from './multi-save-close-coordinator.mjs'

test('starts all save tasks in parallel and retries a transient failure independently', async () => {
  const started = []
  const attempts = new Map()
  const updates = []
  const gates = new Map()
  const tasks = ['red', 'blue', 'green'].map(id => ({
    id,
    label: id,
    async run() {
      started.push(id)
      const count = (attempts.get(id) ?? 0) + 1
      attempts.set(id, count)
      if (id === 'blue' && count === 1) {
        await new Promise(resolve => { gates.set(id, resolve) })
        const error = new Error('temporary')
        error.transient = true
        throw error
      }
      return { id }
    },
  }))
  const promise = createMultiSaveCloseCoordinator({ tasks, retry: { maxAttempts: 2, delays: [0] }, onUpdate: rows => updates.push(rows) }).run()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(started.sort(), ['blue', 'green', 'red'])
  assert.equal(updates.at(-1).find(row => row.id === 'blue').status, 'processing')
  gates.get('blue')()
  const result = await promise
  assert.deepEqual(result.map(row => row.status), ['saved', 'saved', 'saved'])
  assert.equal(attempts.get('blue'), 2)
  assert.ok(updates.some(rows => rows.find(row => row.id === 'blue').status === 'retrying'))
})

test('keeps terminal failures visible and retries only failed rows on manual retry', async () => {
  let count = 0
  const coordinator = createMultiSaveCloseCoordinator({
    tasks: [{ id: 'broken', label: 'Broken', async run() { count += 1; throw new Error('bad') } }],
    retry: { maxAttempts: 1, delays: [0] },
  })
  const failed = await coordinator.run()
  assert.equal(failed[0].status, 'failed')
  const retried = await coordinator.retryFailed()
  assert.equal(retried[0].status, 'failed')
  assert.equal(count, 2)
})

