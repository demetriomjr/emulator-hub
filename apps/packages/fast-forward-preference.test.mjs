import assert from 'node:assert/strict'
import test from 'node:test'
import { readFastForwardSpeed, writeFastForwardSpeed } from './fast-forward-preference.mjs'

test('reads only a supported fast-forward speed from the preference cookie', () => {
  assert.equal(readFastForwardSpeed('theme=dark; emulator_hub_fast_forward_speed=3.5'), 3.5)
  assert.equal(readFastForwardSpeed('emulator_hub_fast_forward_speed=99'), 1.5)
})

test('writes the speed as a persistent same-site Hub cookie', () => {
  const document = { cookie: '' }
  writeFastForwardSpeed(document, 4)
  assert.equal(document.cookie, 'emulator_hub_fast_forward_speed=4; Path=/; Max-Age=31536000; SameSite=Lax')
})
