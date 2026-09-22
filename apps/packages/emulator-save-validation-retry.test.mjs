import assert from 'node:assert/strict'
import test from 'node:test'
import { validateSaveWithRetry } from './emulator-save-validation-retry.mjs'

test('rereads a rejected save after 800 ms and returns the validated fresh bytes', async () => {
  const initial = new Uint8Array([1])
  const fresh = new Uint8Array([2])
  const events = []
  let delayMs = null
  const result = await validateSaveWithRetry(initial, {
    validate: bytes => { if (bytes[0] !== 2) throw new Error('invalid'); return { saveIndex: 7 } },
    readCurrent: () => fresh,
    wait: async milliseconds => { delayMs = milliseconds },
    onAttempt: event => events.push(event),
  })

  assert.equal(delayMs, 800)
  assert.equal(result.bytes, fresh)
  assert.deepEqual(result.validation, { saveIndex: 7 })
  assert.deepEqual(events.map(event => event.valid), [false, true])
})

test('does not return or upload bytes that remain invalid after the reread', async () => {
  const events = []
  const result = await validateSaveWithRetry(new Uint8Array([1]), {
    validate: () => { throw new Error('invalid') },
    readCurrent: () => new Uint8Array([3]),
    wait: async milliseconds => assert.equal(milliseconds, 800),
    onAttempt: event => events.push(event),
  })

  assert.equal(result, null)
  assert.deepEqual(events.map(event => event.valid), [false, false])
})

test('accepts a valid first read without delaying or rereading', async () => {
  const bytes = new Uint8Array([2])
  let reread = false
  let delayed = false
  const result = await validateSaveWithRetry(bytes, {
    validate: () => 'valid',
    readCurrent: () => { reread = true; return null },
    wait: async () => { delayed = true },
  })

  assert.equal(result.bytes, bytes)
  assert.equal(result.validation, 'valid')
  assert.equal(reread, false)
  assert.equal(delayed, false)
})
