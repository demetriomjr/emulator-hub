import assert from 'node:assert/strict'
import test from 'node:test'
import { createGlobalPlaybackToggle, createPlayerPlaybackToggle, applyPlayerPlayback, isEmulatorPlaying, selectPlayingSessions } from './player-playback.mjs'

function harness() {
  const frames = [{ contentWindow: {} }, { contentWindow: {} }, { contentWindow: {} }]
  const listeners = new Set()
  const sent = []
  const toggle = createGlobalPlaybackToggle({
    getFrames: () => frames,
    send: (frame, message) => sent.push({ frame, message }),
    getOrigin: frame => frame === frames[0] ? 'https://first.example' : 'https://other.example',
    hostWindow: {
      addEventListener(_type, listener) { listeners.add(listener) },
      removeEventListener(_type, listener) { listeners.delete(listener) },
      setTimeout, clearTimeout,
    },
    timeoutMs: 15,
  })
  const reply = (paused, overrides = {}) => {
    const requestId = sent[0].message.requestId
    for (const listener of listeners) listener({ origin: 'https://first.example', source: frames[0].contentWindow, data: { type: 'emulator-hub:playback-state', requestId, paused }, ...overrides })
  }
  return { frames, listeners, sent, toggle, reply }
}

test('uses the first rendered emulator to pause or play every rendered emulator', async () => {
  for (const [paused, action] of [[false, 'pause'], [true, 'play']]) {
    const { frames, sent, toggle, reply } = harness()
    const done = toggle()
    await Promise.resolve()
    assert.deepEqual(sent[0].frame, frames[0])
    reply(paused)
    await done
    assert.deepEqual(sent.slice(1).map(({ frame, message }) => [frame, message]), frames.map(frame => [frame, { type: 'emulator-hub:set-playback', action }]))
  }
})

test('rejects an untrusted reply and does nothing if the first emulator disappears', async () => {
  const { frames, sent, toggle, reply } = harness()
  const done = toggle()
  await Promise.resolve()
  reply(false, { origin: 'https://wrong.example' })
  assert.equal(sent.length, 1)
  frames.shift()
  reply(false)
  await done
  assert.equal(sent.length, 1)
})

test('does not change players if the first emulator does not answer', async () => {
  const { sent, toggle } = harness()
  await toggle()
  assert.equal(sent.length, 1)
})

test('applies explicit playback commands only to ready, unlocked emulators', () => {
  const actions = []
  const emulator = { gameManager: {}, pause: () => actions.push('pause'), play: () => actions.push('play') }
  assert.equal(applyPlayerPlayback(emulator, 'pause', { ready: true, locked: false }), true)
  assert.equal(applyPlayerPlayback(emulator, 'play', { ready: true, locked: true }), false)
  assert.equal(applyPlayerPlayback(emulator, 'play', { ready: false, locked: false }), false)
  assert.equal(applyPlayerPlayback(emulator, 'play', { ready: true, locked: false }), true)
  assert.deepEqual(actions, ['pause', 'play'])
})

test('requires a ready and explicitly running emulator for gameplay actions', () => {
  const emulator = { gameManager: {}, paused: false }
  assert.equal(isEmulatorPlaying(emulator, true), true)
  emulator.paused = true
  assert.equal(isEmulatorPlaying(emulator, true), false)
  emulator.paused = false
  assert.equal(isEmulatorPlaying(emulator, false), false)
  assert.equal(isEmulatorPlaying(null, true), false)
})

test('selects only running players for automations and skips unavailable replies', async () => {
  const sessions = [{ sessionId: 'running' }, { sessionId: 'paused' }, { sessionId: 'unavailable' }]
  const selected = await selectPlayingSessions(sessions, async session => {
    if (session.sessionId === 'unavailable') throw new Error('frame unavailable')
    return { paused: session.sessionId === 'paused' }
  })
  assert.deepEqual(selected, [sessions[0]])
})

test('toggles only the selected emulator from its own current playback state', async () => {
  const frames = new Map([['a', { contentWindow: {} }], ['b', { contentWindow: {} }]])
  const paused = new Map([['a', false], ['b', true]])
  const sent = []
  const toggle = createPlayerPlaybackToggle({
    getFrame: id => frames.get(id),
    getState: async id => ({ paused: paused.get(id) }),
    send: (frame, message) => sent.push([frame, message]),
  })
  assert.equal(await toggle('b'), true)
  assert.deepEqual(sent, [[frames.get('b'), { type: 'emulator-hub:set-playback', action: 'play' }]])
  assert.equal(await toggle('a'), true)
  assert.deepEqual(sent[1], [frames.get('a'), { type: 'emulator-hub:set-playback', action: 'pause' }])
})

test('ignores a playback reply after its emulator frame is replaced', async () => {
  const first = { contentWindow: {} }
  let frame = first
  let answer
  const sent = []
  const toggle = createPlayerPlaybackToggle({
    getFrame: () => frame,
    getState: () => new Promise(resolve => { answer = resolve }),
    send: (...args) => sent.push(args),
  })
  const pending = toggle('a')
  await Promise.resolve()
  frame = { contentWindow: {} }
  answer({ paused: false })
  assert.equal(await pending, false)
  assert.deepEqual(sent, [])
})
