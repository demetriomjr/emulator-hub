import assert from 'node:assert/strict'
import test from 'node:test'

import { createFrontendViteConfiguration } from './vite.config.js'

test('frontend development server and backend proxy use frontend environment settings', () => {
  const configuration = createFrontendViteConfiguration({
    HOST: '127.0.0.1',
    PORT: '5174',
    BACKEND_URL: 'http://127.0.0.1:3001',
  })

  assert.equal(configuration.server.host, '127.0.0.1')
  assert.equal(configuration.server.port, 5174)
  assert.equal(configuration.server.proxy['/api'], 'http://127.0.0.1:3001')
  assert.equal(configuration.server.proxy['/roms'], 'http://127.0.0.1:3001')
})
