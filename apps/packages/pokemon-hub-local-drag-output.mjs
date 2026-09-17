export function createPokemonHubLocalDragOutput({ source = null, target = null, result }) {
  if (!result || !['move', 'swap', 'none'].includes(result.action)) throw new TypeError('Pokemon Hub local drag result is invalid')
  return {
    type: 'pokemon-hub-local-drag',
    mode: 'local-preview',
    action: result.action,
    source,
    target,
    nextState: {
      hubProfiles: result.hubProfiles,
      saveLayoutsBySource: result.saveLayoutsBySource,
    },
  }
}
