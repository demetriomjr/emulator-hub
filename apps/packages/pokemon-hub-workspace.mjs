export function createPokemonHubWorkspaceState() {
  return { profile: null, panes: [null], boxes: {} }
}

export function choosePaneSource(panes, index, nextSource) {
  const duplicate = !isPaneSourceAvailable(panes, index, nextSource)
  if (duplicate) return { panes, error: nextSource.kind === 'hub' ? 'This Hub profile is already open.' : 'This game save is already open.' }
  return { panes: panes.map((source, candidate) => candidate === index ? nextSource : source), error: '' }
}

export function isPaneSourceAvailable(panes, index, nextSource) {
  return !panes.some((source, candidate) => candidate !== index && sameSource(source, nextSource))
}

export function isCompletePaneSource(source) {
  if (source?.kind === 'hub') return typeof source.hubProfileId === 'string' && source.hubProfileId.length > 0
  return source?.kind === 'game'
    && typeof source.gameId === 'string' && source.gameId.length > 0
    && typeof source.profileId === 'string' && source.profileId.length > 0
}

export function hasAvailableSaveProfile(panes, index, gameId, profiles) {
  return Array.isArray(profiles) && profiles.some(profile => (
    profile && typeof profile.id === 'string'
      && isPaneSourceAvailable(panes, index, { kind: 'game', gameId, profileId: profile.id })
  ))
}

export function firstAvailableSaveSource(panes, index, games, profilesByGame) {
  for (const game of games ?? []) {
    const profile = (profilesByGame?.[game.id] ?? []).find(candidate => (
      isPaneSourceAvailable(panes, index, { kind: 'game', gameId: game.id, profileId: candidate.id })
    ))
    if (profile) return { kind: 'game', gameId: game.id, profileId: profile.id }
  }
  return { kind: 'game' }
}

export function activePaneSourceKind(source, selectionDraft) {
  return selectionDraft?.kind ?? source?.kind ?? null
}

export function addWorkspacePane(panes) {
  if (panes.length >= 3) throw new Error('Pokémon Hub supports at most three panes.')
  return [...panes, null]
}

export function removeWorkspacePane(panes, index) {
  if (panes.length <= 1) throw new Error('Pokémon Hub must keep at least one pane.')
  if (!Number.isInteger(index) || index < 0 || index >= panes.length) throw new Error('Pokémon Hub pane does not exist.')
  return panes.filter((_pane, candidate) => candidate !== index)
}

function sameSource(first, second) {
  if (!first || !second || first.kind !== second.kind) return false
  if (first.kind === 'hub') return Boolean(first.hubProfileId && second.hubProfileId) && first.hubProfileId === second.hubProfileId
  return Boolean(first.profileId && first.gameId && second.profileId && second.gameId)
    && first.profileId === second.profileId && first.gameId === second.gameId
}
