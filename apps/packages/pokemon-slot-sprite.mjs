import { spriteUrl } from './pokemon-resource-catalog.mjs'

export function getPokemonSlotSprite(slot) {
  if (!slot?.occupied) return null
  if (slot.isEgg === true) return '/resources/pokemon/egg.png'
  if (!Number.isInteger(slot.species) || slot.species < 1) return null
  return spriteUrl({ nationalDex: slot.species, shiny: slot.shiny === true })
}

export function getPokemonSlotFallback(slot) {
  return slot?.isEgg === true ? 'Ovo' : `#${slot?.species ?? '●'}`
}

export function hidePokemonSlotSprite(image) {
  image.hidden = true
}
