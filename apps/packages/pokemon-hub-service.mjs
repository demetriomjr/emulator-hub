import { randomUUID } from 'node:crypto'
import { parseExpectedRevisions, parseHubLocation } from './pokemon-hub-model.mjs'

export function createPokemonHubService({ profileStore, saveStore, hubStore, registry, sessions, snapshots = { invalidateGames: () => {} }, catalogLoader }) {
  return {
    async getInventory(profileId) {
      if (await profileStore.get(profileId) === null) throw transferError('PROFILE_NOT_FOUND', 'Profile was not found.')
      const inventory = await hubStore.getProfileState(profileId)
      const catalog = await catalogLoader()
      const games = []
      for (const game of catalog) {
        if (game.pokemonSave?.supported !== true || !registry.get(game.pokemonSave.adapter)) continue
        const stored = await saveStore.get(profileId, game.id)
        if (!stored) {
          games.push({ id: game.id, title: game.title, status: 'save-missing' })
          continue
        }
        try {
          const inspection = registry.get(game.pokemonSave.adapter).inspect(stored.bytes)
          games.push({ id: game.id, title: game.title, status: sessions.hasLiveSession(profileId, game.id) ? 'active' : 'ready', revision: stored.revision, boxes: inspection.boxes })
        } catch {
          games.push({ id: game.id, title: game.title, status: 'save-unsupported' })
        }
      }
      return { hubEpoch: inventory.hubEpoch, revision: inventory.revision, slots: inventory.slots, games }
    },
    async transfer(request) {
      const source = parseHubLocation(request.source)
      const destination = parseHubLocation(request.destination)
      const { gameRevisions, hubEpoch } = parseExpectedRevisions(request.expectedRevisions, request.expectedHubEpoch)
      if (source.kind === 'hub' && destination.kind === 'game') return withdraw(request, source, destination, gameRevisions, hubEpoch)
      if (source.kind === 'game' && destination.kind === 'game') return moveBetweenGames(request, source, destination, gameRevisions, hubEpoch)
      if (source.kind !== 'game' || destination.kind !== 'hub') throw transferError('POKEMON_HUB_TRANSFER_UNSUPPORTED', 'This Pokémon Hub transfer is not supported yet.')
      if (source.gameId !== request.source.gameId) throw transferError('POKEMON_HUB_TRANSFER_INVALID', 'Pokémon Hub source is invalid.')
      if (await profileStore.get(request.profileId) === null) throw transferError('PROFILE_NOT_FOUND', 'Profile was not found.')
      if (sessions.hasLiveSession(request.profileId, source.gameId)) throw transferError('POKEMON_HUB_GAME_ACTIVE', 'Close the game before using Pokémon Hub.')
      const catalog = await catalogLoader()
      const game = catalog.find(entry => entry.id === source.gameId && entry.pokemonSave?.supported === true)
      if (!game) throw transferError('POKEMON_HUB_GAME_UNSUPPORTED', 'Game is not supported by Pokémon Hub.')
      const adapter = registry.get(game.pokemonSave.adapter)
      if (!adapter) throw transferError('POKEMON_HUB_GAME_UNSUPPORTED', 'Game adapter is unavailable.')
      const inventory = await hubStore.getProfileState(request.profileId)
      if (inventory.hubEpoch !== hubEpoch) throw transferError('POKEMON_HUB_REVISION_CONFLICT', 'Pokémon Hub inventory changed.')
      if (inventory.slots[destination.slot] !== null) throw transferError('POKEMON_HUB_DESTINATION_OCCUPIED', 'Pokémon Hub destination is occupied.')
      const stored = await saveStore.get(request.profileId, source.gameId)
      if (!stored || stored.revision !== gameRevisions[source.gameId]) throw transferError('POKEMON_HUB_REVISION_CONFLICT', 'Game save changed.')
      const record = adapter.readSlot(stored.bytes, source.box, source.slot)
      if (!record) throw transferError('POKEMON_HUB_SOURCE_EMPTY', 'Pokémon Hub source is empty.')
      const hubPokemonId = randomUUID()
      const document = {
        schemaVersion: 1, hubPokemonId, profileId: request.profileId, state: 'stored', location: destination,
        identity: { species: record.canonical?.species ?? null, form: 0, shiny: false, nativeIdentity: record.identity ?? {} },
        canonical: { trainer: {}, moves: [], stats: {}, met: {}, ribbons: [], attributes: {}, gameData: {}, unknownFields: {}, ...record.canonical },
        representations: [{ adapter: adapter.id, kind: 'pc-record', bytesBase64: Buffer.from(record.bytes).toString('base64') }],
        provenance: { firstSeenAt: new Date().toISOString(), sourceGameId: source.gameId }, history: [], revision: 1,
      }
      const rewritten = adapter.writeSlot(stored.bytes, source.box, source.slot, null)
      await saveStore.put(request.profileId, source.gameId, rewritten, stored.revision)
      await hubStore.putPokemon(document)
      const next = { ...inventory, hubEpoch: inventory.hubEpoch + 1, slots: [...inventory.slots] }
      next.slots[destination.slot] = hubPokemonId
      await hubStore.putProfileState(next, inventory.revision)
      snapshots.invalidateGames(request.profileId, [source.gameId], next.hubEpoch)
      return { hubEpoch: next.hubEpoch, hubPokemonId }
    },
  }

  async function withdraw(request, source, destination, gameRevisions, hubEpoch) {
    if (await profileStore.get(request.profileId) === null) throw transferError('PROFILE_NOT_FOUND', 'Profile was not found.')
    if (sessions.hasLiveSession(request.profileId, destination.gameId)) throw transferError('POKEMON_HUB_GAME_ACTIVE', 'Close the game before using Pokémon Hub.')
    const inventory = await hubStore.getProfileState(request.profileId)
    if (inventory.hubEpoch !== hubEpoch) throw transferError('POKEMON_HUB_REVISION_CONFLICT', 'Pokémon Hub inventory changed.')
    const hubPokemonId = inventory.slots[source.slot]
    if (!hubPokemonId) throw transferError('POKEMON_HUB_SOURCE_EMPTY', 'Pokémon Hub source is empty.')
    const document = await hubStore.getPokemon(request.profileId, hubPokemonId)
    const catalog = await catalogLoader()
    const game = catalog.find(entry => entry.id === destination.gameId && entry.pokemonSave?.supported === true)
    const adapter = game && registry.get(game.pokemonSave.adapter)
    if (!adapter) throw transferError('POKEMON_HUB_GAME_UNSUPPORTED', 'Game is not supported by Pokémon Hub.')
    const representation = document?.representations.find(item => item.adapter === adapter.id && item.kind === 'pc-record')
    if (!representation) throw transferError('POKEMON_HUB_TRANSFER_UNSUPPORTED', 'Pokémon is not compatible with this game.')
    const stored = await saveStore.get(request.profileId, destination.gameId)
    if (!stored || stored.revision !== gameRevisions[destination.gameId]) throw transferError('POKEMON_HUB_REVISION_CONFLICT', 'Game save changed.')
    if (adapter.readSlot(stored.bytes, destination.box, destination.slot)) throw transferError('POKEMON_HUB_DESTINATION_OCCUPIED', 'Game destination is occupied.')
    const record = { bytes: Buffer.from(representation.bytesBase64, 'base64') }
    await saveStore.put(request.profileId, destination.gameId, adapter.writeSlot(stored.bytes, destination.box, destination.slot, record), stored.revision)
    const next = { ...inventory, hubEpoch: inventory.hubEpoch + 1, slots: [...inventory.slots] }
    next.slots[source.slot] = null
    await hubStore.putProfileState(next, inventory.revision)
    await hubStore.putPokemon({ ...document, state: 'in-game', location: destination, history: [...document.history, { type: 'withdrawal', at: new Date().toISOString(), destination }], revision: document.revision + 1 })
    snapshots.invalidateGames(request.profileId, [destination.gameId], next.hubEpoch)
    return { hubEpoch: next.hubEpoch, hubPokemonId }
  }

  async function moveBetweenGames(request, source, destination, gameRevisions, hubEpoch) {
    if (await profileStore.get(request.profileId) === null) throw transferError('PROFILE_NOT_FOUND', 'Profile was not found.')
    if (sessions.hasLiveSession(request.profileId, source.gameId) || sessions.hasLiveSession(request.profileId, destination.gameId)) throw transferError('POKEMON_HUB_GAME_ACTIVE', 'Close the game before using Pokémon Hub.')
    const inventory = await hubStore.getProfileState(request.profileId)
    if (inventory.hubEpoch !== hubEpoch) throw transferError('POKEMON_HUB_REVISION_CONFLICT', 'Pokémon Hub inventory changed.')
    const catalog = await catalogLoader()
    const sourceGame = catalog.find(game => game.id === source.gameId && game.pokemonSave?.supported)
    const destinationGame = catalog.find(game => game.id === destination.gameId && game.pokemonSave?.supported)
    const sourceAdapter = sourceGame && registry.get(sourceGame.pokemonSave.adapter)
    const destinationAdapter = destinationGame && registry.get(destinationGame.pokemonSave.adapter)
    if (!sourceAdapter || !destinationAdapter || sourceAdapter.id !== destinationAdapter.id) throw transferError('POKEMON_HUB_TRANSFER_UNSUPPORTED', 'Games are not compatible for a direct Pokémon Hub transfer.')
    const sourceSave = await saveStore.get(request.profileId, source.gameId)
    const destinationSave = await saveStore.get(request.profileId, destination.gameId)
    if (!sourceSave || !destinationSave || sourceSave.revision !== gameRevisions[source.gameId] || destinationSave.revision !== gameRevisions[destination.gameId]) throw transferError('POKEMON_HUB_REVISION_CONFLICT', 'Game save changed.')
    const record = sourceAdapter.readSlot(sourceSave.bytes, source.box, source.slot)
    if (!record) throw transferError('POKEMON_HUB_SOURCE_EMPTY', 'Pokémon Hub source is empty.')
    if (destinationAdapter.readSlot(destinationSave.bytes, destination.box, destination.slot)) throw transferError('POKEMON_HUB_DESTINATION_OCCUPIED', 'Game destination is occupied.')
    await saveStore.put(request.profileId, source.gameId, sourceAdapter.writeSlot(sourceSave.bytes, source.box, source.slot, null), sourceSave.revision)
    await saveStore.put(request.profileId, destination.gameId, destinationAdapter.writeSlot(destinationSave.bytes, destination.box, destination.slot, record), destinationSave.revision)
    const next = { ...inventory, hubEpoch: inventory.hubEpoch + 1, slots: [...inventory.slots] }
    await hubStore.putProfileState(next, inventory.revision)
    snapshots.invalidateGames(request.profileId, [source.gameId, destination.gameId], next.hubEpoch)
    return { hubEpoch: next.hubEpoch }
  }
}

function transferError(code, message) { const error = new Error(message); error.code = code; return error }
