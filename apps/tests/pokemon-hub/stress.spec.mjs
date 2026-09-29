import { test, expect } from '@playwright/test'
import { pokemonGen3Adapter } from '../../packages/pokemon-gen3-adapter.mjs'
import { addPane, boxSlot, closeWorkspace, createHubProfile, drag, gameId, hubSlot, occupiedIds, openWorkspace, pane, profiles, readHubProfile, readLayout, readSave, selectHub, selectSave } from './helpers.mjs'
import { expectSnapshotUnique, watchSnapshots } from './snapshot-audit.mjs'

const audits = new WeakMap()
test.beforeEach(async ({ page }, testInfo) => {
  const mayAbort = testInfo.title.includes('ack descartado') || testInfo.title.includes('F5 antes') || testInfo.title.includes('F5 com ack retido')
  audits.set(page, await watchSnapshots(page, { expectedFailedRequests: 0, maximumFailedRequests: mayAbort ? 1 : 0, maximumUnansweredRequests: testInfo.title.includes('F5 com ack retido') ? 1 : 0 }))
})
test.afterEach(async ({ page }, testInfo) => { await audits.get(page)(testInfo) })

test('24 drags alternados forçam debounce e fila sem perder ou duplicar IDs', async ({ page }, testInfo) => {
  test.setTimeout(180_000)
  const baseline = (await occupiedIds('stress-drags')).sort()
  const initial = await readLayout('stress-drags')
  const originals = initial.boxes[0].slots.slice(0, 3).map(slot => slot.pokemonInstanceId)
  await openWorkspace(page)
  await selectSave(page, 0, 'stress-drags')
  const start = performance.now()
  for (let turn = 0; turn < 24; turn += 1) {
    const index = turn % 3
    const from = Math.floor(turn / 3) % 2 === 0 ? index : index + 10
    const to = from === index ? index + 10 : index
    await drag(page, boxSlot(page, 0, from), boxSlot(page, 0, to))
    await expect(boxSlot(page, 0, to)).toHaveAccessibleName(/ocupada/)
  }
  await closeWorkspace(page)
  const elapsedMs = Math.round(performance.now() - start)
  await testInfo.attach('stress-timing.json', { body: JSON.stringify({ drags: 24, elapsedMs }), contentType: 'application/json' })
  const after = await readLayout('stress-drags')
  expect(after.boxes[0].slots.slice(0, 3).map(slot => slot.pokemonInstanceId)).toEqual(originals)
  expect(after.boxes[0].slots.slice(10, 13).every(slot => !slot.pokemonInstanceId)).toBe(true)
  expect((await occupiedIds('stress-drags')).sort()).toEqual(baseline)
  const saved = await readSave('stress-drags')
  expect([0, 1, 2].map(slot => pokemonGen3Adapter.readSlot(saved.bytes, 0, slot)?.canonical.species)).toEqual([25, 64, 133])
})

test('seis ciclos de close e reabertura renovam session ID e persistem Eevee', async ({ page }) => {
  test.setTimeout(180_000)
  const baseline = (await occupiedIds('stress-cycles')).sort()
  const eeveeId = (await readLayout('stress-cycles')).boxes[0].slots[2].pokemonInstanceId
  const sessionIds = []
  for (let cycle = 0; cycle < 6; cycle += 1) {
    await openWorkspace(page)
    const opening = page.waitForResponse(response => /\/pokemon-hub\/sessions$/.test(new URL(response.url()).pathname) && response.status() === 201)
    await selectSave(page, 0, 'stress-cycles')
    sessionIds.push((await opening).json().then(body => body.sessionId))
    const from = cycle % 2 === 0 ? 2 : 12
    const to = cycle % 2 === 0 ? 12 : 2
    await drag(page, boxSlot(page, 0, from), boxSlot(page, 0, to))
    await closeWorkspace(page)
    expect((await readLayout('stress-cycles')).boxes[0].slots[to].pokemonInstanceId).toBe(eeveeId)
    expect(pokemonGen3Adapter.readSlot((await readSave('stress-cycles')).bytes, 0, to)?.canonical.species).toBe(133)
    expect((await occupiedIds('stress-cycles')).sort()).toEqual(baseline)
  }
  expect(new Set(await Promise.all(sessionIds)).size).toBe(6)
})

