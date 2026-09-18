const gameStatuses = new Set(['ready', 'unavailable'])

export function createGameCatalogResponse(games) {
  const response = { games }
  parseGameCatalogResponse(response)
  return response
}

export function parseGameCatalogResponse(response) {
  if (!response || typeof response !== 'object' || Array.isArray(response) || !Array.isArray(response.games)) {
    throw contractError('Invalid game catalog response.')
  }
  response.games.forEach((game, index) => validateGame(game, index))
  return response.games
}

function validateGame(game, index) {
  if (!game || typeof game !== 'object' || Array.isArray(game)) throw contractError(`Invalid game catalog entry at index ${index}.`)
  assertString(game.id, `Game catalog entry ${index} ID`)
  assertString(game.title, `Game catalog entry ${index} title`)
  assertString(game.system, `Game catalog entry ${index} system`)
  if (!gameStatuses.has(game.status)) throw contractError(`Invalid game catalog entry ${index} status.`)
  if (typeof game.pokemonHubSaveSupported !== 'boolean') throw contractError(`Game catalog entry ${index} Pokémon Hub save support is invalid.`)
  if (!Array.isArray(game.profiles)) throw contractError(`Invalid game catalog entry ${index} profiles.`)
  game.profiles.forEach((profile, profileIndex) => validateProfile(profile, index, profileIndex))
  for (const field of ['core', 'reason', 'region', 'coverUrl', 'language']) {
    if (game[field] !== undefined) assertString(game[field], `Game catalog entry ${index} ${field}`)
  }
}

function validateProfile(profile, gameIndex, profileIndex) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) throw contractError(`Invalid game catalog profile ${gameIndex}:${profileIndex}.`)
  assertString(profile.id, `Game catalog profile ${gameIndex}:${profileIndex} ID`)
  assertString(profile.name, `Game catalog profile ${gameIndex}:${profileIndex} name`)
  assertString(profile.createdAt, `Game catalog profile ${gameIndex}:${profileIndex} creation time`)
  if (typeof profile.hasSave !== 'boolean') throw contractError(`Game catalog profile ${gameIndex}:${profileIndex} save availability is invalid.`)
}

function assertString(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw contractError(`${label} is invalid.`)
}

function contractError(message) {
  const error = new TypeError(message)
  error.code = 'GAME_CATALOG_CONTRACT_INVALID'
  return error
}
