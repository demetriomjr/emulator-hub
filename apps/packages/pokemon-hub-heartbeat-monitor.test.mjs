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
