import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

const hub = await readFile(new URL('./src/main.jsx', import.meta.url), 'utf8')
const player = await readFile(new URL('./src/player.js', import.meta.url), 'utf8')
const begin = hub.indexOf('function playerFrameUrl(session)')
const end = hub.indexOf('function ControlBinding(', begin)
const playerFrameUrl = runInNewContext(`${hub.slice(begin, end)}\nplayerFrameUrl`, {
  clientDiagnosticsOptions: { enabled: true, sessionId: 'debug-session' },
  appendClientDiagnosticsParameters: parameters => parameters,
  URLSearchParams,
})

const session = {
  gameId: 'game', profileId: 'profile', sessionId: 'lease-session', leaseGeneration: 3,
  initialFastForwardEnabled: true, initialFastForwardSpeed: 5, initialMuted: false,
  restoreRecovery: false, localRecoveryPrompt: false,
}

test('debug player launch keeps the normal core and lease identity without performance URL controls', () => {
  const url = new URL(playerFrameUrl(session), 'https://hub.example')
  assert.equal(url.searchParams.has('performanceCore'), false)
  assert.equal(url.searchParams.get('sessionId'), 'lease-session')
  assert.equal(url.searchParams.get('leaseGeneration'), '3')
  assert.match(player, /retryWithoutThreads: parameters\.get\('threadFallback'\) === '1'/)
})
