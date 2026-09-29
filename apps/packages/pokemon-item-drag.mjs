import { getPokemonItemPolicy } from './pokemon-item-policy.mjs'
import { evaluateGenerationIIIItemTrade } from './pokemon-gen3-transfer-rules.mjs'

export function getPokemonItemReorderIntent(source, target, inventory) {
  if (source?.kind !== 'item' || target?.kind !== 'item'
    || source.gameId !== target.gameId || source.profileId !== target.profileId || source.area !== target.area
    || !Number.isInteger(source.slot) || !Number.isInteger(target.slot) || source.slot === target.slot
    || inventory?.status !== 'ready' || !Number.isSafeInteger(inventory.saveRevision)
    || !getPokemonItemPolicy(inventory.title, source.area, null)?.canReorder) return null
  const area = inventory.areas?.[source.area]
  if (!Array.isArray(area?.slots) || area.issues?.length
    || source.slot < 0 || source.slot >= area.slots.length || target.slot < 0 || target.slot >= area.slots.length
    || !area.slots[source.slot]?.nativeId) return null
  let empty = false
  for (const slot of area.slots) {
    if (!slot?.nativeId) empty = true
    else if (empty) return null
  }
  return { area: source.area, fromSlot: source.slot, toSlot: target.slot, expectedSaveRevision: inventory.saveRevision }
}

export function getPokemonItemTransferIntent(source, target, sourceLayout, destinationLayout) {
  if (source?.kind !== 'item' || target?.kind !== 'item'
    || source.gameId === target.gameId && source.profileId === target.profileId) return null
  const from = sourceLayout?.itemInventory
  const to = destinationLayout?.itemInventory
  if (from?.status !== 'ready' || to?.status !== 'ready'
    || !Number.isSafeInteger(from.saveRevision) || !Number.isSafeInteger(to.saveRevision)) return null
  const sourceArea = from.areas?.[source.area]
  const destinationArea = to.areas?.[source.area]
  const item = sourceArea?.slots?.[source.slot]
  if (!item?.nativeId || !Number.isSafeInteger(item.quantity) || item.quantity < 1
    || !getPokemonItemPolicy(from.title, source.area, item.itemKey)?.canTransfer
    || !getPokemonItemPolicy(to.title, source.area, item.itemKey)?.canTransfer
    || sourceArea.issues?.length || destinationArea?.issues?.length
    || !Array.isArray(destinationArea?.slots) || !Number.isSafeInteger(destinationArea.maxPerStack)) return null
  for (const area of [sourceArea, destinationArea]) {
    let empty = false
    for (const slot of area.slots) {
      if (!slot?.nativeId) empty = true
      else if (empty) return null
    }
  }
  const decision = evaluateGenerationIIIItemTrade({
    source: { title: from.title, ...sourceLayout.transferCapabilities },
    destination: { title: to.title, ...destinationLayout.transferCapabilities },
  })
  if (!decision.allowed) return null
  const matches = destinationArea.slots.filter(slot => slot.itemKey === item.itemKey)
  if (matches.length > 1) return null
  const existing = matches[0] ?? null
  const maxQuantity = Math.min(item.quantity, existing ? destinationArea.maxPerStack - existing.quantity
    : destinationArea.slots.some(slot => !slot.nativeId) ? destinationArea.maxPerStack : 0)
  if (maxQuantity < 1) return null
  return { source, destination: target, area: source.area, fromSlot: source.slot, itemKey: item.itemKey,
    maxQuantity, destinationExisting: existing?.quantity ?? 0, destinationLimit: destinationArea.maxPerStack,
    sourceSaveRevision: from.saveRevision, destinationSaveRevision: to.saveRevision }
}
