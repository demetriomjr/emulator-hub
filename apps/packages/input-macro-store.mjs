import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { validateMacro } from './input-macro-simulator.mjs'

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
        const existing = macros.find(candidate => candidate.id === normalized.id)
        const stored = {
          ...normalized,
          createdAt: existing?.createdAt ?? normalized.createdAt,
          updatedAt: Date.now(),
        }
        const index = macros.findIndex(candidate => candidate.id === stored.id)
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
        const index = macros.findIndex(candidate => candidate.id === id)
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
        const existing = macros.find(candidate => candidate.id === normalized.id)
        const stored = {
          ...normalized,
          createdAt: existing?.createdAt ?? normalized.createdAt,
          updatedAt: Date.now(),
        }
        const index = macros.findIndex(candidate => candidate.id === stored.id)
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
        const index = macros.findIndex(candidate => candidate.id === id)
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
    const normalized = Array.isArray(macros) ? macros.map(normalizeStoredMacro) : null
    if (!normalized || normalized.some(macro => macro === null)) throw new Error('Invalid input macro data.')
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
    const normalized = Array.isArray(macros) ? macros.map(normalizeStoredMacro) : null
    if (!normalized || normalized.some(macro => macro === null)) throw new Error('Invalid input macro data.')
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
  const validation = validateMacro(macro)
  if (!validation.valid) throw macroError('INPUT_MACRO_INVALID', validation.errors[0])
  return normalizeStoredMacro({
    ...macro,
    id: typeof macro.id === 'string' && macro.id.length > 0 ? macro.id : randomUUID(),
    createdAt: typeof macro.createdAt === 'number' ? macro.createdAt : Date.now(),
    updatedAt: Date.now(),
  })
}

function normalizeStoredMacro(macro) {
  if (!macro || typeof macro !== 'object' || Array.isArray(macro)
    || typeof macro.id !== 'string' || macro.id.length === 0
    || !Array.isArray(macro.steps)
    || typeof macro.createdAt !== 'number' || !Number.isFinite(macro.createdAt)
    || typeof macro.updatedAt !== 'number' || !Number.isFinite(macro.updatedAt)) return null
  const normalized = { ...macro, id: macro.id, steps: macro.steps.map(copyStep), createdAt: macro.createdAt, updatedAt: macro.updatedAt }
  if (!validateMacro(normalized).valid) return null
  return normalized
}

function copyStep(step) {
  return { ...step }
}

function copyMacro(macro) {
  return { ...macro, steps: macro.steps.map(copyStep) }
}

function copyMacros(macros) {
  return macros.map(copyMacro)
}

function macroError(code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined)
  error.code = code
  return error
}