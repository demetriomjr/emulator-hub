import assert from 'node:assert/strict'
import { test } from 'node:test'

import { reclaimOwnBackend } from '../dev.mjs'

test('development supervisor leaves a non-Emulator Hub listener untouched', async () => {
  let terminated = false

  const result = await reclaimOwnBackend({
    legacyWatcherPids: async () => [],
    listenerPid: async () => 42000,
    request: async () => ({ headers: new Headers({ 'x-emulator-hub-backend': 'other-service' }) }),
    terminateTree: async () => { terminated = true },
  })

  assert.deepEqual(result, { status: 'foreign-listener', pid: 42000 })
  assert.equal(terminated, false)
})

test('development supervisor terminates only a listener identified as Emulator Hub', async () => {
  const terminated = []

  const result = await reclaimOwnBackend({
    legacyWatcherPids: async () => [],
    listenerPid: async () => 42000,
    request: async () => ({ headers: new Headers({ 'x-emulator-hub-backend': '1' }) }),
    terminateTree: async (pid) => { terminated.push(pid) },
    waitForPortRelease: async () => {},
  })

  assert.deepEqual(result, { status: 'reclaimed', pid: 42000, clearedWatchers: 0 })
  assert.deepEqual(terminated, [42000])
})

test('development supervisor clears a previous failed backend watcher before binding a port', async () => {
  const terminated = []
  let waitedForRelease = false

  const result = await reclaimOwnBackend({
    legacyWatcherPids: async () => [31001],
    listenerPid: async () => null,
    terminateTree: async (pid) => { terminated.push(pid) },
    waitForPortRelease: async () => { waitedForRelease = true },
  })

  assert.deepEqual(result, { status: 'available', clearedWatchers: 1 })
  assert.deepEqual(terminated, [31001])
  assert.equal(waitedForRelease, true)
})
