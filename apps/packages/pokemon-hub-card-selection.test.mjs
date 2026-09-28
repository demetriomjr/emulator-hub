import assert from 'node:assert/strict'
import test from 'node:test'

import { reconcilePokemonCardSelection } from './pokemon-hub-card-selection.mjs'

test('keeps each card with its source when a pane before it closes', () => {
  const previous = [
    { sourceKey: 'hub:a', pokemonInstanceId: 'a' },
    { sourceKey: 'hub:b', pokemonInstanceId: 'b' },
    { sourceKey: 'hub:c', pokemonInstanceId: 'c' },
  ]
  const key = source => source ? `hub:${source.hubProfileId}` : ''
  assert.deepEqual(reconcilePokemonCardSelection(previous, [{ hubProfileId: 'b' }, { hubProfileId: 'c' }], key), [previous[1], previous[2]])
  assert.deepEqual(reconcilePokemonCardSelection(previous, [{ hubProfileId: 'a' }, { hubProfileId: 'new' }], key), [previous[0], null])
})
