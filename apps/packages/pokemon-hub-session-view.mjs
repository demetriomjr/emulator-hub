import { pokemonHubLocationKey } from './pokemon-hub-location-key.mjs'

export function createGameSessionSourceSnapshot({ profileId, gameId, layout }) {
  const source = sourceProjectionFromSaveLayout(layout)
  return {
    kind: 'game',
    profileId,
    gameId,
    sourceKey: `save:${profileId}:${gameId}`,
    layout,
    pokemonDisplay: source.pokemonDisplay,
    placements: source.placements,
  }
}

export function snapshotToSaveLayout(snapshot, layout) {
  const placements = new Map(snapshot.placements.map(placement => [pokemonHubLocationKey(placement.location), placement.pokemonInstanceId]))
  const projection = location => {
    const pokemonInstanceId = placements.get(pokemonHubLocationKey(location))
    return pokemonInstanceId ? { occupied: true, pokemonInstanceId, ...(snapshot.pokemonDisplay?.[pokemonInstanceId] ?? {}) } : { occupied: false }
  }
  return {
    ...layout,
    party: layout.party.map((_, slot) => projection({ kind: 'game', area: 'party', slot })),
    boxes: layout.boxes.map((box, boxIndex) => ({ ...box, slots: box.slots.map((_, slot) => projection({ kind: 'game', area: 'box', box: boxIndex, slot })) })),
  }
}

export function visiblePokemonHubPanes(canonicalPanes, visiblePaneCount, profileId) {
  return canonicalPanes.slice(0, visiblePaneCount).map(pane => pane === null ? null : pane.profile.type === 'hub-profile'
    ? { kind: 'hub', hubProfileId: pane.profile.hubProfileId }
    : { kind: 'game', gameId: pane.profile.gameId, profileId })
}

function sourceProjectionFromSaveLayout(layout) {
  return {
    placements: [
      ...layout.party.map((slot, index) => ({ location: { kind: 'game', area: 'party', slot: index }, pokemonInstanceId: slot.pokemonInstanceId ?? null })),
      ...layout.boxes.flatMap((box, boxIndex) => box.slots.map((slot, index) => ({ location: { kind: 'game', area: 'box', box: boxIndex, slot: index }, pokemonInstanceId: slot.pokemonInstanceId ?? null }))),
    ],
    pokemonDisplay: Object.fromEntries([
      ...layout.party.flatMap(slot => slot.pokemonInstanceId ? [[slot.pokemonInstanceId, slot]] : []),
      ...layout.boxes.flatMap(box => box.slots.flatMap(slot => slot.pokemonInstanceId ? [[slot.pokemonInstanceId, slot]] : [])),
    ]),
  }
}
