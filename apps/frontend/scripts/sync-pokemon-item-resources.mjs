import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

import { ITEM_SPRITE_NORMALIZATION_VERSION, collectPokemonItemKeys, getPokemonItemSpriteRequirementStatus, normalizePokemonItemSprite, selectPokemonItemSpriteSources, syncPokemonItemSpriteRequirements, validatePokemonItemSpriteRequirements } from '../../packages/pokemon-item-sprite-resources.mjs'

const requirementsPath = fileURLToPath(new URL('../pokemon-item-sprite-requirements.json', import.meta.url))
const catalogPath = fileURLToPath(new URL('../../packages/pokemon-item-catalog.json', import.meta.url))
const targetDirectory = fileURLToPath(new URL('../public/resources/items/', import.meta.url))
const scriptPath = fileURLToPath(import.meta.url)
const refresh = process.argv.includes('--refresh')
const renormalize = process.argv.includes('--renormalize')
const background = process.argv.includes('--background')
const optional = process.argv.includes('--optional')
const githubHeaders = { 'User-Agent': 'emulator-hub-item-sprites' }
const sourceRoot = 'https://raw.githubusercontent.com/PokeAPI/sprites/'
const hash = bytes => createHash('sha256').update(bytes).digest('hex')

async function getJson(url, headers = undefined) {
  const response = await fetch(url, { headers })
  if (!response.ok) throw new Error(`Item sprite metadata failed: ${response.status} ${url}`)
  return response.json()
}

async function download(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Item sprite download failed: ${response.status} ${url}`)
  return new Uint8Array(await response.arrayBuffer())
}

async function mapConcurrent(values, limit, mapper) {
  const results = new Array(values.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (next < values.length) { const index = next++; results[index] = await mapper(values[index]) }
  }))
  return results
}

async function itemKeys() {
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8'))
  return collectPokemonItemKeys(catalog)
}

async function availablePaths(revision) {
  const directories = ['', 'dream-world/', 'gen3/']
  const lists = await Promise.all(directories.map(async directory => {
    const url = `https://api.github.com/repos/PokeAPI/sprites/contents/sprites/items/${directory}?ref=${revision}`
    const entries = await getJson(url, githubHeaders)
    if (!Array.isArray(entries)) throw new TypeError(`Invalid item sprite listing: ${directory}`)
    return entries.filter(entry => entry.type === 'file' && entry.name.endsWith('.png')).map(entry => `${directory}${entry.name}`)
  }))
  return new Set(lists.flat())
}

async function machineMoveTypes(keys) {
  const moves = [...new Set(keys.map(key => /^(?:tm|hm)\d\d-(.+)$/.exec(key)?.[1]).filter(Boolean)
    .map(move => move === 'solarbeam' ? 'solar-beam' : move))]
  const types = await mapConcurrent(moves, 8, async move => {
    const data = await getJson(`https://pokeapi.co/api/v2/move/${move}/`)
    if (typeof data?.type?.name !== 'string') throw new TypeError(`Missing move type: ${move}`)
    return [move, data.type.name]
  })
  return Object.fromEntries(types)
}

async function saveRequirements(requirements) {
  const temporary = `${requirementsPath}.${process.pid}.tmp`
  try {
    await writeFile(temporary, JSON.stringify(requirements, null, 2) + '\n')
    await rename(temporary, requirementsPath)
  } finally { await rm(temporary, { force: true }) }
}

