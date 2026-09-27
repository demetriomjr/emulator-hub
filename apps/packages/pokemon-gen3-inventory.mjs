import { pokemonGen3SaveByteOffset, refreshPokemonGen3SaveSectionChecksums, selectUnambiguousPokemonGen3SaveCopy } from './pokemon-gen3-save-validation.mjs'

const profiles = Object.freeze({
  'pokemon-ruby': { keyOffset: 0x5b0, keySlots: 20, pcOffset: 0x498, pcSlots: 50, securityOffset: null, allowed: [275] },
  'pokemon-sapphire': { keyOffset: 0x5b0, keySlots: 20, pcOffset: 0x498, pcSlots: 50, securityOffset: null, allowed: [275] },
  'pokemon-emerald': { keyOffset: 0x5d8, keySlots: 30, pcOffset: 0x498, pcSlots: 50, securityOffset: 0x0ac, allowed: [275, 370, 371, 376] },
  'pokemon-firered': { keyOffset: 0x3b8, keySlots: 30, pcOffset: 0x298, pcSlots: 30, securityOffset: 0xf20, allowed: [370, 371] },
  'pokemon-leafgreen': { keyOffset: 0x3b8, keySlots: 30, pcOffset: 0x298, pcSlots: 30, securityOffset: 0xf20, allowed: [370, 371] },
})

export function inspectPokemonGen3Inventory(saveBytes, pokemonSaveTitle) {
  const profile = inventoryProfile(pokemonSaveTitle)
  const save = selectUnambiguousPokemonGen3SaveCopy(saveBytes)
  return inspect(saveBytes, save, profile)
}

export function addPokemonGen3KeyItems(saveBytes, pokemonSaveTitle, itemIds) {
  const profile = inventoryProfile(pokemonSaveTitle)
  if (!Array.isArray(itemIds)) throw invalidInventory('Gen III item IDs must be an array.')
  const requested = new Set()
  for (const itemId of itemIds) {
    if (!Number.isInteger(itemId) || !profile.allowed.includes(itemId)) throw invalidInventory('Unsupported Gen III Key Item for this title.')
    if (requested.has(itemId)) throw invalidInventory('Duplicate Gen III Key Item request.')
    requested.add(itemId)
  }
  const save = selectUnambiguousPokemonGen3SaveCopy(saveBytes)
  const inventory = inspect(saveBytes, save, profile)
  const owned = new Set()
  for (const slot of inventory.keyItems.slots) {
    if (slot.itemId === 0) continue
    if (slot.quantity !== 1) throw invalidInventory('Gen III Key Item quantity is invalid.')
    if (owned.has(slot.itemId)) throw invalidInventory('Duplicate Gen III Key Item in save.')
    owned.add(slot.itemId)
  }
  const missing = itemIds.filter(itemId => !owned.has(itemId))
  for (const itemId of missing) {
    if (inventory.pcItems.slots.some(slot => slot.itemId === itemId)) {
      const error = invalidInventory('Gen III Key Item is already in the PC.')
      error.code = 'SAVE_ITEM_IN_PC'
      throw error
    }
  }
  const free = inventory.keyItems.slots.filter(slot => slot.itemId === 0)
  if (free.length < missing.length) {
    const error = invalidInventory('Gen III Key Items pocket has no space.')
    error.code = 'SAVE_INVENTORY_FULL'
    throw error
  }
  const edited = Buffer.from(saveBytes)
  const touched = new Set()
  const key = securityKey(saveBytes, save, profile)
  for (const [index, itemId] of missing.entries()) {
    const logicalOffset = profile.keyOffset + free[index].index * 4
    const offset = pokemonGen3SaveByteOffset(save, 'large', logicalOffset)
    edited.writeUInt16LE(itemId, offset)
    edited.writeUInt16LE(1 ^ key, offset + 2)
    touched.add(1 + Math.floor(logicalOffset / 0xf80))
  }
  return refreshPokemonGen3SaveSectionChecksums(edited, save, touched)
}

function inspect(bytes, save, profile) {
  const key = securityKey(bytes, save, profile)
  const keyItems = readSlots(bytes, save, profile.keyOffset, profile.keySlots, key)
  const pcItems = readSlots(bytes, save, profile.pcOffset, profile.pcSlots, 0)
  return {
    keyItems: { slots: keyItems, freeSlots: keyItems.filter(slot => slot.itemId === 0).length },
    pcItems: { slots: pcItems, freeSlots: pcItems.filter(slot => slot.itemId === 0).length },
  }
}

function readSlots(bytes, save, logicalStart, count, key) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return Array.from({ length: count }, (_, index) => {
    const offset = pokemonGen3SaveByteOffset(save, 'large', logicalStart + index * 4)
    const itemId = view.getUint16(offset, true)
    return { index, itemId, quantity: itemId === 0 ? 0 : view.getUint16(offset + 2, true) ^ key }
  })
}

function securityKey(bytes, save, profile) {
  if (profile.securityOffset === null) return 0
  const offset = pokemonGen3SaveByteOffset(save, 'small', profile.securityOffset)
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, true)
}

function inventoryProfile(title) {
  const profile = profiles[title]
  if (!profile) throw invalidInventory('Unsupported Gen III save title.')
  return profile
}

function invalidInventory(message) {
  const error = new TypeError(message)
  error.code = 'SAVE_UNSUPPORTED'
  return error
}