test('F5 após mover Eevee abandona sessão antiga, libera lease e cria sessão nova', async ({ page }) => {
  test.setTimeout(90_000)
  const baseline = (await occupiedIds('stress-reload')).sort()
  const eeveeId = (await readLayout('stress-reload')).boxes[0].slots[2].pokemonInstanceId
  await openWorkspace(page)
  const opening = page.waitForResponse(response => /\/pokemon-hub\/sessions$/.test(new URL(response.url()).pathname) && response.status() === 201)
  await selectSave(page, 0, 'stress-reload')
  const oldSessionId = (await (await opening).json()).sessionId
  const accepted = page.waitForResponse(response => /\/pokemon-hub\/sessions\/[^/]+\/snapshots$/.test(new URL(response.url()).pathname) && response.status() === 200)
  await drag(page, boxSlot(page, 0, 2), boxSlot(page, 0, 12))
  await accepted
  await page.reload()
  await expect(page.getByRole('dialog', { name: 'Pokémon Hub' })).toHaveCount(0)
  await expect.poll(async () => (await readLayout('stress-reload')).boxes[0].slots[12].pokemonInstanceId, { timeout: 20_000 }).toBe(eeveeId)
  await openWorkspace(page)
  const reopening = page.waitForResponse(response => /\/pokemon-hub\/sessions$/.test(new URL(response.url()).pathname) && response.status() === 201)
  await selectSave(page, 0, 'stress-reload')
  const newSessionId = (await (await reopening).json()).sessionId
  expect(newSessionId).not.toBe(oldSessionId)
  await expect(boxSlot(page, 0, 12)).toHaveAccessibleName(/ocupada/)
  await closeWorkspace(page)
  expect((await occupiedIds('stress-reload')).sort()).toEqual(baseline)
  expect(pokemonGen3Adapter.readSlot((await readSave('stress-reload')).bytes, 0, 12)?.canonical.species).toBe(133)
})

test('oito requisições simultâneas com a mesma chave não aplicam o movimento oito vezes', async ({ page }) => {
  test.setTimeout(90_000)
  const baseline = (await occupiedIds('stress-idempotent')).sort()
  const movedId = (await readLayout('stress-idempotent')).boxes[0].slots[0].pokemonInstanceId
  let injected = false
  await page.route('**/pokemon-hub/sessions/*/snapshots', async route => {
    if (injected) return route.continue()
    injected = true
    const original = route.request()
    const replies = await Promise.all(Array.from({ length: 8 }, () => fetch(original.url(), {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': original.headers()['idempotency-key'] }, body: original.postData(),
    })))
    expect(replies.map(reply => reply.status)).toEqual(Array(8).fill(200))
    await route.continue()
  })
  await openWorkspace(page)
  await selectSave(page, 0, 'stress-idempotent')
  await drag(page, boxSlot(page, 0, 0), boxSlot(page, 0, 5))
  await expect.poll(() => injected).toBe(true)
  await closeWorkspace(page)
  expect((await readLayout('stress-idempotent')).boxes[0].slots[5].pokemonInstanceId).toBe(movedId)
  expect((await occupiedIds('stress-idempotent')).sort()).toEqual(baseline)
  expect(pokemonGen3Adapter.readSlot((await readSave('stress-idempotent')).bytes, 0, 5)?.canonical.species).toBe(25)
})

