import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { validateLegacyMacro, validateMacro } from './input-macro-simulator.mjs'

export function createInputMacroStore({ dataPath }) {
  let queue = Promise.resolve()

  return {
    async list() {
      return copyMacros(await readMacros(dataPath))
    },
    save(macro) {
      const operation = queue.then(async () => {
        const normalized = normalizeMacro(macro)
        const macros = await readMacros(dataPath)
        const existing = macros.find(candidate => candidate?.id === normalized.id)
        const stored = {
          ...normalized,
          createdAt: Number.isSafeInteger(existing?.createdAt) && existing.createdAt >= 0 ? existing.createdAt : normalized.createdAt,
          updatedAt: Date.now(),
        }
        const index = macros.findIndex(candidate => candidate?.id === stored.id)
        const next = index === -1 ? [...macros, stored] : [...macros.slice(0, index), stored, ...macros.slice(index + 1)]
        await writeMacros(dataPath, next)
        return copyMacro(stored)
      })
      queue = operation.catch(() => {})
      return operation
    },
    delete(id) {
      const operation = queue.then(async () => {
        const macros = await readMacros(dataPath)
        const index = macros.findIndex(candidate => candidate?.id === id)
        if (index === -1) throw macroError('INPUT_MACRO_NOT_FOUND', 'Input macro was not found.')
        const [removed] = macros.splice(index, 1)
        await writeMacros(dataPath, macros)
        return copyMacro(removed)
      })
      queue = operation.catch(() => {})
      return operation
    },
  }
}

export function createRedisInputMacroStore({ persistence }) {
  let queue = Promise.resolve()
  const collectionKey = 'input-macros'

  return {
    async list() {
      return copyMacros(await readRedisMacros(persistence, collectionKey))
    },
    save(macro) {
      const operation = queue.then(async () => {
        const normalized = normalizeMacro(macro)
        const macros = await readRedisMacros(persistence, collectionKey)
        const existing = macros.find(candidate => candidate?.id === normalized.id)
        const stored = {
          ...normalized,
          createdAt: Number.isSafeInteger(existing?.createdAt) && existing.createdAt >= 0 ? existing.createdAt : normalized.createdAt,
          updatedAt: Date.now(),
        }
        const index = macros.findIndex(candidate => candidate?.id === stored.id)
        const next = index === -1 ? [...macros, stored] : [...macros.slice(0, index), stored, ...macros.slice(index + 1)]
        await writeRedisMacros(persistence, collectionKey, next)
        return copyMacro(stored)
      })
      queue = operation.catch(() => {})
      return operation
    },
    delete(id) {
      const operation = queue.then(async () => {
        const macros = await readRedisMacros(persistence, collectionKey)
        const index = macros.findIndex(candidate => candidate?.id === id)
        if (index === -1) throw macroError('INPUT_MACRO_NOT_FOUND', 'Input macro was not found.')
        const [removed] = macros.splice(index, 1)
        await writeRedisMacros(persistence, collectionKey, macros)
        return copyMacro(removed)
      })
      queue = operation.catch(() => {})
      return operation
    },
  }
}

async function readMacros(dataPath) {
  try {
    const source = await readFile(dataPath, 'utf8')
    const macros = JSON.parse(source)
    const normalized = Array.isArray(macros) ? macros : null
    if (!normalized) throw new Error('Invalid input macro data.')
    return normalized
  } catch (error) {
    if (error.code === 'ENOENT') return []
    if (error.code === 'INPUT_MACRO_INVALID') throw error
    if (error.code?.startsWith('INPUT_MACRO_')) throw error
    throw macroError('INPUT_MACRO_LOAD_FAILED', 'Input macros could not be loaded.', error)
  }
}

async function writeMacros(dataPath, macros) {
  try {
    await mkdir(dirname(dataPath), { recursive: true })
    const temporaryPath = `${dataPath}.${randomUUID()}.tmp`
    await writeFile(temporaryPath, JSON.stringify(macros, null, 2), 'utf8')
    await rename(temporaryPath, dataPath)
  } catch (error) {
    throw macroError('INPUT_MACRO_WRITE_FAILED', 'Input macros could not be saved.', error)
  }
}

async function readRedisMacros(persistence, collectionKey) {
  try {
    const source = await persistence.get(collectionKey)
    if (source === null) return []
    const macros = JSON.parse(source)
    const normalized = Array.isArray(macros) ? macros : null
    if (!normalized) throw new Error('Invalid input macro data.')
    return normalized
  } catch (error) {
    if (error.code?.startsWith('INPUT_MACRO_')) throw error
    throw macroError('INPUT_MACRO_LOAD_FAILED', 'Input macros could not be loaded.', error)
  }
}

async function writeRedisMacros(persistence, collectionKey, macros) {
  try { await persistence.set(collectionKey, JSON.stringify(macros)) } catch (error) {
    throw macroError('INPUT_MACRO_WRITE_FAILED', 'Input macros could not be saved.', error)
  }
}

function normalizeMacro(macro) {
  if (!macro || typeof macro !== 'object' || Array.isArray(macro)) throw macroError('INPUT_MACRO_INVALID', 'Input macro body is required.')
  const candidate = {
    ...macro,
    id: Object.hasOwn(macro, 'id') ? macro.id : randomUUID(),
    createdAt: Object.hasOwn(macro, 'createdAt') ? macro.createdAt : Date.now(),
    updatedAt: Date.now(),
  }
  const validation = validateMacro(candidate)
  if (!validation.valid) throw macroError('INPUT_MACRO_INVALID', validation.errors[0])
  return normalizeStoredMacro(candidate)
}

function normalizeStoredMacro(macro) {
  if (macro?.schemaVersion === 2) return validateMacro(macro).valid ? structuredClone(macro) : null
  return validateLegacyMacro(macro) ? structuredClone(macro) : null
}

function copyMacro(macro) {
  return structuredClone(macro)
}

function copyMacros(macros) {
  return macros.map(normalizeStoredMacro).filter(Boolean).map(copyMacro)
}

function macroError(code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined)
  error.code = code
  return error
}
