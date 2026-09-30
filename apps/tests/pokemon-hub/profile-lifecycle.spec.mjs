import { test, expect } from '@playwright/test'
import { pokemonGen3Adapter } from '../../packages/pokemon-gen3-adapter.mjs'
import { addPane, boxSlot, closeWorkspace, createHubProfile, drag, hubSlot, openWorkspace, pane, profiles, gameId, readHubProfile, readLayout, readSave, selectHub, selectSave } from './helpers.mjs'
import { watchSnapshots } from './snapshot-audit.mjs'

const audits = new WeakMap()
test.beforeEach(async ({ page }) => { audits.set(page, await watchSnapshots(page)) })
test.afterEach(async ({ page }, testInfo) => { await audits.get(page)(testInfo) })

test('reserva imediatamente o Hub escolhido e libera o anterior só após confirmar', async ({ page }) => {
  const first = await createHubProfile('E2E Reserva Hub A')
  const second = await createHubProfile('E2E Reserva Hub B')
  await openWorkspace(page)
  await selectHub(page, 0, first)
  await addPane(page)

  let release, started
  const hold = new Promise(resolve => { release = resolve })
  const requested = new Promise(resolve => { started = resolve })
  await page.route('**/pokemon-hub/sessions/*/panes/0', async route => {
    if (route.request().method() !== 'POST') return route.continue()
    const response = await route.fetch()
    started()
    await hold
    await route.fulfill({ response })
  })

  const firstSelector = pane(page, 0).getByRole('combobox', { name: 'Perfil do Hub' })
  await firstSelector.click()
  await firstSelector.fill(second.name)
  await firstSelector.press('Enter')
  try {
    await requested
    const secondPane = pane(page, 1)
    await secondPane.getByRole('button', { name: 'Perfil do Hub', exact: true }).click()
    const otherSelector = secondPane.getByRole('combobox', { name: 'Perfil do Hub' })
    await otherSelector.click()
    await otherSelector.fill(second.name)
    await expect(page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: second.name })).toHaveCount(0)
    await otherSelector.fill(first.name)
    await expect(page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: first.name })).toHaveCount(0)
  } finally { release() }

  await expect(pane(page, 0).getByRole('heading', { name: second.name })).toBeVisible()
  const otherSelector = pane(page, 1).getByRole('combobox', { name: 'Perfil do Hub' })
  if (await otherSelector.getAttribute('aria-expanded') !== 'true') await otherSelector.click()
  await otherSelector.fill(first.name)
  await expect(page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: first.name })).toBeVisible()
  await otherSelector.fill(second.name)
  await expect(page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: second.name })).toHaveCount(0)
  await closeWorkspace(page)
})

test('devolve o Save ao seletor dos outros blocos quando o carregamento falha', async ({ page }) => {
  await openWorkspace(page)
  await selectSave(page, 0, 'isolated-a')
  await addPane(page)
  const currentSelector = pane(page, 0).getByRole('combobox', { name: 'Perfil de Save' })
  await currentSelector.click()
  await expect(page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: 'isolated-b' })).toBeVisible()
  await currentSelector.press('Escape')

  let release, started
  const hold = new Promise(resolve => { release = resolve })
  const requested = new Promise(resolve => { started = resolve })
  await page.route('**/pokemon-hub/sessions/*/panes/1', async route => {
    if (route.request().method() !== 'POST') return route.continue()
    started()
    await hold
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Falha de carregamento simulada' }) })
  })

  await selectSave(page, 1, 'isolated-b', { waitForLoad: false })
  try {
    await requested
    const selector = pane(page, 0).getByRole('combobox', { name: 'Perfil de Save' })
    await selector.click()
    await expect(page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: 'isolated-b' })).toHaveCount(0)
  } finally { release() }

  await expect(pane(page, 1).getByRole('status', { name: 'Processando painel 2' })).toHaveCount(0)
  const selector = pane(page, 0).getByRole('combobox', { name: 'Perfil de Save' })
  if (await selector.getAttribute('aria-expanded') !== 'true') await selector.click()
  await expect(page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: 'isolated-b' })).toBeVisible()
  await closeWorkspace(page)
})

