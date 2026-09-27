import assert from 'node:assert/strict'
import test from 'node:test'

import { createShinyHuntPlayer } from './shiny-hunt-player.mjs'

test('configures odds before soft reset and confirms only after reset finishes', async () => {
  const events = []
  const player = createShinyHuntPlayer({
    getLayout: () => ({ enemyAddress: 1 }),
    getState: () => new Uint8Array([1]),
    captureBaseline: () => new Uint8Array(80),
    inspect: () => ({ status: 'pending' }),
    configureOdds: count => { events.push(['odds', count]); return true },
    softReset: async () => { events.push(['reset']); return true },
    setA: () => {},
    saveState: async () => true,
  })
  assert.deepEqual(await player.handle({ type: 'prepare', huntId: 'hunt' }), { ok: true })
  assert.deepEqual(await player.handle({ type: 'reset', huntId: 'hunt', cycleId: 1, oddsResetCount: 3 }), { ok: true })
  assert.deepEqual(events, [['odds', 3], ['reset']])
})

test('does not apply a delayed reset from an earlier cycle', async () => {
  let resets = 0
  const player = createShinyHuntPlayer({
    getLayout: () => ({ enemyAddress: 1 }),
    getState: () => new Uint8Array([1]),
    captureBaseline: () => new Uint8Array(80),
    inspect: () => ({ status: 'pending' }),
    configureOdds: () => true,
    softReset: async () => { resets += 1; return true },
    setA: () => {},
    saveState: async () => true,
  })
  await player.handle({ type: 'prepare', huntId: 'hunt' })
  await player.handle({ type: 'reset', huntId: 'hunt', cycleId: 1, oddsResetCount: 1 })
  await player.handle({ type: 'reset', huntId: 'hunt', cycleId: 2, oddsResetCount: 2 })
  assert.deepEqual(await player.handle({ type: 'reset', huntId: 'hunt', cycleId: 1, oddsResetCount: 1 }), { ok: false, error: 'stale-cycle' })
  assert.equal(resets, 2)
})

test('rejects A once an enemy exists and never drives the button', async () => {
  const events = []
  let enemyCreated = false
  const player = createShinyHuntPlayer({
    getLayout: () => ({ enemyAddress: 1 }),
    getState: () => new Uint8Array([1]),
    captureBaseline: () => new Uint8Array(80),
    inspect: () => ({ status: enemyCreated ? 'normal' : 'pending' }),
    configureOdds: () => true,
    softReset: async () => true,
    setA: down => events.push(down),
    saveState: async () => true,
  })
  await player.handle({ type: 'prepare', huntId: 'hunt' })
  await player.handle({ type: 'reset', huntId: 'hunt', cycleId: 1, oddsResetCount: 1 })
  enemyCreated = true
  assert.deepEqual(await player.handle({ type: 'input', huntId: 'hunt', cycleId: 1, pressIndex: 1, down: true }), { ok: false, error: 'enemy-already-created' })
  assert.deepEqual(events, [])
})

test('fifth A permits inspection and every participant can save its state', async () => {
  const events = []
  let released = 0
  const player = createShinyHuntPlayer({
    getLayout: () => ({ enemyAddress: 1 }),
    getState: () => new Uint8Array([1]),
    captureBaseline: () => new Uint8Array(80),
    inspect: () => released === 5 ? { status: 'shiny', species: 25 } : { status: 'pending' },
    configureOdds: () => true,
    softReset: async () => true,
    setA: down => { events.push(down); if (!down) released += 1 },
    saveState: async () => { events.push('save'); return true },
  })
  await player.handle({ type: 'prepare', huntId: 'hunt' })
  await player.handle({ type: 'reset', huntId: 'hunt', cycleId: 1, oddsResetCount: 1 })
  assert.deepEqual(await player.handle({ type: 'inspect', huntId: 'hunt', cycleId: 1 }), { ok: true, status: 'pending' })
  for (let pressIndex = 1; pressIndex <= 5; pressIndex += 1) {
    await player.handle({ type: 'input', huntId: 'hunt', cycleId: 1, pressIndex, down: true })
    await player.handle({ type: 'input', huntId: 'hunt', cycleId: 1, pressIndex, down: false })
  }
  assert.deepEqual(await player.handle({ type: 'inspect', huntId: 'hunt', cycleId: 1 }), { ok: true, status: 'shiny', species: 25 })
  assert.deepEqual(await player.handle({ type: 'save', huntId: 'hunt', cycleId: 1 }), { ok: true })
  assert.equal(events.filter(value => value === 'save').length, 1)
})

test('rejects an A release without its matching press', async () => {
  const events = []
  const player = createShinyHuntPlayer({
    getLayout: () => ({ enemyAddress: 1 }),
    getState: () => new Uint8Array([1]),
    captureBaseline: () => new Uint8Array(80),
    inspect: () => ({ status: 'pending' }),
    configureOdds: () => true,
    softReset: async () => true,
    setA: down => events.push(down),
    saveState: async () => true,
  })
  await player.handle({ type: 'prepare', huntId: 'hunt' })
  await player.handle({ type: 'reset', huntId: 'hunt', cycleId: 1, oddsResetCount: 1 })
  assert.deepEqual(await player.handle({ type: 'input', huntId: 'hunt', cycleId: 1, pressIndex: 1, down: false }), { ok: false, error: 'invalid-input-order' })
  assert.deepEqual(events, [])
})
