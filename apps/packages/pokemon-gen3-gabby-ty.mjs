import { editPokemonGen3Flags, readPokemonGen3Flags } from './pokemon-gen3-event-flags.mjs'
import { pokemonGen3SaveByteOffset, refreshPokemonGen3SaveSectionChecksums, selectUnambiguousPokemonGen3SaveCopy } from './pokemon-gen3-save-validation.mjs'

export const gabbyTyAdjustmentId = 'gabby-ty-route111'

const counterOffsets = Object.freeze({
  'pokemon-ruby': 0x2b19,
  'pokemon-sapphire': 0x2b19,
  'pokemon-emerald': 0x2bad,
})

const locationFlags = [0x31c, 0x31d, 0x31e, 0x31f, 0x385, 0x386, 0x387, 0x388]
const route111Flags = [true, true, true, true, true, true, false, true]

export function supportsGabbyTyAdjustment(title) { return Object.hasOwn(counterOffsets, title) }

export function stopPokemonGen3GabbyTy(saveBytes, title) {
  const logicalOffset = counterOffsets[title]
  if (logicalOffset === undefined) throw invalidAdjustment('Gabby and Ty are unsupported for this title.')
  const save = selectUnambiguousPokemonGen3SaveCopy(saveBytes)
  const edited = Buffer.from(saveBytes)
  const address = pokemonGen3SaveByteOffset(save, 'large', logicalOffset)
  if (edited[address] !== 0xff) {
    edited[address] = 0xff
    refreshPokemonGen3SaveSectionChecksums(edited, save, new Set([1 + Math.floor(logicalOffset / 0xf80)]))
  }
  const candidate = editPokemonGen3Flags(edited, title, locationFlags.map((flagId, index) => ({ flagId, value: route111Flags[index] })))
  validatePokemonGen3GabbyTyCandidate(saveBytes, candidate, title)
  return candidate
}

export function validatePokemonGen3GabbyTyCandidate(original, candidate, title) {
  const logicalOffset = counterOffsets[title]
  if (logicalOffset === undefined) throw invalidAdjustment('Gabby and Ty are unsupported for this title.')
  const before = selectUnambiguousPokemonGen3SaveCopy(original)
  const after = selectUnambiguousPokemonGen3SaveCopy(candidate)
  if (before.copyOffset !== after.copyOffset || before.saveIndex !== after.saveIndex) throw invalidAdjustment('Gabby and Ty candidate changed active save identity.')
  const counterAddress = pokemonGen3SaveByteOffset(before, 'large', logicalOffset)
  if (candidate[counterAddress] !== 0xff || readPokemonGen3Flags(candidate, title, locationFlags).some((value, index) => value !== route111Flags[index])) {
    throw invalidAdjustment('Gabby and Ty candidate has an incorrect final location.')
  }
  const flagBase = title === 'pokemon-emerald' ? 0x1270 : 0x1220
  const flagMasks = new Map()
  const touchedSections = new Set([1 + Math.floor(logicalOffset / 0xf80)])
  for (const flagId of locationFlags) {
    const offset = flagBase + (flagId >> 3)
    const address = pokemonGen3SaveByteOffset(before, 'large', offset)
    flagMasks.set(address, (flagMasks.get(address) ?? 0) | (1 << (flagId & 7)))
    touchedSections.add(1 + Math.floor(offset / 0xf80))
  }
  const checksumAddresses = new Set([...touchedSections].flatMap(sectionId => {
    const address = before.sectors.get(sectionId).offset + 0xff6
    return [address, address + 1]
  }))
  let changed = false
  for (let address = 0; address < original.byteLength; address += 1) {
    if (original[address] === candidate[address]) continue
    changed = true
    if (address === counterAddress || checksumAddresses.has(address)) continue
    const mask = flagMasks.get(address)
    if (mask !== undefined && ((original[address] ^ candidate[address]) & ~mask) === 0) continue
    throw invalidAdjustment('Gabby and Ty candidate changed unrelated save bytes.')
  }
  return { changed }
}

function invalidAdjustment(message) {
  const error = new Error(message)
  error.code = 'SAVE_CANDIDATE_INVALID'
  return error
}
