import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import { gameId, occupiedIds, profiles, readLayout, readSave } from './helpers.mjs'
import { expectSnapshotUnique } from './snapshot-audit.mjs'

const api = process.env.E2E_API_URL
const logPath = join(process.env.E2E_ARTIFACT_DIR, 'backend.ndjson')
let logOffset = 0

test.beforeEach(async () => { logOffset = (await stat(logPath).catch(() => ({ size: 0 }))).size })
test.afterEach(async ({}, testInfo) => {
  const log = (await readFile(logPath)).subarray(logOffset)
  await testInfo.attach('backend.ndjson', { body: log, contentType: 'application/x-ndjson' })
  if (testInfo.status === 'passed') {
    const errors = log.toString('utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(event => event.level === 'error')
    expect(errors).toEqual([])
  }
})

async function loadedSession(request, profileName) {
  const profileId = profiles[profileName]
  const base = `${api}/api/pokemon-hub/sessions`
  const opened = await request.post(base, { data: {} })
  expect(opened.status()).toBe(201)
  const { sessionId } = await opened.json()
  const url = `${base}/${sessionId}`
  const pane = await request.post(`${url}/panes/0`, { data: { source: { kind: 'game', profileId, gameId } } })
  expect(pane.status()).toBe(200)
  const snapshot = await pane.json()
  expectSnapshotUnique(snapshot)
  return { url, snapshot }
}

async function submit(request, url, snapshot, idempotencyKey = crypto.randomUUID()) {
  return request.post(`${url}/snapshots`, { data: snapshot, headers: { 'idempotency-key': idempotencyKey } })
}

async function close(request, url, snapshot) {
  const response = await request.post(`${url}/close`, { data: snapshot, headers: { 'idempotency-key': crypto.randomUUID() } })
  expect(response.status(), await response.text()).toBe(200)
}

function moved(snapshot, from, to) {
  const candidate = structuredClone(snapshot)
  const entry = candidate.panes[0].boxes.find(box => box.slot === from)
  expect(entry).toBeTruthy()
  entry.slot = to
  return candidate
}

test('dois snapshots válidos da mesma revisão em paralelo aceitam só um escritor', async ({ request }) => {
  const baseline = (await occupiedIds('adversarial-parallel')).sort()
  const before = await readLayout('adversarial-parallel')
  const { url, snapshot } = await loadedSession(request, 'adversarial-parallel')
  const [first, second] = await Promise.all([
    submit(request, url, moved(snapshot, 0, 5)),
    submit(request, url, moved(snapshot, 1, 6)),
  ])
  expect([first.status(), second.status()].sort()).toEqual([200, 409])
  const corrected = first.status() === 409 ? await first.json() : await second.json()
  expectSnapshotUnique(corrected)
  expect(corrected.revision).toBe(snapshot.revision + 1)
  await close(request, url, corrected)
  const after = await readLayout('adversarial-parallel')
  const firstMoved = after.boxes[0].slots[5].pokemonInstanceId === before.boxes[0].slots[0].pokemonInstanceId
  const secondMoved = after.boxes[0].slots[6].pokemonInstanceId === before.boxes[0].slots[1].pokemonInstanceId
  expect(Number(firstMoved) + Number(secondMoved)).toBe(1)
  expect((await occupiedIds('adversarial-parallel')).sort()).toEqual(baseline)
  expect((await readSave('adversarial-parallel')).revision).toBeGreaterThan(1)
})

test('IDs duplicado, ausente e desconhecido recebem correção sem mutação parcial', async ({ request }) => {
  const baseline = (await occupiedIds('adversarial-duplicate')).sort()
  const savedBefore = await readSave('adversarial-duplicate')
  const { url, snapshot } = await loadedSession(request, 'adversarial-duplicate')
  const duplicate = structuredClone(snapshot)
  duplicate.panes[0].boxes.push({ pokemonInstanceId: duplicate.panes[0].boxes[0].pokemonInstanceId, slot: 5 })
  const missing = structuredClone(snapshot)
  missing.panes[0].boxes = missing.panes[0].boxes.filter(entry => entry.slot !== 0)
  const unknown = structuredClone(snapshot)
  unknown.panes[0].boxes.push({ pokemonInstanceId: crypto.randomUUID(), slot: 6 })
  for (const candidate of [duplicate, missing, unknown]) {
    const response = await submit(request, url, candidate)
    expect(response.status()).toBe(409)
    const corrected = await response.json()
    expectSnapshotUnique(corrected)
    expect(corrected).toEqual(snapshot)
  }
  await close(request, url, snapshot)
  expect((await occupiedIds('adversarial-duplicate')).sort()).toEqual(baseline)
  const savedAfter = await readSave('adversarial-duplicate')
  expect(savedAfter.revision).toBe(savedBefore.revision)
  expect(savedAfter.bytes).toEqual(savedBefore.bytes)
})

test('mesma chave com payload diferente retorna a autoridade sem aplicar segunda mutação', async ({ request }) => {
  const baseline = (await occupiedIds('adversarial-payload')).sort()
  const firstId = (await readLayout('adversarial-payload')).boxes[0].slots[0].pokemonInstanceId
  const { url, snapshot } = await loadedSession(request, 'adversarial-payload')
  const key = crypto.randomUUID()
  const accepted = await submit(request, url, moved(snapshot, 0, 5), key)
  expect(accepted.status()).toBe(200)
  const conflict = await submit(request, url, moved(snapshot, 0, 6), key)
  expect(conflict.status()).toBe(409)
  const authority = await conflict.json()
  expectSnapshotUnique(authority)
  await close(request, url, authority)
  const layout = await readLayout('adversarial-payload')
  expect(layout.boxes[0].slots[5].pokemonInstanceId).toBe(firstId)
  expect(layout.boxes[0].slots[6].pokemonInstanceId).toBeFalsy()
  expect((await occupiedIds('adversarial-payload')).sort()).toEqual(baseline)
})