test('um movimento nos Saves durante a troca do terceiro pane permanece após a resposta atrasada', async ({ page }) => {
 test.setTimeout(90_000)
 const hubA=await createHubProfile('E2E Peer Race A'), hubB=await createHubProfile('E2E Peer Race B')
 const id=(await readLayout('race-pane-a')).boxes[0].slots[0].pokemonInstanceId
 await openWorkspace(page)
 await selectHub(page,0,hubA)
 await addPane(page)
 await selectSave(page,1,'race-pane-a')
 await addPane(page)
 await selectSave(page,2,'race-pane-b')
 let release, loaded
 const hold=new Promise(resolve=>{release=resolve}), started=new Promise(resolve=>{loaded=resolve})
 await page.route('**/pokemon-hub/sessions/*/panes/0',async route=>{
  if(route.request().method()!=='POST') return route.continue()
  const response=await route.fetch()
  loaded()
  await hold
  await route.fulfill({response})
 })
 const selector=pane(page,0).getByRole('combobox',{name:'Perfil do Hub'})
 await selector.click()
 await selector.fill(hubB.name)
 await selector.press('Enter')
 try {
  await started
  await expect(pane(page,0).getByRole('status',{name:'Processando painel 1'})).toBeVisible()
  await expect(boxSlot(page,1,0)).toBeEnabled()
  await drag(page,boxSlot(page,1,0),boxSlot(page,2,5))
 } finally {release()}
 await expect(pane(page,0).getByRole('heading',{name:hubB.name})).toBeVisible()
 await expect(boxSlot(page,2,5)).toHaveAccessibleName(/ocupada/)
 await closeWorkspace(page)
 expect((await readLayout('race-pane-a')).boxes[0].slots[0].occupied).toBe(false)
 expect(pokemonGen3Adapter.readSlot((await readSave('race-pane-a')).bytes,0,0)).toBeNull()
 expect((await readLayout('race-pane-b')).boxes[0].slots[5].pokemonInstanceId).toBe(id)
})

test('trocar somente o Hub depois de transferir dois Pokémon não restaura o Save', async ({ page }) => {
  const originalSave = (await readSave('isolated-a')).bytes.toString('base64')
  const first = await createHubProfile('E2E Isolado A')
  const second = await createHubProfile('E2E Isolado B')
  await openWorkspace(page)
  await selectHub(page, 0, second)
  await addPane(page)
  await selectSave(page, 1, 'isolated-a')
  await closeWorkspace(page)

  await openWorkspace(page)
  await selectHub(page, 0, first)
  await addPane(page)
  await selectSave(page, 1, 'isolated-a')
  await addPane(page)
  await selectSave(page, 2, 'isolated-b')
  for (const slot of [0, 1]) {
    await drag(page, boxSlot(page, 1, slot), hubSlot(page, 0, first, slot))
    await expect(boxSlot(page, 1, slot)).toHaveAccessibleName(/vazia/)
    await expect(hubSlot(page, 0, first, slot)).toHaveAccessibleName(/ocupada/)
  }
  const requests = []
  page.on('request', request => { if (request.url().includes('/api/')) requests.push(request.url()) })
  await page.evaluate(() => {
    window.hubGlobalSplashSeen = false
    new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (node.nodeType === 1 && (node.matches('.pokemon-workspace-stale') || node.querySelector('.pokemon-workspace-stale'))) window.hubGlobalSplashSeen = true
      }
    }).observe(document.body, { childList: true, subtree: true })
  })
  await selectHub(page, 0, second)
  for (const slot of [0, 1]) await expect(boxSlot(page, 1, slot)).toHaveAccessibleName(/vazia/)
  await selectHub(page, 0, first)
  for (const slot of [0, 1]) {
    await expect(boxSlot(page, 1, slot)).toHaveAccessibleName(/vazia/)
    await expect(hubSlot(page, 0, first, slot)).toHaveAccessibleName(/ocupada/)
  }
  expect(requests.filter(url => /\/close$|\/save-profiles\//.test(url))).toEqual([])
  expect(await page.evaluate(() => window.hubGlobalSplashSeen)).toBe(false)
  await selectSave(page, 1, 'lifecycle-c')
  await selectSave(page, 1, 'isolated-a')
  const currentLayout = await readLayout('isolated-a')
  for (const slot of [0, 1]) expect(currentLayout.boxes[0].slots[slot].occupied).toBe(false)
  for (const slot of [0, 1]) expect(pokemonGen3Adapter.readSlot((await readSave('isolated-a')).bytes, 0, slot)).toBeNull()
  await closeWorkspace(page)
  for (const slot of [0, 1]) expect(pokemonGen3Adapter.readSlot((await readSave('isolated-a')).bytes, 0, slot)).toBeNull()
  const historyResponse = await fetch(process.env.E2E_API_URL + '/api/pokemon-hub/sessions')
  expect(historyResponse.status).toBe(200)
  const { sessions } = await historyResponse.json()
  const session = sessions.at(-1)
  expect(session.closedAt).not.toBeNull()
  const originalsResponse = await fetch(process.env.E2E_API_URL + '/api/pokemon-hub/sessions/' + session.sessionId + '/backups')
  expect(originalsResponse.status).toBe(200)
  const { backups } = await originalsResponse.json()
  expect(backups.map(backup => backup.sourceKey).sort()).toEqual([
    'hub:' + first.hubProfileId, 'hub:' + second.hubProfileId,
    'save:' + profiles['isolated-a'] + ':' + gameId, 'save:' + profiles['isolated-b'] + ':' + gameId,
    'save:' + profiles['lifecycle-c'] + ':' + gameId,
  ].sort())
  expect(backups.find(backup => backup.original.save?.bytesBase64 === originalSave)).toBeTruthy()
  expect(backups.find(backup => backup.sourceKey === 'hub:' + first.hubProfileId).original.source.placements.every(slot => slot.pokemonInstanceId === null)).toBe(true)

})

