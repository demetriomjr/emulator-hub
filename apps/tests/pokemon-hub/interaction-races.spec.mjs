import { test, expect } from '@playwright/test'
import { pokemonGen3Adapter } from '../../packages/pokemon-gen3-adapter.mjs'
import { addPane, boxSlot, closeWorkspace, createHubProfile, drag, hubSlot, occupiedIds, openWorkspace, pane, readHubProfile, readLayout, readSave, selectHub, selectSave } from './helpers.mjs'
import { watchSnapshots } from './snapshot-audit.mjs'

const audits = new WeakMap()
test.beforeEach(async ({ page }) => { audits.set(page, await watchSnapshots(page)) })
test.afterEach(async ({ page }, testInfo) => { await audits.get(page)(testInfo) })

test('Escape durante drag ativo fecha a sessão sem snapshot nem mutação do Save', async ({ page }) => {
  const before = await readSave('race-cancel-drag')
  const beforeLayout = await readLayout('race-cancel-drag')
  const originalIds = (await occupiedIds('race-cancel-drag')).sort()
  await openWorkspace(page)
  await selectSave(page, 0, 'race-cancel-drag')
  let snapshotRequests = 0
  page.on('request', request => {
    if (request.method() === 'POST' && /\/pokemon-hub\/sessions\/[^/]+\/snapshots$/.test(new URL(request.url()).pathname)) snapshotRequests += 1
  })
  const from = await boxSlot(page, 0, 2).boundingBox()
  const to = await boxSlot(page, 0, 12).boundingBox()
  expect(from).not.toBeNull()
  expect(to).not.toBeNull()
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 })
  const closing = page.waitForResponse(response => response.request().method() === 'POST' && /\/pokemon-hub\/sessions\/[^/]+\/close$/.test(new URL(response.url()).pathname))
  await page.keyboard.press('Escape')
  await page.mouse.up()
  expect((await closing).status()).toBe(200)
  await expect(page.getByRole('dialog', { name: 'Pokémon Hub' })).toHaveCount(0)
  expect(snapshotRequests).toBe(0)
  const afterLayout = await readLayout('race-cancel-drag')
  expect(afterLayout.boxes[0].slots[2].pokemonInstanceId).toBe(beforeLayout.boxes[0].slots[2].pokemonInstanceId)
  expect(afterLayout.boxes[0].slots[12].pokemonInstanceId ?? null).toBeNull()
  expect((await occupiedIds('race-cancel-drag')).sort()).toEqual(originalIds)
  const afterSave = await readSave('race-cancel-drag')
  expect(Array.from({ length: 15 }, (_, slot) => pokemonGen3Adapter.readSlot(afterSave.bytes, 0, slot)?.canonical ?? null)).toEqual(
    Array.from({ length: 15 }, (_, slot) => pokemonGen3Adapter.readSlot(before.bytes, 0, slot)?.canonical ?? null),
  )
  await openWorkspace(page)
  await selectSave(page, 0, 'race-cancel-drag')
  await expect(boxSlot(page, 0, 2)).toHaveAccessibleName(/ocupada/)
  await closeWorkspace(page)
})

test('fechar painel Hub com ack retido materializa transferência uma vez', async ({ page }) => {
  test.setTimeout(90_000)
  const baseline = (await occupiedIds('race-close-hub')).sort()
  const movedId = (await readLayout('race-close-hub')).boxes[0].slots[2].pokemonInstanceId
  const hub = await createHubProfile('E2E Close Hub In Flight')
  let releaseAck
  let committed
  const ack = new Promise(resolve => { releaseAck = resolve })
  const committedResult = new Promise(resolve => { committed = resolve })
  let held = false
  await page.route('**/pokemon-hub/sessions/*/snapshots', async route => {
    if (held) return route.continue()
    held = true
    const response = await route.fetch()
    committed(response.status())
    await ack
    await route.fulfill({ response })
  })
  await openWorkspace(page)
  await selectSave(page, 0, 'race-close-hub')
  await addPane(page)
  await selectHub(page, 1, hub)
  try {
    await drag(page, boxSlot(page, 0, 2), hubSlot(page, 1, hub, 0), { settleMs: 30 })
    expect(await committedResult).toBe(200)
    await pane(page, 1).getByRole('button', { name: 'Fechar container' }).click()
  } finally { releaseAck() }
  await expect(page.locator('.pokemon-workspace-pane')).toHaveCount(1)
  await closeWorkspace(page)
  const hubIds = Object.values((await readHubProfile(hub.hubProfileId)).profile.grid.entries).map(entry => entry.pokemonInstanceId)
  expect(hubIds).toEqual([movedId])
  expect([...await occupiedIds('race-close-hub'), ...hubIds].sort()).toEqual(baseline)
  expect(pokemonGen3Adapter.readSlot((await readSave('race-close-hub')).bytes, 0, 2)).toBeNull()
})

test('fechamento espera heartbeat em trânsito antes de invalidar a sessão', async ({ page }) => {
  let releaseHeartbeat
  let signalHeartbeat
  const heldHeartbeat = new Promise(resolve => { releaseHeartbeat = resolve })
  const heartbeatStarted = new Promise(resolve => { signalHeartbeat = resolve })
  let held = false
  await page.route('**/pokemon-hub/sessions/*/heartbeat', async route => {
    if (held) return route.continue()
    held = true
    signalHeartbeat()
    await heldHeartbeat
    await route.continue()
  })
  await openWorkspace(page)
  await selectSave(page, 0, 'race-close-hub')
  await heartbeatStarted
  const closes = []
  page.on('request', request => {
    if (request.method() === 'POST' && /\/pokemon-hub\/sessions\/[^/]+\/close$/.test(new URL(request.url()).pathname)) closes.push(request)
  })
  const closing = page.waitForResponse(response => response.request().method() === 'POST' && /\/pokemon-hub\/sessions\/[^/]+\/close$/.test(new URL(response.url()).pathname))
  try {
    await page.getByRole('button', { name: 'Fechar Pokémon Hub' }).click()
    await page.waitForTimeout(200)
    expect(closes).toHaveLength(0)
  } finally { releaseHeartbeat() }
  expect((await closing).status()).toBe(200)
  await expect(page.getByRole('dialog', { name: 'Pokémon Hub' })).toHaveCount(0)
})
