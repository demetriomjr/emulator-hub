import assert from 'node:assert/strict'
import test from 'node:test'

import { validatePokemonHubTransferPlacement } from './pokemon-hub-transfer-placement-policy.mjs'

const gameBox = { kind: 'game', area: 'box', box: 0, slot: 0 }
const gameParty = { kind: 'game', area: 'party', slot: 0 }
const hub = { kind: 'hub', hubProfileId: '11111111-1111-4111-8111-111111111111', slot: 0 }
const anotherHubSlot = { ...hub, slot: 1 }

test('allows a valid move into a vacant destination regardless of its pane source', () => {
  assert.doesNotThrow(() => validatePokemonHubTransferPlacement({ origin: { location: gameBox }, destination: { location: gameBox }, sourceAdapter: 'gen3-gba-v1', destinationAdapter: 'other' }))
  assert.doesNotThrow(() => validatePokemonHubTransferPlacement({ origin: { location: gameBox }, destination: { location: hub }, sourceAdapter: 'gen3-gba-v1', destinationAdapter: 'hub-grid-v1' }))
  assert.doesNotThrow(() => validatePokemonHubTransferPlacement({ origin: { location: hub }, destination: { location: gameBox }, sourceAdapter: 'hub-grid-v1', destinationAdapter: 'gen3-gba-v1' }))
  assert.doesNotThrow(() => validatePokemonHubTransferPlacement({ origin: { location: hub }, destination: { location: anotherHubSlot }, sourceAdapter: 'hub-grid-v1', destinationAdapter: 'hub-grid-v1' }))
  assert.doesNotThrow(() => validatePokemonHubTransferPlacement({ origin: { location: gameParty }, destination: { location: hub }, sourceAdapter: 'gen3-gba-v1', destinationAdapter: 'hub-grid-v1' }))
  assert.doesNotThrow(() => validatePokemonHubTransferPlacement({ origin: { location: hub }, destination: { location: gameParty }, sourceAdapter: 'hub-grid-v1', destinationAdapter: 'gen3-gba-v1' }))
})

test('rejects a move without an origin or destination', () => {
  assert.throws(() => validatePokemonHubTransferPlacement({ origin: { location: gameParty }, destination: null }), { code: 'SAVE_MATERIALIZATION_UNSUPPORTED' })
})