async function refreshRequirements() {
  const keys = await itemKeys()
  const commit = await getJson('https://api.github.com/repos/PokeAPI/sprites/commits/master', githubHeaders)
  const revision = commit?.sha
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new TypeError('Invalid sprite repository revision')
  const paths = await availablePaths(revision)
  const types = await machineMoveTypes(keys)
  const selected = selectPokemonItemSpriteSources(keys, paths, types)
  const sourceCache = new Map()
  const cachedDownload = url => {
    if (!sourceCache.has(url)) sourceCache.set(url, download(url))
    return sourceCache.get(url)
  }
  const entries = await mapConcurrent(selected, 8, async selectedItem => {
    if (selectedItem.status === 'missing') return selectedItem
    const source = `${sourceRoot}${revision}/sprites/items/${selectedItem.path}`
    const bytes = await cachedDownload(source)
    const normalized = await normalizePokemonItemSprite(bytes, sharp)
    return {
      itemKey: selectedItem.itemKey, status: 'resolved', file: `${selectedItem.itemKey}.png`,
      family: selectedItem.family, sourcePath: selectedItem.path, source,
      sourceSha256: hash(bytes), sha256: hash(normalized),
    }
  })
  const requirements = validatePokemonItemSpriteRequirements({
    schemaVersion: 1, spriteNormalizationVersion: ITEM_SPRITE_NORMALIZATION_VERSION,
    catalogRevision: hash(keys.join('\n') + '\n'), spriteRepositoryRevision: revision, entries,
  }, keys)
  const result = await syncPokemonItemSpriteRequirements({ targetDirectory, requirements, download: cachedDownload, imageProcessor: sharp })
  if (result.status === 'running') throw new Error('Item sprite synchronization is already running')
  await saveRequirements(requirements)
  return { ...result, missing: entries.filter(entry => entry.status === 'missing').length }
}

async function renormalizeRequirements() {
  const original = JSON.parse(await readFile(requirementsPath, 'utf8'))
  const sourceCache = new Map()
  const cachedDownload = url => {
    if (!sourceCache.has(url)) sourceCache.set(url, download(url))
    return sourceCache.get(url)
  }
  const entries = await mapConcurrent(original.entries, 8, async entry => {
    if (entry.status === 'missing') return entry
    const bytes = await cachedDownload(entry.source)
    if (hash(bytes) !== entry.sourceSha256) throw new Error(`Item sprite source hash differs from requirements: ${entry.file}`)
    return { ...entry, sha256: hash(await normalizePokemonItemSprite(bytes, sharp)) }
  })
  const requirements = validatePokemonItemSpriteRequirements({
    ...original, spriteNormalizationVersion: ITEM_SPRITE_NORMALIZATION_VERSION, entries,
  }, await itemKeys())
  const result = await syncPokemonItemSpriteRequirements({ targetDirectory, requirements, download: cachedDownload, imageProcessor: sharp })
  if (result.status === 'running') throw new Error('Item sprite synchronization is already running')
  await saveRequirements(requirements)
  return { ...result, missing: entries.filter(entry => entry.status === 'missing').length }
}

async function synchronizeRequirements() {
  const requirements = JSON.parse(await readFile(requirementsPath, 'utf8'))
  validatePokemonItemSpriteRequirements(requirements, await itemKeys())
  const result = await syncPokemonItemSpriteRequirements({ targetDirectory, requirements, download, imageProcessor: sharp })
  return { ...result, missing: requirements.entries.filter(entry => entry.status === 'missing').length }
}

try {
  if (background) {
    const requirements = JSON.parse(await readFile(requirementsPath, 'utf8'))
    validatePokemonItemSpriteRequirements(requirements, await itemKeys())
    const status = await getPokemonItemSpriteRequirementStatus(targetDirectory, requirements)
    if (status.status === 'incomplete') {
      const child = spawn(process.execPath, [scriptPath, '--optional'], { detached: true, stdio: 'ignore', windowsHide: true })
      child.unref()
      console.log('Item sprites: download started in the background')
    } else console.log(`Item sprites: ${status.status} (${status.count} entries)`)
  } else {
    const result = renormalize ? await renormalizeRequirements() : refresh ? await refreshRequirements() : await synchronizeRequirements()
    if (result.status === 'running' && !optional) throw new Error('Item sprite synchronization is already running')
    console.log(`Item sprites: ${result.status} (${result.count} sprites; ${result.missing} missing)`)
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  if (!optional && !background) process.exitCode = 1
}
