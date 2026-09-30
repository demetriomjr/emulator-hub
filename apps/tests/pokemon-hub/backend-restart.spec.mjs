import { test, expect } from '@playwright/test'
import { pokemonGen3Adapter } from '../../packages/pokemon-gen3-adapter.mjs'
import { boxSlot, closeWorkspace, drag, occupiedIds, openWorkspace, readLayout, readSave, selectSave } from './helpers.mjs'
import { watchSnapshots } from './snapshot-audit.mjs'

test('reiniciar backend após snapshot aceito preserva sessão, Eevee e flush físico', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  const audit = await watchSnapshots(page)
  try {
    const baseline = (await occupiedIds('stress-backend-restart')).sort()
    const eeveeId = (await readLayout('stress-backend-restart')).boxes[0].slots[2].pokemonInstanceId
    const opening = page.waitForResponse(response => /\/pokemon-hub\/sessions$/.test(new URL(response.url()).pathname) && response.status() === 201)
    await openWorkspace(page)
    await selectSave(page, 0, 'stress-backend-restart')
    const oldSessionId = (await (await opening).json()).sessionId
    const accepted = page.waitForResponse(response => /\/pokemon-hub\/sessions\/[^/]+\/snapshots$/.test(new URL(response.url()).pathname) && response.status() === 200)
    await drag(page, boxSlot(page, 0, 2), boxSlot(page, 0, 12))
    await accepted
    const restarted = await fetch(`${process.env.E2E_CONTROL_URL}/restart-backend`, { method: 'POST' })
    expect(restarted.status).toBe(200)
    await closeWorkspace(page)
    expect((await readLayout('stress-backend-restart')).boxes[0].slots[12].pokemonInstanceId).toBe(eeveeId)
    expect(pokemonGen3Adapter.readSlot((await readSave('stress-backend-restart')).bytes, 0, 12)?.canonical.species).toBe(133)
    expect((await occupiedIds('stress-backend-restart')).sort()).toEqual(baseline)
    const reopening = page.waitForResponse(response => /\/pokemon-hub\/sessions$/.test(new URL(response.url()).pathname) && response.status() === 201)
    await openWorkspace(page)
    await selectSave(page, 0, 'stress-backend-restart')
    const newSessionId = (await (await reopening).json()).sessionId
    expect(newSessionId).not.toBe(oldSessionId)
    await expect(boxSlot(page, 0, 12)).toHaveAccessibleName(/ocupada/)
    await closeWorkspace(page)
  } finally {
    await audit(testInfo)
  }
})
