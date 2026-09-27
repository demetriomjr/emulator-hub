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

test('begins a cycle without reset and releases a held direction on cancellation', async () => {
  const buttons = []
  const player = createShinyHuntPlayer({
    getLayout: () => ({ enemyAddress: 1 }), getState: () => new Uint8Array([1]),
    captureBaseline: () => new Uint8Array(80), inspect: () => ({ status: 'pending' }),
    configureOdds: () => true, softReset: async () => true,
    setA: () => {}, setButton: (button, down) => buttons.push([button, down]),
    saveState: async () => true,
  })
  await player.handle({ type: 'prepare', huntId: 'hunt' })
  assert.deepEqual(await player.handle({ type: 'begin', huntId: 'hunt', cycleId: 1 }), { ok: true })
  assert.deepEqual(await player.handle({ type: 'input', huntId: 'hunt', cycleId: 1, button: 'LEFT', down: true }), { ok: true })
  await player.handle({ type: 'cancel', huntId: 'hunt' })
  assert.deepEqual(buttons, [['LEFT', true], ['LEFT', false]])
})

test('reset waits for a readable state before confirming the new cycle', async () => {
  let reads = 0
  const player = createShinyHuntPlayer({
    getLayout: () => ({ enemyAddress: 1 }),
    getState: () => { reads += 1; if (reads === 1) throw new Error('state temporarily unavailable'); return reads < 3 ? null : new Uint8Array([0]) },
    captureBaseline: state => state?.slice(),
    wait: async () => {}, inspect: () => ({ status: 'pending' }),
    configureOdds: () => true, softReset: async () => true,
    setA: () => {}, saveState: async () => true,
  })
  await player.handle({ type: 'prepare', huntId: 'hunt' })
  assert.deepEqual(await player.handle({ type: 'reset', huntId: 'hunt', cycleId: 1, oddsResetCount: 1 }), { ok: true })
  assert.equal(reads, 3)
})

test('reset confirmation reports the cycle after a delayed reset completes', async () => {
  let finishReset
  const player = createShinyHuntPlayer({
    getLayout: () => ({ enemyAddress: 1 }), getState: () => new Uint8Array([0]),
    captureBaseline: state => state.slice(), inspect: () => ({ status: 'pending' }),
    configureOdds: () => true,
    softReset: () => new Promise(resolve => { finishReset = resolve }),
    setA: () => {}, saveState: async () => true,
  })
  await player.handle({ type: 'prepare', huntId: 'hunt' })
  const running = player.handle({ type: 'reset', huntId: 'hunt', cycleId: 1, oddsResetCount: 1 })
  assert.deepEqual(await player.handle({ type: 'confirm-reset', huntId: 'hunt', cycleId: 1 }), { ok: true, confirmed: false })
  finishReset(true)
  assert.deepEqual(await running, { ok: true })
  assert.deepEqual(await player.handle({ type: 'confirm-reset', huntId: 'hunt', cycleId: 1 }), { ok: true, confirmed: true })
})

test('a new down command releases a stale held direction before rejecting it', async () => {
  const buttons = []
  const player = createShinyHuntPlayer({
    getLayout: () => ({ enemyAddress: 1 }), getState: () => new Uint8Array([0]),
    captureBaseline: () => new Uint8Array(80), inspect: () => ({ status: 'pending' }),
    configureOdds: () => true, softReset: async () => true,
    setA: () => {}, setButton: (button, down) => buttons.push([button, down]), saveState: async () => true,
  })
  await player.handle({ type: 'prepare', huntId: 'hunt' })
  await player.handle({ type: 'begin', huntId: 'hunt', cycleId: 1 })
  assert.deepEqual(await player.handle({ type: 'input', huntId: 'hunt', cycleId: 1, button: 'LEFT', down: true, stage: 'encounter' }), { ok: true })
  assert.deepEqual(await player.handle({ type: 'input', huntId: 'hunt', cycleId: 1, button: 'RIGHT', down: true, stage: 'encounter' }), { ok: false, error: 'invalid-input-order' })
  assert.deepEqual(buttons, [['LEFT', true], ['LEFT', false]])
  assert.deepEqual(await player.handle({ type: 'input', huntId: 'hunt', cycleId: 1, button: 'RIGHT', down: true, stage: 'encounter' }), { ok: true })
})

test('release input command lets a timed out direction be released without cancelling the hunt', async () => {
  const buttons = []
  const player = createShinyHuntPlayer({
    getLayout: () => ({ enemyAddress: 1 }), getState: () => new Uint8Array([0]),
    captureBaseline: () => new Uint8Array(80), inspect: () => ({ status: 'pending' }),
    configureOdds: () => true, softReset: async () => true,
    setA: () => {}, setButton: (button, down) => buttons.push([button, down]), saveState: async () => true,
  })
  await player.handle({ type: 'prepare', huntId: 'hunt' })
  await player.handle({ type: 'begin', huntId: 'hunt', cycleId: 1 })
  await player.handle({ type: 'input', huntId: 'hunt', cycleId: 1, button: 'LEFT', down: true, stage: 'encounter' })
  assert.deepEqual(await player.handle({ type: 'release-input', huntId: 'hunt', cycleId: 1 }), { ok: true })
  assert.deepEqual(buttons, [['LEFT', true], ['LEFT', false]])
  assert.deepEqual(await player.handle({ type: 'inspect', huntId: 'hunt', cycleId: 1, configured: true }), { ok: true, status: 'pending' })
})

