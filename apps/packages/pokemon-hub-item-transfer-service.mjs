import { addPokemonItemToSave, readPokemonItemInventory, removePokemonItemFromSave } from './pokemon-item-inventory.mjs'
import { addHubItem, decodeHubItemLedger, emptyHubItemLedger, encodeHubItemLedger, hubItemLedgerGameId, moveHubItem, removeHubItem } from './pokemon-hub-item-ledger.mjs'

export function createPokemonHubItemTransferService({ sessions, gameSaveLeases, saveStore, saveFlush, snapshotCoordinator, snapshotStore, hubProfileStore, resolveSaveSource, onWarning = console.warn } = {}) {
  if (!sessions?.withLoadedSources || !sessions?.withLoadedSource || !gameSaveLeases?.assertHub || !saveStore?.putPair
    || !saveFlush?.flushSource || !hubProfileStore?.list || !resolveSaveSource) throw new TypeError('Hub item transfer dependencies are unavailable.')
  return { transfer, reorder }

  async function transfer({ profileId, sessionId, source, destination, area, fromSlot, toSlot, quantity } = {}) {
    if (!profileId || !sessionId || !validIdentity(source) || !validIdentity(destination)
      || !Number.isSafeInteger(fromSlot) || fromSlot < 0 || !Number.isSafeInteger(quantity) || quantity < 1
      || toSlot !== undefined && (!Number.isSafeInteger(toSlot) || toSlot < 0)
      || sourceKey(source) === sourceKey(destination) || !isHub(source) && !isHub(destination)
      || (!isHub(source) || !isHub(destination)) && typeof area !== 'string') throw invalid('Hub item transfer request is invalid.')
    const identities = [source, destination]
    const keys = identities.map(sourceKey)
    return sessions.withLoadedSources({ profileId, sessionId, sourceKeys: keys, run: async () => {
      const profiles = await hubProfileStore.list()
      for (const identity of identities.filter(isHub)) {
        const profile = profiles.find(profile => profile.hubProfileId === identity.hubProfileId)
        if (!profile || profile.ownerProfileId !== profileId) throw invalid('Hub item profile is unavailable in this workspace.')
      }
      const targets = await Promise.all(identities.map(identity => isHub(identity) ? null : resolveSaveSource({ profileId, sourceKey: sourceKey(identity) })))
      for (let index = 0; index < 2; index++) {
        if (isHub(identities[index])) continue
        const target = targets[index]
        if (target?.sourceProfileId !== identities[index].profileId || target.gameId !== identities[index].gameId
          || !['pokemon-ruby', 'pokemon-sapphire', 'pokemon-emerald'].includes(target.layout?.pokemonSaveTitle)) throw invalid('Item save source is invalid.')
      }
      const leases = identities.filter(identity => !isHub(identity)).map(identity => ({ profileId: identity.profileId, gameId: identity.gameId, workspaceId: sessionId }))
      const assertLeases = async () => {
        for (const lease of leases) await gameSaveLeases.assertHub(lease)
        const currentProfiles = await hubProfileStore.list()
        for (const identity of identities.filter(isHub)) {
          if (!currentProfiles.some(profile => profile.hubProfileId === identity.hubProfileId && profile.ownerProfileId === profileId)) {
            throw invalid('Hub item profile is unavailable in this workspace.')
          }
        }
      }
      await assertLeases()
      const originals = await Promise.all(identities.map(identity => readSource(profileId, identity)))
      for (let index = 0; index < 2; index++) assertRevision(identities[index], originals[index])
      createCandidates(originals, targets, { area, fromSlot, toSlot, quantity })
      const flushes = await Promise.all(keys.map((key, index) => isHub(identities[index]) ? { status: 'clean' } : saveFlush.flushSource({ profileId, sourceKey: key })))
      if (flushes.some(flush => flush.status === 'failed')) throw invalid('The Pokémon save could not be flushed before item transfer.')
      await assertLeases()
      const current = await Promise.all(identities.map(identity => readSource(profileId, identity)))
      for (let index = 0; index < 2; index++) {
        if (isHub(identities[index])) assertRevision(identities[index], current[index])
        else if (!current[index].saved || current[index].saved.revision !== originals[index].saved.revision + (flushes[index].status === 'flushed' ? 1 : 0)) throw conflict()
      }
      const result = createCandidates(current, targets, { area, fromSlot, toSlot, quantity })
      for (let index = 0; index < 2; index++) {
        if (!isHub(identities[index]) || current[index].saved) continue
        try { await saveStore.put(profileId, hubItemLedgerGameId(identities[index].hubProfileId), encodeHubItemLedger(emptyHubItemLedger()), null) }
        catch (error) { if (error.code !== 'SAVE_REVISION_CONFLICT') throw error; throw conflict() }
        current[index] = await readSource(profileId, identities[index])
      }
      const saved = await saveStore.putPair(identities.map((identity, index) => ({
        profileId: isHub(identity) ? profileId : identity.profileId,
        gameId: isHub(identity) ? hubItemLedgerGameId(identity.hubProfileId) : identity.gameId,
        bytes: index === 0 ? result.sourceBytes : result.destinationBytes,
        expectedRevision: current[index].saved.revision,
        fenceGeneration: current[index].saved.fenceGeneration ?? 0,
      })), { beforeCommit: assertLeases })
      for (let index = 0; index < 2; index++) {
        if (isHub(identities[index])) continue
        const plan = await snapshotCoordinator?.getSaveFlushPlan({ profileId, sourceKey: keys[index] })
        if (plan && !plan.source.needsSaveFlush) await snapshotCoordinator.markSaveFlushed({ profileId, sourceKey: keys[index], sourceRevision: plan.source.sourceRevision, saveRevision: saved[index].revision })
        try { await snapshotStore?.delete(identities[index].profileId, identities[index].gameId, { kind: 'cloud-recovery' }) }
        catch (error) { onWarning('[Pokemon Hub] item transfer cloud recovery cleanup failed', { code: error.code ?? null }) }
      }
      const project = (identity, index, bytes) => isHub(identity)
        ? { [`${index === 0 ? 'source' : 'destination'}HubItemInventory`]: { revision: saved[index].revision, ...decodeHubItemLedger(bytes) } }
        : { [`${index === 0 ? 'source' : 'destination'}ItemInventory`]: { status: 'ready', saveRevision: saved[index].revision,
          ...readPokemonItemInventory(bytes, targets[index].layout.pokemonSaveTitle) } }
      return { itemKey: result.itemKey, quantity, ...project(source, 0, result.sourceBytes), ...project(destination, 1, result.destinationBytes) }
    } })
  }

  async function reorder({ profileId, sessionId, hubProfileId, fromSlot, toSlot, expectedItemRevision } = {}) {
    if (!profileId || !sessionId || !hubProfileId || !Number.isSafeInteger(expectedItemRevision) || expectedItemRevision < 1
      || !Number.isSafeInteger(fromSlot) || !Number.isSafeInteger(toSlot) || fromSlot < 0 || toSlot < 0) throw invalid('Hub item reorder request is invalid.')
    return sessions.withLoadedSource({ profileId, sessionId, sourceKey: `hub:${hubProfileId}`, run: async () => {
      const profile = (await hubProfileStore.list()).find(value => value.hubProfileId === hubProfileId)
      if (!profile || profile.ownerProfileId !== profileId) throw invalid('Hub item profile is unavailable in this workspace.')
      const current = await saveStore.get(profileId, hubItemLedgerGameId(hubProfileId))
      if (!current || current.revision !== expectedItemRevision) throw conflict()
      const moved = moveHubItem(decodeHubItemLedger(current.bytes), { fromSlot, toSlot })
      if (fromSlot === toSlot) return { changed: false, hubItemInventory: { revision: current.revision, ...moved } }
      const saved = await saveStore.put(profileId, hubItemLedgerGameId(hubProfileId), encodeHubItemLedger(moved), current.revision)
      return { changed: true, hubItemInventory: { revision: saved.revision, ...moved } }
    } })
  }

  async function readSource(profileId, identity) {
    const saved = await saveStore.get(isHub(identity) ? profileId : identity.profileId,
      isHub(identity) ? hubItemLedgerGameId(identity.hubProfileId) : identity.gameId)
    return { saved, ledger: isHub(identity) ? saved ? decodeHubItemLedger(saved.bytes) : emptyHubItemLedger() : null }
  }
}

