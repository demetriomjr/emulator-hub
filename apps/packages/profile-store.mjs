import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export function createProfileStore({ dataPath }) {
  let queue = Promise.resolve()

  return {
    list: async gameId => (await readProfiles(dataPath, gameId)).map(copyProfile),
    get: async (gameId, id) => id === undefined
      ? findProfile(dataPath, gameId)
      : (await readProfiles(dataPath, gameId)).find(profile => profile.id === id) ?? null,
    updateOddsResetCount(gameId, id, count) {
      const operation = queue.then(async () => {
        validateOddsResetCount(count)
        const profiles = await readProfiles(dataPath, gameId)
        const index = profiles.findIndex(profile => profile.id === id)
        if (index === -1) return null
        profiles[index] = { ...profiles[index], oddsResetCount: Math.max(profiles[index].oddsResetCount ?? 0, count) }
        await writeProfiles(dataPath, gameId, profiles)
        return copyProfile(profiles[index])
      })
      queue = operation.catch(() => {})
      return operation
    },
    create(gameId, name) {
      const operation = queue.then(async () => {
        const normalizedName = normalizeProfileName(name)
        const profiles = await readProfiles(dataPath, gameId)
        if (profiles.some(profile => profile.name.localeCompare(normalizedName, undefined, { sensitivity: 'accent' }) === 0)) {
          throw profileError('PROFILE_NAME_DUPLICATE', 'A profile with this name already exists.')
        }

        const profile = { id: randomUUID(), name: normalizedName, createdAt: new Date().toISOString(), oddsResetCount: 0 }
        await writeProfiles(dataPath, gameId, [...profiles, profile])
        return copyProfile(profile)
      })
      queue = operation.catch(() => {})
      return operation
    },
    update(gameId, id, name) {
      const operation = queue.then(async () => {
        const normalizedName = normalizeProfileName(name)
        const profiles = await readProfiles(dataPath, gameId)
        const index = profiles.findIndex(profile => profile.id === id)
        if (index === -1) return null
        if (profiles.some(profile => profile.id !== id && profile.name.localeCompare(normalizedName, undefined, { sensitivity: 'accent' }) === 0)) {
          throw profileError('PROFILE_NAME_DUPLICATE', 'A profile with this name already exists.')
        }

        const profile = { ...profiles[index], name: normalizedName, oddsResetCount: profiles[index].oddsResetCount ?? 0 }
        profiles[index] = profile
        await writeProfiles(dataPath, gameId, profiles)
        return copyProfile(profile)
      })
      queue = operation.catch(() => {})
      return operation
    },
    remove(gameId, id) {
      const operation = queue.then(async () => {
        const profiles = await readProfiles(dataPath, gameId)
        const index = profiles.findIndex(profile => profile.id === id)
        if (index === -1) return null

        const [removed] = profiles.splice(index, 1)
        await writeProfiles(dataPath, gameId, profiles)
        return copyProfile(removed)
      })
      queue = operation.catch(() => {})
      return operation
    },
  }
}

export function createRedisProfileStore({ persistence }) {
  let queue = Promise.resolve()

  return {
    list: async gameId => (await readRedisProfiles(persistence, gameId)).map(copyProfile),
    get: async (gameId, id) => id === undefined
      ? findRedisProfile(persistence, gameId)
      : (await readRedisProfiles(persistence, gameId)).find(profile => profile.id === id) ?? null,
    updateOddsResetCount(gameId, id, count) {
      const operation = queue.then(async () => {
        validateOddsResetCount(count)
        const profiles = await readRedisProfiles(persistence, gameId)
        const index = profiles.findIndex(profile => profile.id === id)
        if (index === -1) return null
        profiles[index] = { ...profiles[index], oddsResetCount: Math.max(profiles[index].oddsResetCount ?? 0, count) }
        await writeRedisProfiles(persistence, gameId, profiles)
        return copyProfile(profiles[index])
      })
      queue = operation.catch(() => {})
      return operation
    },
    create(gameId, name) {
      const operation = queue.then(async () => {
        const normalizedName = normalizeProfileName(name)
        const profiles = await readRedisProfiles(persistence, gameId)
        if (profiles.some(profile => profile.name.localeCompare(normalizedName, undefined, { sensitivity: 'accent' }) === 0)) throw profileError('PROFILE_NAME_DUPLICATE', 'A profile with this name already exists.')
        const profile = { id: randomUUID(), name: normalizedName, createdAt: new Date().toISOString(), oddsResetCount: 0 }
        await writeRedisProfiles(persistence, gameId, [...profiles, profile])
        return copyProfile(profile)
      })
      queue = operation.catch(() => {})
      return operation
    },
    update(gameId, id, name) {
      const operation = queue.then(async () => {
        const normalizedName = normalizeProfileName(name)
        const profiles = await readRedisProfiles(persistence, gameId)
        const index = profiles.findIndex(profile => profile.id === id)
        if (index === -1) return null
        if (profiles.some(profile => profile.id !== id && profile.name.localeCompare(normalizedName, undefined, { sensitivity: 'accent' }) === 0)) throw profileError('PROFILE_NAME_DUPLICATE', 'A profile with this name already exists.')
        const profile = { ...profiles[index], name: normalizedName, oddsResetCount: profiles[index].oddsResetCount ?? 0 }
        profiles[index] = profile
        await writeRedisProfiles(persistence, gameId, profiles)
        return copyProfile(profile)
      })
      queue = operation.catch(() => {})
      return operation
    },
    remove(gameId, id) {
      const operation = queue.then(async () => {
        const profiles = await readRedisProfiles(persistence, gameId)
        const index = profiles.findIndex(profile => profile.id === id)
        if (index === -1) return null
        const [removed] = profiles.splice(index, 1)
        await writeRedisProfiles(persistence, gameId, profiles)
        return copyProfile(removed)
      })
      queue = operation.catch(() => {})
      return operation
    },
  }
}