test('criar e reabrir perfil Hub sem Save não mostra erro estrutural', async ({ page }) => {
  const browserErrors = []
  page.on('console', message => { if (message.type() === 'error') browserErrors.push(message.text()) })
  await openWorkspace(page)
  await pane(page, 0).getByRole('button', { name: 'Perfil do Hub', exact: true }).click()
  await pane(page, 0).getByRole('button', { name: 'Criar Perfil do Hub' }).click()
  await page.getByRole('textbox', { name: 'Nome do Perfil do Hub' }).fill('E2E Hub Novo Sozinho')
  await page.getByRole('button', { name: 'Criar perfil', exact: true }).click()
  await expect(pane(page, 0).getByRole('heading', { name: 'E2E Hub Novo Sozinho' })).toBeVisible()
  await closeWorkspace(page)
  await openWorkspace(page)
  await selectHub(page, 0, { name: 'E2E Hub Novo Sozinho' })
  await closeWorkspace(page)
  expect(browserErrors).toEqual([])
})

test('excluir perfil Hub aparece junto ao criar somente com perfil selecionado', async ({ page }) => {
  const profile = await createHubProfile('E2E Excluir na barra')
  await openWorkspace(page)
  const firstPane = pane(page, 0)
  await firstPane.getByRole('button', { name: 'Perfil do Hub', exact: true }).click()
  await expect(firstPane.getByRole('button', { name: `Excluir ${profile.name}` })).toHaveCount(0)
  await selectHub(page, 0, profile)
  const deleteButton = firstPane.getByRole('button', { name: `Excluir ${profile.name}` })
  await expect(deleteButton).toBeVisible()
  await deleteButton.click()
  await expect(page.getByText(`Excluir ${profile.name}?`)).toBeVisible()
  await page.getByRole('button', { name: 'Cancelar' }).click()
  await selectSave(page, 0, 'lifecycle-a')
  await expect(deleteButton).toHaveCount(0)
  await selectHub(page, 0, profile)
  await deleteButton.click()
  await page.getByRole('button', { name: 'Excluir', exact: true }).click()
  await expect(deleteButton).toHaveCount(0)
  await expect(firstPane.getByRole('heading', { name: profile.name })).toHaveCount(0)
})

