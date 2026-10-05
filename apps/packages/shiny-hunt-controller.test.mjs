import assert from 'node:assert/strict'
import test from 'node:test'

import { createShinyHuntController } from './shiny-hunt-controller.mjs'

function harness(results) {
  const calls = []
  let time = 0
  let cycle = 0
  const controller = createShinyHuntController({
    now: () => time,
    sleep: async ms => { time += ms },
    prepare: async sessions => { calls.push(['prepare', sessions.map(s => s.sessionId)]) },
    reset: async session => { if (session.sessionId === 'a') cycle += 1; calls.push(['reset', session.sessionId]) },
    pulse: async (sessions, down, index) => { calls.push(['pulse', down, index, sessions.map(s => s.sessionId)]) },
    inspect: async session => results(cycle, session.sessionId),
    saveState: async session => { calls.push(['save', session.sessionId]) },
    release: async sessions => { calls.push(['release', sessions.map(s => s.sessionId)]) },
    onStatus: status => { calls.push(['status', status.phase, status.resetCount]) },
  })
  return { controller, calls, now: () => time }
}

const sessions = [{ sessionId: 'a' }, { sessionId: 'b' }]

test('Fossil completes five A and two B at 120 ms plus 400 ms idle, resets a normal and saves a shiny', async () => {
  let time = 0
  let presses = 0
  let resets = 0
  const inputs = []
  const saved = []
  const controller = createShinyHuntController({
    now: () => time, sleep: async ms => { time += ms }, prepare: async () => {},
    reset: async () => { resets++; presses = 0 }, begin: async () => {},
    input: async (_session, button, down, _signal, cycleId, stage) => {
      if (stage === 'encounter') { inputs.push([button, down, time, cycleId]); if (!down) presses++ }
    },
    inspect: async (_session, _signal, cycleId) => ({ status: presses >= 7 ? cycleId === 1 ? 'normal' : 'shiny' : 'pending' }),
    saveState: async (_session, _signal, cycleId) => { saved.push([cycleId, time]) }, release: async () => {},
  })
  const result = await controller.start([{ sessionId: 'a' }], { resetMode: 'soft-reset', startMode: 'fossil', stopMode: 'first-shiny' })
  assert.equal(result.phase, 'found')
  assert.equal(result.attemptCount, 2)
  assert.equal(resets, 2)
  for (const cycle of [1, 2]) {
    const events = inputs.filter(event => event[3] === cycle)
    assert.deepEqual(events.filter(([, down]) => down).map(([button]) => button), ['A', 'A', 'A', 'A', 'A', 'B', 'B'])
    for (let index = 0; index < 14; index += 2) {
      assert.equal(events[index + 1][2] - events[index][2], 120)
      if (index < 12) assert.equal(events[index + 2][2] - events[index + 1][2], 400)
    }
  }
  assert.equal(saved.length, 1)
  assert.equal(saved[0][1] - inputs.at(-1)[2], 400)
})

test('Fossil pending timeout and cancellation during B never count or save', async () => {
  for (const cancel of [false, true]) {
    let time = 0
    let held = null
    const inputs = []
    const controller = createShinyHuntController({
      now: () => time, sleep: async ms => { time += ms; if (cancel && held === 'B') controller.stop() },
      prepare: async () => {}, reset: async () => {}, begin: async () => {},
      input: async (_session, button, down, _signal, _cycle, stage) => { held = down ? button : null; if (stage === 'encounter') inputs.push([button, down]) },
      inspect: async () => ({ status: 'pending' }), saveState: async () => assert.fail('unconfirmed fossil cannot save'), release: async () => {},
    })
    const result = await controller.start([{ sessionId: 'a' }], { resetMode: 'soft-reset', startMode: 'fossil', stopMode: 'first-shiny' })
    assert.equal(result.phase, cancel ? 'stopped' : 'error')
    assert.equal(result.attemptCount, 0)
    assert.equal(held, null)
    if (cancel) assert.deepEqual(inputs.slice(-2), [['B', true], ['B', false]])
  }
})

for (const resetMode of ['soft-reset', 'exit-encounter']) {
  test(`${resetMode}: nine startup resets count zero until nine Pokemon are checked`, async () => {
    const players = Array.from({ length: 9 }, (_, index) => ({ sessionId: `player-${index}` }))
    const startupCounts = []
    let checks = 0
    const controller = createShinyHuntController({
      sleep: async () => {}, prepare: async () => {}, reset: async () => {},
      begin: async () => { startupCounts.push(controller.getStatus().attemptCount) },
      input: async () => {}, inspectPhase: async () => ({ status: 'map' }),
      inspect: async () => { checks++; return { status: 'shiny' } },
      saveState: async () => {}, release: async () => {},
    })
    const result = await controller.start(players, { resetMode, startMode: 'interact-a', stopMode: 'all-shiny' })
    assert.deepEqual(startupCounts, Array(9).fill(0))
    assert.equal(checks, 9)
    assert.equal(result.attemptCount, 9)
  })

  test(`${resetMode}: resets and exits leave the count unchanged until the next checked Pokemon`, async () => {
    const resetCounts = []
    const beginCounts = []
    const controller = createShinyHuntController({
      sleep: async () => {}, prepare: async () => {},
      reset: async () => { resetCounts.push(controller.getStatus().attemptCount) },
      begin: async () => { beginCounts.push(controller.getStatus().attemptCount) },
      input: async () => {}, inspectPhase: async () => ({ status: 'map' }),
      inspect: async (_session, _signal, cycleId) => ({ status: cycleId === 1 ? 'normal' : 'shiny' }),
      saveState: async () => {}, release: async () => {},
    })
    const result = await controller.start([{ sessionId: 'a' }], { resetMode, startMode: 'interact-a', stopMode: 'first-shiny' })
    assert.deepEqual(resetCounts, resetMode === 'soft-reset' ? [0, 1] : [0])
    assert.deepEqual(beginCounts, [0, 1])
    assert.equal(result.attemptCount, 2)
  })
}

