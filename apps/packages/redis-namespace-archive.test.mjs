import test from 'node:test'
import assert from 'node:assert/strict'
import { captureRedisNamespace, restoreDevelopmentNamespace } from './redis-namespace-archive.mjs'

function fixture() {
 const data = new Map([
  ['emulator-hub:v1:binary', Buffer.from([0, 255, 128, 1])],
  ['emulator-hub:dev:old', Buffer.from('old')],
  ['emulator-hub:v10:untouched', Buffer.from('other')],
 ])
 const writes = []
 const client = {
  async scan(cursor, { MATCH }) { assert.equal(cursor,'0'); return {cursor:Buffer.from('0'),keys:[...data.keys()].filter(key => key.startsWith(MATCH.slice(0,-1))).map(key=>Buffer.from(key))} },
  async eval(_script, { keys: [key] }) { return [data.get(key), 'string', -1] },
  async del(keys) { for (const key of keys) { writes.push(key); data.delete(key) } },
  async restore(key, ttl, bytes) { writes.push(key); data.set(key, bytes); assert.equal(ttl, 0) },
 }
 return { client, data, writes }
}
test('copies exact binary values, replaces only dev and preserves the v1 original', async () => {
 const {client, data, writes} = fixture()
 const archive = await captureRedisNamespace(client, 'emulator-hub:v1')
 await restoreDevelopmentNamespace(client, archive, 'emulator-hub:dev')
 assert.deepEqual(data.get('emulator-hub:dev:binary'), Buffer.from([0,255,128,1]))
 assert.deepEqual(data.get('emulator-hub:v1:binary'), Buffer.from([0,255,128,1]))
 assert.equal(data.has('emulator-hub:dev:old'), false)
 assert.ok(data.has('emulator-hub:v10:untouched'))
 assert.ok(writes.every(key => key.startsWith('emulator-hub:dev:')))
})
test('refuses production targets and tampered archives before any mutation', async () => {
 const {client, writes} = fixture()
 const archive = await captureRedisNamespace(client, 'emulator-hub:v1')
 await assert.rejects(restoreDevelopmentNamespace(client, archive, 'emulator-hub:v1'), /development/)
 archive.records[0].dumpBase64 = Buffer.from('changed').toString('base64')
 await assert.rejects(restoreDevelopmentNamespace(client, archive, 'emulator-hub:dev'), /checksum/)
 assert.deepEqual(writes, [])
})
