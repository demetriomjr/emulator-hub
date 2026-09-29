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
  const slot = current.slots[request.slot]
  if (!slot.nativeId || request.quantity > slot.quantity) throw invalidInventory('The source item quantity is unavailable.')
  if (!getPokemonItemPolicy(title, area.id, slot.itemKey)?.canTransfer) throw invalidInventory('The item transfer is blocked by policy.')

  const edited = Buffer.from(saveBytes)
  const logicalOffset = area.logicalOffset + request.slot * 4
  const physicalOffset = state.format.offset(state.save, area.block, logicalOffset)
  const remaining = slot.quantity - request.quantity
  const view = new DataView(edited.buffer, edited.byteOffset, edited.byteLength)
  view.setUint16(physicalOffset, remaining ? slot.nativeId : 0, true)
  view.setUint16(physicalOffset + 2, remaining ? remaining ^ quantityMask(state, area) : 0, true)
  state.format.refresh(edited, state.save, new Set([state.format.sectionOf(area.block, logicalOffset)]))

  return {
    saveBytes: edited,
    removed: { itemKey: slot.itemKey, nativeId: slot.nativeId, quantity: request.quantity, area: area.id, slot: request.slot },
  }
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
  const source = openInventory(sourceBytes, sourceTitle)
  const destination = openInventory(destinationBytes, destinationTitle)
  const sourceArea = source.profile.areas.find(area => area.id === request.area)
  const destinationArea = destination.profile.areas.find(area => area.id === request.area)
  if (!sourceArea || !destinationArea) throw invalidInventory('The item area is unavailable in one of the saves.')
  if (request.toSlot !== undefined && request.toSlot >= destinationArea.slots) throw invalidInventory('The destination item slot is invalid.')
  const from = readArea(source, sourceArea)
  const to = readArea(destination, destinationArea)
  if (from.issues.length || to.issues.length) throw invalidInventory('An item area contains invalid or unknown items.')
  const sourceCount = occupiedPrefixLength(from.slots)
  const destinationCount = occupiedPrefixLength(to.slots)
  if (sourceCount < 0 || destinationCount < 0 || request.fromSlot < 0 || request.fromSlot >= sourceCount) {
    throw invalidInventory('An item area has a gap or the source slot is empty.')
  }
  const item = from.slots[request.fromSlot]
  if (!getPokemonItemPolicy(sourceTitle, request.area, item.itemKey)?.canTransfer
    || !getPokemonItemPolicy(destinationTitle, request.area, item.itemKey)?.canTransfer) {
    throw invalidInventory('The item transfer is blocked by policy.')
  }
  const destinationNativeId = destination.itemKeys.indexOf(item.itemKey)
  if (destinationNativeId < 1 || destinationNativeId > destination.maxNativeId) throw invalidInventory('The destination game does not recognize this item.')
  const matching = to.slots.slice(0, destinationCount).filter(slot => slot.itemKey === item.itemKey)
  if (matching.length > 1) throw invalidInventory('The destination contains multiple stacks of this item.')
  const existing = matching[0] ?? null
  const maxQuantity = Math.min(item.quantity, existing ? to.maxPerStack - existing.quantity : destinationCount < to.capacity ? to.maxPerStack : 0)
  if (request.quantity > maxQuantity) throw invalidInventory('The destination stack or item area is full.')

  const sourceSaveBytes = Buffer.from(sourceBytes)
  const destinationSaveBytes = Buffer.from(destinationBytes)
  const sourceSections = new Set()
  const destinationSections = new Set()
  const sourceOffset = index => sourceArea.logicalOffset + index * 4
  const destinationOffset = index => destinationArea.logicalOffset + index * 4
  const edit = (state, bytes, area, logicalOffset, sections, nativeId, quantity) => {
    const physical = state.format.offset(state.save, area.block, logicalOffset)
    bytes.writeUInt16LE(nativeId, physical)
    bytes.writeUInt16LE(nativeId ? quantity ^ quantityMask(state, area) : 0, physical + 2)
    sections.add(state.format.sectionOf(area.block, logicalOffset))
  }
  if (request.quantity < item.quantity) {
    edit(source, sourceSaveBytes, sourceArea, sourceOffset(request.fromSlot), sourceSections, item.nativeId, item.quantity - request.quantity)
  } else {
    for (let index = request.fromSlot; index < sourceCount - 1; index++) {
      const targetOffset = source.format.offset(source.save, sourceArea.block, sourceOffset(index))
      const nextOffset = source.format.offset(source.save, sourceArea.block, sourceOffset(index + 1))
      sourceBytes.copy(sourceSaveBytes, targetOffset, nextOffset, nextOffset + 4)
      sourceSections.add(source.format.sectionOf(sourceArea.block, sourceOffset(index)))
    }
    edit(source, sourceSaveBytes, sourceArea, sourceOffset(sourceCount - 1), sourceSections, 0, 0)
  }

  if (existing) {
    edit(destination, destinationSaveBytes, destinationArea, destinationOffset(existing.index), destinationSections, destinationNativeId, existing.quantity + request.quantity)
  } else {
    const sorted = request.area === 'tm-hm' || request.area === 'berries'
    const insertAt = sorted ? to.slots.slice(0, destinationCount).findIndex(slot => slot.nativeId > destinationNativeId) : -1
    const targetSlot = sorted ? insertAt < 0 ? destinationCount : insertAt
      : Math.min(request.toSlot ?? destinationCount, destinationCount)
    for (let index = destinationCount; index > targetSlot; index--) {
      const targetOffset = destination.format.offset(destination.save, destinationArea.block, destinationOffset(index))
      const previousOffset = destination.format.offset(destination.save, destinationArea.block, destinationOffset(index - 1))
      destinationBytes.copy(destinationSaveBytes, targetOffset, previousOffset, previousOffset + 4)
      destinationSections.add(destination.format.sectionOf(destinationArea.block, destinationOffset(index)))
    }
    edit(destination, destinationSaveBytes, destinationArea, destinationOffset(targetSlot), destinationSections, destinationNativeId, request.quantity)
  }
  source.format.refresh(sourceSaveBytes, source.save, sourceSections)
  destination.format.refresh(destinationSaveBytes, destination.save, destinationSections)
  return { sourceSaveBytes, destinationSaveBytes, itemKey: item.itemKey, quantity: request.quantity, maxQuantity }
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