test('nine startup resets followed by pending encounters do not count an attempt', async () => {
  const controller = createShinyHuntController({
    sleep: async () => {}, prepare: async () => {}, reset: async () => {},
    begin: async () => {}, input: async () => {},
    inspect: async () => ({ status: 'pending' }), release: async () => {},
  })
  const result = await controller.start(Array.from({ length: 9 }, (_, index) => ({ sessionId: `player-${index}` })), { resetMode: 'soft-reset', startMode: 'interact-a', stopMode: 'first-shiny' })
  assert.equal(result.phase, 'error')
  assert.equal(result.attemptCount, 0)
})

test('stopping after nine initial resets and before inspection leaves the count at zero', async () => {
  let resets = 0
  const controller = createShinyHuntController({
    prepare: async () => {}, reset: async () => { resets++ },
    sleep: async () => { controller.stop() },
    begin: async () => {}, input: async () => {}, release: async () => {},
    inspect: async () => { assert.fail('startup was stopped before inspection') },
  })
  const result = await controller.start(Array.from({ length: 9 }, (_, index) => ({ sessionId: `player-${index}` })), { resetMode: 'soft-reset', startMode: 'interact-a', stopMode: 'first-shiny' })
  assert.equal(resets, 9)
  assert.equal(result.phase, 'stopped')
  assert.equal(result.attemptCount, 0)
})

for (const [position, direction] of [[1, 'LEFT'], [2, null], [3, 'RIGHT']]) {
  test(`Hoenn ball ${position} opens the bag, taps once from the center, and confirms twice`, async () => {
    let time = 0
    let confirmations = 0
    let reads = 0
    const commands = []
    const controller = createShinyHuntController({
      now: () => time, sleep: async ms => { time += ms }, prepare: async () => {}, reset: async () => {},
      begin: async () => {},
      input: async (_session, button, down, _signal, _cycle, stage) => {
        if (stage === 'encounter') {
          commands.push([button, down, time])
          if (button === 'A' && !down) confirmations++
        }
      },
      tap: async (_session, button) => { commands.push([button, 'tap', time]); time += 8 },
      inspect: async () => ({ status: confirmations === 3 && ++reads > 2 ? 'shiny' : 'pending' }),
      saveState: async () => {}, release: async () => {},
    })
    const result = await controller.start([{ sessionId: 'a', gameCode: 'AXVE' }], { resetMode: 'soft-reset', startMode: 'hoenn-starter', starterPosition: position, stopMode: 'first-shiny' })
    assert.equal(result.phase, 'found')
    assert.deepEqual(commands.filter(([, down]) => down === true || down === 'tap').map(([button]) => button), direction ? ['A', direction, 'A', 'A'] : ['A', 'A', 'A'])
    const starts = commands.filter(([, down]) => down === true || down === 'tap')
    for (let index = 1; index < starts.length; index++) assert.ok(starts[index][2] - starts[index - 1][2] >= 1000)
    for (let i = 0; i < commands.length - 1; i++) if (commands[i][1] === true) assert.equal(commands[i + 1][2] - commands[i][2], 40)
    assert.equal(result.attemptCount, 1)
  })
}

test('Hoenn hunt refuses a missing ball or encounter-exit reset before preparing players', async () => {
  let preparations = 0
  const controller = createShinyHuntController({ prepare: async () => { preparations++ }, release: async () => {} })
  for (const config of [
    { resetMode: 'soft-reset', startMode: 'hoenn-starter', stopMode: 'first-shiny' },
    { resetMode: 'exit-encounter', startMode: 'hoenn-starter', starterPosition: 2, stopMode: 'first-shiny' },
  ]) assert.equal((await controller.start([{ sessionId: 'a' }], config)).phase, 'error')
  assert.equal(preparations, 0)
})

test('a lost Hoenn direction response stops the hunt without retrying or confirming another ball', async () => {
  let time = 0
  let taps = 0
  let resets = 0
  const encounterButtons = []
  const controller = createShinyHuntController({
    now: () => time, sleep: async ms => { time += ms }, prepare: async () => {}, reset: async () => { resets++ }, begin: async () => {},
    input: async (_session, button, down, _signal, _cycle, stage) => { if (stage === 'encounter' && down) encounterButtons.push(button) },
    tap: async () => { taps++; throw new Error('Player request timed out') },
    inspect: async () => ({ status: 'pending' }), release: async () => {},
    saveState: async () => { assert.fail('no encounter was confirmed') },
  })
  const result = await controller.start([{ sessionId: 'a', gameCode: 'AXVE' }], { resetMode: 'soft-reset', startMode: 'hoenn-starter', starterPosition: 1, stopMode: 'first-shiny' })
  assert.equal(result.phase, 'error')
  assert.equal(taps, 1)
  assert.equal(resets, 1)
  assert.equal(result.attemptCount, 0)
  assert.deepEqual(encounterButtons, ['A'])
})

test('one starter hunt routes all five verified titles and never sends Hoenn arrows to Kanto', async () => {
  let time = 0
  const players = ['AXVE', 'AXPE', 'BPEE', 'BPRE', 'BPGE'].map(gameCode => ({ sessionId: gameCode, gameCode }))
  const presses = new Map(players.map(player => [player.sessionId, []]))
  const released = new Map(players.map(player => [player.sessionId, 0]))
  const saved = []
  const controller = createShinyHuntController({
    now: () => time, sleep: async ms => { time += ms }, prepare: async () => {}, reset: async () => {}, begin: async () => {},
    input: async (session, button, down, _signal, _cycle, stage) => {
      if (stage !== 'encounter') return
      if (down) presses.get(session.sessionId).push(button)
      else if (button === 'A') released.set(session.sessionId, released.get(session.sessionId) + 1)
    },
    tap: async (session, button) => { presses.get(session.sessionId).push(button) },
    inspect: async session => ({ status: released.get(session.sessionId) >= (session.gameCode.startsWith('AX') || session.gameCode === 'BPEE' ? 3 : 4) ? 'shiny' : 'pending' }),
    saveState: async session => { saved.push(session.sessionId) }, release: async () => {},
  })
  const result = await controller.start(players, { resetMode: 'soft-reset', startMode: 'hoenn-starter', starterPosition: 3, stopMode: 'all-shiny' })
  assert.equal(result.phase, 'found')
  for (const gameCode of ['AXVE', 'AXPE', 'BPEE']) assert.deepEqual(presses.get(gameCode), ['A', 'RIGHT', 'A', 'A'])
  for (const gameCode of ['BPRE', 'BPGE']) assert.deepEqual(presses.get(gameCode), ['A', 'A', 'A', 'A'])
  assert.deepEqual(saved.sort(), players.map(player => player.sessionId).sort())
})

