import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect } from '@playwright/test'

const api = process.env.E2E_API_URL
const fixture = JSON.parse(await readFile(join(process.env.E2E_ARTIFACT_DIR, 'fixture.json'), 'utf8'))
const selectedSavesByPage = new WeakMap()
export const gameId = fixture.gameId
export const profiles = fixture.profiles

export async function readLayout(profileName, workspaceProfileName = profileName) {
  const profileId = profiles[profileName]
  const owner = profiles[workspaceProfileName]
  const response = await fetch(`${api}/api/pokemon-hub/save-profiles/${gameId}/${profileId}/layout?workspaceProfileId=${owner}`)
  expect(response.status, await response.clone().text()).toBe(200)
  return response.json()
}

export async function readSave(profileName) {
  const response = await fetch(`${api}/api/profiles/${profiles[profileName]}/games/${gameId}/save`)
  expect(response.status).toBe(200)
  return { bytes: Buffer.from(await response.arrayBuffer()), revision: Number(response.headers.get('etag')?.replaceAll('"', '')) }
}

export async function createHubProfile(name) {
  const response = await fetch(`${api}/api/pokemon-hub/profiles`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }),
  })
  expect(response.status).toBe(201)
  return response.json()
}

export async function readHubProfile(id) {
  const response = await fetch(`${api}/api/pokemon-hub/profiles/${id}`)
  expect(response.status).toBe(200)
  return response.json()
}

export async function openWorkspace(page) {
  selectedSavesByPage.set(page, new Set())
  await page.goto('/')
  await page.getByRole('button', { name: 'Abrir Pokémon Hub' }).click()
  await expect(page.getByRole('dialog', { name: 'Pokémon Hub' })).toBeVisible()
}

export function pane(page, index) {
  return page.getByRole('region', { name: `Painel ${index + 1} do Pokémon Hub` })
}

export async function selectSave(page, index, profileName) {
  const panel = pane(page, index)
  await panel.getByRole('button', { name: 'Perfil de Save' }).click()
  const rom = panel.getByRole('combobox', { name: 'ROM com perfil' })
  await rom.click()
  await rom.press('Enter')
  await expect(panel.getByRole('combobox', { name: 'Perfil de Save' })).toBeEnabled()
  const saveProfile = panel.getByRole('combobox', { name: 'Perfil de Save' })
  await saveProfile.click()
  await saveProfile.press('Home')
  const selected = selectedSavesByPage.get(page) ?? new Set()
  const ordinal = Object.keys(profiles).filter(name => !selected.has(name)).indexOf(profileName)
  expect(ordinal).toBeGreaterThanOrEqual(0)
  for (let index = 0; index < ordinal; index += 1) await saveProfile.press('ArrowDown')
  await saveProfile.press('Enter')
  await expect(panel.getByText(new RegExp(`#\\d+ ${escapeRegExp(profileName)}`))).toBeVisible()
  selected.add(profileName)
  selectedSavesByPage.set(page, selected)
  await expect(boxSlot(page, index, 0)).toBeVisible()
  await expect(panel.getByRole('status', { name: `Processando painel ${index + 1}` })).toHaveCount(0)
}

export async function selectHub(page, index, hubProfile) {
  const panel = pane(page, index)
  await panel.getByRole('button', { name: 'Perfil do Hub' }).click()
  await panel.getByRole('combobox', { name: 'Perfil do Hub' }).click()
  await activeDropdown(page).locator('.ant-select-item-option').filter({ hasText: hubProfile.name }).click()
  await expect(panel.getByRole('heading', { name: hubProfile.name })).toBeVisible()
}

export async function addPane(page) {
  const last = await page.locator('.pokemon-workspace-pane').count() - 1
  await pane(page, last).getByRole('button', { name: 'Abrir novo container' }).click()
}

export function boxSlot(page, index, slot) {
  return saveBoxSlot(page, index, 0, slot)
}

export function saveBoxSlot(page, index, box, slot) {
  return pane(page, index).getByRole('button', { name: new RegExp(`^Box ${box + 1}, posição ${slot + 1},`) })
}

export function partySlot(page, index, slot) {
  return pane(page, index).getByRole('button', { name: new RegExp(`^Party, posição ${slot + 1},`) })
}

export function hubSlot(page, index, hubProfile, slot) {
  return pane(page, index).getByRole('button', { name: new RegExp(`^${escapeRegExp(hubProfile.name)}, posição ${slot + 1},`) })
}

export async function drag(page, from, to, { travelSteps = 12, settleMs = 0 } = {}) {
  const start = await from.boundingBox()
  const end = await to.boundingBox()
  expect(start).not.toBeNull()
  expect(end).not.toBeNull()
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2)
  await page.mouse.down()
  await page.mouse.move(start.x + start.width / 2 + 8, start.y + start.height / 2 + 8, { steps: 4 })
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: travelSteps })
  // Cross-pane drags can scroll the horizontal workspace while the pointer moves.
  // Resolve the destination again before mouseup so the pointer lands on that slot.
  if (settleMs > 0) await page.waitForTimeout(settleMs)
  const settled = await to.boundingBox()
  expect(settled).not.toBeNull()
  await page.mouse.move(settled.x + settled.width / 2, settled.y + settled.height / 2, { steps: 2 })
  if (settleMs > 0) {
    await page.waitForTimeout(settleMs)
    const final = await to.boundingBox()
    expect(final).not.toBeNull()
    await page.mouse.move(final.x + final.width / 2, final.y + final.height / 2)
    await page.waitForTimeout(settleMs)
  }
  await page.mouse.up()
}

export async function closeWorkspace(page) {
  const closing = page.waitForResponse(response => response.request().method() === 'POST' && /\/pokemon-hub\/sessions\/[^/]+\/close$/.test(new URL(response.url()).pathname))
  await page.getByRole('button', { name: 'Fechar Pokémon Hub' }).click()
  await expect(page.getByRole('dialog', { name: 'Pokémon Hub' })).toHaveCount(0)
  expect((await closing).status()).toBe(200)
  selectedSavesByPage.delete(page)
}

export async function occupiedIds(profileName, workspaceProfileName = profileName) {
  const layout = await readLayout(profileName, workspaceProfileName)
  return [
    ...layout.party.map(slot => slot.pokemonInstanceId).filter(Boolean),
    ...layout.boxes.flatMap(box => box.slots.map(slot => slot.pokemonInstanceId).filter(Boolean)),
  ]
}

function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
function activeDropdown(page) { return page.locator('.ant-select-dropdown:visible:not([style*="pointer-events: none"])') }
