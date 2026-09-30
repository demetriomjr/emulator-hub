import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import { pokemonGen3Adapter } from '../../packages/pokemon-gen3-adapter.mjs'
import { boxSlot, closeWorkspace, drag, occupiedIds, openWorkspace, readLayout, readSave, selectSave } from './helpers.mjs'

test('falha de gravação impede confirmação e recupera Eevee antes de liberar a sessão', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  const before = (await occupiedIds('fault-flush')).sort()
  const eeveeId = (await readLayout('fault-flush')).boxes[0].slots[2].pokemonInstanceId
  const opening = page.waitForResponse(response => /\/pokemon-hub\/sessions$/.test(new URL(response.url()).pathname) && response.status() === 201)
  await openWorkspace(page)
  const sessionId = (await (await opening).json()).sessionId
  await selectSave(page, 0, 'fault-flush')
  const failedMove = page.waitForResponse(response => /\/pokemon-hub\/sessions\/[^/]+\/snapshots$/.test(new URL(response.url()).pathname))
  await drag(page, boxSlot(page, 0, 2), boxSlot(page, 0, 12))
  await expect(page.getByRole('dialog', { name: 'Pokémon Hub' })).toHaveCount(0)
  const response = await failedMove
  expect(response.status()).toBe(400)
  expect((await response.json()).code).toBe('SAVE_FLUSH_FAILED')
  await expect.poll(async () => pokemonGen3Adapter.readSlot((await readSave('fault-flush')).bytes, 0, 12)?.canonical.species, { timeout: 45_000 }).toBe(133)
  await expect.poll(async () => (await (await fetch(`${process.env.E2E_API_URL}/api/pokemon-hub/sessions`)).json()).sessions.find(session => session.sessionId === sessionId)?.closedAt, { timeout: 15_000 }).toBeTruthy()
  expect((await readLayout('fault-flush')).boxes[0].slots[12].pokemonInstanceId).toBe(eeveeId)
  await openWorkspace(page)
  await selectSave(page, 0, 'fault-flush')
  await closeWorkspace(page)
  expect((await occupiedIds('fault-flush')).sort()).toEqual(before)
  const log = await readFile(join(process.env.E2E_ARTIFACT_DIR, 'backend.ndjson'))
  await testInfo.attach('backend.ndjson', { body: log, contentType: 'application/x-ndjson' })
  const events = log.toString('utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
  expect(events.some(event => event.event === 'backend.console' && event.values?.[1]?.code === 'E2E_SAVE_FLUSH_FAILURE')).toBe(true)
})
