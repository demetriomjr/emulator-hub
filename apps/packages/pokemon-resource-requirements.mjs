import { createHash } from 'node:crypto'
import { copyFile, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'

import { normalizePokemonSprite, SPRITE_NORMALIZATION_VERSION } from './pokemon-resource-sync.mjs'

const HASH = /^[a-f0-9]{64}$/
const FILE = /^[a-zA-Z0-9-]+\.png$/
const EGG_SOURCE = 'https://raw.githubusercontent.com/pret/pokeemerald/master/graphics/pokemon/egg/front.png'

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
    if (missing.length === 0 && currentInventory === expectedInventory) {
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
