import assert from 'node:assert/strict'
import test from 'node:test'
const module = await import('./player-origin-asset-bridge.mjs').catch(() => ({}))
function fixture() {
  assert.equal(typeof module.createPlayerAssetRequestHandler, 'function', 'Session-scoped asset bridge must exist')
  const replies = [], loads = [], preparations = [], session = { sessionId: 'session-a', profileId: 'profile-a', gameId: 'game', leaseGeneration: 2 }
  const frame = { contentWindow: { postMessage: value => replies.push(value) } }
  let current = true
  const handler = module.createPlayerAssetRequestHandler({ launchLoader: async s => { loads.push(s); return { romUrl: '/roms/game', romSha256: 'a'.repeat(64) } },
    preparation: { async prepare(launch) { preparations.push(launch); return { bytes: new Uint8Array([1,2]), patchApplied: false } } }, isCurrent: () => current })
  const event = (operation, extra = {}) => ({ source: frame.contentWindow, origin: 'https://hub:8444', data: { type: 'emulator-hub:game-asset-request', requestId: 'request-a', sessionId: session.sessionId, profileId: session.profileId, gameId: session.gameId, generation: 2, operation, ...extra } })
  const call = e => handler(e, { frame, session, origin: 'https://hub:8444' })
  return { session, frame, replies, loads, preparations, event, call, close: () => { current = false } }
}
test('parent resolves the leased launch; players never choose URLs or hashes', async () => {
  const f = fixture()
  await f.call(f.event('get-launch'))
  const token = f.replies[0].value.launchToken
  await f.call(f.event('prepare-rom', { launchToken: token, url: 'https://evil/rom' }))
  assert.equal(f.loads.length, 1)
  assert.equal(f.preparations[0].romUrl, '/roms/game')
  assert.deepEqual(f.replies[1].value.bytes, new Uint8Array([1,2]))
})
for (const condition of ['source', 'origin', 'profileId', 'gameId', 'generation', 'sessionId']) test(`bridge rejects wrong ${condition}`, async () => {
  const f = fixture(), event = f.event('get-launch')
  if (condition === 'source') event.source = {}
  else if (condition === 'origin') event.origin = 'https://evil'
  else event.data[condition] = 'wrong'
  assert.equal(await f.call(event), false)
  assert.equal(f.loads.length, 0)
  assert.equal(f.replies.length, 0)
})
test('unknown token and closed session cannot deliver a ROM', async () => {
  const f = fixture()
  await f.call(f.event('prepare-rom', { launchToken: 'wrong' }))
  assert.equal(f.replies[0].ok, false)
  assert.equal(f.preparations.length, 0)
  f.close()
  await f.call(f.event('get-launch'))
  assert.equal(f.loads.length, 0)
})
test('session closed during download suppresses late delivery without aborting shared work', async () => {
  const f = fixture()
  await f.call(f.event('get-launch'))
  const waiting = f.call(f.event('prepare-rom', { launchToken: f.replies[0].value.launchToken }))
  f.close(); await waiting
  assert.equal(f.replies.length, 1)
})
test('client authenticates replies, rejects late ones and disposes timers', async () => {
  assert.equal(typeof module.createPlayerOriginAssetClient, 'function')
  const listeners = new Set(), outgoing = [], parent = { postMessage: m => outgoing.push(m) }
  const browser = { addEventListener: (_, f) => listeners.add(f), removeEventListener: (_, f) => listeners.delete(f), setTimeout, clearTimeout }
  const client = module.createPlayerOriginAssetClient({ browser, parent, hubOrigin: 'https://hub', sessionId: 'a', profileId: 'b', gameId: 'c', generation: 1, timeoutMs: 100 })
  const work = client.getLaunch()
  const reply = { type: 'emulator-hub:game-asset-response', requestId: outgoing[0].requestId, sessionId: 'a', ok: true, value: { launch: 'ok' } }
  for (const listener of listeners) listener({ source: {}, origin: 'https://evil', data: reply })
  for (const listener of listeners) listener({ source: parent, origin: 'https://hub', data: reply })
  assert.deepEqual(await work, { launch: 'ok' })
  const pending = client.prepareRom('token')
  client.dispose()
  await assert.rejects(pending, /closed/)
  assert.equal(listeners.size, 0)
  await assert.rejects(client.getLaunch(), /closed/)
})
