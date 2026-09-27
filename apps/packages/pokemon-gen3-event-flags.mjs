import { pokemonGen3SaveByteOffset, refreshPokemonGen3SaveSectionChecksums, selectUnambiguousPokemonGen3SaveCopy } from './pokemon-gen3-save-validation.mjs'
import capabilities from './pokemon-gen3-save-capabilities.json' with { type: 'json' }

const flagBytesByTitle = Object.freeze({
  'pokemon-ruby': 288,
  'pokemon-sapphire': 288,
  'pokemon-emerald': 300,
  'pokemon-firered': 288,
  'pokemon-leafgreen': 288,
})

export function readPokemonGen3Flags(saveBytes, pokemonSaveTitle, flagIds) {
  const profile = flagProfile(pokemonSaveTitle)
  validateFlagIds(flagIds, profile.flagBytes)
  const save = selectUnambiguousPokemonGen3SaveCopy(saveBytes)
  return flagIds.map(flagId => {
    const offset = pokemonGen3SaveByteOffset(save, 'large', profile.eventFlagBase + (flagId >> 3))
    return (saveBytes[offset] & (1 << (flagId & 7))) !== 0
  })
}

export function editPokemonGen3Flags(saveBytes, pokemonSaveTitle, changes) {
  const profile = flagProfile(pokemonSaveTitle)
  if (!Array.isArray(changes)) throw invalidFlag('Gen III flag changes must be an array.')
  validateFlagIds(changes.map(change => change?.flagId), profile.flagBytes)
  const seen = new Set()
  for (const change of changes) {
    if (seen.has(change.flagId)) throw invalidFlag('Duplicate Gen III flag edit.')
    if (typeof change.value !== 'boolean') throw invalidFlag('Gen III flag value must be boolean.')
    seen.add(change.flagId)
  }
  const save = selectUnambiguousPokemonGen3SaveCopy(saveBytes)
  const edited = Buffer.from(saveBytes)
  const touched = new Set()
  for (const { flagId, value } of changes) {
    const logicalOffset = profile.eventFlagBase + (flagId >> 3)
    const offset = pokemonGen3SaveByteOffset(save, 'large', logicalOffset)
    const mask = 1 << (flagId & 7)
    const next = value ? edited[offset] | mask : edited[offset] & ~mask
    if (next !== edited[offset]) {
      edited[offset] = next
      touched.add(1 + Math.floor(logicalOffset / 0xf80))
    }
  }
  return refreshPokemonGen3SaveSectionChecksums(edited, save, touched)
}

function flagProfile(title) {
  const eventFlagBase = capabilities.titles[title]?.eventFlagBase
  const flagBytes = flagBytesByTitle[title]
  if (!Number.isInteger(eventFlagBase) || !Number.isInteger(flagBytes)) throw invalidFlag('Unsupported Gen III save title.')
  return { eventFlagBase, flagBytes }
}

function validateFlagIds(flagIds, flagBytes) {
  if (!Array.isArray(flagIds)) throw invalidFlag('Gen III flag IDs must be an array.')
  for (const id of flagIds) if (!Number.isInteger(id) || id < 0 || id >= flagBytes * 8) throw invalidFlag('Gen III flag ID is outside the supported range.')
}

function invalidFlag(message) {
  const error = new TypeError(message)
  error.code = 'SAVE_UNSUPPORTED'
  return error
}
