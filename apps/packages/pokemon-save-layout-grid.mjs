export function getSavePartySlotPosition(slot, slotCount) {
  if (!Number.isInteger(slot) || !Number.isInteger(slotCount) || slot < 0 || slot >= slotCount) throw new Error('Party slot is invalid.')
  return slot + 1
}

export function getSaveBoxSlotPosition(box, slot, slotsPerBox) {
  if (!Number.isInteger(box) || box < 0 || !Number.isInteger(slot) || !Number.isInteger(slotsPerBox) || slot < 0 || slot >= slotsPerBox) throw new Error('Box slot is invalid.')
  return box * slotsPerBox + slot + 1
}

export function getPreviousSaveBoxIndex(boxIndex, boxCount) {
  return getWrappedSaveBoxIndex(boxIndex, boxCount, -1)
}

export function getNextSaveBoxIndex(boxIndex, boxCount) {
  return getWrappedSaveBoxIndex(boxIndex, boxCount, 1)
}

function getWrappedSaveBoxIndex(boxIndex, boxCount, direction) {
  if (!Number.isInteger(boxIndex) || !Number.isInteger(boxCount) || boxCount < 1 || boxIndex < 0 || boxIndex >= boxCount) throw new Error('Save Box index is invalid.')
  return (boxIndex + direction + boxCount) % boxCount
}