test('trocar Hubs anteriormente usados com Saves diferentes preserva os dois Saves abertos', async ({ page }) => {
  test.setTimeout(150_000)
  const first = await createHubProfile('E2E Independent A')
  const second = await createHubProfile('E2E Independent B')
  const firstId = (await readLayout('lifecycle-a')).boxes[0].slots[0].pokemonInstanceId
  const secondId = (await readLayout('lifecycle-b')).boxes[0].slots[0].pokemonInstanceId

  await openWorkspace(page)
  await selectSave(page, 0, 'lifecycle-a')
  await addPane(page)
  await selectHub(page, 1, first)
  await drag(page, boxSlot(page, 0, 0), hubSlot(page, 1, first, 0))
  await closeWorkspace(page)

  await openWorkspace(page)
  await selectSave(page, 0, 'lifecycle-b')
  await addPane(page)
  await selectHub(page, 1, second)
  await drag(page, boxSlot(page, 0, 0), hubSlot(page, 1, second, 0))
  await closeWorkspace(page)
  const settledSaveA = (await readSave('lifecycle-a')).bytes
  const settledSaveB = (await readSave('lifecycle-b')).bytes

  await openWorkspace(page)
  await selectHub(page, 0, first)
  await addPane(page)
  await selectSave(page, 1, 'lifecycle-a')
  await addPane(page)
  await selectSave(page, 2, 'lifecycle-b')
  for (let cycle = 0; cycle < 6; cycle += 1) {
    const selected = cycle % 2 === 0 ? second : first
    await selectHub(page, 0, selected)
    await expect(hubSlot(page, 0, selected, 0)).toHaveAccessibleName(/ocupada/)
    await expect(boxSlot(page, 1, 1)).toBeVisible()
    await expect(boxSlot(page, 2, 1)).toBeVisible()
  }
  expect((await readSave('lifecycle-a')).bytes.equals(settledSaveA)).toBe(true)
  expect((await readSave('lifecycle-b')).bytes.equals(settledSaveB)).toBe(true)
  await drag(page, boxSlot(page, 2, 1), hubSlot(page, 0, first, 1))
  await expect(hubSlot(page, 0, first, 1)).toHaveAccessibleName(/ocupada/)
  await drag(page, hubSlot(page, 0, first, 1), boxSlot(page, 2, 5), { settleMs: 150 })
  await expect(boxSlot(page, 2, 5)).toHaveAccessibleName(/ocupada/)
  await closeWorkspace(page)
  expect(Object.values((await readHubProfile(first.hubProfileId)).profile.grid.entries).map(entry => entry.pokemonInstanceId)).toEqual([firstId])
  expect(Object.values((await readHubProfile(second.hubProfileId)).profile.grid.entries).map(entry => entry.pokemonInstanceId)).toEqual([secondId])
  expect((await readSave('lifecycle-a')).bytes.equals(settledSaveA)).toBe(true)
  expect(pokemonGen3Adapter.readSlot((await readSave('lifecycle-b')).bytes, 0, 1)).toBeNull()
  expect(pokemonGen3Adapter.readSlot((await readSave('lifecycle-b')).bytes, 0, 5)?.canonical.species).toBe(64)
})

test('campanha de abertura, troca e fechamento alterna owners sem erro de backend', async ({ page }) => {
  test.setTimeout(180_000)
  const first = await createHubProfile('E2E Brute Hub A')
  const second = await createHubProfile('E2E Brute Hub B')

  await openWorkspace(page)
  await selectSave(page, 0, 'lifecycle-stress-a')
  await addPane(page)
  await selectHub(page, 1, first)
  await closeWorkspace(page)
  await openWorkspace(page)
  await selectSave(page, 0, 'lifecycle-stress-b')
  await addPane(page)
  await selectHub(page, 1, second)
  await closeWorkspace(page)

  const originalA = (await readSave('lifecycle-stress-a')).bytes
  const originalB = (await readSave('lifecycle-stress-b')).bytes
  for (let cycle = 0; cycle < 12; cycle += 1) {
    await openWorkspace(page)
    await selectHub(page, 0, cycle % 2 ? second : first)
    await addPane(page)
    await selectSave(page, 1, 'lifecycle-stress-a')
    await addPane(page)
    await selectSave(page, 2, 'lifecycle-stress-b')
    await selectHub(page, 0, cycle % 2 ? first : second)
    await expect(boxSlot(page, 1, 0)).toHaveAccessibleName(/ocupada/)
    await expect(boxSlot(page, 2, 0)).toHaveAccessibleName(/ocupada/)
    await closeWorkspace(page)
  }
  expect((await readSave('lifecycle-stress-a')).bytes.equals(originalA)).toBe(true)
  expect((await readSave('lifecycle-stress-b')).bytes.equals(originalB)).toBe(true)
})

test('dois perfis Hub de owners distintos em painéis diferentes não derrubam a sessão atual', async ({ page }) => {
  const first = await createHubProfile('E2E Simultaneo A')
  const second = await createHubProfile('E2E Simultaneo B')
  await openWorkspace(page)
  await selectSave(page, 0, 'lifecycle-a')
  await addPane(page)
  await selectHub(page, 1, first)
  await closeWorkspace(page)
  await openWorkspace(page)
  await selectSave(page, 0, 'lifecycle-b')
  await addPane(page)
  await selectHub(page, 1, second)
  await closeWorkspace(page)

  await openWorkspace(page)
  await selectHub(page, 0, first)
  await addPane(page)
  const secondPane = pane(page, 1)
  await secondPane.getByRole('button', { name: 'Perfil do Hub', exact: true }).click()
  const selector = secondPane.getByRole('combobox', { name: 'Perfil do Hub' })
  await selector.click()
  await selector.fill(second.name)
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: second.name }).click()
  await expect(pane(page, 1).getByRole('heading', { name: second.name })).toBeVisible()
  await expect(pane(page, 0).getByRole('heading', { name: first.name })).toBeVisible()
  await closeWorkspace(page)
})
