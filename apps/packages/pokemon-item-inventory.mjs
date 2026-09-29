import itemCatalog from './pokemon-item-catalog.json' with { type: 'json' }
import saveProfiles from './pokemon-item-save-profiles.json' with { type: 'json' }
import { getPokemonItemPolicy } from './pokemon-item-policy.mjs'
import { pokemonGen3SaveByteOffset, refreshPokemonGen3SaveSectionChecksums, selectUnambiguousPokemonGen3SaveCopy } from './pokemon-gen3-save-validation.mjs'

// The public inventory contract is independent of console. A new save format
// registers its byte operations here; titles, areas and item IDs stay in data.
const saveFormats = {
  'gen3-gba': {
    select: selectUnambiguousPokemonGen3SaveCopy,
    offset: pokemonGen3SaveByteOffset,
    refresh: refreshPokemonGen3SaveSectionChecksums,
    sectionOf: (_, logicalOffset) => 1 + Math.floor(logicalOffset / 0xf80),
  },
}

export function readPokemonItemInventory(saveBytes, title) {
  const state = openInventory(saveBytes, title)
  return {
    title,
    areas: Object.fromEntries(state.profile.areas.map(area => [area.id, readArea(state, area)])),
  }
}

export function removePokemonItemFromSave(saveBytes, title, request) {
  const state = openInventory(saveBytes, title)
  const area = state.profile.areas.find(candidate => candidate.id === request?.area)
  if (!area || !Number.isInteger(request.slot) || request.slot < 0 || request.slot >= area.slots
    || !Number.isSafeInteger(request.quantity) || request.quantity < 1) {
    throw invalidInventory('The item removal request is invalid.')
  }

  const current = readArea(state, area)
  if (current.issues.length) throw invalidInventory('The source item area is invalid or contains unknown items.')
  const occupiedCount = occupiedPrefixLength(current.slots)
  if (occupiedCount < 0) throw invalidInventory('The source item area contains gaps.')
  const slot = current.slots[request.slot]
  if (!slot.nativeId || request.quantity > slot.quantity) throw invalidInventory('The source item quantity is unavailable.')
  if (!getPokemonItemPolicy(title, area.id, slot.itemKey)?.canTransfer) throw invalidInventory('The item transfer is blocked by policy.')

  const edited = Buffer.from(saveBytes)
  const logicalOffset = area.logicalOffset + request.slot * 4
  const physicalOffset = state.format.offset(state.save, area.block, logicalOffset)
  const remaining = slot.quantity - request.quantity
  const view = new DataView(edited.buffer, edited.byteOffset, edited.byteLength)
  if (remaining) {
    view.setUint16(physicalOffset, slot.nativeId, true)
    view.setUint16(physicalOffset + 2, remaining ^ quantityMask(state, area), true)
  } else {
    for (let index = request.slot; index < occupiedCount - 1; index++) {
      const target = state.format.offset(state.save, area.block, area.logicalOffset + index * 4)
      const next = state.format.offset(state.save, area.block, area.logicalOffset + (index + 1) * 4)
      saveBytes.copy(edited, target, next, next + 4)
    }
    const last = state.format.offset(state.save, area.block, area.logicalOffset + (occupiedCount - 1) * 4)
    edited.writeUInt32LE(0, last)
  }
  const sections = new Set()
  for (let index = request.slot; index < (remaining ? request.slot + 1 : occupiedCount); index++) sections.add(state.format.sectionOf(area.block, area.logicalOffset + index * 4))
  state.format.refresh(edited, state.save, sections)

  return {
    saveBytes: edited,
    removed: { itemKey: slot.itemKey, nativeId: slot.nativeId, quantity: request.quantity, area: area.id, slot: request.slot },
  }
}

