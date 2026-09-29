export function getPokemonItemSpriteUrl(itemKey) {
  return typeof itemKey === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(itemKey)
    ? `/resources/items/${itemKey}.png`
    : null
}
