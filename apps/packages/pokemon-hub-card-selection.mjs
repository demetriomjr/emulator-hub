export function reconcilePokemonCardSelection(previous, nextPanes, sourceKeyForPane) {
  return nextPanes.map(source => previous.find(selection => selection?.sourceKey === sourceKeyForPane(source)) ?? null)
}
