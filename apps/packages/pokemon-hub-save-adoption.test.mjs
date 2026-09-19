import assert from 'node:assert/strict'
import test from 'node:test'

import { adoptPokemonHubSave } from './pokemon-hub-save-adoption.mjs'

test('adopts every adapter slot from persisted save bytes into the snapshot coordinator', async () => {
  const calls = []
  const adapter = {
    id: 'gen3-gba-v1',
    readAllSlots: (bytes, layout) => {
      assert.deepEqual(bytes, Buffer.from([7]))
      assert.deepEqual(layout, { id: 'emerald' })
      return [{ location: { kind: 'game', area: 'party', slot: 0 }, record: { representation: { adapter: 'gen3-gba-v1', kind: 'party-record', bytes: Buffer.alloc(100, 7) }, display: { species: 289, shiny: false } } }]
    },
  }
  const coordinator = { adopt: async input => { calls.push(input); return { sourceKey: input.sourceKey } } }

  const result = await adoptPokemonHubSave({ coordinator, profileId: 'profile-may', gameId: 'emerald', saved: { bytes: Buffer.from([7]), revision: 4 }, adapter, layout: { id: 'emerald' } })

  assert.deepEqual(result, { sourceKey: 'save:profile-may:emerald' })
  assert.equal(calls[0].sourceRevision, 4)
  assert.equal(calls[0].adapter, 'gen3-gba-v1')
  assert.equal(calls[0].slots[0].record.representation.bytes.length, 100)
})

test('persists the inspected transfer capability with its adopted save source', async () => {
  const calls = []
  const adapter = {
    id: 'gen3-gba-v1',
    inspect: () => ({ transferCapabilities: { game: 'pokemon-emerald', ordinaryTradeReady: true, nationalDexUnlocked: true, networkMachineRestored: null } }),
    readAllSlots: () => [],
  }
  await adoptPokemonHubSave({ coordinator: { adopt: async input => { calls.push(input) } }, profileId: 'profile-may', gameId: 'emerald', saved: { bytes: Buffer.from([7]), revision: 4 }, adapter, layout: { id: 'emerald' } })

  assert.deepEqual(calls[0].transferCapability, { game: 'pokemon-emerald', ordinaryTradeReady: true, nationalDexUnlocked: true, networkMachineRestored: null })
})
