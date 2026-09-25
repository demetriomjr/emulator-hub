import assert from 'node:assert/strict'
import test from 'node:test'
import { requestPlayerFrame } from './player-frame-request.mjs'

test('a player reply requires matching origin, frame, session and request', async () => {
  let receive
  let message
  const target = { postMessage(value) { message = value } }
  const browser = {
    location: { origin: 'https://hub.example' },
    setTimeout() { return 1 }, clearTimeout() {},
    addEventListener(_name, listener) { receive = listener },
    removeEventListener() { receive = null },
  }
  const pending = requestPlayerFrame({ frame: { contentWindow: target }, browser, sessionId: 's1', type: 'close', replyType: 'closed' })
  let completed = false
  pending.then(() => { completed = true })
  for (const variant of [
    { origin: 'https://other.example', source: target, data: { type: 'closed', requestId: message.requestId, sessionId: 's1' } },
    { origin: 'https://hub.example', source: {}, data: { type: 'closed', requestId: message.requestId, sessionId: 's1' } },
    { origin: 'https://hub.example', source: target, data: { type: 'closed', requestId: message.requestId, sessionId: 's2' } },
    { origin: 'https://hub.example', source: target, data: { type: 'closed', requestId: 'old', sessionId: 's1' } },
  ]) {
    receive(variant)
    await Promise.resolve()
    assert.equal(completed, false)
  }
  receive({ origin: 'https://hub.example', source: target, data: { type: 'closed', requestId: message.requestId, sessionId: 's1', ok: true } })
  assert.equal((await pending).ok, true)
  assert.equal(receive, null)
})

test('player failures are returned to caller', async () => {
  let receive
  const target = { postMessage(message) { queueMicrotask(() => receive({ origin: 'https://hub.example', source: target, data: { type: 'cleared', requestId: message.requestId, sessionId: 's1', ok: false, error: 'IndexedDB failed' } })) } }
  const browser = { location: { origin: 'https://hub.example' }, setTimeout() { return 1 }, clearTimeout() {}, addEventListener(_name, listener) { receive = listener }, removeEventListener() {} }
  await assert.rejects(requestPlayerFrame({ frame: { contentWindow: target }, browser, sessionId: 's1', type: 'clear', replyType: 'cleared' }), /IndexedDB failed/)
})

test('a cross-origin player uses its own frame origin for requests and replies', async () => {
  let receive
  let sentOrigin
  let sentMessage
  const target = { postMessage(message, origin) { sentMessage = message; sentOrigin = origin } }
  const browser = { location: { origin: 'http://localhost:5174' }, setTimeout() { return 1 }, clearTimeout() {}, addEventListener(_name, listener) { receive = listener }, removeEventListener() {} }
  const pending = requestPlayerFrame({ frame: { src: 'http://localhost:5175/player.html', contentWindow: target }, browser, sessionId: 's1', type: 'close', replyType: 'closed' })
  assert.equal(sentOrigin, 'http://localhost:5175')
  receive({ origin: 'http://localhost:5175', source: target, data: { type: 'closed', requestId: sentMessage.requestId, sessionId: 's1', ok: true } })
  assert.equal((await pending).ok, true)
})
