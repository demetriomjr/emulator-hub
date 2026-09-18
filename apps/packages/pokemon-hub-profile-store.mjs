import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export function createPokemonHubProfileStore({ dataPath }) {
  let queue = Promise.resolve()

  return {
    async list() {
      return (await readProfiles(dataPath)).map(copy)
    },
    create({ name }) {
      const operation = queue.then(async () => {
        const normalizedName = normalizeName(name)
        const profiles = await readProfiles(dataPath)
        if (profiles.some(profile => profile.name.localeCompare(normalizedName, undefined, { sensitivity: 'accent' }) === 0)) {
          throw profileError('POKEMON_HUB_PROFILE_NAME_DUPLICATE', 'A Pokémon Hub profile with this name already exists.')
        }
        const profile = {
          schemaVersion: 6,
          hubProfileId: randomUUID(),
          name: normalizedName,
          createdAt: new Date().toISOString(),
          grid: { entries: {} },
        }
        await writeProfiles(dataPath, [...profiles, profile])
        return copy(profile)
      })
      queue = operation.catch(() => {})
      return operation
    },
    rename(hubProfileId, name) {
      const operation = queue.then(async () => {
        const normalizedName = normalizeName(name)
        const profiles = await readProfiles(dataPath)
        const index = profiles.findIndex(profile => profile.hubProfileId === hubProfileId)
        if (index === -1) throw profileError('POKEMON_HUB_PROFILE_NOT_FOUND', 'Pokémon Hub profile was not found.')
        if (profiles.some(profile => profile.hubProfileId !== hubProfileId && profile.name.localeCompare(normalizedName, undefined, { sensitivity: 'accent' }) === 0)) {
          throw profileError('POKEMON_HUB_PROFILE_NAME_DUPLICATE', 'A Pokémon Hub profile with this name already exists.')
        }
        const profile = { ...profiles[index], name: normalizedName }
        profiles[index] = profile
        await writeProfiles(dataPath, profiles)
        return copy(profile)
      })
      queue = operation.catch(() => {})
      return operation
    },
    bindOwner(hubProfileId, ownerProfileId) {
      const operation = queue.then(async () => {
        const owner = normalizeOwnerProfileId(ownerProfileId)
        const profiles = await readProfiles(dataPath)
        const index = profiles.findIndex(profile => profile.hubProfileId === hubProfileId)
        if (index === -1) throw profileError('POKEMON_HUB_PROFILE_NOT_FOUND', 'Pokemon Hub profile was not found.')
        const profile = profiles[index]
        if (profile.ownerProfileId && profile.ownerProfileId !== owner) throw profileError('POKEMON_HUB_PROFILE_OWNER_CONFLICT', 'Pokemon Hub profile is reserved by another backend profile.')
        if (Object.values(profile.grid.entries).some(entry => typeof entry.pokemonInstanceId !== 'string')) throw profileError('POKEMON_HUB_PROFILE_LEGACY_ENTRIES', 'Pokemon Hub profile contains entries without an authoritative record identity.')
        const bound = { ...profile, ownerProfileId: owner }
        profiles[index] = bound
        await writeProfiles(dataPath, profiles)
        return copy(bound)
      })
      queue = operation.catch(() => {})
      return operation
    },
    delete(hubProfileId, { discardOccupied = false } = {}) {
      const operation = queue.then(async () => {
        const profiles = await readProfiles(dataPath)
        const index = profiles.findIndex(profile => profile.hubProfileId === hubProfileId)
        if (index === -1) throw profileError('POKEMON_HUB_PROFILE_NOT_FOUND', 'Pokémon Hub profile was not found.')
        const profile = profiles[index]
        const discardedPokemonCount = Object.keys(profile.grid.entries).length
        if (discardedPokemonCount > 0 && !discardOccupied) {
          throw profileError('POKEMON_HUB_PROFILE_NOT_EMPTY', 'Pokémon Hub profile contains Pokémon and requires discard confirmation.')
        }
        profiles.splice(index, 1)
        await writeProfiles(dataPath, profiles)
        return { hubProfileId, discardedPokemonCount }
      })
      queue = operation.catch(() => {})
      return operation
    },
  }
}