test('saves every open player and stops before another reset on enemy shiny', async () => {
  const { controller, calls } = harness((_cycle, sessionId) => ({ status: sessionId === 'b' ? 'shiny' : 'normal' }))
  const outcome = await controller.start(sessions)
  assert.deepEqual(outcome, { phase: 'found', resetCount: 1, foundSessionId: 'b' })
  assert.equal(calls.filter(call => call[0] === 'reset').length, 2)
  assert.equal(calls.filter(call => call[0] === 'pulse' && call[1]).length, 5)
  assert.deepEqual(calls.filter(call => call[0] === 'save').map(call => call[1]), ['a', 'b'])
  assert.equal(calls.some(call => call[0] === 'status' && call[1] === 'found'), true)
})

test('inspects all nine open players before deciding the cycle', async () => {
  const players = Array.from({ length: 9 }, (_, index) => ({ sessionId: `player-${index + 1}` }))
  const inspected = []
  const saved = []
  let time = 0
  const controller = createShinyHuntController({
    now: () => time,
    sleep: async ms => { time += ms },
    prepare: async () => {},
    reset: async () => {},
    pulse: async () => {},
    inspect: async session => {
      inspected.push(session.sessionId)
      return { status: session.sessionId === 'player-9' ? 'shiny' : 'normal' }
    },
    saveState: async session => { saved.push(session.sessionId) },
    release: async () => {},
  })

  const outcome = await controller.start(players)
  assert.equal(outcome.foundSessionId, 'player-9')
  assert.deepEqual(inspected, players.map(session => session.sessionId))
  assert.deepEqual(saved, players.map(session => session.sessionId))
})

test('a shiny in a later player takes priority over an inspection failure', async () => {
  const players = [{ sessionId: 'broken' }, { sessionId: 'shiny' }]
  const saved = []
  let time = 0
  const controller = createShinyHuntController({
    now: () => time,
    sleep: async ms => { time += ms },
    prepare: async () => {},
    reset: async () => {},
    pulse: async () => {},
    inspect: async session => {
      if (session.sessionId === 'broken') throw new Error('inspection unavailable')
      return { status: 'shiny' }
    },
    saveState: async session => { saved.push(session.sessionId) },
    release: async () => {},
  })

  const outcome = await controller.start(players)
  assert.equal(outcome.phase, 'found')
  assert.equal(outcome.foundSessionId, 'shiny')
  assert.deepEqual(saved, ['broken', 'shiny'])
})

test('waits two real seconds after all soft resets before the first A', async () => {
  let now = 0
  const downTimes = []
  const controller = createShinyHuntController({
    now: () => now,
    sleep: async ms => { now += ms },
    prepare: async () => {},
    reset: async () => {},
    pulse: async (_sessions, down) => { if (down) downTimes.push(now) },
    inspect: async () => ({ status: 'shiny' }),
    saveState: async () => {},
    release: async () => {},
  })
  await controller.start([{ sessionId: 'only' }])
  assert.deepEqual(downTimes, [2000, 3000, 4000, 5000, 6000])
})

test('only starts a second reset after every player is normal', async () => {
  const { controller, calls } = harness((cycle, sessionId) => ({ status: cycle === 1 || sessionId === 'a' ? 'normal' : 'shiny' }))
  const outcome = await controller.start(sessions)
  assert.equal(outcome.resetCount, 2)
  assert.deepEqual(calls.filter(call => call[0] === 'reset').map(call => call[1]), ['a', 'b', 'a', 'b'])
})

test('passes the same cycle identity through reset, input, inspection and saving', async () => {
  const cycles = []
  let time = 0
  const controller = createShinyHuntController({
    now: () => time,
    sleep: async ms => { time += ms },
    prepare: async () => {},
    reset: async (_session, _signal, cycleId) => cycles.push(['reset', cycleId]),
    pulse: async (_sessions, down, _index, _signal, cycleId) => { if (down) cycles.push(['A', cycleId]) },
    inspect: async (_session, _signal, cycleId) => { cycles.push(['inspect', cycleId]); return { status: 'shiny' } },
    saveState: async (_session, _signal, cycleId) => cycles.push(['save', cycleId]),
    release: async () => {},
  })
  await controller.start([{ sessionId: 'only' }])
  assert.equal(cycles.every(([, cycleId]) => cycleId === 1), true)
})

test('never continues to A when one reset fails', async () => {
  const calls = []
  const controller = createShinyHuntController({
    now: () => 0,
    sleep: async () => {},
    prepare: async () => {},
    reset: async session => { if (session.sessionId === 'b') throw new Error('reset failed') },
    pulse: async () => { calls.push('A') },
    inspect: async () => ({ status: 'normal' }),
    saveState: async () => {},
    release: async () => { calls.push('release') },
  })
  const outcome = await controller.start(sessions)
  assert.equal(outcome.phase, 'error')
  assert.equal(outcome.resetCount, 0)
  assert.deepEqual(calls, ['release'])
})

