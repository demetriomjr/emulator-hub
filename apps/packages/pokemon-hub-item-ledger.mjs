import itemCatalog from './pokemon-item-catalog.json' with { type: 'json' }

const knownKeys = new Set(Object.values(itemCatalog.nativeIdMaps).flat().filter(Boolean))

export function hubItemLedgerGameId(hubProfileId) {
  if (typeof hubProfileId !== 'string' || !/^[0-9a-f-]{36}$/i.test(hubProfileId)) throw invalidLedger('Hub profile ID is invalid.')
  return `.hub-items-${hubProfileId}`
}

export function emptyHubItemLedger() { return { schemaVersion: 1, slots: {} } }

export function decodeHubItemLedger(bytes) {
  try { return validateLedger(JSON.parse(bytes.toString('utf8'))) }
  catch (error) { if (error.code === 'HUB_ITEM_INVALID') throw error; throw invalidLedger('Hub item ledger is invalid.') }
}

export function encodeHubItemLedger(ledger) {
  return Buffer.from(JSON.stringify(validateLedger(ledger)))
}

export function addHubItem(ledger, { itemKey, quantity, toSlot } = {}) {
  const current = validateLedger(ledger)
  if (!knownKeys.has(itemKey) || !validQuantity(quantity) || toSlot !== undefined && !validSlot(toSlot)) throw invalidLedger('Hub item addition is invalid.')
  const existing = Object.entries(current.slots).find(([, item]) => item.itemKey === itemKey)
  const slots = { ...current.slots }
  if (existing) {
    const nextQuantity = existing[1].quantity + quantity
    if (!validQuantity(nextQuantity)) throw invalidLedger('Hub item quantity would overflow.')
    slots[existing[0]] = { itemKey, quantity: nextQuantity }
  } else {
    let target = toSlot
    if (target === undefined || slots[target]) {
      target = 0
      while (slots[target]) target++
    }
    slots[target] = { itemKey, quantity }
  }
  return { schemaVersion: 1, slots }
}

export function removeHubItem(ledger, { fromSlot, quantity } = {}) {
  const current = validateLedger(ledger)
  if (!validSlot(fromSlot) || !validQuantity(quantity) || !current.slots[fromSlot] || current.slots[fromSlot].quantity < quantity) throw invalidLedger('Hub item withdrawal is invalid.')
  const slots = { ...current.slots }
  const item = slots[fromSlot]
  if (item.quantity === quantity) delete slots[fromSlot]
  else slots[fromSlot] = { ...item, quantity: item.quantity - quantity }
  return { schemaVersion: 1, slots }
}

export function moveHubItem(ledger, { fromSlot, toSlot } = {}) {
  const current = validateLedger(ledger)
  if (!validSlot(fromSlot) || !validSlot(toSlot) || !current.slots[fromSlot]) throw invalidLedger('Hub item move is invalid.')
  if (fromSlot === toSlot) return current
  const slots = { ...current.slots }
  const source = slots[fromSlot]
  if (slots[toSlot]) slots[fromSlot] = slots[toSlot]
  else delete slots[fromSlot]
  slots[toSlot] = source
  return { schemaVersion: 1, slots }
}

function validateLedger(ledger) {
  if (!ledger || ledger.schemaVersion !== 1 || !ledger.slots || typeof ledger.slots !== 'object' || Array.isArray(ledger.slots)) throw invalidLedger('Hub item ledger is invalid.')
  const seen = new Set()
  const slots = {}
  for (const [index, item] of Object.entries(ledger.slots)) {
    if (!/^(0|[1-9]\d*)$/.test(index) || !validSlot(Number(index)) || !item || typeof item !== 'object' || Array.isArray(item)
      || !knownKeys.has(item.itemKey) || !validQuantity(item.quantity) || seen.has(item.itemKey)) throw invalidLedger('Hub item ledger is invalid.')
    seen.add(item.itemKey)
    slots[index] = { itemKey: item.itemKey, quantity: item.quantity }
  }
  return { schemaVersion: 1, slots }
}

function validSlot(value) { return Number.isSafeInteger(value) && value >= 0 }
function validQuantity(value) { return Number.isSafeInteger(value) && value > 0 }
function invalidLedger(message) { const error = new Error(message); error.code = 'HUB_ITEM_INVALID'; return error }
