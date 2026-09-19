export function createInitialPokemonHubCanonicalSnapshot() {
  return { revision: 0, panes: [null, null, null] }
}

export function validatePokemonHubCanonicalSnapshot(snapshot) {
  if (!isRecord(snapshot) || !hasOnlyKeys(snapshot, ['revision', 'panes'])) throw invalidSnapshot('Snapshot format is invalid.')
  if (!Number.isInteger(snapshot.revision) || snapshot.revision < 0) throw invalidSnapshot('Snapshot revision is invalid.')
  if (!Array.isArray(snapshot.panes) || snapshot.panes.length !== 3) throw invalidSnapshot('Snapshot must contain exactly three panes.')

  const pokemonIds = new Set()
  const profiles = new Set()
  snapshot.panes.forEach((pane, index) => validatePane(pane, index, profiles, pokemonIds))
  return structuredClone(snapshot)
}

function validatePane(pane, index, profiles, pokemonIds) {
  if (pane === null) return
  if (!isRecord(pane) || !Number.isInteger(pane.pane) || pane.pane !== index || !isRecord(pane.profile)) throw invalidSnapshot('Snapshot pane is invalid.')

  const { profile } = pane
  if (profile.type === 'hub-profile') {
    if (!hasOnlyKeys(pane, ['pane', 'profile', 'hub']) || !hasOnlyKeys(profile, ['type', 'hubProfileId']) || !isNonEmptyString(profile.hubProfileId)) throw invalidSnapshot('Hub pane is invalid.')
    registerProfile(`hub:${profile.hubProfileId}`, profiles)
    validateOccupancy(pane.hub, 0, Number.MAX_SAFE_INTEGER, pokemonIds)
    return
  }

  if (profile.type === 'save') {
    if (!hasOnlyKeys(pane, ['pane', 'profile', 'party', 'boxes']) || !hasOnlyKeys(profile, ['type', 'profileId', 'gameId']) || !isNonEmptyString(profile.profileId) || !isNonEmptyString(profile.gameId)) throw invalidSnapshot('Save pane is invalid.')
    registerProfile(`save:${profile.profileId}:${profile.gameId}`, profiles)
    validateOccupancy(pane.party, 0, 5, pokemonIds)
    validateParty(pane.party)
    validateOccupancy(pane.boxes, 0, 419, pokemonIds)
    return
  }

  throw invalidSnapshot('Snapshot profile is invalid.')
}

function validateParty(entries) {
  if (entries.length === 0) throw invalidSnapshot('Save Party cannot be empty.')
  for (let slot = 0; slot < entries.length; slot += 1) {
    if (!entries.some(entry => entry.slot === slot)) throw invalidSnapshot('Save Party must be contiguous from slot zero.')
  }
}

function validateOccupancy(entries, minimumSlot, maximumSlot, pokemonIds) {
  if (!Array.isArray(entries)) throw invalidSnapshot('Snapshot occupancy is invalid.')
  const slots = new Set()
  for (const entry of entries) {
    if (!isRecord(entry) || !hasOnlyKeys(entry, ['pokemonInstanceId', 'slot']) || !isNonEmptyString(entry.pokemonInstanceId) || !Number.isInteger(entry.slot) || entry.slot < minimumSlot || entry.slot > maximumSlot) throw invalidSnapshot('Snapshot occupancy is invalid.')
    if (slots.has(entry.slot)) throw invalidSnapshot('Snapshot has duplicate slot occupancy.')
    if (pokemonIds.has(entry.pokemonInstanceId)) throw invalidSnapshot('Snapshot has duplicate Pokemon identity.')
    slots.add(entry.slot)
    pokemonIds.add(entry.pokemonInstanceId)
  }
}

function registerProfile(profile, profiles) {
  if (profiles.has(profile)) throw invalidSnapshot('Snapshot has duplicate profile panes.')
  profiles.add(profile)
}

function hasOnlyKeys(value, keys) {
  return Object.keys(value).every(key => keys.includes(key)) && keys.every(key => Object.hasOwn(value, key))
}

function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function isNonEmptyString(value) { return typeof value === 'string' && value.length > 0 }
function invalidSnapshot(message) { const error = new TypeError(message); error.code = 'SNAPSHOT_FORMAT_INVALID'; return error }
