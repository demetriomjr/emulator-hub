import { createHash } from 'node:crypto'
import { copyFile, mkdir, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'

import { normalizePokemonSprite, SPRITE_NORMALIZATION_VERSION } from './pokemon-resource-sync.mjs'

const HASH = /^[a-f0-9]{64}$/
const FILE = /^[a-zA-Z0-9-]+\.png$/
const EGG_SOURCE = 'https://projectpokemon.org/images/sprites-models/homeimg/poke_capture_0000_000_uk_n_00000000_f_n.png'

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

export async function createPokemonRequirements(targetDirectory, resources) {
  if (!Array.isArray(resources)) throw new TypeError('Pokemon resources must be an array')
  const entries = []
  for (const resource of resources) {
    for (const [file, source] of [[resource.normalFile, resource.images?.normal], [resource.shinyFile, resource.images?.shiny]]) {
      entries.push({ file, source, sha256: sha256(await readFile(join(targetDirectory, file))) })
    }
  }
  entries.push({ file: 'egg.png', source: EGG_SOURCE, sha256: sha256(await readFile(join(targetDirectory, 'egg.png'))) })
  return validatePokemonRequirements({ schemaVersion: 1, spriteNormalizationVersion: SPRITE_NORMALIZATION_VERSION, entries })
}

export function validatePokemonRequirements(requirements) {
  if (requirements?.schemaVersion !== 1 || requirements?.spriteNormalizationVersion !== SPRITE_NORMALIZATION_VERSION || !Array.isArray(requirements.entries) || requirements.entries.length === 0) {
    throw new TypeError('Invalid Pokemon sprite requirements manifest')
  }
  const files = new Set()
  for (const entry of requirements.entries) {
    if (!FILE.test(entry?.file) || files.has(entry.file) || !HASH.test(entry?.sha256) || typeof entry?.source !== 'string' || !entry.source.startsWith('https://')) {
      throw new TypeError('Invalid Pokemon sprite requirement')
    }
    files.add(entry.file)
  }
  if (!files.has('egg.png')) throw new TypeError('Pokemon sprite requirements must include egg.png')
  return requirements
}

async function inventory(targetDirectory, requirements) {
  const present = []
  const missing = []
  for (const entry of requirements.entries) {
    try {
      const hash = sha256(await readFile(join(targetDirectory, entry.file)))
      if (hash === entry.sha256) present.push(entry.file)
      else missing.push(entry.file)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      missing.push(entry.file)
    }
  }
  return { present, missing }
}

export async function getPokemonRequirementStatus(targetDirectory, requirements) {
  validatePokemonRequirements(requirements)
  const { present, missing } = await inventory(resolve(targetDirectory), requirements)
  return { status: missing.length === 0 ? 'complete' : 'incomplete', count: present.length, missing }
}

function inventoryManifest(requirements) {
  return JSON.stringify({
    schemaVersion: 1,
    spriteNormalizationVersion: SPRITE_NORMALIZATION_VERSION,
    entries: requirements.entries.map(({ file, sha256: hash }) => ({ file, sha256: hash })),
  }, null, 2) + '\n'
}

async function replaceDirectory(targetDirectory, stageDirectory) {
  const backupDirectory = `${targetDirectory}.backup-${process.pid}-${Date.now()}`
  let backedUp = false
  try {
    await rename(targetDirectory, backupDirectory)
    backedUp = true
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  try {
    await rename(stageDirectory, targetDirectory)
  } catch (error) {
    if (backedUp) await rename(backupDirectory, targetDirectory)
    throw error
  }
  if (backedUp) await rm(backupDirectory, { recursive: true, force: true })
}

export async function upgradePokemonRequirements({ targetDirectory, requirements, download, imageProcessor } = {}) {
  if (typeof targetDirectory !== 'string' || !targetDirectory) throw new TypeError('Target directory is required')
  if (requirements?.schemaVersion !== 1 || requirements?.spriteNormalizationVersion !== SPRITE_NORMALIZATION_VERSION - 1 || !Array.isArray(requirements.entries) || requirements.entries.length === 0) {
    throw new TypeError('Legacy Pokemon sprite requirements are required')
  }
  if (typeof download !== 'function') throw new TypeError('Resource downloader is required')
  const files = new Set()
  for (const entry of requirements.entries) {
    if (!FILE.test(entry?.file) || files.has(entry.file) || !HASH.test(entry?.sha256) || typeof entry?.source !== 'string' || !entry.source.startsWith('https://')) {
      throw new TypeError('Invalid legacy Pokemon sprite requirement')
    }
    files.add(entry.file)
  }
  if (!files.has('egg.png')) throw new TypeError('Pokemon sprite requirements must include egg.png')

  targetDirectory = resolve(targetDirectory)
  await mkdir(dirname(targetDirectory), { recursive: true })
  const lockPath = join(dirname(targetDirectory), `.${basename(targetDirectory)}.sync.lock`)
  const lock = await open(lockPath, 'wx')
  const stageDirectory = join(dirname(targetDirectory), `.${basename(targetDirectory)}.sync-${process.pid}-${Date.now()}`)
  try {
    await mkdir(stageDirectory)
    let cachedHashes = new Map()
    let cachedSources = new Map()
    try {
      const cachedInventory = JSON.parse(await readFile(join(targetDirectory, 'inventory.json'), 'utf8'))
      const sources = JSON.parse(await readFile(join(targetDirectory, 'upgrade-sources.json'), 'utf8'))
      if (cachedInventory?.schemaVersion === 1 && cachedInventory?.spriteNormalizationVersion === SPRITE_NORMALIZATION_VERSION && Array.isArray(cachedInventory.entries)) {
        cachedHashes = new Map(cachedInventory.entries.map(({ file, sha256: hash }) => [file, hash]))
      }
      if (sources?.spriteNormalizationVersion === SPRITE_NORMALIZATION_VERSION && Array.isArray(sources.entries)) {
        cachedSources = new Map(sources.entries.map(({ file, source }) => [file, source]))
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    const upgradedEntries = new Array(requirements.entries.length)
    let nextIndex = 0
    const workers = Array.from({ length: Math.min(8, requirements.entries.length) }, async () => {
      while (nextIndex < requirements.entries.length) {
        const index = nextIndex++
        const entry = requirements.entries[index]
        const cachedHash = cachedHashes.get(entry.file)
        if (HASH.test(cachedHash) && cachedSources.get(entry.file) === entry.source) {
          try {
            const bytes = await readFile(join(targetDirectory, entry.file))
            if (sha256(bytes) === cachedHash) {
              await writeFile(join(stageDirectory, entry.file), bytes)
              upgradedEntries[index] = { ...entry, sha256: cachedHash }
              continue
            }
          } catch (error) {
            if (error?.code !== 'ENOENT') throw error
          }
        }
        const normalized = await normalizePokemonSprite(await download(entry.source), imageProcessor)
        await writeFile(join(stageDirectory, entry.file), normalized)
        upgradedEntries[index] = { ...entry, sha256: sha256(normalized) }
      }
    })
    const results = await Promise.allSettled(workers)
    const failure = results.find(result => result.status === 'rejected')
    if (failure) throw failure.reason

    const upgraded = validatePokemonRequirements({ ...requirements, spriteNormalizationVersion: SPRITE_NORMALIZATION_VERSION, entries: upgradedEntries })
    await writeFile(join(stageDirectory, 'inventory.json'), inventoryManifest(upgraded))
    await writeFile(join(stageDirectory, 'upgrade-sources.json'), JSON.stringify({ spriteNormalizationVersion: SPRITE_NORMALIZATION_VERSION, entries: upgraded.entries.map(({ file, source }) => ({ file, source })) }, null, 2) + '\n')
    try {
      const manifest = JSON.parse(await readFile(join(targetDirectory, 'manifest.json'), 'utf8'))
      if (manifest?.schemaVersion === 1 && Array.isArray(manifest.entries)) {
        await writeFile(join(stageDirectory, 'manifest.json'), JSON.stringify({ ...manifest, spriteNormalizationVersion: SPRITE_NORMALIZATION_VERSION }, null, 2) + '\n')
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    await replaceDirectory(targetDirectory, stageDirectory)
    return upgraded
  } finally {
    await rm(stageDirectory, { recursive: true, force: true })
    await lock.close()
    await rm(lockPath, { force: true })
  }
}

export async function syncPokemonRequirements({ targetDirectory, requirements, download, imageProcessor } = {}) {
  if (typeof targetDirectory !== 'string' || !targetDirectory) throw new TypeError('Target directory is required')
  validatePokemonRequirements(requirements)
  if (typeof download !== 'function') throw new TypeError('Resource downloader is required')
  targetDirectory = resolve(targetDirectory)
  await mkdir(dirname(targetDirectory), { recursive: true })
  const lockPath = join(dirname(targetDirectory), `.${basename(targetDirectory)}.sync.lock`)
  let lock
  try {
    lock = await open(lockPath, 'wx')
  } catch (error) {
    if (error?.code === 'EEXIST') return { status: 'running', count: 0, downloaded: [] }
    throw error
  }

  try {
    const { present, missing } = await inventory(targetDirectory, requirements)
    const expectedInventory = inventoryManifest(requirements)
    let currentInventory = null
    try { currentInventory = await readFile(join(targetDirectory, 'inventory.json'), 'utf8') } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    const expectedFiles = new Set([...requirements.entries.map(entry => entry.file), 'inventory.json', 'manifest.json'])
    let currentFiles = []
    try { currentFiles = await readdir(targetDirectory) } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    if (missing.length === 0 && currentInventory === expectedInventory && currentFiles.every(file => expectedFiles.has(file))) {
      return { status: 'complete', count: requirements.entries.length, downloaded: [] }
    }

    const stageDirectory = join(dirname(targetDirectory), `.${basename(targetDirectory)}.sync-${process.pid}-${Date.now()}`)
    await mkdir(stageDirectory)
    try {
      const reusable = new Set(present)
      for (const entry of requirements.entries) {
        const stagedFile = join(stageDirectory, entry.file)
        if (reusable.has(entry.file)) {
          await copyFile(join(targetDirectory, entry.file), stagedFile)
        } else {
          const source = await download(entry.source)
          const normalized = await normalizePokemonSprite(source, imageProcessor)
          if (sha256(normalized) !== entry.sha256) throw new Error(`Downloaded Pokemon sprite hash differs from requirements: ${entry.file}`)
          await writeFile(stagedFile, normalized)
        }
      }
      try { await copyFile(join(targetDirectory, 'manifest.json'), join(stageDirectory, 'manifest.json')) } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
      await writeFile(join(stageDirectory, 'inventory.json'), expectedInventory)
      await replaceDirectory(targetDirectory, stageDirectory)
      return { status: 'synchronized', count: requirements.entries.length, downloaded: missing }
    } finally {
      await rm(stageDirectory, { recursive: true, force: true })
    }
  } finally {
    await lock.close()
    await rm(lockPath, { force: true })
  }
}
