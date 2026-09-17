import assert from 'node:assert/strict'
import test from 'node:test'

import { createHubBox, migrateLegacyInventory } from './pokemon-hub-organization.mjs'

test('migrates a legacy 30-slot inventory into one default Hub profile and box', () => {
  const legacy = { schemaVersion: 1, profileId: '00000000-0000-4000-8000-000000000001', hubEpoch: 4, revision: 2, slots: ['pokemon-1', null, 'pokemon-2', ...Array(27).fill(null)] }

  const migrated = migrateLegacyInventory(legacy, { hubProfileId: 'profile-1', hubBoxId: 'box-1' })

  assert.deepEqual(migrated.inventory, { schemaVersion: 2, profileId: legacy.profileId, hubEpoch: 4, revision: 2, hubProfiles: [{ hubProfileId: 'profile-1', name: 'Pokémon Hub', boxOrder: ['box-1'] }] })
  assert.deepEqual(migrated.box, { schemaVersion: 1, hubBoxId: 'box-1', hubProfileId: 'profile-1', name: 'Box 1', columns: 6, rows: 5, revision: 1, slots: legacy.slots })
})

test('creates a configurable Hub box with exactly its requested grid capacity', () => {
  const box = createHubBox({ hubBoxId: 'box-2', hubProfileId: 'profile-2', name: 'Shiny', columns: 8, rows: 4 })

  assert.equal(box.slots.length, 32)
  assert.equal(box.slots.every(slot => slot === null), true)
})

test('rejects Hub boxes outside the bounded initial grid dimensions', () => {
  assert.throws(() => createHubBox({ hubBoxId: 'box-2', hubProfileId: 'profile-2', name: 'Invalid', columns: 31, rows: 1 }), /box/i)
  assert.throws(() => createHubBox({ hubBoxId: 'box-2', hubProfileId: 'profile-2', name: 'Invalid', columns: 1, rows: 0 }), /box/i)
})