test('begin after fleeing preserves an encounter created before baseline capture', async () => {
  let enemyCreated = false
  const player = createShinyHuntPlayer({
    getLayout: () => ({ enemyAddress: 1 }), getState: () => new Uint8Array([enemyCreated ? 1 : 0]),
    captureBaseline: state => state.slice(),
    inspect: (state, layout) => ({ status: state[0] !== layout.baselineEnemy[0] ? 'shiny' : 'pending' }),
    configureOdds: () => true, softReset: async () => true,
    setA: () => {}, saveState: async () => true,
  })
  await player.handle({ type: 'prepare', huntId: 'hunt' })
  await player.handle({ type: 'begin', huntId: 'hunt', cycleId: 1 })
  enemyCreated = true
  assert.deepEqual(await player.handle({ type: 'begin', huntId: 'hunt', cycleId: 2 }), { ok: true, alreadyEncountered: true })
  assert.deepEqual(await player.handle({ type: 'inspect', huntId: 'hunt', cycleId: 2, configured: true }), { ok: true, status: 'shiny' })
})

test('a temporary state exception during begin can be retried without advancing the cycle', async () => {
  let reads = 0
  const player = createShinyHuntPlayer({
    getLayout: () => ({ enemyAddress: 1 }),
    getState: () => { if (++reads === 2) throw new Error('temporary state error'); return new Uint8Array([0]) },
    captureBaseline: state => state.slice(), inspect: () => ({ status: 'pending' }),
    configureOdds: () => true, softReset: async () => true,
    setA: () => {}, saveState: async () => true,
  })
  await player.handle({ type: 'prepare', huntId: 'hunt' })
  await player.handle({ type: 'begin', huntId: 'hunt', cycleId: 1 })
  assert.deepEqual(await player.handle({ type: 'begin', huntId: 'hunt', cycleId: 2 }), { ok: false, error: 'state-unavailable' })
  assert.deepEqual(await player.handle({ type: 'begin', huntId: 'hunt', cycleId: 2 }), { ok: true })
})

test('duplicate save requests for one cycle share the same save and acknowledge it once', async () => {
  let finishSave
  let saves = 0
  const player = createShinyHuntPlayer({
    getLayout: () => ({ enemyAddress: 1 }), getState: () => new Uint8Array([0]),
    captureBaseline: () => new Uint8Array(80), inspect: () => ({ status: 'pending' }),
    configureOdds: () => true, softReset: async () => true,
    setA: () => {}, saveState: () => { saves += 1; return new Promise(resolve => { finishSave = resolve }) },
  })
  await player.handle({ type: 'prepare', huntId: 'hunt' })
  await player.handle({ type: 'begin', huntId: 'hunt', cycleId: 1 })
  const first = player.handle({ type: 'save', huntId: 'hunt', cycleId: 1, complete: true })
  const second = player.handle({ type: 'save', huntId: 'hunt', cycleId: 1, complete: true })
  assert.equal(saves, 1)
  finishSave(true)
  assert.deepEqual(await Promise.all([first, second]), [{ ok: true }, { ok: true }])
  assert.deepEqual(await player.handle({ type: 'save', huntId: 'hunt', cycleId: 1, complete: true }), { ok: true })
  assert.equal(saves, 1)
})

test('initial reset in exit mode keeps its original enemy baseline through navigation', async () => {
  let enemyCreated = false
  const player = createShinyHuntPlayer({
    getLayout: () => ({ enemyAddress: 1 }),
    getState: () => new Uint8Array([enemyCreated ? 1 : 0]),
    captureBaseline: state => state.slice(),
    inspect: (state, layout) => ({ status: state[0] !== layout.baselineEnemy[0] ? 'shiny' : 'pending' }),
    configureOdds: () => true, softReset: async () => true,
    setA: () => {}, setButton: () => {}, saveState: async () => true,
  })
  await player.handle({ type: 'prepare', huntId: 'hunt', resetMode: 'exit-encounter' })
  await player.handle({ type: 'reset', huntId: 'hunt', cycleId: 1, oddsResetCount: 1 })
  enemyCreated = true
  await player.handle({ type: 'begin', huntId: 'hunt', cycleId: 1, afterReset: true })
  assert.deepEqual(await player.handle({ type: 'inspect', huntId: 'hunt', cycleId: 1, configured: true }), { ok: true, status: 'shiny' })
})

test('exit input follows the supplied sequence without requiring battle phase mapping', async () => {
  const buttons = []
  const player = createShinyHuntPlayer({
    getLayout: () => ({ enemyAddress: 1 }), getState: () => new Uint8Array([0]),
    captureBaseline: () => new Uint8Array(80), inspect: () => ({ status: 'pending' }),
    inspectPhase: () => { throw new Error('phase must not be read') }, configureOdds: () => true, softReset: async () => true,
    setA: () => {}, setButton: (button, down) => buttons.push([button, down]), saveState: async () => true,
  })
  assert.deepEqual(await player.handle({ type: 'prepare', huntId: 'hunt', resetMode: 'exit-encounter' }), { ok: true })
  await player.handle({ type: 'begin', huntId: 'hunt', cycleId: 1 })
  const sequence = ['B', 'B', 'B', 'B', 'DOWN', 'RIGHT', 'A', 'A']
  for (const button of sequence) {
    assert.deepEqual(await player.handle({ type: 'input', huntId: 'hunt', cycleId: 1, button, down: true, stage: 'exit' }), { ok: true })
    assert.deepEqual(await player.handle({ type: 'input', huntId: 'hunt', cycleId: 1, button, down: false, stage: 'exit' }), { ok: true })
  }
  assert.deepEqual(buttons, sequence.flatMap(button => [[button, true], [button, false]]))
})