export function addPokemonItemToSave(saveBytes, title, request) {
  if (!request || !Number.isSafeInteger(request.quantity) || request.quantity < 1
    || request.toSlot !== undefined && (!Number.isInteger(request.toSlot) || request.toSlot < 0)) throw invalidInventory('The item addition request is invalid.')
  const state = openInventory(saveBytes, title)
  const area = state.profile.areas.find(candidate => candidate.id === request.area)
  if (!area || request.toSlot !== undefined && request.toSlot >= area.slots) throw invalidInventory('The destination item area is invalid.')
  if (!getPokemonItemPolicy(title, area.id, request.itemKey)?.canTransfer) throw invalidInventory('The item transfer is blocked by policy.')
  const nativeId = state.itemKeys.indexOf(request.itemKey)
  if (nativeId < 1 || nativeId > state.maxNativeId) throw invalidInventory('The destination game does not recognize this item.')
  const current = readArea(state, area)
  if (current.issues.length) throw invalidInventory('The destination item area is invalid or contains unknown items.')
  const count = occupiedPrefixLength(current.slots)
  if (count < 0) throw invalidInventory('The destination item area contains gaps.')
  const matching = current.slots.slice(0, count).filter(slot => slot.itemKey === request.itemKey)
  if (matching.length > 1) throw invalidInventory('The destination contains multiple stacks of this item.')
  const existing = matching[0]
  const maxQuantity = existing ? area.maxPerStack - existing.quantity : count < area.slots ? area.maxPerStack : 0
  if (request.quantity > maxQuantity) throw invalidInventory('The destination stack or item area is full.')
  const edited = Buffer.from(saveBytes)
  const sections = new Set()
  const offset = index => area.logicalOffset + index * 4
  const write = (index, id, quantity) => {
    const logical = offset(index)
    const physical = state.format.offset(state.save, area.block, logical)
    edited.writeUInt16LE(id, physical)
    edited.writeUInt16LE(quantity ^ quantityMask(state, area), physical + 2)
    sections.add(state.format.sectionOf(area.block, logical))
  }
  if (existing) write(existing.index, nativeId, existing.quantity + request.quantity)
  else {
    const sorted = area.id === 'tm-hm' || area.id === 'berries'
    const sortedSlot = sorted ? current.slots.slice(0, count).findIndex(slot => slot.nativeId > nativeId) : -1
    const target = sorted ? sortedSlot < 0 ? count : sortedSlot : Math.min(request.toSlot ?? count, count)
    for (let index = count; index > target; index--) {
      const physical = state.format.offset(state.save, area.block, offset(index))
      const previous = state.format.offset(state.save, area.block, offset(index - 1))
      saveBytes.copy(edited, physical, previous, previous + 4)
      sections.add(state.format.sectionOf(area.block, offset(index)))
    }
    write(target, nativeId, request.quantity)
  }
  state.format.refresh(edited, state.save, sections)
  return { saveBytes: edited, itemKey: request.itemKey, quantity: request.quantity, maxQuantity }
}

export function reorderPokemonItemsInSave(saveBytes, title, request) {
  const state = openInventory(saveBytes, title)
  const area = state.profile.areas.find(candidate => candidate.id === request?.area)
  if (!area || !Number.isInteger(request.fromSlot) || !Number.isInteger(request.toSlot)
    || request.fromSlot < 0 || request.toSlot < 0 || request.fromSlot >= area.slots || request.toSlot >= area.slots) {
    throw invalidInventory('The item reorder request is invalid.')
  }
  if (!getPokemonItemPolicy(title, area.id, null)?.canReorder) throw invalidInventory('Item reordering is blocked by policy.')

  const current = readArea(state, area)
  if (current.issues.length) throw invalidInventory('The item area is invalid or contains unknown items.')
  const occupied = current.slots.findIndex(slot => !slot.nativeId)
  const count = occupied < 0 ? area.slots : occupied
  if (current.slots.slice(count).some(slot => slot.nativeId)) throw invalidInventory('The item area contains empty slots between items.')
  if (request.fromSlot >= count) throw invalidInventory('The source item slot is empty.')

  const destination = request.toSlot < count ? request.toSlot : count - 1
  const edited = Buffer.from(saveBytes)
  if (destination === request.fromSlot) return { saveBytes: edited, changed: false, area: area.id, fromSlot: request.fromSlot, toSlot: destination }

  const start = Math.min(request.fromSlot, destination)
  const end = Math.max(request.fromSlot, destination)
  const records = Array.from({ length: end - start + 1 }, (_, index) => {
    const offset = state.format.offset(state.save, area.block, area.logicalOffset + (start + index) * 4)
    return Buffer.from(saveBytes.subarray(offset, offset + 4))
  })
  if (request.toSlot < count) {
    const original = records[request.fromSlot - start]
    records[request.fromSlot - start] = records[destination - start]
    records[destination - start] = original
  } else {
    records.push(records.shift())
  }

  const sections = new Set()
  let changed = false
  records.forEach((record, index) => {
    const logicalOffset = area.logicalOffset + (start + index) * 4
    const offset = state.format.offset(state.save, area.block, logicalOffset)
    if (record.equals(saveBytes.subarray(offset, offset + 4))) return
    record.copy(edited, offset)
    sections.add(state.format.sectionOf(area.block, logicalOffset))
    changed = true
  })
  if (changed) state.format.refresh(edited, state.save, sections)
  return { saveBytes: edited, changed, area: area.id, fromSlot: request.fromSlot, toSlot: destination }
}

