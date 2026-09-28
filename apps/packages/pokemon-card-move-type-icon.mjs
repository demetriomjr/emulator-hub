export const gen3MoveTypeSlugs = Object.freeze([
  'normal', 'fighting', 'flying', 'poison', 'ground', 'rock', 'bug', 'ghost', 'steel',
  'fire', 'water', 'grass', 'electric', 'psychic', 'ice', 'dragon', 'dark', 'mystery',
])

export function getGen3MoveTypeIconUrl(type) {
  return type !== 'mystery' && gen3MoveTypeSlugs.includes(type) ? `/resources/pokemon-card/types/${type}.png` : null
}
