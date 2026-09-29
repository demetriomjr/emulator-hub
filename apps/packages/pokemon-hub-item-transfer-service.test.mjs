import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createSaveStore } from './save-store.mjs'
import { readPokemonItemInventory } from './pokemon-item-inventory.mjs'
import { decodeHubItemLedger, encodeHubItemLedger, hubItemLedgerGameId } from './pokemon-hub-item-ledger.mjs'
import { createPokemonHubItemTransferService } from './pokemon-hub-item-transfer-service.mjs'
import { createItemSave } from '../tests/pokemon-hub/gen3-fixture.mjs'

const hubA = '11111111-1111-4111-8111-111111111111'
const hubB = '22222222-2222-4222-8222-222222222222'

async function fixture(run) {
  const directory = await mkdtemp(join(tmpdir(), 'hub-items-service-'))
  try {
    const saveStore = createSaveStore({ dataPath: directory })
    await saveStore.put('red', 'ruby', createItemSave('pokemon-ruby', { areas: { items: [[13, 10], [14, 2]] } }), null)
    const service = createPokemonHubItemTransferService({
      sessions: { withLoadedSources: async ({ run }) => run(), withLoadedSource: async ({ run }) => run() },
      gameSaveLeases: { assertHub: async () => {} }, saveStore,
      saveFlush: { flushSource: async () => ({ status: 'clean' }) },
      snapshotCoordinator: { getSaveFlushPlan: async () => ({ source: { needsSaveFlush: true } }) },
      hubProfileStore: { list: async () => [{ hubProfileId: hubA, ownerProfileId: 'owner' }, { hubProfileId: hubB, ownerProfileId: 'owner' }] },
      resolveSaveSource: async () => ({ sourceProfileId: 'red', gameId: 'ruby', layout: { pokemonSaveTitle: 'pokemon-ruby' } }),
    })
    await run({ saveStore, service })
  } finally { await rm(directory, { recursive: true, force: true }) }
}

test('save-to-Hub and Hub-to-save transfer conserve semantic quantity and reject replay', async () => fixture(async ({ saveStore, service }) => {
  const deposited = await service.transfer({ profileId: 'owner', sessionId: 'work',
    source: { gameId: 'ruby', profileId: 'red', expectedSaveRevision: 1 },
    destination: { hubProfileId: hubA, expectedItemRevision: 0 }, area: 'items', fromSlot: 0, toSlot: 2, quantity: 4 })
  assert.equal(deposited.destinationHubItemInventory.slots[2].quantity, 4)
  assert.equal(readPokemonItemInventory((await saveStore.get('red', 'ruby')).bytes, 'pokemon-ruby').areas.items.slots[0].quantity, 6)
  assert.equal((await saveStore.listAll()).some(entry => entry.gameId.startsWith('.hub-items-')), false)
  assert.equal((await saveStore.listAll({ includeInternal: true })).some(entry => entry.gameId.startsWith('.hub-items-')), true)
  await assert.rejects(() => service.transfer({ profileId: 'owner', sessionId: 'work',
    source: { gameId: 'ruby', profileId: 'red', expectedSaveRevision: 1 },
    destination: { hubProfileId: hubA, expectedItemRevision: 0 }, area: 'items', fromSlot: 0, toSlot: 2, quantity: 4 }))
  const returned = await service.transfer({ profileId: 'owner', sessionId: 'work',
    source: { hubProfileId: hubA, expectedItemRevision: deposited.destinationHubItemInventory.revision },
    destination: { gameId: 'ruby', profileId: 'red', expectedSaveRevision: 2 }, area: 'items', fromSlot: 2, toSlot: 0, quantity: 3 })
  assert.equal(returned.sourceHubItemInventory.slots[2].quantity, 1)
  assert.equal(readPokemonItemInventory((await saveStore.get('red', 'ruby')).bytes, 'pokemon-ruby').areas.items.slots[0].quantity, 9)
  await assert.rejects(() => saveStore.removeHubItemLedger('owner', hubItemLedgerGameId(hubA), 1))
  await saveStore.removeHubItemLedger('owner', hubItemLedgerGameId(hubA), returned.sourceHubItemInventory.revision)
  assert.equal(await saveStore.get('owner', hubItemLedgerGameId(hubA)), null)
}))

test('Hub-to-Hub transfer merges by itemKey and keeps unrelated positions', async () => fixture(async ({ saveStore, service }) => {
  await saveStore.put('owner', hubItemLedgerGameId(hubA), encodeHubItemLedger({ schemaVersion: 1, slots: { 3: { itemKey: 'potion', quantity: 8 } } }), null)
  await saveStore.put('owner', hubItemLedgerGameId(hubB), encodeHubItemLedger({ schemaVersion: 1, slots: { 0: { itemKey: 'antidote', quantity: 2 }, 5: { itemKey: 'potion', quantity: 1 } } }), null)
  const result = await service.transfer({ profileId: 'owner', sessionId: 'work', source: { hubProfileId: hubA, expectedItemRevision: 1 },
    destination: { hubProfileId: hubB, expectedItemRevision: 1 }, fromSlot: 3, toSlot: 0, quantity: 6 })
  assert.equal(result.sourceHubItemInventory.slots[3].quantity, 2)
  assert.equal(result.destinationHubItemInventory.slots[5].quantity, 7)
  assert.equal(result.destinationHubItemInventory.slots[0].itemKey, 'antidote')
  assert.equal(decodeHubItemLedger((await saveStore.get('owner', hubItemLedgerGameId(hubB))).bytes).slots[5].quantity, 7)
}))