test('doze snapshots obsoletos simultâneos não sobrescrevem o estado confirmado', async ({ page }) => {
  test.setTimeout(90_000)
  const baseline = (await occupiedIds('stress-conflict')).sort()
  const movedId = (await readLayout('stress-conflict')).boxes[0].slots[0].pokemonInstanceId
  await openWorkspace(page)
  await selectSave(page, 0, 'stress-conflict')
  const moveRequest = page.waitForRequest(request => /\/pokemon-hub\/sessions\/[^/]+\/snapshots$/.test(new URL(request.url()).pathname))
  const moveResponse = page.waitForResponse(response => /\/pokemon-hub\/sessions\/[^/]+\/snapshots$/.test(new URL(response.url()).pathname))
  await drag(page, boxSlot(page, 0, 0), boxSlot(page, 0, 5))
  const request = await moveRequest
  expect((await moveResponse).status()).toBe(200)
  const stale = { ...request.postDataJSON(), revision: request.postDataJSON().revision - 1 }
  const corrections = await Promise.all(Array.from({ length: 12 }, () => fetch(request.url(), {
    method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify(stale),
  })))
  expect(corrections.map(response => response.status)).toEqual(Array(12).fill(409))
  const authorities = await Promise.all(corrections.map(response => response.json()))
  for (const authority of authorities) expectSnapshotUnique(authority)
  expect(new Set(authorities.map(authority => JSON.stringify(authority))).size).toBe(1)
  await closeWorkspace(page)
  expect((await readLayout('stress-conflict')).boxes[0].slots[5].pokemonInstanceId).toBe(movedId)
  expect((await occupiedIds('stress-conflict')).sort()).toEqual(baseline)
})

