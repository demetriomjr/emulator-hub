import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { closePlayerOriginProxies, createPlayerOriginProxyServer, startPlayerOriginProxies } from './scripts/player-origin-proxy.mjs'
import { frontendEventsMiddleware } from './server/frontend-events-vite.mjs'

test('player proxy preserves the player Host so its frontend collector accepts its Origin', async () => {
  const events = []
  const handler = frontendEventsMiddleware({ output: value => events.push(JSON.parse(value)) })
  const upstream = createServer((request, response) => handler(request, response, () => response.writeHead(404).end()))
  await new Promise(done => upstream.listen(0, '127.0.0.1', done))
  const proxy = createPlayerOriginProxyServer({ targetOrigin: `http://127.0.0.1:${upstream.address().port}` })
  await new Promise(done => proxy.listen(0, '127.0.0.1', done))
  try {
    const origin = `http://127.0.0.1:${proxy.address().port}`
    const response = await fetch(`${origin}/_frontend/events`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'game-asset', source: 'player', sessionId: 'session', phase: 'player-rom-ready' }) })
    assert.equal(response.status, 204)
    assert.equal(events.length, 1)
  } finally { await new Promise(done => proxy.close(done)); await new Promise(done => upstream.close(done)) }
})

test('player origin proxy serves the same document and forwards cookies', async () => {
  const upstream = createServer((request, response) => {
    assert.equal(request.url, '/player.html?slot=0')
    assert.equal(request.headers.cookie, 'emulator_hub_device=existing')
    response.writeHead(200, { 'Content-Type': 'text/html', 'Document-Isolation-Policy': 'isolate-and-require-corp' })
    response.end('player document')
  })
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve))
  const targetOrigin = `http://127.0.0.1:${upstream.address().port}`
  const proxy = createPlayerOriginProxyServer({ targetOrigin })
  try {
    await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve))
    const result = await fetch(`http://127.0.0.1:${proxy.address().port}/player.html?slot=0`, { headers: { cookie: 'emulator_hub_device=existing' } })
    assert.equal(result.status, 200)
    assert.equal(result.headers.get('document-isolation-policy'), 'isolate-and-require-corp')
    assert.equal(await result.text(), 'player document')
  } finally {
    await new Promise(resolve => proxy.close(resolve))
    await new Promise(resolve => upstream.close(resolve))
  }
})

test('development starts nine independent player listeners for the same upstream', async () => {
  const upstream = createServer((_request, response) => { response.end('shared frontend') })
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve))
  let servers = []
  try {
    servers = await startPlayerOriginProxies({ targetOrigin: `http://127.0.0.1:${upstream.address().port}`, ports: Array(9).fill(0) })
    const ports = servers.map(server => server.address().port)
    assert.equal(new Set(ports).size, 9)
    const bodies = await Promise.all(ports.map(async port => (await fetch(`http://127.0.0.1:${port}/player.html`)).text()))
    assert.deepEqual(bodies, Array(9).fill('shared frontend'))
  } finally {
    await closePlayerOriginProxies(servers)
    await new Promise(resolve => upstream.close(resolve))
  }
})
