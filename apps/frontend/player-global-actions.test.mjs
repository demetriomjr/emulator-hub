import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { selectPlayingSessions } from '../packages/player-playback.mjs'
import { createPlayerTriggerActions } from '../packages/player-trigger-actions.mjs'

const source = await readFile(new URL('./src/main.jsx', import.meta.url), 'utf8')
const sessions = ['paused', 'running-a', 'running-b'].map(sessionId => ({ sessionId }))

function harness() {
  const sent = []
  const context = {
    activeSessions: sessions,
    activeSessionsRef: { current: sessions },
    focusedSessionId: 'paused', selectedPlayerSessionId: 'paused',
    huntActiveRef: { current: false }, snapshotRestoreRequestsRef: { current: {} },
    selectPlayingSessions,
    getPlayerPlaybackState: async sessionId => ({ paused: sessionId === 'paused' }),
    getPlayingSessions: () => selectPlayingSessions(context.activeSessionsRef.current, session => context.getPlayerPlaybackState(session.sessionId)),
    playerFrameForSession: sessionId => sessionId,
    configurePlayerFrame: (frame, message) => sent.push([frame.sessionId ?? frame, message.type]),
    setPlayerActionErrors: update => update({}),
    stopMacro: () => sent.push(['macro', 'stop']),
    document: { querySelectorAll: () => sessions.map(session => ({ closest: () => ({ dataset: { sessionId: session.sessionId } }), sessionId: session.sessionId })) },
    oddsManipulatorEnabled: false,
    setActiveSessions() {},
    toggleFastForwardFromFirstFrame: () => sent.push(['all', 'fast-forward']),
    lastMacroActionRef: { current: { toggle: async () => {} } },
    setMacroError() {},
  }
  const begin = source.indexOf('  function sendPlayerMessage(')
  const end = source.indexOf('  async function refreshMacros()', begin)
  runInNewContext(source.slice(begin, end), context)
  const resetBegin = source.indexOf('  async function dispatchReset(')
  const resetEnd = source.indexOf('\n  }', resetBegin) + '\n  }'.length
  runInNewContext(source.slice(resetBegin, resetEnd), context)
  // Include the helper and callback setup from the real gamepad effect.
  const effectBegin = source.lastIndexOf('    let current = true', source.indexOf('    const triggerActions ='))
  const effectEnd = source.indexOf('    const broadcast = bindings', effectBegin)
  assert.ok(effectBegin >= 0 && effectEnd > effectBegin)
  context.createPlayerTriggerActions = options => options
  const triggers = runInNewContext(`(() => { ${source.slice(effectBegin, effectEnd)}; return triggerActions })()`, context)
  return { context, sent, triggers }
}

for (const [label, type] of [['Salvar estado', 'emulator-hub:save-state'], ['Carregar estado', 'emulator-hub:load-state'], ['Soft Reset', 'emulator-hub:soft-reset'], ['Hard Reset', 'emulator-hub:reset']]) {
  test(`header ${label} reaches every running emulator when the selected one is paused`, async () => {
    const { context, sent } = harness()
    const button = source.split('\n').find(line => line.includes(`aria-label="${label}"`))
    const handler = button.match(/onClick=\{(.*?)\} \/>/)?.[1]
    assert.ok(handler)
    await runInNewContext(`(${handler})()`, context)
    assert.deepEqual(sent.filter(([id]) => id !== 'macro'), [['running-a', type], ['running-b', type]])
  })
}

for (const type of ['emulator-hub:save-state', 'emulator-hub:load-state', 'emulator-hub:soft-reset', 'emulator-hub:reset']) {
  test(`L2/R2 ${type} reaches all running emulators despite paused selection`, async () => {
    for (const [trigger, binding] of [['l2', 'button:6'], ['r2', 'button:7']]) {
      const { sent, triggers } = harness()
      const actions = createPlayerTriggerActions(triggers)
      const action = type.replace('emulator-hub:', '')
      actions.update([binding], { [trigger]: action }, { [trigger]: binding })
      await new Promise(resolve => setImmediate(resolve))
      assert.deepEqual(sent.filter(([id]) => id !== 'macro'), [['running-a', type], ['running-b', type]])
    }
  })
}

test('L2/R2 fast forward works even when every emulator is paused', async () => {
  const { context, sent, triggers } = harness()
  context.getPlayerPlaybackState = async () => ({ paused: true })
  triggers.toggleFastForward()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(sent, [['all', 'fast-forward']])
})

test('L2/R2 last macro uses the global coordinator despite a paused selected emulator', async () => {
  const { context, sent, triggers } = harness()
  context.lastMacroActionRef.current.toggle = async () => sent.push(['all', 'last-macro'])
  triggers.toggleLastMacro()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(sent, [['all', 'last-macro']])
})

test('global actions do nothing when every emulator is paused', async () => {
  const { context, sent } = harness()
  context.getPlayerPlaybackState = async () => ({ paused: true })
  for (const action of ['save-state', 'load-state', 'soft-reset', 'reset']) {
    await context.dispatchPlayingPlayerMessage(`emulator-hub:${action}`)
  }
  assert.deepEqual(sent, [])
})

test('header state buttons remain usable when a different emulator has a restore prompt or saved state', () => {
  const { context } = harness()
  Object.assign(context, { huntRunning: false, snapshotRestoreRequests: { paused: {} }, userStateAvailable: { 'running-b': true } })
  for (const label of ['Salvar estado', 'Carregar estado']) {
    const button = source.split('\n').find(line => line.includes(`aria-label="${label}"`))
    const disabled = button.match(/disabled=\{(.*?)\} onClick/)?.[1]
    assert.ok(disabled)
    assert.equal(runInNewContext(disabled, context), false)
  }
})

test('a restore prompt in one player does not block state actions in the others', async () => {
  const { context, sent } = harness()
  context.snapshotRestoreRequestsRef.current = { 'running-a': {} }
  await context.dispatchPlayingPlayerMessage('emulator-hub:load-state')
  assert.deepEqual(sent.filter(([id]) => id !== 'macro'), [['running-b', 'emulator-hub:load-state']])
})

test('a player closed while its playback reply is pending receives no state command', async () => {
  const { context, sent } = harness()
  let answer
  context.getPlayingSessions = () => new Promise(resolve => { answer = resolve })
  const pending = context.dispatchPlayingPlayerMessage('emulator-hub:save-state')
  context.activeSessionsRef.current = [sessions[0], sessions[2]]
  answer(sessions.slice(1))
  await pending
  assert.deepEqual(sent, [['running-b', 'emulator-hub:save-state']])
})

test('global header and gamepad actions have no focused emulator dependency', () => {
  assert.doesNotMatch(source, /selectedPlayerSessionId|focusedSessionId|whenSelectedPlaying|sendSelectedPlayerMessage/)
})
