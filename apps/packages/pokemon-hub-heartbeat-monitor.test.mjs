import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createPokemonHubHeartbeatMonitor } from './pokemon-hub-heartbeat-monitor.mjs'

test('expires the client session after three consecutive failed heartbeats', async () => {
  const monitor = createPokemonHubHeartbeatMonitor()
  const unavailable = new Error('Workspace session is invalid.')
  const heartbeat = async () => { throw unavailable }

  assert.deepEqual(await monitor.observe(heartbeat), { status: 'retrying', failures: 1 })
  assert.deepEqual(await monitor.observe(heartbeat), { status: 'retrying', failures: 2 })
  assert.deepEqual(await monitor.observe(heartbeat), { status: 'expired', failures: 3, error: unavailable })
})

test('resets failed-heartbeat attempts after the backend responds', async () => {
  const monitor = createPokemonHubHeartbeatMonitor()
  const unavailable = new Error('Workspace session is invalid.')

  await monitor.observe(async () => { throw unavailable })
  await monitor.observe(async () => {})

  assert.deepEqual(await monitor.observe(async () => { throw unavailable }), { status: 'retrying', failures: 1 })
})

test('waits for an active request before sending the pending heartbeat', async () => {
  const monitor = createPokemonHubHeartbeatMonitor()
  let releaseRequest
  const requestFinished = new Promise(resolve => { releaseRequest = resolve })
  let heartbeats = 0

  const pending = monitor.observe(async () => { heartbeats += 1 }, {
    waitUntilReady: async () => { await requestFinished; return true },
  })

  await new Promise(resolve => setImmediate(resolve))
  assert.equal(heartbeats, 0)
  releaseRequest()
  assert.deepEqual(await pending, { status: 'healthy' })
  assert.equal(heartbeats, 1)
})

test('does not count a cancelled pending heartbeat as a transport failure', async () => {
  const monitor = createPokemonHubHeartbeatMonitor()
  const unavailable = new Error('connection lost')

  assert.deepEqual(await monitor.observe(async () => { throw unavailable }), { status: 'retrying', failures: 1 })
  assert.deepEqual(await monitor.observe(async () => {}, { waitUntilReady: async () => false }), { status: 'cancelled' })
  assert.deepEqual(await monitor.observe(async () => { throw unavailable }), { status: 'retrying', failures: 2 })
})
