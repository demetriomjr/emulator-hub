import assert from 'node:assert/strict'
import test from 'node:test'
import { createHubServer } from '../server.mjs'
import { createMemoryRedisPersistence } from '../../packages/redis-persistence.mjs'

test('debugging environment is a persisted singleton, defaults off, and validates operator updates', async () => {
  const persistence = createMemoryRedisPersistence()
  let server
  const start = async () => {
    server = createHubServer({ persistence, backupToken: 'test-operator' })
    await new Promise(done => server.listen(0, '127.0.0.1', done))
    return `http://127.0.0.1:${server.address().port}/api/debug/environment`
  }
  const close = () => new Promise(done => { server.closeAllConnections(); server.close(done) })
  try {
    let url = await start()
    assert.deepEqual(await (await fetch(url)).json(), { rngDebugLogging: false })
    const update = (body, token = 'test-operator') => fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) })
    assert.equal((await update({ rngDebugLogging: true }, 'wrong')).status, 401)
    assert.equal((await update({ rngDebugLogging: 'true' })).status, 400)
    assert.equal((await update({ rngDebugLogging: true, unrelated: true })).status, 400)
    assert.equal((await update({ rngDebugLogging: true })).status, 200)
    await close(); url = await start()
    assert.deepEqual(await (await fetch(url)).json(), { rngDebugLogging: true })
    assert.equal((await update({ rngDebugLogging: false })).status, 200)
    assert.deepEqual(await (await fetch(url)).json(), { rngDebugLogging: false })
    assert.deepEqual(await persistence.keys('debugging-environment'), ['debugging-environment'])
  } finally { await close() }
})

