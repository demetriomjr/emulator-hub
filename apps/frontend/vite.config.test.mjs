import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
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
  assert.equal(configuration.server.strictPort, true)
  assert.equal(configuration.server.proxy['/api'], 'http://127.0.0.1:3001')
  assert.equal(configuration.server.proxy['/roms'], 'http://127.0.0.1:3001')
  assert.ok(configuration.plugins.some(plugin => plugin.name === 'workspace-package-dependency-resolver'))
})

test('production build emits the standalone emulator player page', () => {
  const configuration = createFrontendViteConfiguration({})

  assert.deepEqual(Object.keys(configuration.build.rollupOptions.input).sort(), ['main', 'player'])
  assert.match(configuration.build.rollupOptions.input.main, /index\.html$/)
  assert.match(configuration.build.rollupOptions.input.player, /player\.html$/)
})

test('document isolation header applies only to the player document in dev and preview', () => {
  const plugin = createFrontendViteConfiguration({}).plugins.find(candidate => candidate.name === 'player-document-isolation')
  assert.ok(plugin)
  for (const hook of ['configureServer', 'configurePreviewServer']) {
    let middleware
    plugin[hook]({ middlewares: { use(value) { middleware = value } } })
    for (const [path, expected] of [['/player.html?sessionId=1', 'isolate-and-require-corp'], ['/index.html', undefined], ['/roms/game', undefined]]) {
      const headers = new Map()
      let continued = false
      middleware({ url: path }, { setHeader(name, value) { headers.set(name, value) } }, () => { continued = true })
      assert.equal(headers.get('Document-Isolation-Policy'), expected)
      assert.equal(continued, true)
    }
  }
})

test('production Nginx isolates the exact player document rather than the catalog', async () => {
  const config = await readFile(new URL('../../deploy/nginx.conf', import.meta.url), 'utf8')
  assert.match(config, /location = \/player\.html \{\s*add_header Document-Isolation-Policy "isolate-and-require-corp" always;/)
  assert.doesNotMatch(config, /location = \/index\.html \{[^}]*Document-Isolation-Policy/s)
})
