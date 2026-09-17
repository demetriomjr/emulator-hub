export function createPokemonSaveAdapterRegistry(adapters) {
  if (!Array.isArray(adapters)) throw invalidAdapter()

  const byId = new Map()
  for (const adapter of adapters) {
    if (!adapter || typeof adapter !== 'object' || typeof adapter.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(adapter.id) || byId.has(adapter.id)) {
      throw invalidAdapter()
    }
    byId.set(adapter.id, adapter)
  }

  return {
    get: id => typeof id === 'string' ? byId.get(id) ?? null : null,
    supports: id => typeof id === 'string' && byId.has(id),
  }
}

function invalidAdapter() {
  return new Error('Pokémon save adapter registry is invalid.')
}
