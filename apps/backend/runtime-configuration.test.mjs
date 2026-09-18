import assert from 'node:assert/strict'
import test from 'node:test'

import { backendListenConfiguration } from './runtime-configuration.mjs'

test('backend listener uses HOST and PORT from its environment', () => {
  assert.deepEqual(backendListenConfiguration({ HOST: '0.0.0.0', PORT: '3001' }), {
    host: '0.0.0.0',
    port: 3001,
  })
})

test('backend listener defaults to the documented local address', () => {
  assert.deepEqual(backendListenConfiguration({}), {
    host: '127.0.0.1',
    port: 3001,
  })
})
