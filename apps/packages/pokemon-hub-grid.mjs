export const pokemonHubSlotSize = 86
const minimumCardWidth = pokemonHubSlotSize
const cardGap = 7
const initialRowCount = 5

export function getPokemonHubColumnCount(availableWidth) {
  const fittedColumns = Math.floor((Math.max(0, availableWidth) + cardGap) / (minimumCardWidth + cardGap))
  return Math.max(1, fittedColumns)
}

export function getPokemonHubGridWidth(columns) {
  if (!Number.isInteger(columns) || columns < 1) throw new Error('Pokémon Hub column count is invalid.')
  return columns * pokemonHubSlotSize + (columns - 1) * cardGap
}

export function getPokemonHubVisibleSlotCount(entries, columns) {
  if (!Number.isInteger(columns) || columns < 1) throw new Error('Pokémon Hub column count is invalid.')

  const occupiedSlots = Object.keys(entries).map(Number)
  const highestOccupiedSlot = occupiedSlots.length === 0 ? -1 : Math.max(...occupiedSlots)
  const occupiedRows = highestOccupiedSlot < 0 ? 0 : Math.floor(highestOccupiedSlot / columns) + 1

  return Math.max(initialRowCount, occupiedRows + 1) * columns
}
