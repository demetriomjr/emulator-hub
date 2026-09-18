import assert from 'node:assert/strict'
import test from 'node:test'

import { createPokemonHubSnapshotFlight } from './pokemon-hub-snapshot-flight.mjs'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail })
  return { promise, resolve, reject }
}

function fixture() {
  let revision = 0
  let candidate = 'first'
  const requests = []
  const accepted = []
  const corrected = []
  const failed = []
  const flight = createPokemonHubSnapshotFlight({
    capture: () => ({ revision, value: candidate }),
    send: request => {
      const response = deferred()
      requests.push({ request, response })
      return response.promise
    },
    onAccepted: request => { revision = request.revision + 1; accepted.push(request.value) },
    onCorrection: snapshot => { revision = snapshot.revision; corrected.push(snapshot) },
    onFailure: error => { failed.push(error) },
    newId: (() => { let value = 0; return () => `flight-${++value}` })(),
  })
  return { flight, requests, accepted, corrected, failed, setCandidate(value) { candidate = value } }
}

test('a drain coalesces later local moves into one successor request', async () => {
  const { flight, requests, accepted, setCandidate } = fixture()
  flight.markDirty()
  void flight.flush()

  setCandidate('second')
  flight.markDirty()
  setCandidate('latest')
  flight.markDirty()
  const draining = flight.drain()

  requests[0].response.resolve(null)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(requests.length, 2)
  assert.deepEqual(requests[1].request.snapshot, { revision: 1, value: 'latest' })

  requests[1].response.resolve(null)
  assert.equal(await draining, true)
  assert.deepEqual(accepted, ['first', 'latest'])
})

test('a correction clears later dirty work instead of dispatching it from a stale base', async () => {
  const { flight, requests, corrected, setCandidate } = fixture()
  flight.markDirty()
  void flight.flush()
  setCandidate('later')
  flight.markDirty()
  const draining = flight.drain()

  requests[0].response.resolve({ revision: 4, panes: [null, null, null] })

  assert.equal(await draining, true)
  assert.equal(requests.length, 1)
  assert.equal(flight.isDirty(), false)
  assert.deepEqual(corrected, [{ revision: 4, panes: [null, null, null] }])
})

test('a terminal request failure stops the drain and never invents a retry identity', async () => {
  const { flight, requests, failed } = fixture()
  flight.markDirty()
  const draining = flight.drain()
  const failure = new Error('connection lost')

  requests[0].response.reject(failure)

  assert.equal(await draining, false)
  assert.equal(requests.length, 1)
  assert.deepEqual(failed, [failure])
})

test('an explicit lost-response retry reuses the exact immutable body and idempotency key', async () => {
  const { flight, requests, setCandidate } = fixture()
  flight.markDirty()
  const first = flight.flush()
  const original = structuredClone(requests[0].request)

  requests[0].response.reject(new Error('response lost'))
  assert.equal(await first, false)

  setCandidate('must-not-replace-failed-request')
  const retry = flight.retryFailed()
  assert.equal(requests.length, 2)
  assert.deepEqual(requests[1].request, original)
  assert.equal(requests[1].request.idempotencyKey, requests[0].request.idempotencyKey)

  requests[1].response.resolve(null)
  assert.equal(await retry, true)
})