function createCandidates(sources, targets, { area, fromSlot, toSlot, quantity }) {
  const source = sources[0]
  const destination = sources[1]
  let itemKey
  let sourceBytes
  if (source.ledger) {
    itemKey = source.ledger.slots[fromSlot]?.itemKey
    if (!itemKey) throw invalid('The source Hub item slot is empty.')
    sourceBytes = encodeHubItemLedger(removeHubItem(source.ledger, { fromSlot, quantity }))
  } else {
    const removed = removePokemonItemFromSave(source.saved.bytes, targets[0].layout.pokemonSaveTitle, { area, slot: fromSlot, quantity })
    itemKey = removed.removed.itemKey
    sourceBytes = removed.saveBytes
  }
  const destinationBytes = destination.ledger
    ? encodeHubItemLedger(addHubItem(destination.ledger, { itemKey, quantity, toSlot }))
    : addPokemonItemToSave(destination.saved.bytes, targets[1].layout.pokemonSaveTitle, { area, itemKey, quantity, toSlot }).saveBytes
  return { itemKey, sourceBytes, destinationBytes }
}

function isHub(identity) { return typeof identity?.hubProfileId === 'string' }
function sourceKey(identity) { return isHub(identity) ? `hub:${identity.hubProfileId}` : `save:${identity.profileId}:${identity.gameId}` }
function validIdentity(identity) { return isHub(identity) ? Number.isSafeInteger(identity.expectedItemRevision) && identity.expectedItemRevision >= 0
  : typeof identity?.profileId === 'string' && !!identity.profileId && typeof identity?.gameId === 'string' && !!identity.gameId
    && Number.isSafeInteger(identity.expectedSaveRevision) && identity.expectedSaveRevision > 0 }
function assertRevision(identity, source) {
  if (isHub(identity)) {
    if (source.saved?.revision === identity.expectedItemRevision) return
    if (identity.expectedItemRevision === 0 && (!source.saved || source.saved.revision === 1 && Object.keys(source.ledger.slots).length === 0)) return
    throw conflict()
  }
  if (!source.saved || source.saved.revision !== identity.expectedSaveRevision) throw conflict()
}
function conflict() { const error = new Error('An item inventory revision has changed.'); error.code = 'SAVE_ITEM_REVISION_CONFLICT'; return error }
function invalid(message) { const error = new Error(message); error.code = 'SAVE_ITEM_REQUEST_INVALID'; return error }
