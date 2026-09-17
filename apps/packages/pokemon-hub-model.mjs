const gameIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export function parseHubLocation(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidLocation()

  if (value.kind === 'hub' && Number.isInteger(value.slot) && value.slot >= 0 && value.slot < 30) {
    return { kind: 'hub', slot: value.slot }
  }

  if (
    value.kind === 'game'
    && typeof value.gameId === 'string'
    && gameIdPattern.test(value.gameId)
    && Number.isInteger(value.box)
    && value.box >= 0
    && value.box < 14
    && Number.isInteger(value.slot)
    && value.slot >= 0
    && value.slot < 30
  ) {
    return { kind: 'game', gameId: value.gameId, box: value.box, slot: value.slot }
  }

  throw invalidLocation()
}

export function parseExpectedRevisions(value, hubEpoch) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Number.isInteger(hubEpoch) || hubEpoch < 0) {
    throw invalidRevision()
  }

  const gameRevisions = {}
  for (const [gameId, revision] of Object.entries(value)) {
    if (!gameIdPattern.test(gameId) || !Number.isInteger(revision) || revision < 1) throw invalidRevision()
    gameRevisions[gameId] = revision
  }
  return { gameRevisions, hubEpoch }
}

function invalidLocation() {
  return new Error('Pokémon Hub location is invalid.')
}

function invalidRevision() {
  return new Error('Pokémon Hub revision is invalid.')
}
