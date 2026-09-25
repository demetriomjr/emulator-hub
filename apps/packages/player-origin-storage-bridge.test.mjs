import assert from 'node:assert/strict'
import test from 'node:test'
import { createPlayerOriginStorageClient, respondToPlayerStorageRequest } from './player-origin-storage-bridge.mjs'

test('hub storage bridge accepts only the active profile and game key', async () => {
  const records = new Map()
  const messages = []
  const frame = { contentWindow: { postMessage: (...args) => messages.push(args) } }
  const storage = {
    async put(key, value) { records.set(key, value) },
    async get(key) { return records.get(key) ?? null },
    async delete(key) { records.delete(key) },
    async deleteIfMatches(key, candidateId) { if (records.get(key)?.candidateId !== candidateId) return false; records.delete(key); return true },
  }
  const context = { frame, session: { sessionId: 'session', profileId: 'profile', gameId: 'game' }, storage, installationIdentity: { id: 'original', comparisonId: 'original' }, origin: 'http://localhost:5175' }
  assert.equal(await respondToPlayerStorageRequest({ data: { type: 'emulator-hub:local-storage-request', requestId: 'bad', sessionId: 'session', operation: 'put', key: 'other\0game', value: { state: new Uint8Array([1]) } } }, context), false)
  assert.equal(records.size, 0)
  assert.equal(await respondToPlayerStorageRequest({ data: { type: 'emulator-hub:local-storage-request', requestId: 'put', sessionId: 'session', operation: 'put', key: 'profile\0game', value: { candidateId: 'a' } } }, context), true)
  assert.equal(records.get('profile\0game').candidateId, 'a')
  assert.deepEqual(messages.at(-1), [{ type: 'emulator-hub:local-storage-response', requestId: 'put', sessionId: 'session', ok: true, value: undefined }, 'http://localhost:5175'])
  await respondToPlayerStorageRequest({ data: { type: 'emulator-hub:local-storage-request', requestId: 'identity', sessionId: 'session', operation: 'installation-identity' } }, context)
  assert.deepEqual(messages.at(-1)[0].value, { id: 'original', comparisonId: 'original' })
})

test('player storage client sends to exact hub origin and resolves only matching response', async () => {
  const listeners = new Map()
  const browser = { addEventListener: (type, fn) => listeners.set(type, fn), setTimeout: setTimeout, clearTimeout: clearTimeout }
  const sent = []
  const parent = { postMessage: (...args) => sent.push(args) }
  const client = createPlayerOriginStorageClient({ browser, parent, hubOrigin: 'http://localhost:5174', sessionId: 'session', profileId: 'profile', gameId: 'game' })
  const pending = client.storage.get('profile\0game')
  const [message, targetOrigin] = sent.at(-1)
  assert.equal(targetOrigin, 'http://localhost:5174')
  assert.equal(message.operation, 'get')
  listeners.get('message')({ source: parent, origin: 'http://localhost:5176', data: { type: 'emulator-hub:local-storage-response', requestId: message.requestId, sessionId: 'session', ok: true, value: 'wrong' } })
  listeners.get('message')({ source: parent, origin: 'http://localhost:5174', data: { type: 'emulator-hub:local-storage-response', requestId: message.requestId, sessionId: 'session', ok: true, value: { candidateId: 'a' } } })
  assert.deepEqual(await pending, { candidateId: 'a' })
  client.dispose()
})
