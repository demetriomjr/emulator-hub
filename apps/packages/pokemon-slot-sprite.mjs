import { spriteUrl } from './pokemon-resource-catalog.mjs'

export function getPokemonSlotSprite(slot) {
  if (!slot?.occupied || !Number.isInteger(slot.species) || slot.species < 1) return null
  return spriteUrl({ nationalDex: slot.species, shiny: slot.shiny === true })
}

export function hidePokemonSlotSprite(image) {
  image.hidden = true
}
