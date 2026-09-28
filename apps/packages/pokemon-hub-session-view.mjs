import { pokemonHubLocationKey } from './pokemon-hub-location-key.mjs'
import { extendPokemonHubPlacements } from './pokemon-hub-canonical-session-snapshot.mjs'

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

export function visiblePokemonHubPanes(canonicalPanes, visiblePaneCount) {
  return canonicalPanes.slice(0, visiblePaneCount).map(pane => pane === null ? null : pane.profile.type === 'hub-profile'
    ? { kind: 'hub', hubProfileId: pane.profile.hubProfileId }
    : { kind: 'game', gameId: pane.profile.gameId, profileId: pane.profile.profileId })
}

export function createHubSessionSourceSnapshot({ profileId, profile }) {
  const entries = profile.grid?.entries ?? {}
  const highestOccupiedSlot = Math.max(-1, ...Object.keys(entries).map(Number))
  const count = Math.max(60, highestOccupiedSlot + 1)
  return {
    kind: 'hub',
    profileId,
    hubProfileId: profile.hubProfileId,
    sourceKey: `hub:${profile.hubProfileId}`,
    placements: Array.from({ length: count }, (_, slot) => ({ location: { kind: 'hub', hubProfileId: profile.hubProfileId, slot }, pokemonInstanceId: entries[String(slot)]?.pokemonInstanceId ?? null })),
    pokemonDisplay: Object.fromEntries(Object.values(entries).flatMap(entry => entry?.pokemonInstanceId ? [[entry.pokemonInstanceId, entry]] : [])),
  }
}

export function extendHubSessionSourceSnapshot(snapshot, slot) {
  if (!Number.isInteger(slot) || slot < 0) throw new TypeError('Hub slot is invalid')
  if (slot < snapshot.placements.length) return snapshot
  const placements = extendPokemonHubPlacements(snapshot.placements, snapshot.hubProfileId, slot)
  if (!placements) throw new RangeError('Hub slot exceeds the growth window or source topology is invalid')
  return { ...snapshot, placements }
}

export function reconcileCanonicalSessionSnapshot(snapshot, visiblePaneCount, sourceSnapshots) {
  const panes = visiblePokemonHubPanes(snapshot.panes, visiblePaneCount)
  const snapshots = {}
  for (const pane of snapshot.panes.slice(0, visiblePaneCount)) {
    if (pane === null) continue
    const key = pane.profile.type === 'hub-profile' ? `hub:${pane.profile.hubProfileId}` : `${pane.profile.gameId}:${pane.profile.profileId}`
    const existing = sourceSnapshots[key]
    if (!existing) continue
    const projected = pane.profile.type === 'hub-profile' && pane.hub.length > 0
      ? extendHubSessionSourceSnapshot(existing, Math.max(...pane.hub.map(entry => entry.slot)))
      : existing
    const requested = canonicalPaneOccupancy(pane)
    snapshots[key] = { ...projected, placements: projected.placements.map(placement => ({ ...placement, pokemonInstanceId: requested.get(pokemonHubLocationKey(placement.location)) ?? null })) }
  }
  return { panes, snapshots }
}

function canonicalPaneOccupancy(pane) {
  const entries = pane.profile.type === 'hub-profile'
    ? pane.hub.map(entry => [{ kind: 'hub', hubProfileId: pane.profile.hubProfileId, slot: entry.slot }, entry.pokemonInstanceId])
    : [
      ...pane.party.map(entry => [{ kind: 'game', area: 'party', slot: entry.slot }, entry.pokemonInstanceId]),
      ...pane.boxes.map(entry => [{ kind: 'game', area: 'box', box: Math.floor(entry.slot / 30), slot: entry.slot % 30 }, entry.pokemonInstanceId]),
    ]
  return new Map(entries.map(([location, pokemonInstanceId]) => [pokemonHubLocationKey(location), pokemonInstanceId]))
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
