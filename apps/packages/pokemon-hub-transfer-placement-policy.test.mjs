import assert from 'node:assert/strict'
import test from 'node:test'

import { createPokemonHubTransferPlacementPolicy, validatePokemonHubTransferPlacement } from './pokemon-hub-transfer-placement-policy.mjs'

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

test('uses the shared Gen III evaluator for a verified save-to-Hub export', () => {
  const validatePlacementChange = createPokemonHubTransferPlacementPolicy()
  const decision = validatePlacementChange({
    origin: { location: gameBox },
    destination: { location: hub },
    record: { display: { species: 1, isEgg: true } },
    source: { transferCapability: { title: 'pokemon-firered', ordinaryTradeReady: true, nationalDexUnlocked: false, networkMachineRestored: false } },
    sourcePokemonCount: 2,
  })

  assert.deepEqual(decision, {
    allowed: false,
    reason: {
      code: 'TRANSFER_NATIONAL_DEX_REQUIRED',
      message: 'Este save ainda não pode enviar ou receber esse Pokémon sem a Pokédex Nacional.',
    },
  })
})

test('creates an immutable first-admission Hub passport from a verified source title', () => {
  const validatePlacementChange = createPokemonHubTransferPlacementPolicy()
  const decision = validatePlacementChange({
    origin: { location: gameBox },
    destination: { location: hub },
    record: { display: { species: 252, isEgg: false } },
    source: { transferCapability: { title: 'pokemon-ruby', ordinaryTradeReady: true, nationalDexUnlocked: false, networkMachineRestored: false } },
    sourcePokemonCount: 2,
  })

  assert.deepEqual(decision, { allowed: true, hubPassport: { sourceTitle: 'pokemon-ruby', sourceFamily: 'hoenn-rs' } })
})

test('uses the adapter game capability as the rules title', () => {
  const decision = createPokemonHubTransferPlacementPolicy()({
    origin: { location: gameBox }, destination: { location: hub }, record: { display: { species: 252, isEgg: false } },
    source: { transferCapability: { game: 'pokemon-ruby', ordinaryTradeReady: true, nationalDexUnlocked: false, networkMachineRestored: null } }, sourcePokemonCount: 2,
  })
  assert.deepEqual(decision, { allowed: true, hubPassport: { sourceTitle: 'pokemon-ruby', sourceFamily: 'hoenn-rs' } })
})

test('applies the shared evaluator to verified moves between two different game saves', () => {
  const validatePlacementChange = createPokemonHubTransferPlacementPolicy()
  const decision = validatePlacementChange({
    origin: { location: gameBox },
    destination: { location: { ...gameBox, slot: 1 } },
    record: { display: { species: 252, isEgg: true } },
    source: { sourceKey: 'save:profile:ruby', transferCapability: { title: 'pokemon-ruby', ordinaryTradeReady: true, nationalDexUnlocked: false, networkMachineRestored: false } },
    destinationSource: { sourceKey: 'save:profile:emerald', transferCapability: { title: 'pokemon-emerald', ordinaryTradeReady: true, nationalDexUnlocked: false, networkMachineRestored: false } },
    sourcePokemonCount: 2,
  })

  assert.equal(decision.reason?.code, 'TRANSFER_NATIONAL_DEX_REQUIRED')
})
