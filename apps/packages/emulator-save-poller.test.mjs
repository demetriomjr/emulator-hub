import assert from 'node:assert/strict'
import test from 'node:test'
import { startEmulatorSavePolling } from './emulator-save-poller.mjs'

test('flushes changed battery data through the EmulatorJS save event only while the game is running', () => {
  const ticks = []
  const cleared = []
  let saveFileReads = 0
  let saveFileFlushes = 0
  const emulator = {
    started: false,
    gameManager: {
      getSaveFile(save) {
        assert.equal(save, false)
        saveFileReads += 1
        return new Uint8Array(128 * 1024)
      },
      saveSaveFiles() { saveFileFlushes += 1 },
    },
  }

  const stop = startEmulatorSavePolling(emulator, {
    setIntervalFn(callback, delay) {
      ticks.push({ callback, delay })
      return 'timer-id'
    },
    clearIntervalFn(id) { cleared.push(id) },
  })

  assert.equal(saveFileReads, 1)
  assert.equal(ticks[0].delay, 3_000)
  ticks[0].callback()
  assert.equal(saveFileFlushes, 0)
  emulator.started = true
  ticks[0].callback()
  assert.equal(saveFileFlushes, 1)

  stop()
  assert.deepEqual(cleared, ['timer-id'])
})

test('does not start polling when EmulatorJS has no save API', () => {
  assert.equal(startEmulatorSavePolling({ gameManager: {} }), null)
})
