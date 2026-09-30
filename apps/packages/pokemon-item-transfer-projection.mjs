import itemCatalog from './pokemon-item-catalog.json' with { type: 'json' }
import saveProfiles from './pokemon-item-save-profiles.json' with { type: 'json' }

const saveKey = location => `${location.gameId}:${location.profileId}`
const vacant = index => ({ index, nativeId: 0, itemKey: null, quantity: 0 })

export function projectPokemonItemTransfers(layouts, profiles, transfers) {
  const nextLayouts = { ...layouts }
  const nextProfiles = profiles.map(profile => ({ ...profile }))
  const skipped = []
  for (const transfer of transfers) {
    try { applyTransfer(nextLayouts, nextProfiles, transfer) }
    catch (error) { skipped.push({ transfer, reason: error.message }) }
  }
  return { layouts: nextLayouts, profiles: nextProfiles, skipped }
}

function applyTransfer(layouts, profiles, transfer) {
  const { source, destination, area, itemKey, quantity, toSlot } = transfer
  if (!Number.isSafeInteger(quantity) || quantity < 1) throw new Error('Invalid quantity')
  const from = readInventory(layouts, profiles, source)
  const to = readInventory(layouts, profiles, destination)
  const sourceArea = source.kind === 'hub-item' ? null : from.areas?.[area]
  const destinationArea = destination.kind === 'hub-item' ? null : to.areas?.[area]
  const sourceEntry = sourceArea
    ? sourceArea.slots.find(slot => slot.itemKey === itemKey)
    : Object.entries(from.slots).find(([, item]) => item.itemKey === itemKey)
  const available = sourceArea ? sourceEntry?.quantity : sourceEntry?.[1]?.quantity
  if (!available || quantity > available) throw new Error('Insufficient source quantity')

  let nextDestination
  if (destinationArea) {
    const slots = destinationArea.slots.map(slot => ({ ...slot }))
    const existing = slots.find(slot => slot.itemKey === itemKey)
    if (existing) {
      if (existing.quantity + quantity > destinationArea.maxPerStack) throw new Error('Destination stack is full')
      existing.quantity += quantity
    } else {
      const count = slots.findIndex(slot => !slot.nativeId)
      if (count < 0) throw new Error('Destination area is full')
      const titleProfile = saveProfiles.profiles.find(profile => profile.titles.includes(to.title))
      const nativeId = itemCatalog.nativeIdMaps[titleProfile?.nativeIdMap]?.indexOf(itemKey)
      if (!nativeId || nativeId < 1) throw new Error('Unknown destination item')
      const sorted = area === 'tm-hm' || area === 'berries'
      const firstGreater = sorted ? slots.slice(0, count).findIndex(slot => slot.nativeId > nativeId) : -1
      const index = sorted ? firstGreater < 0 ? count : firstGreater : Math.min(toSlot, count)
      slots.splice(index, 0, { index, nativeId, itemKey, quantity })
      slots.pop()
    }
    nextDestination = { ...to, areas: { ...to.areas, [area]: indexedArea(destinationArea, slots) } }
  } else {
    const slots = { ...to.slots }
    const matching = Object.entries(slots).find(([, item]) => item.itemKey === itemKey)
    if (matching) {
      const total = matching[1].quantity + quantity
      if (!Number.isSafeInteger(total)) throw new Error('Hub stack would overflow')
      slots[matching[0]] = { ...matching[1], quantity: total }
    } else {
      let index = Number.isSafeInteger(toSlot) && toSlot >= 0 && !slots[toSlot] ? toSlot : 0
      while (slots[index]) index++
      slots[index] = { itemKey, quantity }
    }
    nextDestination = { ...to, slots }
  }

  let nextSource
  if (sourceArea) {
    const slots = sourceArea.slots.map(slot => ({ ...slot }))
    const index = slots.findIndex(slot => slot.itemKey === itemKey)
    if (available === quantity) {
      slots.splice(index, 1)
      slots.push(vacant(slots.length))
    } else slots[index].quantity -= quantity
    nextSource = { ...from, areas: { ...from.areas, [area]: indexedArea(sourceArea, slots) } }
  } else {
    const slots = { ...from.slots }
    const [index, entry] = sourceEntry
    if (available === quantity) delete slots[index]
    else slots[index] = { ...entry, quantity: available - quantity }
    nextSource = { ...from, slots }
  }
  writeInventory(layouts, profiles, source, nextSource)
  writeInventory(layouts, profiles, destination, nextDestination)
}

function indexedArea(area, slots) {
  const indexed = slots.map((slot, index) => ({ ...slot, index }))
  return { ...area, slots: indexed, freeSlots: indexed.filter(slot => !slot.nativeId).length }
}

function readInventory(layouts, profiles, location) {
  if (location.kind === 'hub-item') return profiles.find(profile => profile.hubProfileId === location.hubProfileId)?.itemInventory
  return layouts[saveKey(location)]?.itemInventory
}

function writeInventory(layouts, profiles, location, inventory) {
  if (location.kind === 'hub-item') {
    const index = profiles.findIndex(profile => profile.hubProfileId === location.hubProfileId)
    profiles[index] = { ...profiles[index], itemInventory: inventory }
  } else {
    const key = saveKey(location)
    layouts[key] = { ...layouts[key], itemInventory: inventory }
  }
}
