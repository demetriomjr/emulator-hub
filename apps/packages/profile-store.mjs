import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export function createProfileStore({ dataPath }) {
  let queue = Promise.resolve()

  return {
    list: async () => (await readProfiles(dataPath)).map(copyProfile),
    get: async id => (await readProfiles(dataPath)).find(profile => profile.id === id) ?? null,
    create(name) {
      const operation = queue.then(async () => {
        const normalizedName = normalizeProfileName(name)
        const profiles = await readProfiles(dataPath)
        if (profiles.some(profile => profile.name.localeCompare(normalizedName, undefined, { sensitivity: 'accent' }) === 0)) {
          throw profileError('PROFILE_NAME_DUPLICATE', 'A profile with this name already exists.')
        }

        const profile = { id: randomUUID(), name: normalizedName, createdAt: new Date().toISOString() }
        await writeProfiles(dataPath, [...profiles, profile])
        return copyProfile(profile)
      })
      queue = operation.catch(() => {})
      return operation
    },
    update(id, name) {
      const operation = queue.then(async () => {
        const normalizedName = normalizeProfileName(name)
        const profiles = await readProfiles(dataPath)
        const index = profiles.findIndex(profile => profile.id === id)
        if (index === -1) return null
        if (profiles.some(profile => profile.id !== id && profile.name.localeCompare(normalizedName, undefined, { sensitivity: 'accent' }) === 0)) {
          throw profileError('PROFILE_NAME_DUPLICATE', 'A profile with this name already exists.')
        }

        const profile = { ...profiles[index], name: normalizedName }
        profiles[index] = profile
        await writeProfiles(dataPath, profiles)
        return copyProfile(profile)
      })
      queue = operation.catch(() => {})
      return operation
    },
    remove(id) {
      const operation = queue.then(async () => {
        const profiles = await readProfiles(dataPath)
        const index = profiles.findIndex(profile => profile.id === id)
        if (index === -1) return null

        const [removed] = profiles.splice(index, 1)
        await writeProfiles(dataPath, profiles)
        return copyProfile(removed)
      })
      queue = operation.catch(() => {})
      return operation
    },
  }
}

export function normalizeProfileName(value) {
  const name = typeof value === 'string' ? value.normalize('NFC').trim() : ''
  if (!name || name.length > 32 || /[\u0000-\u001F\u007F]/.test(name)) {
    throw profileError('PROFILE_NAME_INVALID', 'Profile name must contain 1 to 32 printable characters.')
  }
  return name
}

async function readProfiles(dataPath) {
  try {
    const source = await readFile(dataPath, 'utf8')
    const profiles = JSON.parse(source)
    if (!Array.isArray(profiles) || profiles.some(profile => !validProfile(profile))) throw new Error('Invalid profile data.')
    return profiles
  } catch (error) {
    if (error.code === 'ENOENT') return []
    if (error.code?.startsWith('PROFILE_')) throw error
    const storeError = new Error('Profiles could not be loaded.', { cause: error })
    storeError.code = 'PROFILE_STORE_LOAD_FAILED'
    throw storeError
  }
}

async function writeProfiles(dataPath, profiles) {
  try {
    await mkdir(dirname(dataPath), { recursive: true })
    const temporaryPath = `${dataPath}.${randomUUID()}.tmp`
    await writeFile(temporaryPath, JSON.stringify(profiles, null, 2), 'utf8')
    await rename(temporaryPath, dataPath)
  } catch (error) {
    const storeError = new Error('Profiles could not be saved.', { cause: error })
    storeError.code = 'PROFILE_STORE_WRITE_FAILED'
    throw storeError
  }
}

function validProfile(profile) {
  return profile && typeof profile === 'object'
    && typeof profile.id === 'string' && /^[0-9a-f-]{36}$/i.test(profile.id)
    && typeof profile.name === 'string' && profile.name.length > 0 && profile.name.length <= 32
    && typeof profile.createdAt === 'string' && Number.isFinite(Date.parse(profile.createdAt))
}

function copyProfile(profile) {
  return { id: profile.id, name: profile.name, createdAt: profile.createdAt }
}

function profileError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}
