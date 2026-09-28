import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { expect } from '@playwright/test'

const logPath = join(process.env.E2E_ARTIFACT_DIR, 'backend.ndjson')

export async function watchSnapshots(page, { expectedFailedRequests = 0, maximumFailedRequests = expectedFailedRequests, maximumUnansweredRequests = 0 } = {}) {
  const start = (await stat(logPath).catch(() => ({ size: 0 }))).size
  const requests = new Map()
  const records = []
  const responseJobs = []
  const onRequest = request => {
    const kind = requestKind(request)
    if (!kind) return
    let snapshot
    try { snapshot = request.postDataJSON() } catch { snapshot = null }
    const record = {
      kind, url: new URL(request.url()).pathname,
      idempotencyKey: request.headers()['idempotency-key'] ?? null,
      snapshot, startedAt: performance.now(), status: null, failure: null, elapsedMs: null, correction: null,
    }
    requests.set(request, record)
    records.push(record)
  }
  const onResponse = response => {
    const record = requests.get(response.request())
    if (!record) return
    record.status = response.status()
    record.elapsedMs = Math.round((performance.now() - record.startedAt) * 100) / 100
    if (record.status === 409) responseJobs.push(response.json().then(body => { record.correction = body }))
  }
  const onRequestFailed = request => {
    const record = requests.get(request)
    if (record) record.failure = request.failure()?.errorText ?? 'request failed'
  }
  page.on('request', onRequest)
  page.on('response', onResponse)
  page.on('requestfailed', onRequestFailed)
  return async testInfo => {
    page.off('request', onRequest)
    page.off('response', onResponse)
    page.off('requestfailed', onRequestFailed)
    await Promise.all(responseJobs)
    const log = await readFile(logPath).catch(() => Buffer.alloc(0))
    const events = log.subarray(start).toString('utf8').split('\n').filter(Boolean).flatMap(line => {
      try { return [JSON.parse(line)] } catch { return [] }
    })
    const backendDurations = events.filter(event => event.event === 'snapshot.http.response').map(event => event.elapsedMs).sort((a, b) => a - b)
    const report = {
      requests: records, events,
      timing: { count: backendDurations.length, p95Ms: backendDurations[Math.max(0, Math.ceil(backendDurations.length * 0.95) - 1)] ?? null, maxMs: backendDurations.at(-1) ?? null },
    }
    await testInfo.attach('snapshot-audit.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' })
    if (testInfo.status !== 'passed') return report
    const fingerprints = new Map()
    const acceptedRevisions = new Map()
    const failedRequests = records.filter(record => record.failure && record.status === null).length
    expect(failedRequests).toBeGreaterThanOrEqual(expectedFailedRequests)
    expect(failedRequests).toBeLessThanOrEqual(maximumFailedRequests)
    const unansweredRequests = records.filter(record => !record.failure && record.status === null).length
    expect(unansweredRequests).toBeLessThanOrEqual(maximumUnansweredRequests)
    for (const record of records) {
      if (record.status === null) continue
      expect(record.status, `${record.kind} did not receive a response`).not.toBeNull()
      expect([200, 409], `${record.kind} returned HTTP ${record.status}`).toContain(record.status)
      expect(record.idempotencyKey).toBeTruthy()
      expectSnapshotUnique(record.snapshot)
      if (record.correction) expectSnapshotUnique(record.correction)
      const key = `${record.url}:${record.idempotencyKey}`
      const fingerprint = JSON.stringify(record.snapshot)
      if (fingerprints.has(key)) expect(fingerprint, `idempotency key ${key} changed payload`).toBe(fingerprints.get(key))
      else fingerprints.set(key, fingerprint)
      if (record.kind === 'snapshot' && record.status === 200 && !acceptedRevisions.get(record.url)?.has(record.idempotencyKey)) {
        const previous = acceptedRevisions.get(record.url) ?? new Map()
        const latest = [...previous.values()].at(-1)
        if (latest !== undefined) expect(record.snapshot.revision, 'accepted snapshot revision regressed').toBeGreaterThan(latest)
        previous.set(record.idempotencyKey, record.snapshot.revision)
        acceptedRevisions.set(record.url, previous)
      }
    }
    expect(events.filter(event => event.level === 'error'), 'backend emitted errors').toEqual([])
    expect(report.timing.maxMs ?? 0, 'snapshot backend response exceeded 5 seconds in the isolated fixture').toBeLessThan(5_000)
    return report
  }
}

export function expectSnapshotUnique(snapshot) {
  expect(snapshot?.panes).toHaveLength(3)
  const ids = []
  for (const pane of snapshot.panes) {
    if (!pane) continue
    for (const placement of [...(pane.party ?? []), ...(pane.boxes ?? []), ...(pane.hub ?? [])]) {
      ids.push(placement.pokemonInstanceId)
    }
  }
  expect(ids.every(Boolean), 'snapshot contains an empty occupied placement').toBe(true)
  expect(new Set(ids).size, 'snapshot duplicates a Pokémon ID').toBe(ids.length)
}

function requestKind(request) {
  if (request.method() !== 'POST') return null
  const path = new URL(request.url()).pathname
  if (/\/pokemon-hub\/sessions\/[^/]+\/snapshots$/.test(path)) return 'snapshot'
  if (/\/pokemon-hub\/sessions\/[^/]+\/close$/.test(path)) return 'close'
  return null
}