test('reports the found player when a state save fails and never resets again', async () => {
  let time = 0
  let resets = 0
  const controller = createShinyHuntController({
    now: () => time,
    sleep: async ms => { time += ms },
    prepare: async () => {},
    reset: async () => { resets += 1 },
    pulse: async () => {},
    inspect: async () => ({ status: 'shiny', species: 25 }),
    saveState: async () => { throw new Error('snapshot rejected') },
    release: async () => {},
  })
  const outcome = await controller.start([{ sessionId: 'only' }])
  assert.deepEqual(outcome, { phase: 'error', resetCount: 1, foundSessionId: 'only', error: 'snapshot rejected' })
  assert.equal(resets, 1)
})

test('all shiny retires each player and resets only those still hunting', async () => {
  let time = 0
  const resets = []
  const saved = []
  const controller = createShinyHuntController({
    now: () => time, sleep: async ms => { time += ms }, prepare: async () => {},
    reset: async session => { resets.push(session.sessionId) },
    begin: async () => {},
    input: async () => {},
    inspect: async session => ({ status: session.sessionId === 'a' || resets.filter(id => id === 'b').length === 2 ? 'shiny' : 'normal' }),
    saveState: async session => { saved.push(session.sessionId) }, release: async () => {},
  })
  const result = await controller.start(sessions, { resetMode: 'soft-reset', startMode: 'interact-a', stopMode: 'all-shiny' })
  assert.equal(result.phase, 'found')
  assert.equal(result.running, false)
  assert.deepEqual(resets, ['a', 'b', 'b'])
  assert.deepEqual(saved.sort(), ['a', 'b'])
  assert.deepEqual(result.completedSessionIds.sort(), ['a', 'b'])
})

test('all shiny saves two simultaneous shiny players once each', async () => {
  let time = 0
  const saved = []
  const controller = createShinyHuntController({
    now: () => time, sleep: async ms => { time += ms }, prepare: async () => {},
    reset: async () => {}, begin: async () => {}, input: async () => {},
    inspect: async () => ({ status: 'shiny' }),
    saveState: async session => { saved.push(session.sessionId) }, release: async () => {},
  })
  const result = await controller.start(sessions, { resetMode: 'soft-reset', startMode: 'interact-a', stopMode: 'all-shiny' })
  assert.equal(result.phase, 'found')
  assert.deepEqual(saved.sort(), ['a', 'b'])
  assert.deepEqual(result.completedSessionIds.sort(), ['a', 'b'])
})

test('configured first shiny saves every state despite a concurrent unreadable state', async () => {
  let time = 0
  const saved = []
  const controller = createShinyHuntController({
    now: () => time, sleep: async ms => { time += ms }, prepare: async () => {},
    reset: async () => {}, begin: async () => {}, input: async () => {},
    inspect: async session => session.sessionId === 'a' ? { status: 'shiny' } : { status: 'error' },
    saveState: async session => { saved.push(session.sessionId) }, release: async () => {},
  })
  const result = await controller.start(sessions, { resetMode: 'soft-reset', startMode: 'interact-a', stopMode: 'first-shiny' })
  assert.equal(result.phase, 'found')
  assert.deepEqual(saved, ['a', 'b'])
})

test('stopping a configured hunt cancels its wait without sending another input', async () => {
  const inputs = []
  let waiting
  const ready = new Promise(resolve => { waiting = resolve })
  const controller = createShinyHuntController({
    sleep: (_ms, signal) => new Promise((_resolve, reject) => {
      waiting()
      signal.addEventListener('abort', () => { const error = new Error('stopped'); error.name = 'AbortError'; reject(error) }, { once: true })
    }),
    prepare: async () => {}, reset: async () => {}, begin: async () => {},
    input: async (...args) => { inputs.push(args) }, inspect: async () => ({ status: 'pending' }),
    saveState: async () => {}, release: async () => {},
  })
  const running = controller.start([{ sessionId: 'a' }], { resetMode: 'soft-reset', startMode: 'interact-a', stopMode: 'first-shiny' })
  await ready
  controller.stop()
  const result = await running
  assert.equal(result.phase, 'stopped')
  assert.deepEqual(inputs, [])
})

test('common encounter reads after each four-movement group without counting it as a new attempt', async () => {
  let time = 0
  const inputs = []
  const reads = []
  let pairs = 0
  let resets = 0
  const controller = createShinyHuntController({
    now: () => time, sleep: async ms => { time += ms }, prepare: async () => {},
    reset: async () => { resets += 1 }, begin: async () => {},
    input: async (_session, button, down) => { inputs.push([button, down, time]); if (button === 'RIGHT' && !down) pairs += 1 },
    inspect: async () => { reads.push([pairs, time]); return { status: pairs === 4 ? 'shiny' : 'pending' } },
    inspectPhase: async () => ({ status: 'map' }),
    saveState: async () => {}, release: async () => {},
  })
  const result = await controller.start([{ sessionId: 'a' }], { resetMode: 'exit-encounter', startMode: 'common', stopMode: 'first-shiny' })
  assert.equal(result.attemptCount, 1)
  assert.equal(resets, 1)
  assert.equal(result.running, false)
  assert.equal(time, 9550)
  assert.deepEqual(inputs.map(([button, down]) => [button, down]), [
    ...Array.from({ length: 4 }, () => [['A', true], ['A', false]]).flat(),
    ...Array.from({ length: 4 }, () => [['LEFT', true], ['LEFT', false], ['RIGHT', true], ['RIGHT', false]]).flat(),
  ])
  assert.deepEqual(reads, [[0, 6000], [2, 7750], [4, 9550]])
  const directions = inputs.filter(([button, down]) => ['LEFT', 'RIGHT'].includes(button) && down)
  assert.deepEqual(directions.map(([, , pressedAt]) => pressedAt), [6000, 6450, 6900, 7350, 7800, 8250, 8700, 9150])
  for (const button of ['LEFT', 'RIGHT']) {
    const expectedHold = 400
    for (let index = 0; index < inputs.length - 1; index += 1) {
      if (inputs[index][0] === button && inputs[index][1]) assert.equal(inputs[index + 1][2] - inputs[index][2], expectedHold)
    }
  }
})