export function createRedisPokemonHubProfileStore({ persistence }) {
  let queue = Promise.resolve()
  return {
    async list() { return (await readRedisProfiles(persistence)).map(copy) },
    create({ name }) {
      const operation = queue.then(async () => {
        const normalizedName = normalizeName(name)
        const profiles = await readRedisProfiles(persistence)
        if (profiles.some(profile => profile.name.localeCompare(normalizedName, undefined, { sensitivity: 'accent' }) === 0)) throw profileError('POKEMON_HUB_PROFILE_NAME_DUPLICATE', 'Pokémon Hub profile already exists.')
        const profile = { schemaVersion: 6, hubProfileId: randomUUID(), name: normalizedName, createdAt: new Date().toISOString(), grid: { entries: {} } }
        await writeRedisProfiles(persistence, [...profiles, profile])
        return copy(profile)
      })
      queue = operation.catch(() => {})
      return operation
    },
    rename(hubProfileId, name) {
      const operation = queue.then(async () => {
        const normalizedName = normalizeName(name)
        const profiles = await readRedisProfiles(persistence)
        const index = profiles.findIndex(profile => profile.hubProfileId === hubProfileId)
        if (index === -1) throw profileError('POKEMON_HUB_PROFILE_NOT_FOUND', 'Pokémon Hub profile was not found.')
        if (profiles.some(profile => profile.hubProfileId !== hubProfileId && profile.name.localeCompare(normalizedName, undefined, { sensitivity: 'accent' }) === 0)) throw profileError('POKEMON_HUB_PROFILE_NAME_DUPLICATE', 'Pokémon Hub profile already exists.')
        profiles[index] = { ...profiles[index], name: normalizedName }
        await writeRedisProfiles(persistence, profiles)
        return copy(profiles[index])
      })
      queue = operation.catch(() => {})
      return operation
    },
    bindOwner(hubProfileId, ownerProfileId) {
      const operation = queue.then(async () => {
        const owner = normalizeOwnerProfileId(ownerProfileId)
        const profiles = await readRedisProfiles(persistence)
        const index = profiles.findIndex(profile => profile.hubProfileId === hubProfileId)
        if (index === -1) throw profileError('POKEMON_HUB_PROFILE_NOT_FOUND', 'PokÃ©mon Hub profile was not found.')
        const profile = profiles[index]
        if (profile.ownerProfileId && profile.ownerProfileId !== owner) throw profileError('POKEMON_HUB_PROFILE_OWNER_CONFLICT', 'PokÃ©mon Hub profile is reserved by another backend profile.')
        if (Object.values(profile.grid.entries).some(entry => typeof entry.pokemonInstanceId !== 'string')) throw profileError('POKEMON_HUB_PROFILE_LEGACY_ENTRIES', 'PokÃ©mon Hub profile contains entries without an authoritative record identity.')
        profiles[index] = { ...profile, ownerProfileId: owner }
        await writeRedisProfiles(persistence, profiles)
        return copy(profiles[index])
      })
      queue = operation.catch(() => {})
      return operation
    },
    delete(hubProfileId, { discardOccupied = false } = {}) {
      const operation = queue.then(async () => {
        const profiles = await readRedisProfiles(persistence)
        const index = profiles.findIndex(profile => profile.hubProfileId === hubProfileId)
        if (index === -1) throw profileError('POKEMON_HUB_PROFILE_NOT_FOUND', 'Pokémon Hub profile was not found.')
        const profile = profiles[index]
        const discardedPokemonCount = Object.keys(profile.grid.entries).length
        if (discardedPokemonCount > 0 && !discardOccupied) throw profileError('POKEMON_HUB_PROFILE_NOT_EMPTY', 'Pokémon Hub profile contains Pokémon and requires discard confirmation.')
        profiles.splice(index, 1)
        await writeRedisProfiles(persistence, profiles)
        return { hubProfileId, discardedPokemonCount }
      })
      queue = operation.catch(() => {})
      return operation
    },
  }
}

async function readProfiles(dataPath) {
  try {
    const source = JSON.parse(await readFile(collectionPath(dataPath), 'utf8'))
    const profiles = Array.isArray(source) ? source.map(normalizeProfile) : null
    if (!profiles || profiles.some(profile => profile === null)) throw new Error('Invalid Pokémon Hub profile data.')
    if (source.some(profile => profile.schemaVersion !== 6 || Array.isArray(profile.grid?.slots) || 'capacity' in (profile.grid ?? {}))) {
      await writeProfiles(dataPath, profiles)
    }
    return profiles
  } catch (error) {
    if (error.code === 'ENOENT') return []
    if (error.code?.startsWith('POKEMON_HUB_PROFILE_')) throw error
    throw profileError('POKEMON_HUB_PROFILE_STORE_LOAD_FAILED', 'Pokémon Hub profiles could not be loaded.')
  }
}

async function writeProfiles(dataPath, profiles) {
  const path = collectionPath(dataPath)
  try {
    await mkdir(dirname(path), { recursive: true })
    const temporaryPath = `${path}.${randomUUID()}.tmp`
    await writeFile(temporaryPath, JSON.stringify(profiles, null, 2), 'utf8')
    await rename(temporaryPath, path)
  } catch (error) {
    throw profileError('POKEMON_HUB_PROFILE_STORE_WRITE_FAILED', 'Pokémon Hub profiles could not be saved.')
  }
}

function collectionPath(dataPath) { return join(dataPath, 'profiles.json') }

