import { randomUUID } from 'node:crypto'
import { parseExpectedRevisions, parseHubLocation } from './pokemon-hub-model.mjs'

export function createPokemonHubService({ profileStore, saveStore, hubStore, registry, sessions, catalogLoader }) {
  return {
    async transfer(request) {
      const source = parseHubLocation(request.source)
      const destination = parseHubLocation(request.destination)
      const { gameRevisions, hubEpoch } = parseExpectedRevisions(request.expectedRevisions, request.expectedHubEpoch)
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
      return { hubEpoch: next.hubEpoch, hubPokemonId }
    },
  }
}

function transferError(code, message) { const error = new Error(message); error.code = code; return error }