test('exit encounter sends timed inputs and checks battle state after the final wait', async () => {
  let time = 0
  let cycle = 0
  let resets = 0
  const commands = []
  const controller = createShinyHuntController({
    now: () => time, sleep: async ms => { time += ms }, prepare: async () => {},
    reset: async () => { resets += 1 },
    begin: async (_session, _signal, id) => { cycle = id; commands.push(['begin', id, time]) },
    input: async (_session, button, down, _signal, id, stage) => {
      if (down || stage === 'exit') commands.push([button, id, time, down, stage])
    },
    inspect: async () => ({ status: cycle === 1 ? 'normal' : 'shiny' }),
    inspectPhase: async () => { commands.push(['phase', cycle, time]); return { status: 'map' } },
    saveState: async () => {}, release: async () => {},
  })
  const result = await controller.start([{ sessionId: 'a' }], { resetMode: 'exit-encounter', startMode: 'interact-a', stopMode: 'first-shiny' })
  assert.equal(result.phase, 'found')
  assert.equal(result.attemptCount, 2)
  assert.equal(resets, 1)
  assert.deepEqual(commands.filter(([name]) => name === 'begin').map(([, id]) => id), [1, 2])
  assert.deepEqual(commands.filter(([, id, , down]) => id === 1 && down === true), [
    ['A', 1, 2000, true, 'navigation'], ['A', 1, 3000, true, 'navigation'], ['A', 1, 4000, true, 'navigation'], ['A', 1, 5000, true, 'navigation'],
    ['B', 1, 7300, true, 'exit'], ['B', 1, 7700, true, 'exit'], ['B', 1, 8100, true, 'exit'], ['B', 1, 8500, true, 'exit'],
    ['DOWN', 1, 8900, true, 'exit'], ['RIGHT', 1, 9300, true, 'exit'],
    ['A', 1, 9700, true, 'exit'], ['A', 1, 10500, true, 'exit'],
  ])
  const exitCommands = commands.filter(([, id, , , stage]) => id === 1 && stage === 'exit')
  for (let index = 0; index < exitCommands.length; index += 2) {
    const button = exitCommands[index][0]
    assert.equal(exitCommands[index + 1][2] - exitCommands[index][2], button === 'A' ? 400 : 200)
    if (index + 2 < exitCommands.length) assert.equal(exitCommands[index + 2][2] - exitCommands[index + 1][2], button === 'A' ? 400 : 200)
  }
  assert.deepEqual(commands.find(([name, id]) => name === 'begin' && id === 1), ['begin', 1, 6000])
  assert.deepEqual(commands.find(([name, id]) => name === 'begin' && id === 2), ['begin', 2, 11700])
  assert.deepEqual(commands.filter(([name]) => name === 'phase'), [['phase', 1, 11700]])
})

test('common encounter continues when a normal battle starts before the next direction', async () => {
  let cycle = 0
  let appeared = false
  const resets = []
  const inputs = []
  const controller = createShinyHuntController({
    sleep: async () => {}, prepare: async () => {},
    reset: async (_session, _signal, cycleId) => { resets.push(cycleId) },
    begin: async (_session, _signal, cycleId) => { cycle = cycleId },
    input: async (_session, button, down, _signal, _cycleId, stage) => {
      if (stage !== 'encounter') return
      inputs.push([button, down])
      if (cycle === 1 && button === 'RIGHT' && down) {
        appeared = true
        throw new Error('enemy-already-created')
      }
    },
    inspect: async () => ({ status: cycle === 2 ? 'shiny' : appeared ? 'normal' : 'pending' }),
    saveState: async () => {}, release: async () => {},
  })
  const result = await controller.start([{ sessionId: 'a' }], { resetMode: 'soft-reset', startMode: 'common', stopMode: 'all-shiny' })
  assert.equal(result.phase, 'found')
  assert.deepEqual(resets, [1, 2])
  assert.deepEqual(inputs, [['LEFT', true], ['LEFT', false], ['RIGHT', true]])
})

test('common encounter preserves a shiny that appears before the next direction', async () => {
  let appeared = false
  const inputs = []
  const saved = []
  const controller = createShinyHuntController({
    sleep: async () => {}, prepare: async () => {}, reset: async () => {}, begin: async () => {},
    input: async (_session, button, down, _signal, _cycleId, stage) => {
      if (stage !== 'encounter') return
      inputs.push([button, down])
      if (button === 'RIGHT' && down) {
        appeared = true
        throw new Error('enemy-already-created')
      }
    },
    inspect: async () => ({ status: appeared ? 'shiny' : 'pending' }),
    saveState: async session => { saved.push(session.sessionId) }, release: async () => {},
  })
  const result = await controller.start([{ sessionId: 'a' }], { resetMode: 'soft-reset', startMode: 'common', stopMode: 'first-shiny' })
  assert.equal(result.phase, 'found')
  assert.deepEqual(inputs, [['LEFT', true], ['LEFT', false], ['RIGHT', true]])
  assert.deepEqual(saved, ['a'])
})

test('navigation stops pressing A when an encounter starts during boot commands', async () => {
  let navigationPresses = 0
  let appeared = false
  const saved = []
  const controller = createShinyHuntController({
    sleep: async () => {}, prepare: async () => {}, reset: async () => {}, begin: async () => {},
    input: async (_session, button, down, _signal, _cycleId, stage) => {
      if (stage !== 'navigation' || button !== 'A' || !down) return
      navigationPresses += 1
      if (navigationPresses === 3) { appeared = true; throw new Error('enemy-already-created') }
    },
    inspect: async () => ({ status: appeared ? 'shiny' : 'pending' }),
    saveState: async session => { saved.push(session.sessionId) }, release: async () => {},
  })
  const result = await controller.start([{ sessionId: 'a' }], { resetMode: 'soft-reset', startMode: 'interact-a', stopMode: 'first-shiny' })
  assert.equal(result.phase, 'found')
  assert.equal(navigationPresses, 3)
  assert.deepEqual(saved, ['a'])
})

