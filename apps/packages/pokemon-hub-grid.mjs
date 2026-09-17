const cardSize = 76
const cardGap = 7
const initialSlotCount = 60
const minimumColumns = 5
const maximumColumns = 20

export function getPokemonHubColumnCount(availableWidth) {
  const fittedColumns = Math.floor((Math.max(0, availableWidth) + cardGap) / (cardSize + cardGap))
  return Math.min(maximumColumns, Math.max(minimumColumns, fittedColumns))
}

export function getPokemonHubVisibleSlotCount(entries, columns) {
  if (!Number.isInteger(columns) || columns < minimumColumns || columns > maximumColumns) throw new Error('Pokémon Hub column count is invalid.')

  const occupiedSlots = Object.keys(entries).map(Number)
  const highestOccupiedSlot = occupiedSlots.length === 0 ? -1 : Math.max(...occupiedSlots)
  const initialRows = Math.ceil(initialSlotCount / columns)
  const initialRowsWithEmptyTail = initialSlotCount % columns === 0 ? initialRows + 1 : initialRows
  const occupiedRows = highestOccupiedSlot < 0 ? 0 : Math.floor(highestOccupiedSlot / columns) + 1

  return Math.max(initialRowsWithEmptyTail, occupiedRows + 1) * columns
}
