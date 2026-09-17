function assertIdentifier(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} is required`)
}

function assertSlot(value) {
  if (!Number.isInteger(value) || value < 0) throw new TypeError('Slot must be a non-negative integer')
}

export function pokemonHubDragId(location) {
  if (location?.kind === 'hub') {
    assertIdentifier(location.hubProfileId, 'Hub profile')
    assertSlot(location.slot)
    return `hub:${location.hubProfileId}:${location.slot}`
  }

  if (location?.kind !== 'game') throw new TypeError('Unsupported drag location')
  assertIdentifier(location.gameId, 'Game')
  assertIdentifier(location.profileId, 'Profile')
  assertSlot(location.slot)

  if (location.area === 'party') return `game:${location.gameId}:${location.profileId}:party:${location.slot}`
  if (location.area === 'box') {
    if (!Number.isInteger(location.box) || location.box < 0) throw new TypeError('Box must be a non-negative integer')
    return `game:${location.gameId}:${location.profileId}:box:${location.box}:${location.slot}`
  }

  throw new TypeError('Game drag location must identify a Party or Box area')
}

export function isPokemonHubDraggable(slot) {
  return slot?.occupied === true
}
