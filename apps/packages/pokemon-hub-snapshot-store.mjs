export function createPokemonHubSnapshotStore() {
  const bindings = new Map()
  return {
    createBinding(binding) {
      const id = `${binding.profileId}:${binding.gameId}:${binding.saveRevision}:${binding.hubEpoch}`
      const saved = { ...binding, id, invalidatedAt: null }
      bindings.set(id, saved)
      return { ...saved }
    },
    assertRestorable(binding, current) {
      const saved = bindings.get(binding.id)
      if (!saved || saved.invalidatedAt || saved.profileId !== current.profileId || saved.gameId !== current.gameId || saved.saveRevision !== current.saveRevision || saved.saveSha256 !== current.saveSha256 || saved.hubEpoch !== current.hubEpoch) {
        const error = new Error('Saved state is stale after a Pokémon Hub change.')
        error.code = 'SNAPSHOT_STALE'
        throw error
      }
      return { ...saved }
    },
    invalidateGames(profileId, gameIds, hubEpoch) {
      const invalidatedAt = new Date().toISOString()
      for (const binding of bindings.values()) if (binding.profileId === profileId && gameIds.includes(binding.gameId)) binding.invalidatedAt = invalidatedAt
      return { hubEpoch, invalidatedAt }
    },
  }
}
