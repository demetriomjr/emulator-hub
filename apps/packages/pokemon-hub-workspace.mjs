export function createPokemonHubWorkspaceState() {
  return { profile: null, panes: [null], boxes: {} }
}

export function choosePaneSource(panes, index, nextSource) {
  const duplicate = panes.some((source, candidate) => candidate !== index && sameSource(source, nextSource))
  if (duplicate) return { panes, error: nextSource.kind === 'hub' ? 'This Hub profile is already open.' : 'This game save is already open.' }
  return { panes: panes.map((source, candidate) => candidate === index ? nextSource : source), error: '' }
}

export function addWorkspacePane(panes) {
  if (panes.length >= 3) throw new Error('Pokémon Hub supports at most three panes.')
  return [...panes, null]
}

function sameSource(first, second) {
  if (!first || !second || first.kind !== second.kind) return false
  return first.kind === 'hub' ? first.hubProfileId === second.hubProfileId : first.profileId === second.profileId && first.gameId === second.gameId
}
