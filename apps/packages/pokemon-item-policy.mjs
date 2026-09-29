import itemCatalog from './pokemon-item-catalog.json' with { type: 'json' }

const rubySapphireEmerald = new Set(['pokemon-ruby', 'pokemon-sapphire', 'pokemon-emerald'])
const ordinaryAreas = new Set(['pc', 'items', 'poke-balls'])
const tmKey = /^tm(?:0[1-9]|[1-4][0-9]|50)-[a-z0-9-]+$/
const hmKey = /^hm\d{2}-[a-z0-9-]+$/
const gen3Items = itemCatalog.nativeIdMaps['gen3-gba']
const rseKeyItems = new Set([...gen3Items.slice(259, 289), gen3Items[375], gen3Items[376]].filter(Boolean))
const knownItemsByTitle = new Map([...rubySapphireEmerald].map(title => [title,
  new Set(gen3Items.slice(0, itemCatalog.maxNativeIdByTitle[title] + 1).filter(Boolean)),
]))

export function getPokemonItemPolicy(title, areaId, itemKey) {
  if (!rubySapphireEmerald.has(title)) return null
  const knownItem = knownItemsByTitle.get(title).has(itemKey)
  const blockedItem = rseKeyItems.has(itemKey) || hmKey.test(itemKey ?? '')
  if (ordinaryAreas.has(areaId)) return {
    canTransfer: knownItem && !blockedItem, canReorder: true, showQuantity: true,
  }
  if (areaId === 'key-items') return {
    canTransfer: false, canReorder: true, showQuantity: false,
  }
  if (areaId === 'berries') return {
    canTransfer: knownItem && !blockedItem, canReorder: false, showQuantity: true,
  }
  if (areaId === 'tm-hm') return {
    canTransfer: knownItem && tmKey.test(itemKey ?? ''), canReorder: false, showQuantity: true,
  }
  return null
}
