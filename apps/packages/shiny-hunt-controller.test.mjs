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

test('saves every open player and stops before another reset on enemy shiny', async () => {
  const { controller, calls } = harness((_cycle, sessionId) => ({ status: sessionId === 'b' ? 'shiny' : 'normal' }))
  const outcome = await controller.start(sessions)
  assert.deepEqual(outcome, { phase: 'found', resetCount: 1, foundSessionId: 'b' })
  assert.equal(calls.filter(call => call[0] === 'reset').length, 2)
  assert.equal(calls.filter(call => call[0] === 'pulse' && call[1]).length, 5)
  assert.deepEqual(calls.filter(call => call[0] === 'save').map(call => call[1]), ['a', 'b'])
  assert.equal(calls.some(call => call[0] === 'status' && call[1] === 'found'), true)
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
