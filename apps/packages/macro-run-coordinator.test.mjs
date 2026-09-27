import assert from 'node:assert/strict'
import test from 'node:test'
import { createMacroRunCoordinator } from './macro-run-coordinator.mjs'

test('starts only after every player prepares and keeps an early completion', async () => {
  const calls = []
  let coordinator
  coordinator = createMacroRunCoordinator({
    request: async (participant, phase, runId) => {
      calls.push([participant, phase])
      if (phase === 'start' && participant === 'first') coordinator.ended('first', runId, 'completed')
      return { runId }
    },
    onChange() {},
  })
  await coordinator.start({ id: 'macro', items: [] }, ['first', 'second'])
  assert.deepEqual(calls.slice(0, 2), [['first', 'prepare'], ['second', 'prepare']])
  assert.equal(coordinator.getState().phase, 'running')
  coordinator.ended('second', coordinator.getState().runId, 'completed')
  assert.equal(coordinator.getState().phase, 'idle')
})

test('shows starting while waiting for player start acknowledgments', async () => {
  let confirmStart
  const coordinator = createMacroRunCoordinator({
    request: async (_, phase) => phase === 'start' ? new Promise(resolve => { confirmStart = resolve }) : undefined,
  })
  const starting = coordinator.start({ id: 'macro' }, ['first'])
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(coordinator.getState().phase, 'starting')
  confirmStart()
  await starting
  assert.equal(coordinator.getState().phase, 'running')
})

test('failed preparation stops all participants and does not report running', async () => {
  const calls = []
  const coordinator = createMacroRunCoordinator({
    request: async (participant, phase) => { calls.push([participant, phase]); if (participant === 'second' && phase === 'prepare') throw new Error('unavailable') },
    onChange() {},
  })
  await assert.rejects(() => coordinator.start({ id: 'macro' }, ['first', 'second']), /unavailable/)
  assert.ok(calls.some(([, phase]) => phase === 'stop'))
  assert.equal(coordinator.getState().phase, 'failed')
})

test('failed start with unconfirmed rollback keeps Parar available', async () => {
  let stopFails = true
  const coordinator = createMacroRunCoordinator({
    request: async (participant, phase) => {
      if (participant === 'second' && phase === 'start') throw new Error('start failed')
      if (phase === 'stop' && stopFails) throw new Error('stop timeout')
    },
  })
  await assert.rejects(() => coordinator.start({ id: 'macro' }, ['first', 'second']), /start failed/)
  assert.equal(coordinator.getState().phase, 'running')
  assert.match(coordinator.getState().error, /Parada não confirmada/)
  stopFails = false
  await coordinator.stop()
  assert.equal(coordinator.getState().phase, 'idle')
})

test('stop timeout keeps Parar available for retry until a player confirms', async () => {
  let failStop = true
  const coordinator = createMacroRunCoordinator({
    request: async (_, phase) => { if (phase === 'stop' && failStop) throw new Error('timeout') },
  })
  await coordinator.start({ id: 'macro' }, ['first'])
  await assert.rejects(() => coordinator.stop(), /timeout/)
  assert.equal(coordinator.getState().phase, 'running')
  assert.match(coordinator.getState().error, /Parada não confirmada/)
  failStop = false
  await coordinator.stop()
  assert.equal(coordinator.getState().phase, 'idle')
})

test('terminal event during stopping does not bypass a missing stop acknowledgment', async () => {
  let rejectStop
  const coordinator = createMacroRunCoordinator({
    request: async (_, phase) => { if (phase === 'stop') return new Promise((_, reject) => { rejectStop = reject }) },
  })
  await coordinator.start({ id: 'macro' }, ['first'])
  const runId = coordinator.getState().runId
  const stopping = coordinator.stop()
  coordinator.ended('first', runId, 'stopped')
  assert.equal(coordinator.getState().phase, 'stopping')
  rejectStop(new Error('timeout'))
  await assert.rejects(stopping, /timeout/)
  assert.equal(coordinator.getState().phase, 'running')
})

test('a player stopping unexpectedly cancels the other participants', async () => {
  const calls = []
  const coordinator = createMacroRunCoordinator({ request: async (participant, phase) => { calls.push([participant, phase]) } })
  await coordinator.start({ id: 'macro' }, ['first', 'second'])
  coordinator.ended('first', coordinator.getState().runId, 'stopped')
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.ok(calls.some(([participant, phase]) => participant === 'second' && phase === 'stop'))
  assert.equal(coordinator.getState().phase, 'idle')
})

test('a lost iframe is excluded while the remaining player is stopped', async () => {
  const calls = []
  const coordinator = createMacroRunCoordinator({ request: async (participant, phase) => { calls.push([participant, phase]) } })
  await coordinator.start({ id: 'macro' }, ['lost', 'survivor'])
  await coordinator.lost('lost')
  assert.ok(calls.some(([participant, phase]) => participant === 'survivor' && phase === 'stop'))
  assert.equal(calls.some(([participant, phase]) => participant === 'lost' && phase === 'stop'), false)
  assert.equal(coordinator.getState().phase, 'failed')
  assert.match(coordinator.getState().error, /player/i)
})

test('player failure stops peers and reports failure after confirmation', async () => {
  const calls = []
  const coordinator = createMacroRunCoordinator({ request: async (participant, phase) => { calls.push([participant, phase]) } })
  await coordinator.start({ id: 'macro' }, ['first', 'second'])
  coordinator.ended('first', coordinator.getState().runId, 'failed')
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.ok(calls.some(([participant, phase]) => participant === 'second' && phase === 'stop'))
  assert.equal(coordinator.getState().phase, 'failed')
})
