export function deriveSaveProfileCatalog(games) {
  const catalog = Array.isArray(games) ? games : []
  const profilesByGame = Object.fromEntries(catalog.map(game => [game.id, game.profiles ?? []]))
  const saveProfileGames = catalog.filter(game => game.status === 'ready' && profilesByGame[game.id].length > 0)
  return { profilesByGame, saveProfileGames }
}
