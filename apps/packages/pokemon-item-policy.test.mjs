import assert from 'node:assert/strict'
import test from 'node:test'

import { getPokemonItemPolicy } from './pokemon-item-policy.mjs'

test('Ruby, Sapphire and Emerald share explicit transfer and ordering rules', () => {
  for (const title of ['pokemon-ruby', 'pokemon-sapphire', 'pokemon-emerald']) {
    for (const [area, itemKey] of [['pc', 'potion'], ['items', 'potion'], ['poke-balls', 'poke-ball']]) {
      assert.deepEqual(getPokemonItemPolicy(title, area, itemKey), {
        canTransfer: true, canReorder: true, showQuantity: true,
      }, `${title}/${area}`)
    }
    assert.deepEqual(getPokemonItemPolicy(title, 'key-items', 'old-rod'), {
      canTransfer: false, canReorder: true, showQuantity: false,
    })
    assert.deepEqual(getPokemonItemPolicy(title, 'berries', 'cheri-berry'), {
      canTransfer: true, canReorder: false, showQuantity: true,
    })
    assert.deepEqual(getPokemonItemPolicy(title, 'tm-hm', 'tm01-focus-punch'), {
      canTransfer: true, canReorder: false, showQuantity: true,
    })
    assert.deepEqual(getPokemonItemPolicy(title, 'tm-hm', 'hm01-cut'), {
      canTransfer: false, canReorder: false, showQuantity: true,
    })
    assert.equal(getPokemonItemPolicy(title, 'pc', 'hm01-cut').canTransfer, false)
    assert.equal(getPokemonItemPolicy(title, 'pc', 'old-rod').canTransfer, false)
    assert.equal(getPokemonItemPolicy(title, 'pc', 'old-sea-map').canTransfer, false)
    assert.equal(getPokemonItemPolicy(title, 'tm-hm', 'potion').canTransfer, false)
    assert.equal(getPokemonItemPolicy(title, 'tm-hm', null).canTransfer, false)
    assert.equal(getPokemonItemPolicy(title, 'items', 'nonexistent-item').canTransfer, false)
  }
  assert.equal(getPokemonItemPolicy('pokemon-ruby', 'pc', 'old-sea-map').canTransfer, false)
})

test('future titles and unknown areas do not inherit RSE transfer permission', () => {
  for (const title of ['pokemon-firered', 'pokemon-leafgreen', 'pokemon-crystal']) {
    assert.equal(getPokemonItemPolicy(title, 'items', 'potion'), null)
  }
  assert.equal(getPokemonItemPolicy('pokemon-emerald', 'unknown', 'potion'), null)
})
