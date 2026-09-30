import { test, expect } from '@playwright/test'
import { pokemonGen3Adapter } from '../../packages/pokemon-gen3-adapter.mjs'
import { addPane, boxSlot, closeWorkspace, createHubProfile, drag, hubSlot, openWorkspace, pane, readHubProfile, readLayout, readSave, selectHub, selectSave } from './helpers.mjs'
import { watchSnapshots } from './snapshot-audit.mjs'

const audits = new WeakMap()
test.beforeEach(async ({ page }) => { audits.set(page, await watchSnapshots(page)) })
test.afterEach(async ({ page }, testInfo) => { await audits.get(page)(testInfo) })

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

test('trocar perfis Hub de owners distintos com dois Saves abertos preserva os dados', async ({ page }) => {
  test.setTimeout(150_000)
  const first = await createHubProfile('E2E Owner A')
  const second = await createHubProfile('E2E Owner B')
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
  await expect(page.getByText('Close the other Hub profile before switching to this one.')).toBeVisible()
  await expect(pane(page, 0).getByRole('heading', { name: first.name })).toBeVisible()
  await closeWorkspace(page)
})
