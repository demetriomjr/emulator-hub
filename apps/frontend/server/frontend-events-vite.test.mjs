import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { frontendEventsMiddleware } from './frontend-events-vite.mjs'
test('Vite middleware receives real HTTP events locally and never calls the API proxy', async () => {
  const records = []
  let nextCalls = 0
  const middleware = frontendEventsMiddleware({ output: json => records.push(JSON.parse(json)) })
  const server = createServer((request, response) => middleware(request, response, () => { nextCalls++; response.writeHead(418); response.end() }))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}`
  try {
    const event = { source: 'player', sessionId: 'dev', kind: 'rng-reset', rngValue: 42, seed: null }
    assert.equal((await fetch(url + '/_frontend/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(event) })).status, 204)
    assert.equal(nextCalls, 0)
    assert.equal(records[0].rngValue, 42)
    assert.equal((await fetch(url + '/_frontend/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'x'.repeat(20000) })).status, 413)
    assert.equal(records.length, 1)
    assert.equal((await fetch(url + '/api/games')).status, 418)
    assert.equal(nextCalls, 1)
  } finally { await new Promise(resolve => server.close(resolve)) }
})
