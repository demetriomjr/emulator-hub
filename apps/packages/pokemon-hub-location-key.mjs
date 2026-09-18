export function pokemonHubLocationKey(location) {
  if (location?.kind === 'hub') return `hub:${location.hubProfileId ?? ''}:${location.slot}`
  if (location?.kind === 'game' && location.area === 'party') return `game:party:${location.slot}`
  if (location?.kind === 'game' && location.area === 'box') return `game:box:${location.box}:${location.slot}`
  return JSON.stringify(location ?? null, location && typeof location === 'object' ? Object.keys(location).sort() : undefined)
}