test('navigation recovers from a temporary unsafe state before pressing A', async () => {
  let guarded = false
  let presses = 0
  const controller = createShinyHuntController({
    sleep: async () => {}, prepare: async () => {}, reset: async () => {}, begin: async () => {},
    input: async (_session, button, down, _signal, _cycleId, stage) => {
      if (stage !== 'navigation' || button !== 'A' || !down) return
      if (!guarded) { guarded = true; throw new Error('unsafe-state') }
      presses += 1
    },
    inspect: async () => ({ status: 'shiny' }),
    saveState: async () => {}, release: async () => {},
  })
  const result = await controller.start([{ sessionId: 'a' }], { resetMode: 'soft-reset', startMode: 'interact-a', stopMode: 'first-shiny' })
  assert.equal(result.phase, 'found')
  assert.equal(presses, 0)
})

test('a rejected direction is retried after the player releases a stale held button', async () => {
  let collisions = 0
  let directions = 0
  const controller = createShinyHuntController({
    sleep: async () => {}, prepare: async () => {}, reset: async () => {}, begin: async () => {},
    input: async (_session, button, down, _signal, _cycleId, stage) => {
      if (stage !== 'encounter' || !down) return
      if (directions && button !== 'LEFT') throw new Error('enemy-already-created')
      if (button !== 'LEFT') return
      if (!collisions++) throw new Error('invalid-input-order')
      directions += 1
    },
    inspect: async () => ({ status: directions ? 'shiny' : 'pending' }),
    saveState: async () => {}, release: async () => {},
  })
  const result = await controller.start([{ sessionId: 'a' }], { resetMode: 'soft-reset', startMode: 'common', stopMode: 'first-shiny' })
  assert.equal(result.phase, 'found')
  assert.equal(collisions, 2)
})

test('a timed out direction is released and inspected before another command', async () => {
  let appeared = false
  const releases = []
  const inputs = []
  const controller = createShinyHuntController({
    sleep: async () => {}, prepare: async () => {}, reset: async () => {}, begin: async () => {},
    input: async (_session, button, down, _signal, _cycleId, stage) => {
      if (stage !== 'encounter') return
      inputs.push([button, down])
      if (button === 'LEFT' && down) { appeared = true; throw new Error('Player request timed out') }
    },
    releaseInput: async session => { releases.push(session.sessionId) },
    inspect: async () => ({ status: appeared ? 'shiny' : 'pending' }),
    saveState: async () => {}, release: async () => {},
  })
  const result = await controller.start([{ sessionId: 'a' }], { resetMode: 'soft-reset', startMode: 'common', stopMode: 'first-shiny' })
  assert.equal(result.phase, 'found')
  assert.deepEqual(releases, ['a'])
  assert.deepEqual(inputs, [['LEFT', true]])
})

test('a timed out direction with no encounter continues walking after release', async () => {
  let timedOut = false
  let shiny = false
  const inputs = []
  let releases = 0
  const controller = createShinyHuntController({
    sleep: async () => {}, prepare: async () => {}, reset: async () => {}, begin: async () => {},
    input: async (_session, button, down, _signal, _cycleId, stage) => {
      if (stage !== 'encounter') return
      if (shiny && down) throw new Error('enemy-already-created')
      inputs.push([button, down])
      if (button === 'LEFT' && down && !timedOut) { timedOut = true; throw new Error('Player request timed out') }
      if (button === 'RIGHT' && down) shiny = true
    },
    releaseInput: async () => { releases += 1 },
    inspect: async () => ({ status: shiny ? 'shiny' : 'pending' }),
    saveState: async () => {}, release: async () => {},
  })
  const result = await controller.start([{ sessionId: 'a' }], { resetMode: 'soft-reset', startMode: 'common', stopMode: 'first-shiny' })
  assert.equal(result.phase, 'found')
  assert.equal(releases, 1)
  assert.deepEqual(inputs, [['LEFT', true], ['RIGHT', true], ['RIGHT', false]])
})

test('a transient save failure retries without resetting the shiny player', async () => {
  let saves = 0
  let resets = 0
  const controller = createShinyHuntController({
    sleep: async () => {}, prepare: async () => {}, reset: async () => { resets += 1 }, begin: async () => {}, input: async () => {},
    inspect: async () => ({ status: 'shiny' }),
    saveState: async () => { if (++saves < 3) throw new Error('Player request timed out') }, release: async () => {},
  })
  const result = await controller.start([{ sessionId: 'a' }], { resetMode: 'soft-reset', startMode: 'interact-a', stopMode: 'all-shiny' })
  assert.equal(result.phase, 'found')
  assert.equal(saves, 3)
  assert.equal(resets, 1)
})

test('a lost reset response is confirmed without sending a second reset', async () => {
  let resets = 0
  let confirmations = 0
  const controller = createShinyHuntController({
    sleep: async () => {}, prepare: async () => {},
    reset: async () => { resets += 1; throw new Error('Player request timed out') },
    confirmReset: async () => ++confirmations >= 2,
    begin: async () => {}, input: async () => {},
    inspect: async () => ({ status: 'shiny' }), saveState: async () => {}, release: async () => {},
  })
  const result = await controller.start([{ sessionId: 'a' }], { resetMode: 'soft-reset', startMode: 'interact-a', stopMode: 'first-shiny' })
  assert.equal(result.phase, 'found')
  assert.equal(resets, 1)
  assert.equal(confirmations, 2)
})

