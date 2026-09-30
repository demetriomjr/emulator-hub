import { readPokemonItemInventory, reorderPokemonItemsInSave, transferPokemonItemsBetweenSaves } from './pokemon-item-inventory.mjs'
import { evaluateGenerationIIIItemTrade } from './pokemon-gen3-transfer-rules.mjs'

export function createPokemonItemReorderService({ sessions, gameSaveLeases, saveStore, saveFlush, snapshotCoordinator, snapshotStore, resolveSaveSource,
  reorder = reorderPokemonItemsInSave, transferItems = transferPokemonItemsBetweenSaves, readInventory = readPokemonItemInventory, onWarning = console.warn } = {}) {
  if (typeof sessions?.withLoadedSource !== 'function' || typeof gameSaveLeases?.assertHub !== 'function'
    || typeof saveStore?.get !== 'function' || typeof saveStore?.put !== 'function'
    || typeof saveFlush?.flushSource !== 'function' || typeof snapshotCoordinator?.getSaveFlushPlan !== 'function'
    || typeof snapshotCoordinator?.markSaveFlushed !== 'function' || typeof resolveSaveSource !== 'function') {
    throw new TypeError('Pokemon item reorder persistence is unavailable.')
  }

  return { reorder: reorderRequest, transfer: transferRequest }

  async function transferRequest({ sessionId, source, destination, area, fromSlot, toSlot, quantity } = {}) {
    const validIdentity = value => typeof value?.gameId === 'string' && value.gameId.length > 0
      && typeof value.profileId === 'string' && value.profileId.length > 0
      && Number.isSafeInteger(value.expectedSaveRevision) && value.expectedSaveRevision > 0
    if (typeof sessionId !== 'string' || !sessionId
      || !validIdentity(source) || !validIdentity(destination) || !Number.isInteger(fromSlot) || fromSlot < 0
      || toSlot !== undefined && (!Number.isInteger(toSlot) || toSlot < 0)
      || !Number.isSafeInteger(quantity) || quantity < 1 || typeof area !== 'string'
      || source.gameId === destination.gameId && source.profileId === destination.profileId) {
      throw reorderError('SAVE_ITEM_REQUEST_INVALID', 'The item transfer request is invalid.')
    }
    const identities = [source, destination]
    const sourceKeys = identities.map(item => `save:${item.profileId}:${item.gameId}`)
    return sessions.withLoadedSources({ sessionId, sourceKeys, run: async (_sources, assertActive = async () => {}) => {
      const targets = await Promise.all(sourceKeys.map(sourceKey => resolveSaveSource({ sourceKey })))
      for (let index = 0; index < 2; index++) {
        if (targets[index]?.sourceProfileId !== identities[index].profileId || targets[index]?.gameId !== identities[index].gameId
          || !['pokemon-ruby', 'pokemon-sapphire', 'pokemon-emerald'].includes(targets[index]?.layout?.pokemonSaveTitle)
          || typeof targets[index].adapter?.inspect !== 'function') throw reorderError('SAVE_ITEM_SOURCE_INVALID', 'The item save source is invalid.')
      }
      const leases = identities.map(item => ({ profileId: item.profileId, gameId: item.gameId, workspaceId: sessionId }))
      const assertLeases = async () => { await assertActive(); for (const lease of leases) await gameSaveLeases.assertHub(lease) }
      await assertLeases()
      const originals = await Promise.all(identities.map(item => saveStore.get(item.profileId, item.gameId)))
      if (originals.some((saved, index) => !saved || saved.revision !== identities[index].expectedSaveRevision)) {
        throw reorderError('SAVE_ITEM_REVISION_CONFLICT', 'An item save revision has changed.')
      }
      const titles = targets.map(target => target.layout.pokemonSaveTitle)
      const evaluateTrade = saves => {
        const capabilities = saves.map((save, index) => targets[index].adapter.inspect(save.bytes, targets[index].layout).transferCapabilities)
        const decision = evaluateGenerationIIIItemTrade({ source: { title: titles[0], ...capabilities[0] }, destination: { title: titles[1], ...capabilities[1] } })
        if (!decision.allowed) throw reorderError(decision.reason.code, decision.reason.message)
      }
      evaluateTrade(originals)
      const move = { area, fromSlot, ...(toSlot === undefined ? {} : { toSlot }), quantity }
      transferItems(originals[0].bytes, titles[0], originals[1].bytes, titles[1], move)
      const flushes = []
      for (const sourceKey of sourceKeys) {
        const flushed = await saveFlush.flushSource({ sourceKey })
        if (flushed.status === 'failed') throw reorderError('SAVE_FLUSH_FAILED', 'The Pokémon save could not be flushed before item transfer.')
        flushes.push(flushed)
      }
      await assertLeases()
      const current = await Promise.all(identities.map(item => saveStore.get(item.profileId, item.gameId)))
      if (current.some((saved, index) => !saved || saved.revision !== originals[index].revision + (flushes[index].status === 'flushed' ? 1 : 0))) {
        throw reorderError('SAVE_ITEM_REVISION_CONFLICT', 'An item save revision changed during transfer.')
      }
      evaluateTrade(current)
      const result = transferItems(current[0].bytes, titles[0], current[1].bytes, titles[1], move)
      const saved = await saveStore.putPair(identities.map((item, index) => ({ profileId: item.profileId, gameId: item.gameId,
        bytes: index === 0 ? result.sourceSaveBytes : result.destinationSaveBytes,
        expectedRevision: current[index].revision, fenceGeneration: current[index].fenceGeneration ?? 0 })), { beforeCommit: assertLeases })
      for (let index = 0; index < 2; index++) {
        const plan = await snapshotCoordinator.getSaveFlushPlan({ sourceKey: sourceKeys[index] })
        if (!plan.source.needsSaveFlush) await snapshotCoordinator.markSaveFlushed({ sourceKey: sourceKeys[index], sourceRevision: plan.source.sourceRevision, saveRevision: saved[index].revision })
        try { await snapshotStore?.delete(identities[index].profileId, identities[index].gameId, { kind: 'cloud-recovery' }) }
        catch (error) { onWarning('[Pokemon Hub] item transfer cloud recovery cleanup failed', { code: error.code ?? null, gameId: identities[index].gameId }) }
      }
      return { itemKey: result.itemKey, quantity: result.quantity,
        sourceItemInventory: { status: 'ready', saveRevision: saved[0].revision, ...readInventory(result.sourceSaveBytes, titles[0]) },
        destinationItemInventory: { status: 'ready', saveRevision: saved[1].revision, ...readInventory(result.destinationSaveBytes, titles[1]) } }
    } })
  }

  async function reorderRequest({ sessionId, gameId, sourceProfileId, area, fromSlot, toSlot, expectedSaveRevision } = {}) {
    if (![sessionId, gameId, sourceProfileId].every(value => typeof value === 'string' && value.length > 0)
      || !Number.isSafeInteger(expectedSaveRevision) || expectedSaveRevision < 1) {
      throw reorderError('SAVE_ITEM_REQUEST_INVALID', 'The item reorder request is invalid.')
    }
    const sourceKey = `save:${sourceProfileId}:${gameId}`
    return sessions.withLoadedSource({ sessionId, sourceKey, run: async (_source, assertActive = async () => {}) => {
      const target = await resolveSaveSource({ sourceKey })
      if (target?.sourceProfileId !== sourceProfileId || target.gameId !== gameId || !target.layout?.pokemonSaveTitle) {
        throw reorderError('SAVE_ITEM_SOURCE_INVALID', 'The item save source is invalid.')
      }
      const lease = { profileId: sourceProfileId, gameId, workspaceId: sessionId }
      await gameSaveLeases.assertHub(lease)
      const original = await saveStore.get(sourceProfileId, gameId)
      if (!original) throw reorderError('SAVE_MISSING', 'The game save is unavailable.')
      if (original.revision !== expectedSaveRevision) throw reorderError('SAVE_ITEM_REVISION_CONFLICT', 'The item save revision has changed.')
      const move = { area, fromSlot, toSlot }
      const title = target.layout.pokemonSaveTitle
      const preview = reorder(original.bytes, title, move)
      const projection = (saved, result) => ({ changed: result.changed, area: result.area, fromSlot: result.fromSlot, toSlot: result.toSlot,
        itemInventory: { status: 'ready', saveRevision: saved.revision, ...readInventory(saved.bytes, title) } })
      if (!preview.changed) return projection(original, preview)

      const flushed = await saveFlush.flushSource({ sourceKey })
      if (flushed.status === 'failed') throw reorderError('SAVE_FLUSH_FAILED', 'The Pokémon save could not be flushed before item reordering.')
      await gameSaveLeases.assertHub(lease)
      const current = await saveStore.get(sourceProfileId, gameId)
      if (!current) throw reorderError('SAVE_MISSING', 'The game save is unavailable.')
      if (current.revision !== original.revision + (flushed.status === 'flushed' ? 1 : 0)) {
        throw reorderError('SAVE_ITEM_REVISION_CONFLICT', 'The item save revision changed during reordering.')
      }
      const candidate = reorder(current.bytes, title, move)
      if (!candidate.changed) throw reorderError('SAVE_ITEM_REVISION_CONFLICT', 'The item order changed before the request completed.')
      const candidateInventory = readInventory(candidate.saveBytes, title)
      const saved = await saveStore.put(sourceProfileId, gameId, candidate.saveBytes, current.revision, {
        fenceGeneration: current.fenceGeneration ?? 0,
        invalidateRuntimeStates: true,
        beforeCommit: async () => { await assertActive(); await gameSaveLeases.assertHub(lease) },
      })
      const plan = await snapshotCoordinator.getSaveFlushPlan({ sourceKey })
      if (!plan.source.needsSaveFlush) await snapshotCoordinator.markSaveFlushed({ sourceKey, sourceRevision: plan.source.sourceRevision, saveRevision: saved.revision })
      try { await snapshotStore?.delete(sourceProfileId, gameId, { kind: 'cloud-recovery' }) }
      catch (error) { onWarning('[Pokemon Hub] item reorder cloud recovery cleanup failed', { code: error.code ?? null, profileId: sourceProfileId, gameId }) }
      return { changed: true, area: candidate.area, fromSlot: candidate.fromSlot, toSlot: candidate.toSlot,
        itemInventory: { status: 'ready', saveRevision: saved.revision, ...candidateInventory } }
    } })
  }
}

function reorderError(code, message) { const error = new Error(message); error.code = code; return error }
