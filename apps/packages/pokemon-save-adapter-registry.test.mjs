import assert from 'node:assert/strict'
import test from 'node:test'

import { createPokemonSaveAdapterRegistry } from './pokemon-save-adapter-registry.mjs'

test('returns a registered adapter only by its exact ID', () => {
  const adapter = { id: 'gen3-gba-v1' }
  const registry = createPokemonSaveAdapterRegistry([adapter])

  assert.equal(registry.get('gen3-gba-v1'), adapter)
  assert.equal(registry.supports('gen3-gba-v1'), true)
  assert.equal(registry.get('gen3-gba-v2'), null)
  assert.equal(registry.supports('gen3-gba-v2'), false)
})

test('rejects duplicate or malformed adapter IDs', () => {
  assert.throws(() => createPokemonSaveAdapterRegistry([{ id: 'gen3-gba-v1' }, { id: 'gen3-gba-v1' }]), /adapter/i)
  assert.throws(() => createPokemonSaveAdapterRegistry([{ id: '' }]), /adapter/i)
})