async function readRedisProfiles(persistence) {
  try {
    const source = await persistence.get('pokemon-hub:profiles')
    if (source === null) return []
    const profiles = JSON.parse(source)
    const normalized = Array.isArray(profiles) ? profiles.map(normalizeProfile) : null
    if (!normalized || normalized.some(profile => profile === null)) throw new Error('Invalid Pokémon Hub profile data.')
    return normalized
  } catch (error) {
    if (error.code?.startsWith('POKEMON_HUB_PROFILE_')) throw error
    throw profileError('POKEMON_HUB_PROFILE_STORE_LOAD_FAILED', 'Pokémon Hub profiles could not be loaded.')
  }
}

async function writeRedisProfiles(persistence, profiles) {
  try { await persistence.set('pokemon-hub:profiles', JSON.stringify(profiles)) } catch {
    throw profileError('POKEMON_HUB_PROFILE_STORE_WRITE_FAILED', 'Pokémon Hub profiles could not be saved.')
  }
}

function normalizeName(value) {
  const name = typeof value === 'string' ? value.normalize('NFC').trim() : ''
  if (!name || name.length > 26 || /[\u0000-\u001F\u007F]/.test(name)) throw profileError('POKEMON_HUB_PROFILE_INVALID', 'Pokémon Hub profile name must contain 1 to 26 printable characters.')
  return name
}

function normalizeOwnerProfileId(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) throw profileError('POKEMON_HUB_PROFILE_INVALID', 'PokÃ©mon Hub backend profile is invalid.')
  return value
}

function normalizeProfile(profile) {
  if (!profile || typeof profile !== 'object'
    || typeof profile.hubProfileId !== 'string' || !/^[0-9a-f-]{36}$/i.test(profile.hubProfileId)
    || typeof profile.name !== 'string' || profile.name.length === 0 || profile.name.length > 32
    || typeof profile.createdAt !== 'string' || !Number.isFinite(Date.parse(profile.createdAt))
    || !profile.grid || typeof profile.grid !== 'object') return null

  if (![1, 2, 3, 4, 5, 6].includes(profile.schemaVersion)) return null
  if (profile.ownerProfileId !== undefined && (typeof profile.ownerProfileId !== 'string' || profile.ownerProfileId.length === 0 || profile.ownerProfileId.length > 128)) return null
  const owner = profile.ownerProfileId ? { ownerProfileId: profile.ownerProfileId } : {}

  if (profile.schemaVersion === 5 || profile.schemaVersion === 6) {
    const entries = normalizeEntries(profile.grid.entries)
    if (!entries) return null

    return {
      schemaVersion: 6,
      hubProfileId: profile.hubProfileId,
      name: profile.name,
      createdAt: profile.createdAt,
      grid: { entries },
      ...owner,
    }
  }

  if (profile.schemaVersion === 4) {
    const entries = normalizeEntries(profile.grid.entries)
    if (!entries) return null

    return {
      schemaVersion: 6,
      hubProfileId: profile.hubProfileId,
      name: profile.name,
      createdAt: profile.createdAt,
      grid: { entries },
      ...owner,
    }
  }

  if (!Array.isArray(profile.grid.slots) || profile.grid.slots.length === 0
    || !profile.grid.slots.every(slot => slot === null || (slot && typeof slot === 'object' && !Array.isArray(slot)))) return null
  if (profile.schemaVersion === 1 && (!Number.isInteger(profile.grid.columns) || profile.grid.columns < 1 || profile.grid.columns > 30 || !Number.isInteger(profile.grid.rows) || profile.grid.rows < 1 || profile.grid.slots.length !== profile.grid.columns * profile.grid.rows)) return null
  if (profile.schemaVersion === 2 && (!Number.isInteger(profile.grid.maxColumns) || profile.grid.maxColumns < 1 || profile.grid.maxColumns > 30)) return null

  return {
    schemaVersion: 6,
    hubProfileId: profile.hubProfileId,
    name: profile.name,
    createdAt: profile.createdAt,
    grid: {
      entries: entriesFromSlots(profile.grid.slots),
    },
    ...owner,
  }
}

function entriesFromSlots(slots) {
  return Object.fromEntries(
    slots.flatMap((entry, slot) => entry === null ? [] : [[String(slot), structuredClone(entry)]]),
  )
}

function normalizeEntries(entries) {
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)
  ) return null

  const normalizedEntries = {}
  for (const [slot, entry] of Object.entries(entries)) {
    if (!/^(0|[1-9]\d*)$/.test(slot) || !Number.isSafeInteger(Number(slot))
      || !entry || typeof entry !== 'object' || Array.isArray(entry)) return null
    normalizedEntries[slot] = structuredClone(entry)
  }
  return normalizedEntries
}

function copy(profile) { return structuredClone(profile) }
function profileError(code, message) { const error = new Error(message); error.code = code; return error }
