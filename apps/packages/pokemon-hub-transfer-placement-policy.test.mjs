import assert from 'node:assert/strict'
import test from 'node:test'

import { validatePokemonHubTransferPlacement } from './pokemon-hub-transfer-placement-policy.mjs'

const gameBox = { kind: 'game', area: 'box', box: 0, slot: 0 }
const gameParty = { kind: 'game', area: 'party', slot: 0 }
const hub = { kind: 'hub', hubProfileId: '11111111-1111-4111-8111-111111111111', slot: 0 }

test('allows only compatible Box-to-Box and Box-to-grid placement changes', () => {
  assert.doesNotThrow(() => validatePokemonHubTransferPlacement({ origin: { location: gameBox }, destination: { location: gameBox }, sourceAdapter: 'gen3-gba-v1', destinationAdapter: 'gen3-gba-v1' }))
  assert.doesNotThrow(() => validatePokemonHubTransferPlacement({ origin: { location: gameBox }, destination: { location: hub }, sourceAdapter: 'gen3-gba-v1', destinationAdapter: 'hub-grid-v1' }))
  assert.doesNotThrow(() => validatePokemonHubTransferPlacement({ origin: { location: hub }, destination: { location: gameBox }, sourceAdapter: 'hub-grid-v1', destinationAdapter: 'gen3-gba-v1' }))
})

test('rejects Party and mismatched game placement changes before save materialization', () => {
  assert.throws(() => validatePokemonHubTransferPlacement({ origin: { location: gameParty }, destination: { location: hub }, sourceAdapter: 'gen3-gba-v1', destinationAdapter: 'hub-grid-v1' }), { code: 'SAVE_MATERIALIZATION_UNSUPPORTED' })
  assert.throws(() => validatePokemonHubTransferPlacement({ origin: { location: gameBox }, destination: { location: gameBox }, sourceAdapter: 'gen3-gba-v1', destinationAdapter: 'other' }), { code: 'SAVE_MATERIALIZATION_UNSUPPORTED' })
})
