import assert from 'node:assert/strict'
import test from 'node:test'
import { observeEmulatorSaveFiles } from './emulator-save-events.mjs'

test('observes EmulatorJS battery-save events and copies valid byte payloads', async () => {
  let handler
  const emulator = { on(name, callback) { assert.equal(name, 'saveSaveFiles'); handler = callback } }
  const received = []
  assert.equal(observeEmulatorSaveFiles(emulator, bytes => received.push([...bytes])), true)

  const eventBytes = new Uint8Array([1, 2, 3])
  const pending = handler(eventBytes)
  eventBytes[0] = 9
  await pending
  await handler(null)
  await handler(new Uint8Array())

  assert.deepEqual(received, [[1, 2, 3]])
})

test('does not subscribe when the emulator event API or callback is missing', () => {
  assert.equal(observeEmulatorSaveFiles(null, () => {}), false)
  assert.equal(observeEmulatorSaveFiles({}, () => {}), false)
  assert.equal(observeEmulatorSaveFiles({ on() {} }, null), false)
})
