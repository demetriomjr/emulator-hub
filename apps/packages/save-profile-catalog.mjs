import { groupGamesByLayout } from './hub-layout.mjs'
import { orderGameProfiles } from './save-profile-display.mjs'

export function deriveSaveProfileCatalog(games, layout) {
  const catalog = Array.isArray(games) ? games : []
  const profilesByGame = Object.fromEntries(catalog.map(game => [game.id, orderGameProfiles(game.profiles ?? [])
    .filter(profile => profile.hasSave === true)]))
  const orderedGames = layout ? groupGamesByLayout(catalog, layout).flatMap(section => section.games) : catalog
  const saveProfileGames = orderedGames.filter(game => game.status === 'ready' && game.pokemonHubSaveSupported === true && profilesByGame[game.id].length > 0)
  return { profilesByGame, saveProfileGames }
}

export function replaceCatalogProfile(profiles, updated) {
  return profiles.map(profile => profile.id === updated.id ? { ...profile, ...updated } : profile)
}
