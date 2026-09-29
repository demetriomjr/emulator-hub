const areaOrder = ['pc', 'items', 'key-items', 'poke-balls', 'tm-hm', 'berries']
const areaLabels = {
  pc: 'PC',
  items: 'Itens',
  'key-items': 'Itens-chave',
  'poke-balls': 'Poké Bolas',
  'tm-hm': 'TMs/HMs',
  berries: 'Berries',
}

export function getPokemonItemAreaView(inventory, areaId) {
  if (inventory?.status !== 'ready') return null
  const areaIds = areaOrder.filter(id => inventory.areas?.[id])
  const index = areaIds.indexOf(areaId)
  if (index < 0) return null
  const area = inventory.areas[areaId]
  if (!Number.isInteger(area.capacity) || area.capacity < 0 || !Array.isArray(area.slots)
    || area.slots.length !== area.capacity || area.slots.some((slot, slotIndex) => slot?.index !== slotIndex)) return null
  const fireRedLeafGreen = inventory.title === 'pokemon-firered' || inventory.title === 'pokemon-leafgreen'
  const label = fireRedLeafGreen && areaId === 'tm-hm' ? 'TM Case'
    : fireRedLeafGreen && areaId === 'berries' ? 'Berry Pouch'
      : areaLabels[areaId]
  return { areaIds, index, label, capacity: area.capacity, freeSlots: area.freeSlots, slots: area.slots, issues: area.issues }
}

export function getPokemonItemName(slot) {
  if (!slot?.nativeId) return ''
  if (!slot.itemKey) return `Item #${slot.nativeId}`
  return slot.itemKey.split('-').map(word => /^(tm|hm)\d+$/i.test(word)
    ? word.toUpperCase()
    : word === 'poke' ? 'Poké' : word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}
