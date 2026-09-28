import { test, expect } from '@playwright/test'
import { addPane, boxSlot, closeWorkspace, createHubProfile, drag, hubSlot, occupiedIds, openWorkspace, readHubProfile, readLayout, readSave, selectHub, selectSave } from './helpers.mjs'
import { expectSnapshotUnique, watchSnapshots } from './snapshot-audit.mjs'

const audits = new WeakMap()
test.beforeEach(async ({ page }) => { audits.set(page, await watchSnapshots(page)) })
test.afterEach(async ({ page }, testInfo) => { await audits.get(page)(testInfo) })

test('confirmação atrasada de snapshot seguida de outro drag e close conserva todos os IDs', async ({ page }) => {
  const before = await occupiedIds('race-delayed')
  let releaseAck
  let committed
  const committedPromise = new Promise(resolve => { committed = resolve })
  const ackPromise = new Promise(resolve => { releaseAck = resolve })
  let held = false
  await page.route('**/pokemon-hub/sessions/*/snapshots', async route => {
    if (held) return route.continue()
    held = true
    const response = await route.fetch()
    committed(response.status())
    await ackPromise
    await route.fulfill({ response })
  })
  try {
    await openWorkspace(page)
    await selectSave(page, 0, 'race-delayed')
    await drag(page, boxSlot(page, 0, 0), boxSlot(page, 0, 5))
    expect(await committedPromise).toBe(200)
    await drag(page, boxSlot(page, 0, 1), boxSlot(page, 0, 6))
  } finally {
    releaseAck()
  }
  await closeWorkspace(page)
  const after = await readLayout('race-delayed')
  expect(after.boxes[0].slots.slice(5, 7).every(slot => slot.pokemonInstanceId)).toBe(true)
  expect((await occupiedIds('race-delayed')).sort()).toEqual(before.sort())
  expect((await readSave('race-delayed')).revision).toBeGreaterThan(1)
})

test('replay de snapshot aceito com a mesma chave não duplica o Pokémon', async ({ page }) => {
  const baseline = await occupiedIds('race-replay')
  const hub = await createHubProfile('E2E Replay')
  await openWorkspace(page)
  await selectSave(page, 0, 'race-replay')
  await addPane(page)
  await selectHub(page, 1, hub)
  const outbound = page.waitForRequest(request => /\/pokemon-hub\/sessions\/[^/]+\/snapshots$/.test(new URL(request.url()).pathname))
  await drag(page, boxSlot(page, 0, 0), hubSlot(page, 1, hub, 0))
  const request = await outbound
  await expect.poll(async () => Object.values((await readHubProfile(hub.hubProfileId)).profile.grid.entries).length).toBe(1)
  const replay = await fetch(request.url(), { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': request.headers()['idempotency-key'] }, body: request.postData() })
  expect(replay.status).toBe(200)
  expect(await replay.text()).toBe('')
  await closeWorkspace(page)
  const ids = [...await occupiedIds('race-replay'), ...Object.values((await readHubProfile(hub.hubProfileId)).profile.grid.entries).map(entry => entry.pokemonInstanceId)]
  expect(ids.sort()).toEqual(baseline.sort())
})

test('revisão obsoleta recebe correção íntegra e não altera o Save', async ({ page }) => {
  const baseline = await occupiedIds('race-stale')
  const movedId = (await readLayout('race-stale')).boxes[0].slots[0].pokemonInstanceId
  await openWorkspace(page)
  await selectSave(page, 0, 'race-stale')
  const moveRequest = page.waitForRequest(request => /\/pokemon-hub\/sessions\/[^/]+\/snapshots$/.test(new URL(request.url()).pathname))
  const moveResponse = page.waitForResponse(response => /\/pokemon-hub\/sessions\/[^/]+\/snapshots$/.test(new URL(response.url()).pathname))
  await drag(page, boxSlot(page, 0, 0), boxSlot(page, 0, 5))
  const request = await moveRequest
  const accepted = await moveResponse
  expect(accepted.status()).toBe(200)
  const stale = { ...request.postDataJSON(), revision: request.postDataJSON().revision - 1 }
  const corrected = await fetch(request.url(), { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify(stale) })
  expect(corrected.status).toBe(409)
  const authority = await corrected.json()
  expectSnapshotUnique(authority)
  expect(authority.revision).toBeGreaterThan(stale.revision)
  await closeWorkspace(page)
  expect((await occupiedIds('race-stale')).sort()).toEqual(baseline.sort())
  expect((await readLayout('race-stale')).boxes[0].slots[5].pokemonInstanceId).toBe(movedId)
})
