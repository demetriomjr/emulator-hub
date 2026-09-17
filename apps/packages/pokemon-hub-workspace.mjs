export function choosePaneSource(panes, side, nextSource) {
  const otherSide = side === 'left' ? 'right' : 'left'
  const other = panes[otherSide]
  if (nextSource?.kind === 'hub' && other?.kind === 'hub') return { panes, error: 'Pokémon Hub can only be open in one pane.' }
  if (nextSource?.kind === 'game' && other?.kind === 'game' && nextSource.gameId === other.gameId) return { panes, error: 'The same game save cannot be open in both panes.' }
  return { panes: { ...panes, [side]: nextSource }, error: '' }
}
