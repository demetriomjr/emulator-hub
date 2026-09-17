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
