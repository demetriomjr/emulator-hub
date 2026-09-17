import assert from 'node:assert/strict'
import test from 'node:test'

import { isPokemonHubDraggable, pokemonHubDragId } from './pokemon-hub-drag-identity.mjs'

test('creates stable drag identities for Hub, Party, and Box locations', () => {
  assert.equal(pokemonHubDragId({ kind: 'hub', hubProfileId: 'bank-a', slot: 4 }), 'hub:bank-a:4')
  assert.equal(pokemonHubDragId({ kind: 'game', gameId: 'emerald', profileId: 'leaf', area: 'party', slot: 2 }), 'game:emerald:leaf:party:2')
  assert.equal(pokemonHubDragId({ kind: 'game', gameId: 'emerald', profileId: 'leaf', area: 'box', box: 5, slot: 12 }), 'game:emerald:leaf:box:5:12')
})

test('makes only occupied current slots draggable', () => {
  assert.equal(isPokemonHubDraggable({ occupied: true }), true)
  assert.equal(isPokemonHubDraggable({ occupied: false }), false)
  assert.equal(isPokemonHubDraggable(null), false)
})

test('rejects incomplete rendered locations', () => {
  assert.throws(() => pokemonHubDragId({ kind: 'game', gameId: 'emerald', profileId: 'leaf', area: 'box', slot: 12 }), /box/i)
  assert.throws(() => pokemonHubDragId({ kind: 'hub', slot: 4 }), /profile/i)
})
