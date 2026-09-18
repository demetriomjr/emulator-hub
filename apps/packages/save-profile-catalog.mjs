export function deriveSaveProfileCatalog(games) {
  const catalog = Array.isArray(games) ? games : []
  const profilesByGame = Object.fromEntries(catalog.map(game => [game.id, (game.profiles ?? []).filter(profile => profile.hasSave === true)]))
  const saveProfileGames = catalog.filter(game => game.status === 'ready' && game.pokemonHubSaveSupported === true && profilesByGame[game.id].length > 0)
  return { profilesByGame, saveProfileGames }
}

export function replaceCatalogProfile(profiles, updated) {
  return profiles.map(profile => profile.id === updated.id ? { ...profile, ...updated } : profile)
}
