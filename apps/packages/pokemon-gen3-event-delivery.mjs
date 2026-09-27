import catalog from './pokemon-gen3-event-encounters.json' with { type: 'json' }
import { validatePokemonGen3EventCandidate } from './pokemon-gen3-event-candidate-validation.mjs'
import { inspectPokemonGen3EventEligibility } from './pokemon-gen3-event-eligibility.mjs'
import { materializePokemonGen3EventGrant } from './pokemon-gen3-event-grant.mjs'
import { readPokemonGen3Flags } from './pokemon-gen3-event-flags.mjs'
import { inspectPokemonGen3Inventory } from './pokemon-gen3-inventory.mjs'

export function createPokemonGen3EventDeliveryService({ saveStore, gameSaveLeases, snapshotStore = null, resolveGame, now = () => new Date(), onError = console.warn, onEvent = () => {} } = {}) {
  if (typeof saveStore?.get !== 'function' || typeof saveStore?.put !== 'function' || typeof gameSaveLeases?.get !== 'function' || typeof resolveGame !== 'function') {
    throw new TypeError('Gen III event delivery dependencies are invalid.')
  }

  return { attempt }

  async function attempt({ profileId, gameId }) {
    try {
      const game = await resolveGame(gameId)
      const title = game?.title
      const recipeVersion = title === 'pokemon-emerald' ? 2 : 1
      const romSha256 = game?.romSha256
      const eventIds = catalog.events.filter(event => event.itemIdByTitle[title] !== undefined).map(event => event.id)
      if (!eventIds.length || typeof romSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(romSha256)) return { status: 'unsupported-rom', ...(game?.unsupportedReason ? { reason: game.unsupportedReason } : {}) }
      if (await gameSaveLeases.get({ profileId, gameId })) return { status: 'deferred-lease' }
      const original = await saveStore.get(profileId, gameId)
      if (!original) return { status: 'save-missing' }
      const receipt = original.eventGrantReceipt
      if (receipt) {
        if (receipt.romSha256 !== romSha256) return { status: 'rom-identity-changed' }
        if (receipt.recipeVersion === recipeVersion && sameEvents(receipt.eventIds, eventIds)) return { status: 'already-delivered', revision: original.revision }
      }
      const eligibility = inspectPokemonGen3EventEligibility(original.bytes, title)
      emit('eligibility', { profileId, gameId, title, romSha256, patchSha256: game.patchSha256 ?? null, saveRevision: original.revision, ...eligibility })
      if (!eligibility.eligible) return { status: 'pending-progression' }

      const candidate = materializePokemonGen3EventGrant(original.bytes, title, eventIds)
      const validation = validatePokemonGen3EventCandidate(original.bytes, candidate, title, eventIds)
      const requestedItemIds = eventIds.map(eventId => catalog.events.find(event => event.id === eventId).itemIdByTitle[title])
      const ownedBefore = new Set(inspectPokemonGen3Inventory(original.bytes, title).keyItems.slots.filter(slot => slot.quantity === 1).map(slot => slot.itemId))
      const addedItemIds = requestedItemIds.filter(itemId => !ownedBefore.has(itemId))
      const requestedFlagIds = [...new Set([...catalog.globalUnlockFlagIdsByTitle[title], ...eventIds.flatMap(eventId => catalog.events.find(event => event.id === eventId).grantFlagIdsByTitle[title])])]
      const existingFlags = readPokemonGen3Flags(original.bytes, title, requestedFlagIds)
      const enabledFlagIds = requestedFlagIds.filter((_, index) => !existingFlags[index])
      const defaultFlagChanges = catalog.defaultFlagChangesByTitle[title] ?? []
      const defaultFlagsBefore = readPokemonGen3Flags(original.bytes, title, defaultFlagChanges.map(change => change.flagId))
      const clearedFlagIds = defaultFlagChanges.filter((change, index) => !change.value && defaultFlagsBefore[index]).map(change => change.flagId)
      if ((title === 'pokemon-ruby' || title === 'pokemon-sapphire') && !eligibility.nationalDexUnlocked) enabledFlagIds.push(0x836)
      const deliveredAt = new Date(now()).toISOString()
      const saved = await saveStore.put(profileId, gameId, Buffer.from(candidate), original.revision, {
        fenceGeneration: original.fenceGeneration,
        invalidateRuntimeStates: validation.changed,
        eventGrantReceipt: { romSha256, recipeVersion, eventIds, deliveredAt },
        beforeCommit: async () => {
          if (await gameSaveLeases.get({ profileId, gameId })) throw deliveryError('EVENT_SAVE_LEASED', 'The game save acquired a lease before event delivery.')
        },
      })
      const confirmed = await saveStore.get(profileId, gameId)
      if (confirmed?.revision !== saved.revision || confirmed.sha256 !== saved.sha256 || confirmed.eventGrantReceipt?.saveSha256 !== saved.sha256) {
        throw deliveryError('EVENT_SAVE_READBACK_FAILED', 'The stored event save could not be confirmed.')
      }
      emit('committed', { profileId, gameId, title, romSha256, patchSha256: game.patchSha256 ?? null, previousRevision: original.revision, revision: saved.revision, previousSha256: original.sha256, sha256: saved.sha256, backupFileName: saved.eventGrantReceipt.backupFileName, eventIds, addedItemIds, enabledFlagIds: enabledFlagIds.sort((a, b) => a - b), clearedFlagIds })
      if (validation.changed && snapshotStore) {
        for (const kind of ['cloud-recovery', 'user-state']) {
          try { await snapshotStore.delete(profileId, gameId, { kind }) }
          catch (error) { onError('[Gen III events] stale snapshot cleanup failed', { profileId, gameId, kind, code: error.code ?? null }) }
        }
      }
      return { status: 'delivered', revision: saved.revision }
    } catch (error) {
      if (error.code === 'EVENT_SAVE_LEASED') return { status: 'deferred-lease' }
      onError('[Gen III events] optional delivery skipped', { profileId, gameId, code: error.code ?? 'EVENT_DELIVERY_FAILED', message: error.message })
      return { status: 'skipped', code: error.code ?? 'EVENT_DELIVERY_FAILED' }
    }
  }

  function emit(phase, details) {
    try { onEvent(phase, details) } catch {}
  }
}

function sameEvents(left, right) {
  return Array.isArray(left) && left.length === right.length && left.every((eventId, index) => eventId === right[index])
}

function deliveryError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}
