import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import { pokemonGen3Adapter } from '../../packages/pokemon-gen3-adapter.mjs'
import { boxSlot, closeWorkspace, drag, occupiedIds, openWorkspace, readLayout, readSave, selectSave } from './helpers.mjs'

test('falha única de flush no close recupera Eevee e libera a sessão na expiração', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  const before = (await occupiedIds('fault-flush')).sort()
  const eeveeId = (await readLayout('fault-flush')).boxes[0].slots[2].pokemonInstanceId
  await openWorkspace(page)
  await selectSave(page, 0, 'fault-flush')
  await drag(page, boxSlot(page, 0, 2), boxSlot(page, 0, 12))
  const failedClose = page.waitForResponse(response => /\/pokemon-hub\/sessions\/[^/]+\/close$/.test(new URL(response.url()).pathname))
  await page.getByRole('button', { name: 'Fechar Pokémon Hub' }).click()
  await expect(page.getByRole('dialog', { name: 'Pokémon Hub' })).toHaveCount(0)
  const response = await failedClose
  expect(response.status()).toBe(400)
  expect((await response.json()).code).toBe('SAVE_FLUSH_FAILED')
  await expect.poll(async () => pokemonGen3Adapter.readSlot((await readSave('fault-flush')).bytes, 0, 12)?.canonical.species, { timeout: 30_000 }).toBe(133)
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
