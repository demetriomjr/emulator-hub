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

export function getPokemonHubItemTransferIntent(source, target, sourceView, destinationView) {
  const sourceHub = source?.kind === 'hub-item'
  const destinationHub = target?.kind === 'hub-item'
  if ((!sourceHub && source?.kind !== 'item') || (!destinationHub && target?.kind !== 'item')
    || sourceHub && destinationHub && source.hubProfileId === target.hubProfileId) return null
  const from = sourceHub ? sourceView : sourceView?.itemInventory
  const to = destinationHub ? destinationView : destinationView?.itemInventory
  if (sourceHub ? !Number.isSafeInteger(from?.revision) : from?.status !== 'ready' || !Number.isSafeInteger(from.saveRevision)) return null
  if (destinationHub ? !Number.isSafeInteger(to?.revision) : to?.status !== 'ready' || !Number.isSafeInteger(to.saveRevision)) return null
  const area = sourceHub ? target.area : source.area
  const sourceArea = sourceHub ? null : from.areas?.[area]
  const destinationArea = destinationHub ? null : to.areas?.[area]
  const item = sourceHub ? from.slots?.[source.slot] : sourceArea?.slots?.[source.slot]
  if (!item?.itemKey || !Number.isSafeInteger(item.quantity) || item.quantity < 1
    || !sourceHub && (!item.nativeId || sourceArea?.issues?.length || !getPokemonItemPolicy(from.title, area, item.itemKey)?.canTransfer)
    || !destinationHub && (destinationArea?.issues?.length || !getPokemonItemPolicy(to.title, area, item.itemKey)?.canTransfer)) return null
  let existing = null
  let destinationLimit = null
  let maxQuantity = item.quantity
  if (destinationHub) {
    existing = Object.values(to.slots ?? {}).find(slot => slot.itemKey === item.itemKey) ?? null
    if (existing) maxQuantity = Math.min(item.quantity, Number.MAX_SAFE_INTEGER - existing.quantity)
  } else {
    if (!Array.isArray(destinationArea?.slots) || !Number.isSafeInteger(destinationArea.maxPerStack)) return null
    const matches = destinationArea.slots.filter(slot => slot.itemKey === item.itemKey)
    if (matches.length > 1) return null
    existing = matches[0] ?? null
    destinationLimit = destinationArea.maxPerStack
    maxQuantity = Math.min(item.quantity, existing ? destinationLimit - existing.quantity
      : destinationArea.slots.some(slot => !slot.nativeId) ? destinationLimit : 0)
  }
  if (maxQuantity < 1) return null
  return { source, destination: target, area, fromSlot: source.slot, itemKey: item.itemKey, maxQuantity,
    destinationExisting: existing?.quantity ?? 0, destinationLimit,
    ...(sourceHub ? { sourceItemRevision: from.revision } : { sourceSaveRevision: from.saveRevision }),
    ...(destinationHub ? { destinationItemRevision: to.revision } : { destinationSaveRevision: to.saveRevision }) }
}
