import catalog from './pokemon-gen3-event-encounters.json' with { type: 'json' }
import { inspectPokemonGen3EventEligibility } from './pokemon-gen3-event-eligibility.mjs'
import { readPokemonGen3Flags } from './pokemon-gen3-event-flags.mjs'
import { inspectPokemonGen3Inventory } from './pokemon-gen3-inventory.mjs'
import { pokemonGen3SaveByteOffset, selectUnambiguousPokemonGen3SaveCopy } from './pokemon-gen3-save-validation.mjs'

const eventsById = new Map(catalog.events.map(event => [event.id, event]))

// This independent readback runs on private bytes before a canonical save write.
export function validatePokemonGen3EventCandidate(original, candidate, title, eventIds) {
  const layout = catalog.keyItemsInsertion.layoutByTitle[title]
  const globalFlags = catalog.globalUnlockFlagIdsByTitle[title]
  if (!layout || !globalFlags || !Array.isArray(eventIds) || eventIds.length === 0) throw invalidCandidate('Event candidate recipe is unsupported.')
  const itemIds = new Set()
  const flagIds = new Set(globalFlags)
  for (const eventId of eventIds) {
    const event = eventsById.get(eventId)
    const itemId = event?.itemIdByTitle?.[title]
    const flags = event?.grantFlagIdsByTitle?.[title]
    if (!Number.isInteger(itemId) || !Array.isArray(flags) || itemIds.has(itemId)) throw invalidCandidate('Event candidate recipe is unsupported.')
    itemIds.add(itemId)
    for (const flagId of flags) flagIds.add(flagId)
  }

  const beforeSave = selectUnambiguousPokemonGen3SaveCopy(original)
  const afterSave = selectUnambiguousPokemonGen3SaveCopy(candidate)
  if (beforeSave.copyOffset !== afterSave.copyOffset || beforeSave.saveIndex !== afterSave.saveIndex) throw invalidCandidate('Event candidate changed active save identity.')
  const beforeEligibility = inspectPokemonGen3EventEligibility(original, title)
  const afterEligibility = inspectPokemonGen3EventEligibility(candidate, title)
  const rubySapphire = title === 'pokemon-ruby' || title === 'pokemon-sapphire'
  if (!beforeEligibility.eligible || !afterEligibility.eligible || beforeEligibility.gameClear !== afterEligibility.gameClear
    || beforeEligibility.networkMachineRestored !== afterEligibility.networkMachineRestored
    || (!rubySapphire && beforeEligibility.nationalDexUnlocked !== afterEligibility.nationalDexUnlocked)
    || (rubySapphire && !afterEligibility.nationalDexUnlocked)) throw invalidCandidate('Event candidate changed progression.')

  const beforeInventory = inspectPokemonGen3Inventory(original, title)
  const afterInventory = inspectPokemonGen3Inventory(candidate, title)
  const allowedItemBytes = new Set()
  const touchedSections = new Set()
  for (let index = 0; index < layout.keyItemsSlots; index += 1) {
    const before = beforeInventory.keyItems.slots[index]
    const after = afterInventory.keyItems.slots[index]
    if (before.itemId === after.itemId && before.quantity === after.quantity) continue
    if (before.itemId !== 0 || !itemIds.has(after.itemId) || after.quantity !== 1) throw invalidCandidate('Event candidate changed an unrelated item.')
    const logical = layout.keyItemsOffset + index * 4
    const address = pokemonGen3SaveByteOffset(beforeSave, 'large', logical)
    for (let byte = 0; byte < 4; byte += 1) allowedItemBytes.add(address + byte)
    touchedSections.add(1 + Math.floor(logical / 0xf80))
  }
  const owned = new Set(afterInventory.keyItems.slots.filter(slot => slot.quantity === 1).map(slot => slot.itemId))
  if ([...itemIds].some(itemId => !owned.has(itemId))) throw invalidCandidate('Event candidate is missing a Key Item.')

  const requiredFlags = [...flagIds]
  if (readPokemonGen3Flags(candidate, title, requiredFlags).some(value => !value)) throw invalidCandidate('Event candidate is missing a required flag.')
  const defaultFlagChanges = catalog.defaultFlagChangesByTitle[title] ?? []
  if (readPokemonGen3Flags(candidate, title, defaultFlagChanges.map(change => change.flagId))
    .some((value, index) => value !== defaultFlagChanges[index].value)) throw invalidCandidate('Event candidate has an incorrect Match Call flag.')
  const allowedFlagMasks = new Map()
  const flagBase = title === 'pokemon-ruby' || title === 'pokemon-sapphire' ? 0x1220 : title === 'pokemon-emerald' ? 0x1270 : 0x0ee0
  for (const flagId of [...requiredFlags, ...defaultFlagChanges.map(change => change.flagId)]) {
    const logical = flagBase + (flagId >> 3)
    const address = pokemonGen3SaveByteOffset(beforeSave, 'large', logical)
    allowedFlagMasks.set(address, (allowedFlagMasks.get(address) ?? 0) | (1 << (flagId & 7)))
    touchedSections.add(1 + Math.floor(logical / 0xf80))
  }

  const allowedNationalBytes = new Set()
  if (rubySapphire && !beforeEligibility.nationalDexUnlocked) {
    for (const [offset, expected] of [[0x18, 0], [0x19, 1], [0x1a, 0xda]]) {
      const address = pokemonGen3SaveByteOffset(beforeSave, 'small', offset)
      if (candidate[address] !== expected) throw invalidCandidate('Event candidate has an invalid Ruby/Sapphire National Dex field.')
      allowedNationalBytes.add(address)
    }
    const workAddress = pokemonGen3SaveByteOffset(beforeSave, 'large', 0x13cc)
    if (candidate[workAddress] !== 0x02 || candidate[workAddress + 1] !== 0x03) throw invalidCandidate('Event candidate has an invalid Ruby/Sapphire National Dex variable.')
    allowedNationalBytes.add(workAddress)
    allowedNationalBytes.add(workAddress + 1)
    const flagAddress = pokemonGen3SaveByteOffset(beforeSave, 'large', flagBase + (0x836 >> 3))
    allowedFlagMasks.set(flagAddress, (allowedFlagMasks.get(flagAddress) ?? 0) | (1 << (0x836 & 7)))
    touchedSections.add(0)
    touchedSections.add(1 + Math.floor(0x13cc / 0xf80))
    touchedSections.add(1 + Math.floor((flagBase + (0x836 >> 3)) / 0xf80))
  }

  const checksumBytes = new Set()
  for (const sectionId of touchedSections) {
    const address = beforeSave.sectors.get(sectionId).offset + 0xff6
    checksumBytes.add(address)
    checksumBytes.add(address + 1)
  }
  let changed = false
  for (let address = 0; address < original.byteLength; address += 1) {
    if (original[address] === candidate[address]) continue
    changed = true
    if (allowedItemBytes.has(address) || allowedNationalBytes.has(address) || checksumBytes.has(address)) continue
    const mask = allowedFlagMasks.get(address)
    if (mask !== undefined && ((original[address] ^ candidate[address]) & ~mask) === 0) continue
    throw invalidCandidate('Event candidate changed unrelated save bytes.')
  }
  return { changed }
}

function invalidCandidate(message) {
  const error = new Error(message)
  error.code = 'SAVE_CANDIDATE_INVALID'
  return error
}
