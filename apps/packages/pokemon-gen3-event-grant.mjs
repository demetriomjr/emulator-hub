import eventCatalog from './pokemon-gen3-event-encounters.json' with { type: 'json' }
import { inspectPokemonGen3EventEligibility } from './pokemon-gen3-event-eligibility.mjs'
import { editPokemonGen3Flags, readPokemonGen3Flags } from './pokemon-gen3-event-flags.mjs'
import { addPokemonGen3KeyItems, inspectPokemonGen3Inventory } from './pokemon-gen3-inventory.mjs'
import { enableRubySapphireNationalDex } from './pokemon-gen3-national-dex.mjs'

const eventsById = new Map(eventCatalog.events.map(event => [event.id, event]))

// Build a candidate only. Backend ROM policy, leases, persistence, and the
// durable delivery receipt are separate responsibilities.
export function materializePokemonGen3EventGrant(saveBytes, pokemonSaveTitle, eventIds) {
  const globalFlags = eventCatalog.globalUnlockFlagIdsByTitle[pokemonSaveTitle]
  if (!globalFlags) throw invalidGrant('Unsupported Gen III event title.')
  if (!Array.isArray(eventIds) || eventIds.length === 0) throw invalidGrant('At least one Gen III event is required.')

  const requested = new Set()
  const items = []
  const flags = new Set(globalFlags)
  for (const eventId of eventIds) {
    if (requested.has(eventId)) throw invalidGrant('Duplicate Gen III event request.')
    const event = eventsById.get(eventId)
    const itemId = event?.itemIdByTitle?.[pokemonSaveTitle]
    const grantFlags = event?.grantFlagIdsByTitle?.[pokemonSaveTitle]
    if (!Number.isInteger(itemId) || !Array.isArray(grantFlags) || grantFlags.length === 0) throw invalidGrant('Unsupported Gen III event for this title.')
    requested.add(eventId)
    items.push(itemId)
    for (const flagId of grantFlags) flags.add(flagId)
  }

  if (!inspectPokemonGen3EventEligibility(saveBytes, pokemonSaveTitle).eligible) {
    const error = invalidGrant('Gen III event progression is not eligible for a grant.')
    error.code = 'SAVE_EVENT_INELIGIBLE'
    throw error
  }

  const withNationalDex = pokemonSaveTitle === 'pokemon-ruby' || pokemonSaveTitle === 'pokemon-sapphire'
    ? enableRubySapphireNationalDex(saveBytes, pokemonSaveTitle)
    : saveBytes
  const withItems = addPokemonGen3KeyItems(withNationalDex, pokemonSaveTitle, items)
  const flagIds = [...flags]
  const candidate = editPokemonGen3Flags(withItems, pokemonSaveTitle, flagIds.map(flagId => ({ flagId, value: true })))
  const owned = new Set(inspectPokemonGen3Inventory(candidate, pokemonSaveTitle).keyItems.slots
    .filter(slot => slot.quantity === 1)
    .map(slot => slot.itemId))
  if (items.some(itemId => !owned.has(itemId)) || readPokemonGen3Flags(candidate, pokemonSaveTitle, flagIds).some(value => !value)) {
    throw invalidGrant('Gen III event grant could not be verified.')
  }
  return candidate
}

function invalidGrant(message) {
  const error = new TypeError(message)
  error.code = 'SAVE_UNSUPPORTED'
  return error
}