test('a transient invalid state is reread before ending the hunt', async () => {
  let reads = 0
  const controller = createShinyHuntController({
    sleep: async () => {}, prepare: async () => {}, reset: async () => {}, begin: async () => {}, input: async () => {},
    inspect: async () => ({ status: ++reads < 3 ? 'error' : 'shiny' }),
    saveState: async () => {}, release: async () => {},
  })
  const result = await controller.start([{ sessionId: 'a' }], { resetMode: 'soft-reset', startMode: 'common', stopMode: 'first-shiny' })
  assert.equal(result.phase, 'found')
  assert.equal(reads, 3)
})

test('an internal AbortError reports an error instead of a manual stop', async () => {
  const controller = createShinyHuntController({
    sleep: async () => {}, prepare: async () => {}, reset: async () => {}, begin: async () => {}, input: async () => {},
    inspect: async () => { const error = new Error('Runtime read aborted'); error.name = 'AbortError'; throw error },
    saveState: async () => {}, release: async () => {},
  })
  const result = await controller.start([{ sessionId: 'a' }], { resetMode: 'soft-reset', startMode: 'common', stopMode: 'first-shiny' })
  assert.equal(result.phase, 'error')
  assert.equal(result.error, 'Runtime read aborted')
})

test('a player still in battle soft resets while other players continue after fleeing', async () => {
  const resets = []
  const beginnings = []
  const phases = []
  const saved = []
  const controller = createShinyHuntController({
    sleep: async () => {}, prepare: async () => {},
    reset: async (session, _signal, cycleId) => { resets.push([session.sessionId, cycleId]) },
    begin: async (session, _signal, cycleId, options) => { beginnings.push([session.sessionId, cycleId, options.afterReset]) },
    input: async () => {},
    inspect: async (_session, _signal, cycleId) => ({ status: cycleId === 1 ? 'normal' : 'shiny' }),
    inspectPhase: async session => { phases.push(session.sessionId); return { status: session.sessionId === 'a' ? 'battle' : 'map' } },
    saveState: async session => { saved.push(session.sessionId) }, release: async () => {},
  })
  const result = await controller.start(sessions, { resetMode: 'exit-encounter', startMode: 'interact-a', stopMode: 'all-shiny' })
  assert.equal(result.phase, 'found')
  assert.equal(result.attemptCount, 4)
  assert.deepEqual(resets, [['a', 1], ['b', 1], ['a', 2]])
  assert.deepEqual(phases.filter(id => id === 'a').length, 3)
  assert.deepEqual(phases.filter(id => id === 'b').length, 1)
  assert.deepEqual(beginnings.filter(([, cycleId]) => cycleId === 2).sort(), [['a', 2, true], ['b', 2, false]])
  assert.deepEqual(saved.sort(), ['a', 'b'])
})

test('a transient post-flee state does not force a reset', async () => {
  let cycle = 0
  let phaseReads = 0
  const resets = []
  const controller = createShinyHuntController({
    sleep: async () => {}, prepare: async () => {},
    reset: async (_session, _signal, cycleId) => { resets.push(cycleId) },
    begin: async (_session, _signal, cycleId) => { cycle = cycleId }, input: async () => {},
    inspect: async () => ({ status: cycle === 1 ? 'normal' : 'shiny' }),
    inspectPhase: async () => ({ status: ++phaseReads === 1 ? 'error' : phaseReads === 2 ? 'pending' : 'map' }),
    saveState: async () => {}, release: async () => {},
  })
  const result = await controller.start([{ sessionId: 'a' }], { resetMode: 'exit-encounter', startMode: 'interact-a', stopMode: 'first-shiny' })
  assert.equal(result.phase, 'found')
  assert.deepEqual(resets, [1])
  assert.equal(phaseReads, 3)
})

test('a failed exit input falls back to a reset in only that player', async () => {
  let cycle = 0
  const resets = []
  const controller = createShinyHuntController({
    sleep: async () => {}, prepare: async () => {},
    reset: async (_session, _signal, cycleId) => { resets.push(cycleId) },
    begin: async (_session, _signal, cycleId) => { cycle = cycleId },
    input: async (_session, button, down, _signal, _cycleId, stage) => {
      if (cycle === 1 && stage === 'exit' && button === 'B' && down) throw new Error('Player request timed out')
    },
    inspect: async () => ({ status: cycle === 1 ? 'normal' : 'shiny' }),
    inspectPhase: async () => ({ status: 'battle' }),
    saveState: async () => {}, release: async () => {},
  })
  const result = await controller.start([{ sessionId: 'a' }], { resetMode: 'exit-encounter', startMode: 'interact-a', stopMode: 'first-shiny' })
  assert.equal(result.phase, 'found')
  assert.deepEqual(resets, [1, 2])
})

test('exit mode resets every open player before shared navigation and the chosen encounter action', async () => {
  let time = 0
  const events = []
  const reads = new Map()
  const controller = createShinyHuntController({
    now: () => time, sleep: async ms => { time += ms },
    prepare: async () => { events.push(['prepare', time]) },
    reset: async session => { events.push(['reset', session.sessionId, time]) },
    begin: async (session, _signal, cycleId, options) => { events.push(['begin', session.sessionId, cycleId, options.afterReset, time]) },
    input: async (session, button, down, _signal, cycleId, stage) => {
      if (down) events.push(['input', session.sessionId, button, cycleId, stage, time])
    },
    inspect: async session => {
      const next = (reads.get(session.sessionId) ?? 0) + 1
      reads.set(session.sessionId, next)
      return { status: next === 1 ? 'pending' : 'shiny' }
    },
    inspectPhase: async () => ({ status: 'map' }),
    saveState: async () => {}, release: async () => {},
  })
  const result = await controller.start(sessions, { resetMode: 'exit-encounter', startMode: 'walk-right', stopMode: 'first-shiny' })
  assert.equal(result.phase, 'found')
  assert.equal(result.attemptCount, 2)
  assert.deepEqual(events.slice(0, 3), [['prepare', 0], ['reset', 'a', 0], ['reset', 'b', 0]])
  for (const session of sessions) {
    const own = events.filter(event => event[1] === session.sessionId)
    const inputs = own.filter(event => event[0] === 'input')
    assert.deepEqual(inputs.map(event => [event[2], event[3], event[4]]), [
      ['A', 1, 'navigation'], ['A', 1, 'navigation'], ['A', 1, 'navigation'], ['A', 1, 'navigation'],
      ['RIGHT', 1, 'encounter'],
    ])
    assert.ok(inputs[0][5] >= 2000)
    for (let index = 1; index < 4; index += 1) assert.ok(inputs[index][5] - inputs[index - 1][5] >= 1000)
    const started = own.find(event => event[0] === 'begin')
    assert.deepEqual(started.slice(0, 4), ['begin', session.sessionId, 1, true])
    assert.ok(started[4] - inputs[3][5] >= 1000)
    assert.ok(inputs[4][5] >= started[4])
  }
})

