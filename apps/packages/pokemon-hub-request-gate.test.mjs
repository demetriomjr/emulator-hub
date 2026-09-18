import assert from 'node:assert/strict'
import test from 'node:test'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail })
  return { promise, resolve, reject }
}

test('keeps a pending heartbeat behind every active session request', async () => {
  const module = await import('./pokemon-hub-request-gate.mjs').catch(() => ({}))
  assert.equal(typeof module.createPokemonHubRequestGate, 'function')
  const gate = module.createPokemonHubRequestGate()
  const first = deferred()
  const second = deferred()
  void gate.run(() => first.promise)
  void gate.run(() => second.promise)
  let idle = false
  const waiting = gate.waitForIdle().then(() => { idle = true })

  first.resolve()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(idle, false)
  second.resolve()
  await waiting
  assert.equal(idle, true)
  assert.equal(gate.isInFlight(), false)
})

test('unblocks liveness after a failed session request settles', async () => {
  const module = await import('./pokemon-hub-request-gate.mjs').catch(() => ({}))
  assert.equal(typeof module.createPokemonHubRequestGate, 'function')
  const gate = module.createPokemonHubRequestGate()
  const request = deferred()
  const failure = new Error('request failed')
  const sent = gate.run(() => request.promise)
  const waiting = gate.waitForIdle()

  request.reject(failure)
  await assert.rejects(sent, failure)
  assert.equal(await waiting, true)
  assert.equal(gate.isInFlight(), false)
})