test('segunda sessão não adota Save ocupado e consegue adotá-lo após o close', async ({ page }) => {
  const baseline = (await occupiedIds('stress-tabs')).sort()
  await openWorkspace(page)
  await selectSave(page, 0, 'stress-tabs')
  const base = process.env.E2E_API_URL
  const owner = profiles['stress-tabs']
  const opened = await fetch(`${base}/api/profiles/${owner}/pokemon-hub/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
  expect(opened.status).toBe(201)
  const second = await opened.json()
  const paneUrl = `${base}/api/profiles/${owner}/pokemon-hub/sessions/${second.sessionId}/panes/0`
  const source = { kind: 'game', profileId: owner, gameId }
  const blocked = await fetch(paneUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source }) })
  expect(blocked.status).toBe(409)
  expectSnapshotUnique(await blocked.json())
  await closeWorkspace(page)
  const acquired = await fetch(paneUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source }) })
  expect(acquired.status).toBe(200)
  const authority = await acquired.json()
  expectSnapshotUnique(authority)
  const closed = await fetch(`${base}/api/profiles/${owner}/pokemon-hub/sessions/${second.sessionId}/close`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify(authority),
  })
  expect(closed.status).toBe(200)
  expect((await occupiedIds('stress-tabs')).sort()).toEqual(baseline)
})

test('ack descartado após commit recupera Eevee e libera sessão pela expiração', async ({ page }) => {
  test.setTimeout(90_000)
  const baseline = (await occupiedIds('stress-lost-ack')).sort()
  const eeveeId = (await readLayout('stress-lost-ack')).boxes[0].slots[2].pokemonInstanceId
  let discarded = false
  await page.route('**/pokemon-hub/sessions/*/snapshots', async route => {
    if (discarded) return route.continue()
    discarded = true
    const response = await route.fetch()
    expect(response.status()).toBe(200)
    await route.abort('failed')
  })
  await openWorkspace(page)
  await selectSave(page, 0, 'stress-lost-ack')
  await drag(page, boxSlot(page, 0, 2), boxSlot(page, 0, 12))
  await expect.poll(() => discarded).toBe(true)
  await expect(page.getByRole('dialog', { name: 'Pokémon Hub' })).toHaveCount(0)
  await page.reload()
  await expect.poll(async () => pokemonGen3Adapter.readSlot((await readSave('stress-lost-ack')).bytes, 0, 12)?.canonical.species, { timeout: 20_000 }).toBe(133)
  expect((await readLayout('stress-lost-ack')).boxes[0].slots[12].pokemonInstanceId).toBe(eeveeId)
  await openWorkspace(page)
  await selectSave(page, 0, 'stress-lost-ack')
  await closeWorkspace(page)
  expect((await occupiedIds('stress-lost-ack')).sort()).toEqual(baseline)
})

test('100 drags pseudoaleatórios entre 15 slots mantêm o modelo e o Save físico', async ({ page }, testInfo) => {
  test.setTimeout(180_000)
  const before = await readLayout('stress-random')
  const expected = Array.from({ length: 15 }, (_, slot) => before.boxes[0].slots[slot].pokemonInstanceId ?? null)
  const speciesById = new Map(expected.slice(0, 3).map((id, index) => [id, [25, 64, 133][index]]))
  const baseline = (await occupiedIds('stress-random')).sort()
  const initialSeed = Number(process.env.E2E_STRESS_SEED ?? 0x5eed1234) >>> 0
  let seed = initialSeed
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 0x100000000)
  await openWorkspace(page)
  await selectSave(page, 0, 'stress-random')
  const startedAt = performance.now()
  for (let turn = 0; turn < 100; turn += 1) {
    const sources = expected.flatMap((id, slot) => id ? [slot] : [])
    const targets = expected.flatMap((id, slot) => id ? [] : [slot])
    const from = sources[Math.floor(random() * sources.length)]
    const to = targets[Math.floor(random() * targets.length)]
    await drag(page, boxSlot(page, 0, from), boxSlot(page, 0, to))
    await expect(boxSlot(page, 0, to)).toHaveAccessibleName(/ocupada/)
    expected[to] = expected[from]
    expected[from] = null
  }
  await closeWorkspace(page)
  const after = await readLayout('stress-random')
  expect(after.boxes[0].slots.slice(0, 15).map(slot => slot.pokemonInstanceId ?? null)).toEqual(expected)
  expect((await occupiedIds('stress-random')).sort()).toEqual(baseline)
  const saved = await readSave('stress-random')
  expect(expected.map((id, slot) => pokemonGen3Adapter.readSlot(saved.bytes, 0, slot)?.canonical.species ?? null)).toEqual(expected.map(id => speciesById.get(id) ?? null))
  await testInfo.attach('random-stress.json', { body: JSON.stringify({ seed: initialSeed, drags: 100, elapsedMs: Math.round(performance.now() - startedAt), finalSlots: expected }), contentType: 'application/json' })
})

test('30 transferências pseudoaleatórias entre dois Saves e um perfil Hub conservam IDs', async ({ page }, testInfo) => {
  test.setTimeout(180_000)
  const hub = await createHubProfile('E2E Cross Stress')
  const a = await readLayout('stress-cross-a')
  const b = await readLayout('stress-cross-b', 'stress-cross-a')
  const model = [
    Array.from({ length: 10 }, (_, slot) => a.boxes[0].slots[slot].pokemonInstanceId ?? null),
    Array.from({ length: 10 }, (_, slot) => b.boxes[0].slots[slot].pokemonInstanceId ?? null),
    Array(10).fill(null),
  ]
  const baseline = [...await occupiedIds('stress-cross-a'), ...await occupiedIds('stress-cross-b', 'stress-cross-a')].sort()
  const initialSeed = process.env.E2E_STRESS_SEED ? (Number(process.env.E2E_STRESS_SEED) ^ 0xa5a5a5a5) >>> 0 : 0x98765432
  let seed = initialSeed
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 0x100000000)
  const slot = (source, index) => source === 2 ? hubSlot(page, 2, hub, index) : boxSlot(page, source, index)
  const hittable = locator => locator.evaluate(element => {
    const rect = element.getBoundingClientRect()
    const underPointer = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
    return underPointer === element || element.contains(underPointer)
  })
  await openWorkspace(page)
  await selectSave(page, 0, 'stress-cross-a')
  await addPane(page)
  await selectSave(page, 1, 'stress-cross-b')
  await addPane(page)
  await selectHub(page, 2, hub)
  const startedAt = performance.now()
  for (let turn = 0; turn < 30; turn += 1) {
    const sourceCandidates = model.flatMap((slots, source) => slots.flatMap((id, index) => id ? [{ source, index }] : []))
    const sources = []
    for (const candidate of sourceCandidates) if (await hittable(slot(candidate.source, candidate.index))) sources.push(candidate)
    expect(sources.length, `no hittable source on turn ${turn}`).toBeGreaterThan(0)
    const from = sources[Math.floor(random() * sources.length)]
    const targetCandidates = model.flatMap((slots, source) => source === from.source ? [] : slots.flatMap((id, index) => id ? [] : [{ source, index }]))
    const targets = []
    for (const candidate of targetCandidates) if (await hittable(slot(candidate.source, candidate.index))) targets.push(candidate)
    expect(targets.length, `no hittable destination on turn ${turn}`).toBeGreaterThan(0)
    const to = targets[Math.floor(random() * targets.length)]
    await drag(page, slot(from.source, from.index), slot(to.source, to.index), { travelSteps: 1, settleMs: 80 })
    try {
      await expect(slot(to.source, to.index)).toHaveAccessibleName(/ocupada/)
    } catch (error) {
      await testInfo.attach('cross-failure.json', { body: JSON.stringify({ seed: initialSeed, turn, from, to, model }), contentType: 'application/json' })
      throw error
    }
    model[to.source][to.index] = model[from.source][from.index]
    model[from.source][from.index] = null
  }
  await closeWorkspace(page)
  const afterA = await readLayout('stress-cross-a')
  const afterB = await readLayout('stress-cross-b', 'stress-cross-a')
  const afterHub = await readHubProfile(hub.hubProfileId)
  expect(afterA.boxes[0].slots.slice(0, 10).map(slot => slot.pokemonInstanceId ?? null)).toEqual(model[0])
  expect(afterB.boxes[0].slots.slice(0, 10).map(slot => slot.pokemonInstanceId ?? null)).toEqual(model[1])
  expect(Array.from({ length: 10 }, (_, index) => afterHub.profile.grid.entries[String(index)]?.pokemonInstanceId ?? null)).toEqual(model[2])
  const all = [...await occupiedIds('stress-cross-a'), ...await occupiedIds('stress-cross-b', 'stress-cross-a'), ...Object.values(afterHub.profile.grid.entries).map(entry => entry.pokemonInstanceId)]
  expect(all.sort()).toEqual(baseline)
  await testInfo.attach('cross-stress.json', { body: JSON.stringify({ seed: initialSeed, transfers: 30, elapsedMs: Math.round(performance.now() - startedAt), finalSlots: model }), contentType: 'application/json' })
})

test('F5 antes do debounce não duplica Eevee e libera a sessão abandonada', async ({ page }) => {
  test.setTimeout(90_000)
  const baseline = (await occupiedIds('stress-before-debounce')).sort()
  const eeveeId = (await readLayout('stress-before-debounce')).boxes[0].slots[2].pokemonInstanceId
  await openWorkspace(page)
  await selectSave(page, 0, 'stress-before-debounce')
  await drag(page, boxSlot(page, 0, 2), boxSlot(page, 0, 12))
  await page.reload()
  await expect.poll(async () => {
    const save = await readSave('stress-before-debounce')
    return pokemonGen3Adapter.readSlot(save.bytes, 0, 2)?.canonical.species === 133 || pokemonGen3Adapter.readSlot(save.bytes, 0, 12)?.canonical.species === 133
  }, { timeout: 20_000 }).toBe(true)
  await page.waitForTimeout(11_000)
  await openWorkspace(page)
  await selectSave(page, 0, 'stress-before-debounce')
  await closeWorkspace(page)
  const layout = await readLayout('stress-before-debounce')
  const eeveeSlots = [2, 12].filter(slot => layout.boxes[0].slots[slot].pokemonInstanceId === eeveeId)
  expect(eeveeSlots).toHaveLength(1)
  expect((await occupiedIds('stress-before-debounce')).sort()).toEqual(baseline)
})

test('F5 com ack retido após commit recupera Eevee sem reaplicar o snapshot', async ({ page }) => {
  test.setTimeout(90_000)
  const baseline = (await occupiedIds('stress-held-reload')).sort()
  const eeveeId = (await readLayout('stress-held-reload')).boxes[0].slots[2].pokemonInstanceId
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
    await route.fulfill({ response }).catch(() => {})
  })
  try {
    await openWorkspace(page)
    await selectSave(page, 0, 'stress-held-reload')
    await drag(page, boxSlot(page, 0, 2), boxSlot(page, 0, 12))
    expect(await committedResult).toBe(200)
    await page.reload()
  } finally { releaseAck() }
  await expect.poll(async () => pokemonGen3Adapter.readSlot((await readSave('stress-held-reload')).bytes, 0, 12)?.canonical.species, { timeout: 20_000 }).toBe(133)
  await openWorkspace(page)
  await selectSave(page, 0, 'stress-held-reload')
  await closeWorkspace(page)
  expect((await readLayout('stress-held-reload')).boxes[0].slots[12].pokemonInstanceId).toBe(eeveeId)
  expect((await occupiedIds('stress-held-reload')).sort()).toEqual(baseline)
})

test('UI aplica correção 409 de snapshot obsoleto e permite novo movimento íntegro', async ({ page }) => {
  test.setTimeout(90_000)
  const baseline = (await occupiedIds('stress-ui-correction')).sort()
  const eeveeId = (await readLayout('stress-ui-correction')).boxes[0].slots[2].pokemonInstanceId
  let altered = false
  await page.route('**/pokemon-hub/sessions/*/snapshots', async route => {
    if (altered) return route.continue()
    altered = true
    const original = route.request().postDataJSON()
    await route.continue({ postData: JSON.stringify({ ...original, revision: original.revision - 1 }) })
  })
  await openWorkspace(page)
  await selectSave(page, 0, 'stress-ui-correction')
  const correction = page.waitForResponse(response => /\/pokemon-hub\/sessions\/[^/]+\/snapshots$/.test(new URL(response.url()).pathname) && response.status() === 409)
  await drag(page, boxSlot(page, 0, 2), boxSlot(page, 0, 12))
  expectSnapshotUnique(await (await correction).json())
  await expect(boxSlot(page, 0, 2)).toHaveAccessibleName(/ocupada/)
  await drag(page, boxSlot(page, 0, 2), boxSlot(page, 0, 12))
  await closeWorkspace(page)
  expect((await readLayout('stress-ui-correction')).boxes[0].slots[12].pokemonInstanceId).toBe(eeveeId)
  expect((await occupiedIds('stress-ui-correction')).sort()).toEqual(baseline)
})

test('doze snapshots confirmados um a um mantêm revisões crescentes e drenam a fila', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  const baseline = (await occupiedIds('stress-snapshot-queue')).sort()
  const eeveeId = (await readLayout('stress-snapshot-queue')).boxes[0].slots[2].pokemonInstanceId
  const revisions = []
  page.on('request', request => {
    if (/\/pokemon-hub\/sessions\/[^/]+\/snapshots$/.test(new URL(request.url()).pathname)) revisions.push(request.postDataJSON().revision)
  })
  await openWorkspace(page)
  await selectSave(page, 0, 'stress-snapshot-queue')
  for (let turn = 0; turn < 12; turn += 1) {
    const from = turn % 2 === 0 ? 2 : 12
    const to = turn % 2 === 0 ? 12 : 2
    const response = page.waitForResponse(reply => /\/pokemon-hub\/sessions\/[^/]+\/snapshots$/.test(new URL(reply.url()).pathname))
    await drag(page, boxSlot(page, 0, from), boxSlot(page, 0, to))
    expect((await response).status()).toBe(200)
  }
  await closeWorkspace(page)
  expect(revisions).toHaveLength(12)
  expect(revisions.every((revision, index) => index === 0 || revision > revisions[index - 1])).toBe(true)
  expect((await readLayout('stress-snapshot-queue')).boxes[0].slots[2].pokemonInstanceId).toBe(eeveeId)
  expect((await occupiedIds('stress-snapshot-queue')).sort()).toEqual(baseline)
  await testInfo.attach('queue-revisions.json', { body: JSON.stringify({ revisions }), contentType: 'application/json' })
})

test('duas abas reais disputam o mesmo Save e a segunda abre depois do close', async ({ page }) => {
  test.setTimeout(90_000)
  const baseline = (await occupiedIds('stress-browser-tabs')).sort()
  await openWorkspace(page)
  await selectSave(page, 0, 'stress-browser-tabs')
  const second = await page.context().newPage()
  try {
    await openWorkspace(second)
    const panel = pane(second, 0)
    await panel.getByRole('button', { name: 'Perfil de Save' }).click()
    const rom = panel.getByRole('combobox', { name: 'ROM com perfil' })
    await rom.click()
    await rom.press('Enter')
    const profile = panel.getByRole('combobox', { name: 'Perfil de Save' })
    await profile.click()
    await profile.press('Home')
    const ordinal = Object.keys(profiles).indexOf('stress-browser-tabs')
    for (let index = 0; index < ordinal; index += 1) await profile.press('ArrowDown')
    const blocked = second.waitForResponse(response => /\/pokemon-hub\/sessions\/[^/]+\/panes\/0$/.test(new URL(response.url()).pathname))
    await profile.press('Enter')
    expect((await blocked).status()).toBe(409)
    await expect(boxSlot(second, 0, 0)).toHaveCount(0)
    await closeWorkspace(page)
    await closeWorkspace(second)
    await openWorkspace(second)
    await selectSave(second, 0, 'stress-browser-tabs')
    await expect(boxSlot(second, 0, 0)).toHaveAccessibleName(/ocupada/)
    await closeWorkspace(second)
  } finally { await second.close() }
  expect((await occupiedIds('stress-browser-tabs')).sort()).toEqual(baseline)
})

test('fechar painel de origem com ack retido drena a operação e libera ambos os Saves', async ({ page }) => {
  test.setTimeout(90_000)
  const beforeA = await readLayout('stress-pane-a')
  const baseline = [...await occupiedIds('stress-pane-a'), ...await occupiedIds('stress-pane-b', 'stress-pane-a')].sort()
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
  await selectSave(page, 0, 'stress-pane-a')
  await addPane(page)
  await selectSave(page, 1, 'stress-pane-b')
  try {
    await drag(page, boxSlot(page, 0, 0), boxSlot(page, 0, 5))
    expect(await committedResult).toBe(200)
    await pane(page, 0).getByRole('button', { name: 'Fechar container' }).click()
  } finally { releaseAck() }
  await expect(page.locator('.pokemon-workspace-pane')).toHaveCount(1)
  await closeWorkspace(page)
  expect((await readLayout('stress-pane-a')).boxes[0].slots[5].pokemonInstanceId).toBe(beforeA.boxes[0].slots[0].pokemonInstanceId)
  expect([...await occupiedIds('stress-pane-a'), ...await occupiedIds('stress-pane-b', 'stress-pane-a')].sort()).toEqual(baseline)
  await openWorkspace(page)
  await selectSave(page, 0, 'stress-pane-a')
  await closeWorkspace(page)
})

test('vinte ciclos de abrir e fechar perfil Hub mantêm o seletor e as sessões estáveis', async ({ page }) => {
  test.setTimeout(180_000)
  const baseline = (await occupiedIds('stress-hub-selector')).sort()
  const savedBefore = await readSave('stress-hub-selector')
  const hub = await createHubProfile('E2E Selector Stress')
  await openWorkspace(page)
  await selectSave(page, 0, 'stress-hub-selector')
  for (let cycle = 0; cycle < 20; cycle += 1) {
    await addPane(page)
    await selectHub(page, 1, hub)
    await pane(page, 1).getByRole('button', { name: 'Fechar container' }).click()
    await expect(page.locator('.pokemon-workspace-pane')).toHaveCount(1)
  }
  await closeWorkspace(page)
  expect((await occupiedIds('stress-hub-selector')).sort()).toEqual(baseline)
  const savedAfter = await readSave('stress-hub-selector')
  expect(savedAfter.bytes).toEqual(savedBefore.bytes)
})