test('exit mode sends no navigation or encounter input when an initial reset fails', async () => {
  const inputs = []
  const resets = []
  const controller = createShinyHuntController({
    prepare: async () => {},
    reset: async session => {
      resets.push(session.sessionId)
      if (session.sessionId === 'b') throw new Error('reset failed')
    },
    begin: async () => { throw new Error('begin must not run') },
    input: async (...args) => { inputs.push(args) },
    inspect: async () => ({ status: 'pending' }),
    inspectPhase: async () => ({ status: 'map' }),
    saveState: async () => {}, release: async () => {},
  })
  const result = await controller.start(sessions, { resetMode: 'exit-encounter', startMode: 'common', stopMode: 'first-shiny' })
  assert.equal(result.phase, 'error')
  assert.equal(result.attemptCount, 0)
  assert.deepEqual(resets, ['a', 'b'])
  assert.deepEqual(inputs, [])
})

test('an initial reset failure waits for the other reset to settle before releasing the hunt', async () => {
  let finishSecond
  let released = false
  const second = new Promise(resolve => { finishSecond = resolve })
  const controller = createShinyHuntController({
    prepare: async () => {},
    reset: session => session.sessionId === 'a' ? Promise.reject(new Error('reset failed')) : second,
    begin: async () => {}, input: async () => {}, inspect: async () => ({ status: 'pending' }),
    saveState: async () => {}, release: async () => { released = true },
  })
  const running = controller.start(sessions, { resetMode: 'soft-reset', startMode: 'common', stopMode: 'first-shiny' })
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(released, false)
  finishSecond()
  const result = await running
  assert.equal(result.phase, 'error')
  assert.equal(released, true)
})

test('a player continues its hunt while another player is still looking for an encounter', async () => {
  let releaseSlowInput
  const slowInput = new Promise(resolve => { releaseSlowInput = resolve })
  let savedFast
  const fastSaved = new Promise(resolve => { savedFast = resolve })
  const resets = []
  const controller = createShinyHuntController({
    sleep: async () => {}, prepare: async () => {},
    reset: async session => { resets.push(session.sessionId) },
    begin: async () => {},
    input: async (session, button, down) => {
      if (session.sessionId === 'b' && button === 'LEFT' && down) await slowInput
    },
    inspect: async (session, _signal, cycleId) => ({ status: session.sessionId === 'a' ? cycleId === 1 ? 'normal' : 'shiny' : 'pending' }),
    saveState: async session => { if (session.sessionId === 'a') savedFast() },
    release: async () => {},
  })
  const running = controller.start(sessions, { resetMode: 'soft-reset', startMode: 'common', stopMode: 'all-shiny' })
  const fastAdvanced = await Promise.race([fastSaved.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 40))])
  controller.stop()
  releaseSlowInput()
  await running
  assert.equal(fastAdvanced, true)
  assert.deepEqual(resets.filter(id => id === 'a'), ['a', 'a'])
  assert.deepEqual(resets.filter(id => id === 'b'), ['b'])
})

test('first shiny stops another player mid-search and saves both states', async () => {
  let searching
  const slowSearching = new Promise(resolve => { searching = resolve })
  const saved = []
  const controller = createShinyHuntController({
    sleep: async () => {}, prepare: async () => {}, reset: async () => {}, begin: async () => {},
    input: async (session, button, down, signal) => {
      if (session.sessionId !== 'b' || button !== 'LEFT' || !down) return
      searching()
      await new Promise((resolve, reject) => signal.addEventListener('abort', () => {
        const error = new Error('stopped')
        error.name = 'AbortError'
        reject(error)
      }, { once: true }))
    },
    inspect: async session => session.sessionId === 'a' ? (await slowSearching, { status: 'shiny' }) : { status: 'pending' },
    saveState: async session => { saved.push(session.sessionId) }, release: async () => {},
  })
  const result = await controller.start(sessions, { resetMode: 'soft-reset', startMode: 'common', stopMode: 'first-shiny' })
  assert.equal(result.phase, 'found')
  assert.equal(result.foundSessionId, 'a')
  assert.equal(result.attemptCount, 1)
  assert.deepEqual(saved.sort(), ['a', 'b'])
})

test('late browser timers resume the four navigation presses without a burst', async () => {
  let time = 0
  const presses = []
  const controller = createShinyHuntController({
    now: () => time,
    sleep: async ms => { time += ms === 2000 ? 7000 : ms },
    prepare: async () => {}, reset: async () => {}, begin: async () => {},
    input: async (_session, button, down, _signal, _cycleId, stage) => {
      if (button === 'A' && down && stage === 'navigation') presses.push(time)
    },
    inspect: async () => ({ status: 'shiny' }),
    saveState: async () => {}, release: async () => {},
  })
  const result = await controller.start([{ sessionId: 'a' }], { resetMode: 'soft-reset', startMode: 'interact-a', stopMode: 'first-shiny' })
  assert.equal(result.phase, 'found')
  assert.deepEqual(presses, [7000, 8000, 9000, 10000])
})
