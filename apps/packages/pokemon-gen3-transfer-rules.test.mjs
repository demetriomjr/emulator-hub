import assert from 'node:assert/strict'
import test from 'node:test'

import { evaluateGenerationIIITransfer } from './pokemon-gen3-transfer-rules.mjs'

const ruby = { title: 'pokemon-ruby', ordinaryTradeReady: true, nationalDexUnlocked: false, gameClear: false, networkMachineRestored: false }
const sapphire = { ...ruby, title: 'pokemon-sapphire' }
const emeraldBeforeNational = { ...ruby, title: 'pokemon-emerald' }
const emeraldAfterNational = { ...emeraldBeforeNational, nationalDexUnlocked: true }
const fireRedBeforeNational = { ...ruby, title: 'pokemon-firered' }
const fireRedAfterNational = { ...fireRedBeforeNational, nationalDexUnlocked: true, networkMachineRestored: true }
const fireRedWithoutMachine = { ...fireRedBeforeNational, nationalDexUnlocked: true }
const hoennPokemon = { nationalDexNumber: 252, isEgg: false }
const kantoPokemon = { nationalDexNumber: 1, isEgg: false }
const nonRegionalPokemon = { nationalDexNumber: 152, isEgg: false }
const egg = { nationalDexNumber: 252, isEgg: true }

function expectRejected(input, code) {
  const decision = evaluateGenerationIIITransfer(input)
  assert.equal(decision.allowed, false)
  assert.equal(decision.reason?.code, code)
}

test('allows Ruby to Sapphire eggs after both saves are ready for an ordinary trade', () => {
  assert.deepEqual(evaluateGenerationIIITransfer({ operation: 'direct', source: ruby, destination: sapphire, pokemon: egg, sourcePokemonCount: 2 }), { allowed: true })
})

test('applies the exact Hoenn gate to pre-National Emerald destinations', () => {
  assert.deepEqual(evaluateGenerationIIITransfer({ operation: 'direct', source: ruby, destination: emeraldBeforeNational, pokemon: hoennPokemon, sourcePokemonCount: 2 }), { allowed: true })
  expectRejected({ operation: 'direct', source: ruby, destination: emeraldBeforeNational, pokemon: egg, sourcePokemonCount: 2 }, 'TRANSFER_NATIONAL_DEX_REQUIRED')
  expectRejected({ operation: 'direct', source: ruby, destination: emeraldBeforeNational, pokemon: nonRegionalPokemon, sourcePokemonCount: 2 }, 'TRANSFER_NATIONAL_DEX_REQUIRED')
})

test('requires National Dex and League completion, plus the Sevii computer where applicable, before Hub export', () => {
  for (const title of ['pokemon-ruby', 'pokemon-sapphire', 'pokemon-emerald', 'pokemon-firered', 'pokemon-leafgreen']) {
    const unlocked = { title, ordinaryTradeReady: false, nationalDexUnlocked: true, gameClear: true, networkMachineRestored: title === 'pokemon-firered' || title === 'pokemon-leafgreen' ? true : null }
    const input = { operation: 'hub-export', source: unlocked, pokemon: kantoPokemon, sourcePokemonCount: 2 }
    assert.deepEqual(evaluateGenerationIIITransfer(input), { allowed: true }, title)
    expectRejected({ ...input, source: { ...unlocked, nationalDexUnlocked: false } }, 'TRANSFER_NATIONAL_DEX_REQUIRED')
    expectRejected({ ...input, source: { ...unlocked, gameClear: false } }, 'TRANSFER_LEAGUE_REQUIRED')
    if (unlocked.networkMachineRestored === true) expectRejected({ ...input, source: { ...unlocked, networkMachineRestored: false } }, 'TRANSFER_NETWORK_MACHINE_REQUIRED')
  }
})

test('rejects a Hub export when capability, record, or source population cannot be verified', () => {
  const input = { operation: 'hub-export', source: { ...ruby, nationalDexUnlocked: true, gameClear: true }, pokemon: kantoPokemon, sourcePokemonCount: 2 }
  expectRejected({ ...input, source: null }, 'TRANSFER_EXPORT_UNVERIFIED')
  expectRejected({ ...input, source: { title: 'pokemon-ruby', nationalDexUnlocked: true } }, 'TRANSFER_EXPORT_UNVERIFIED')
  expectRejected({ ...input, pokemon: null }, 'TRANSFER_EXPORT_UNVERIFIED')
  expectRejected({ ...input, sourcePokemonCount: null }, 'TRANSFER_EXPORT_UNVERIFIED')
  expectRejected({ ...input, sourcePokemonCount: 1 }, 'TRANSFER_SOURCE_EMPTY_AFTER_MOVE')
})

test('requires the Network Machine when a Hoenn-passported Hub Pokemon enters FireRed', () => {
  expectRejected({
    operation: 'hub-import',
    destination: fireRedWithoutMachine,
    pokemon: hoennPokemon,
    hubPassport: { sourceFamily: 'hoenn-rs', sourceTitle: 'pokemon-ruby' },
  }, 'TRANSFER_NETWORK_MACHINE_REQUIRED')
  assert.deepEqual(evaluateGenerationIIITransfer({
    operation: 'hub-import',
    destination: fireRedAfterNational,
    pokemon: hoennPokemon,
    hubPassport: { sourceFamily: 'hoenn-rs', sourceTitle: 'pokemon-ruby' },
  }), { allowed: true })
})

test('retains one Pokemon in the source even for a same-title direct trade', () => {
  expectRejected({ operation: 'direct', source: ruby, destination: ruby, pokemon: hoennPokemon, sourcePokemonCount: 1 }, 'TRANSFER_SOURCE_EMPTY_AFTER_MOVE')
  assert.deepEqual(evaluateGenerationIIITransfer({ operation: 'direct', source: { ...ruby, ordinaryTradeReady: false }, destination: { ...ruby, ordinaryTradeReady: false }, pokemon: hoennPokemon, sourcePokemonCount: 2 }), { allowed: true })
})
