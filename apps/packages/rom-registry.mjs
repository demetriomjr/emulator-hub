import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

const hashPatterns = Object.freeze({ sha1: /^[a-f0-9]{40}$/, md5: /^[a-f0-9]{32}$/, sha256: /^[a-f0-9]{64}$/ })
const supportedSystems = new Map([['gb', 'gambatte'], ['gbc', 'gambatte'], ['gba', 'gba']])

export function createRomRegistry({ dataPath }) {
  if (typeof dataPath !== 'string' || !dataPath) throw registryError('ROM_REGISTRY_INVALID', 'ROM registry path is invalid.')

  return {
    async load() {
      let source
      try {
        source = await readFile(dataPath, 'utf8')
      } catch (error) {
        if (error.code === 'ENOENT') return []
        throw registryError('ROM_REGISTRY_LOAD_FAILED', 'ROM registry could not be loaded.', error)
      }
      try {
        const document = JSON.parse(source)
        if (!document || document.schemaVersion !== 1 || !Array.isArray(document.entries)) throw new Error('Registry schema is invalid.')
        return document.entries.map(normalizeEntry)
      } catch (error) {
        throw registryError('ROM_REGISTRY_LOAD_FAILED', 'ROM registry could not be loaded.', error)
      }
    },

    async replace(entries) {
      if (!Array.isArray(entries)) throw registryError('ROM_REGISTRY_INVALID', 'ROM registry entries are invalid.')
      let normalized
      try {
        normalized = entries.map(normalizeEntry)
      } catch (error) {
        if (error.code === 'ROM_REGISTRY_INVALID') throw error
        throw registryError('ROM_REGISTRY_INVALID', 'ROM registry entries are invalid.', error)
      }
      if (new Set(normalized.map(entry => entry.id)).size !== normalized.length) throw registryError('ROM_REGISTRY_INVALID', 'ROM registry game IDs must be unique.')

      const temporaryPath = `${dataPath}.${randomUUID()}.tmp`
      try {
        await mkdir(dirname(dataPath), { recursive: true })
        await writeFile(temporaryPath, JSON.stringify({ schemaVersion: 1, entries: normalized }, null, 2))
        await rename(temporaryPath, dataPath)
      } catch (error) {
        throw registryError('ROM_REGISTRY_WRITE_FAILED', 'ROM registry could not be saved.', error)
      }
      return clone(normalized)
    },
  }
}

export function createRedisRomRegistry({ persistence }) {
  return {
    async load() {
      let source
      try { source = await persistence.get('rom-registry') } catch (error) { throw registryError('ROM_REGISTRY_LOAD_FAILED', 'ROM registry could not be loaded.', error) }
      if (source === null) return []
      try {
        const document = JSON.parse(source)
        if (!document || document.schemaVersion !== 1 || !Array.isArray(document.entries)) throw new Error('Registry schema is invalid.')
        return document.entries.map(normalizeEntry)
      } catch (error) { throw registryError('ROM_REGISTRY_LOAD_FAILED', 'ROM registry could not be loaded.', error) }
    },
    async replace(entries) {
      if (!Array.isArray(entries)) throw registryError('ROM_REGISTRY_INVALID', 'ROM registry entries are invalid.')
      let normalized
      try { normalized = entries.map(normalizeEntry) } catch (error) {
        if (error.code === 'ROM_REGISTRY_INVALID') throw error
        throw registryError('ROM_REGISTRY_INVALID', 'ROM registry entries are invalid.', error)
      }
      if (new Set(normalized.map(entry => entry.id)).size !== normalized.length) throw registryError('ROM_REGISTRY_INVALID', 'ROM registry game IDs must be unique.')
      try { await persistence.set('rom-registry', JSON.stringify({ schemaVersion: 1, entries: normalized })) } catch (error) { throw registryError('ROM_REGISTRY_WRITE_FAILED', 'ROM registry could not be saved.', error) }
      return clone(normalized)
    },
  }
}

function normalizeEntry(value) {
  if (!value || typeof value !== 'object') throw registryError('ROM_REGISTRY_INVALID', 'ROM registry entry is invalid.')
  const entry = {
    schemaVersion: value.schemaVersion,
    id: clean(value.id),
    file: clean(value.file),
    system: clean(value.system).toLowerCase(),
    core: clean(value.core),
    title: clean(value.title),
    sha1: clean(value.sha1).toLowerCase(),
    md5: clean(value.md5).toLowerCase(),
    sha256: clean(value.sha256).toLowerCase(),
    size: value.size,
    source: clean(value.source).toLowerCase(),
    region: clean(value.region),
    ...(typeof value.coverUrl === 'string' && value.coverUrl ? { coverUrl: value.coverUrl } : {}),
    ...(value.pokemonSave && typeof value.pokemonSave === 'object' ? { pokemonSave: clone(value.pokemonSave) } : {}),
  }
  if (entry.schemaVersion !== 1 || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(entry.id) || !entry.file || !entry.title || !entry.region || entry.source !== 'no-intro') {
    throw registryError('ROM_REGISTRY_INVALID', 'ROM registry entry is invalid.')
  }
  if (supportedSystems.get(entry.system) !== entry.core || !hashPatterns.sha1.test(entry.sha1) || !hashPatterns.md5.test(entry.md5) || !hashPatterns.sha256.test(entry.sha256) || !Number.isSafeInteger(entry.size) || entry.size < 1) {
    throw registryError('ROM_REGISTRY_INVALID', 'ROM registry entry is invalid.')
  }
  if (entry.coverUrl) {
    try {
      if (new URL(entry.coverUrl).protocol !== 'https:') throw new Error('Cover URL is not HTTPS.')
    } catch (error) {
      throw registryError('ROM_REGISTRY_INVALID', 'ROM registry cover URL is invalid.', error)
    }
  }
  return entry
}

function clean(value) { return typeof value === 'string' ? value.trim() : '' }
function clone(value) { return structuredClone(value) }
function registryError(code, message, cause) { const error = new Error(message, cause ? { cause } : undefined); error.code = code; return error }