export function transferPokemonItemsBetweenSaves(sourceBytes, sourceTitle, destinationBytes, destinationTitle, request) {
  if (!request || !Number.isInteger(request.fromSlot) || !Number.isSafeInteger(request.quantity) || request.quantity < 1
    || request.toSlot !== undefined && (!Number.isInteger(request.toSlot) || request.toSlot < 0)) {
    throw invalidInventory('The item transfer request is invalid.')
  }
  const source = readPokemonItemInventory(sourceBytes, sourceTitle).areas[request.area]
  const sourceQuantity = source?.slots?.[request.fromSlot]?.quantity
  const removed = removePokemonItemFromSave(sourceBytes, sourceTitle, { area: request.area, slot: request.fromSlot, quantity: request.quantity })
  const added = addPokemonItemToSave(destinationBytes, destinationTitle, {
    area: request.area, itemKey: removed.removed.itemKey, quantity: request.quantity, toSlot: request.toSlot,
  })
  return { sourceSaveBytes: removed.saveBytes, destinationSaveBytes: added.saveBytes,
    itemKey: removed.removed.itemKey, quantity: request.quantity, maxQuantity: Math.min(sourceQuantity, added.maxQuantity) }
}

function occupiedPrefixLength(slots) {
  const firstEmpty = slots.findIndex(slot => !slot.nativeId)
  const count = firstEmpty < 0 ? slots.length : firstEmpty
  return slots.slice(count).some(slot => slot.nativeId) ? -1 : count
}

function openInventory(saveBytes, title) {
  const profile = saveProfiles.profiles.find(candidate => candidate.titles.includes(title))
  const format = saveFormats[profile?.saveFormat]
  const itemKeys = itemCatalog.nativeIdMaps[profile?.nativeIdMap]
  const maxNativeId = itemCatalog.maxNativeIdByTitle[title]
  if (!profile || !format || !itemKeys || !Number.isInteger(maxNativeId)) throw invalidInventory('Unsupported item save title.')
  const save = format.select(saveBytes)
  const view = new DataView(saveBytes.buffer, saveBytes.byteOffset, saveBytes.byteLength)
  const key = profile.bagQuantityXorKey
    ? view.getUint16(format.offset(save, profile.bagQuantityXorKey.block, profile.bagQuantityXorKey.logicalOffset), true)
    : 0
  return { saveBytes, profile, format, itemKeys, maxNativeId, save, view, key }
}

function readArea(state, area) {
  const slots = []
  const issues = []
  let freeSlots = 0
  for (let index = 0; index < area.slots; index++) {
    const offset = state.format.offset(state.save, area.block, area.logicalOffset + index * 4)
    const nativeId = state.view.getUint16(offset, true)
    if (!nativeId) {
      freeSlots++
      slots.push({ index, nativeId: 0, itemKey: null, quantity: 0 })
      continue
    }
    const quantity = state.view.getUint16(offset + 2, true) ^ quantityMask(state, area)
    const itemKey = nativeId <= state.maxNativeId ? state.itemKeys[nativeId] ?? null : null
    slots.push({ index, nativeId, itemKey, quantity })
    if (!itemKey) issues.push({ slot: index, code: 'unknown-item-id' })
    if (quantity < 1 || quantity > area.maxPerStack) issues.push({ slot: index, code: 'invalid-quantity' })
  }
  return { capacity: area.slots, maxPerStack: area.maxPerStack, freeSlots, slots, issues }
}

function quantityMask(state, area) {
  return area.quantityEncoding === 'xor-low16-security-key' ? state.key : 0
}

function invalidInventory(message) {
  const error = new Error(message)
  error.code = 'SAVE_ITEM_INVALID'
  return error
}
