import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function createPokemonHubStore({ dataPath }) {
  return {
    async getProfileState(profileId) {
      validateId(profileId)
      const path = inventoryPath(dataPath, profileId)
      try {
        return copy(await readJson(path))
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
        const inventory = { schemaVersion: 1, profileId, hubEpoch: 0, revision: 1, slots: Array(30).fill(null) }
        await writeJson(path, inventory)
        return copy(inventory)
      }
    },
    async getPokemon(profileId, hubPokemonId) {
      validateId(profileId)
      validateId(hubPokemonId)
      try {
        const document = await readJson(pokemonPath(dataPath, profileId, hubPokemonId))
        return copy(document)
      } catch (error) {
        if (error.code === 'ENOENT') return null
        throw error
      }
    },
    async putProfileState(state, expectedRevision) {
      validateProfileState(state)
      const current = await this.getProfileState(state.profileId)
      if (current.revision !== expectedRevision) {
        const error = new Error('Pokémon Hub inventory revision does not match.')
        error.code = 'POKEMON_HUB_REVISION_CONFLICT'
        throw error
      }
      const saved = { ...state, revision: current.revision + 1, slots: [...state.slots] }
      await writeJson(inventoryPath(dataPath, state.profileId), saved)
      return copy(saved)
    },
    async putPokemon(document) {
      validatePokemon(document)
      await writeJson(pokemonPath(dataPath, document.profileId, document.hubPokemonId), document)
      return copy(document)
    },
  }
}

export function createRedisPokemonHubStore({ persistence }) {
  return {
    async getProfileState(profileId) {
      validateId(profileId)
      const key = `pokemon-hub:inventory:${profileId}`
      try {
        const source = await persistence.get(key)
        if (source !== null) return copy(validateStoredProfileState(JSON.parse(source)))
        const inventory = { schemaVersion: 1, profileId, hubEpoch: 0, revision: 1, slots: Array(30).fill(null) }
        const created = await persistence.set(key, JSON.stringify(inventory), { NX: true })
        if (created !== null) return copy(inventory)
        return copy(validateStoredProfileState(JSON.parse(await persistence.get(key))))
      } catch (error) {
        if (error.code?.startsWith('POKEMON_HUB_')) throw error
        throw invalidDocument()
      }
    },
    async getPokemon(profileId, hubPokemonId) {
      validateId(profileId)
      validateId(hubPokemonId)
      try {
        const source = await persistence.get(`pokemon-hub:pokemon:${profileId}:${hubPokemonId}`)
        return source === null ? null : copy(validateStoredPokemon(JSON.parse(source)))
      } catch (error) {
        if (error.code?.startsWith('POKEMON_HUB_')) throw error
        throw invalidDocument()
      }
    },
    async putProfileState(state, expectedRevision) {
      validateProfileState(state)
      const current = await this.getProfileState(state.profileId)
      if (current.revision !== expectedRevision) {
        const error = new Error('Pokémon Hub inventory revision does not match.')
        error.code = 'POKEMON_HUB_REVISION_CONFLICT'
        throw error
      }
      const saved = { ...state, revision: current.revision + 1, slots: [...state.slots] }
      await persistence.set(`pokemon-hub:inventory:${state.profileId}`, JSON.stringify(saved))
      return copy(saved)
    },
    async putPokemon(document) {
      validatePokemon(document)
      await persistence.set(`pokemon-hub:pokemon:${document.profileId}:${document.hubPokemonId}`, JSON.stringify(document))
      return copy(document)
    },
  }
}

function inventoryPath(root, profileId) { return join(root, profileId, 'inventory.json') }
function pokemonPath(root, profileId, hubPokemonId) { return join(root, profileId, 'pokemon', `${hubPokemonId}.json`) }

async function readJson(path) { return JSON.parse(await readFile(path, 'utf8')) }
async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, JSON.stringify(value, null, 2), 'utf8')
  await rename(temporary, path)
}

function validatePokemon(value) {
  if (!value || typeof value !== 'object' || value.schemaVersion !== 1) throw invalidDocument()
  validateId(value.profileId)
  validateId(value.hubPokemonId)
  if (!Number.isInteger(value.revision) || value.revision < 1) throw invalidDocument()
}
function validateProfileState(value) {
  if (!value || typeof value !== 'object' || value.schemaVersion !== 1 || !Number.isInteger(value.hubEpoch) || value.hubEpoch < 0 || !Array.isArray(value.slots) || value.slots.length !== 30) throw invalidDocument()
  validateId(value.profileId)
  if (value.slots.some(slot => slot !== null && (typeof slot !== 'string' || !uuidPattern.test(slot)))) throw invalidDocument()
}
function validateStoredProfileState(value) { validateProfileState(value); return value }
function validateStoredPokemon(value) { validatePokemon(value); return value }
function validateId(value) { if (typeof value !== 'string' || !uuidPattern.test(value)) throw invalidDocument() }
function invalidDocument() { const error = new Error('Pokémon Hub document is invalid.'); error.code = 'POKEMON_HUB_DOCUMENT_INVALID'; return error }
function copy(value) { return structuredClone(value) }