async function findProfile(dataPath, id) {
  try {
    const files = await readdir(dataPath)
    for (const file of files) {
      if (!file.endsWith('.json')) continue
      const gameId = file.slice(0, -'.json'.length)
      const profile = (await readProfiles(dataPath, gameId)).find(candidate => candidate.id === id)
      if (profile) return profile
    }
    return null
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

export function normalizeProfileName(value) {
  const name = typeof value === 'string' ? value.normalize('NFC').trim() : ''
  if (!name || name.length > 32 || /[\u0000-\u001F\u007F]/.test(name)) {
    throw profileError('PROFILE_NAME_INVALID', 'Profile name must contain 1 to 32 printable characters.')
  }
  return name
}

async function readProfiles(dataPath, gameId) {
  try {
    const source = await readFile(collectionPath(dataPath, gameId), 'utf8')
    const profiles = JSON.parse(source)
    if (!Array.isArray(profiles) || profiles.some(profile => !validProfile(profile))) throw new Error('Invalid profile data.')
    return profiles.map(profile => ({ ...profile, oddsResetCount: profile.oddsResetCount ?? 0 }))
  } catch (error) {
    if (error.code === 'ENOENT') return []
    if (error.code?.startsWith('PROFILE_')) throw error
    const storeError = new Error('Profiles could not be loaded.', { cause: error })
    storeError.code = 'PROFILE_STORE_LOAD_FAILED'
    throw storeError
  }
}

async function writeProfiles(dataPath, gameId, profiles) {
  try {
    const path = collectionPath(dataPath, gameId)
    await mkdir(dataPath, { recursive: true })
    const temporaryPath = `${path}.${randomUUID()}.tmp`
    await writeFile(temporaryPath, JSON.stringify(profiles, null, 2), 'utf8')
    await rename(temporaryPath, path)
  } catch (error) {
    const storeError = new Error('Profiles could not be saved.', { cause: error })
    storeError.code = 'PROFILE_STORE_WRITE_FAILED'
    throw storeError
  }
}

function collectionPath(dataPath, gameId) {
  validateGameId(gameId)
  return join(dataPath, `${gameId}.json`)
}

async function findRedisProfile(persistence, id) {
  for (const key of await persistence.keys('profiles:game:')) {
    const profiles = await readRedisProfiles(persistence, key.slice('profiles:game:'.length))
    const profile = profiles.find(candidate => candidate.id === id)
    if (profile) return profile
  }
  return null
}

async function readRedisProfiles(persistence, gameId) {
  validateGameId(gameId)
  try {
    const source = await persistence.get(`profiles:game:${gameId}`)
    if (source === null) return []
    const profiles = JSON.parse(source)
    if (!Array.isArray(profiles) || profiles.some(profile => !validProfile(profile))) throw new Error('Invalid profile data.')
    return profiles.map(profile => ({ ...profile, oddsResetCount: profile.oddsResetCount ?? 0 }))
  } catch (error) {
    if (error.code?.startsWith('PROFILE_')) throw error
    const storeError = new Error('Profiles could not be loaded.', { cause: error })
    storeError.code = 'PROFILE_STORE_LOAD_FAILED'
    throw storeError
  }
}

async function writeRedisProfiles(persistence, gameId, profiles) {
  validateGameId(gameId)
  try { await persistence.set(`profiles:game:${gameId}`, JSON.stringify(profiles)) } catch (error) {
    const storeError = new Error('Profiles could not be saved.', { cause: error })
    storeError.code = 'PROFILE_STORE_WRITE_FAILED'
    throw storeError
  }
}

function validateGameId(gameId) {
  if (typeof gameId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(gameId)) throw profileError('PROFILE_GAME_ID_INVALID', 'Game ID is invalid.')
}

function validProfile(profile) {
  return profile && typeof profile === 'object'
    && typeof profile.id === 'string' && /^[0-9a-f-]{36}$/i.test(profile.id)
    && typeof profile.name === 'string' && profile.name.length > 0 && profile.name.length <= 32
    && typeof profile.createdAt === 'string' && Number.isFinite(Date.parse(profile.createdAt))
    && (profile.oddsResetCount === undefined || profile.oddsResetCount === null || validOddsResetCount(profile.oddsResetCount))
}

function copyProfile(profile) {
  return { id: profile.id, name: profile.name, createdAt: profile.createdAt, oddsResetCount: profile.oddsResetCount ?? 0 }
}

function validOddsResetCount(value) {
  return Number.isSafeInteger(value) && value >= 0
}

function validateOddsResetCount(value) {
  if (!validOddsResetCount(value)) throw profileError('PROFILE_ODDS_COUNT_INVALID', 'Odds reset count must be a non-negative safe integer.')
}

function profileError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}
