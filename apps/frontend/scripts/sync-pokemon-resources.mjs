import { spawn } from 'node:child_process'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

import { createPokemonRequirements, getPokemonRequirementStatus, syncPokemonRequirements } from '../../packages/pokemon-resource-requirements.mjs'
import { syncPokemonResources } from '../../packages/pokemon-resource-sync.mjs'
import { selectPokemonResources } from '../../packages/pokemon-resource-catalog.mjs'

const SOURCE_INDEX_URL = 'https://pokeapi.co/api/v2/pokemon?limit=2000'
const targetDirectory = fileURLToPath(new URL('../public/resources/pokemon/', import.meta.url))
const requirementsPath = fileURLToPath(new URL('../pokemon-sprite-requirements.json', import.meta.url))
const refresh = process.argv.includes('--refresh')
const background = process.argv.includes('--background')
const optional = process.argv.includes('--optional')
const scriptPath = fileURLToPath(import.meta.url)

async function getJson(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Could not load Pokémon resource metadata: ${response.status} ${response.statusText}`)
  return response.json()
}

async function mapConcurrent(values, limit, mapper) {
  const results = new Array(values.length)
  let nextIndex = 0
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await mapper(values[index])
    }
  }))
  return results
}

async function loadRecords() {
  const index = await getJson(SOURCE_INDEX_URL)
  if (!Array.isArray(index?.results)) throw new Error('Pokémon resource index returned an invalid response')

  return mapConcurrent(index.results, 12, async ({ url }) => {
    const pokemon = await getJson(url)
    const artwork = pokemon?.sprites?.other?.home
    return {
      sourceId: pokemon.id,
      speciesId: Number(new URL(pokemon.species.url).pathname.split('/').filter(Boolean).at(-1)),
      name: pokemon.name,
      isDefault: pokemon.is_default,
      images: { normal: artwork?.front_default, shiny: artwork?.front_shiny },
    }
  })
}

async function download(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Could not download Pokémon resource: ${response.status} ${response.statusText}`)
  return new Uint8Array(await response.arrayBuffer())
}

async function loadRequirements() {
  return JSON.parse(await readFile(requirementsPath, 'utf8'))
}

async function refreshRequirements() {
  const records = await loadRecords()
  const result = await syncPokemonResources({ targetDirectory, loadRecords: async () => records, download, imageProcessor: sharp, refresh: true })
  if (result.status === 'running') return result
  const requirements = await createPokemonRequirements(targetDirectory, selectPokemonResources(records))
  const temporaryPath = `${requirementsPath}.${process.pid}.tmp`
  try {
    await writeFile(temporaryPath, JSON.stringify(requirements, null, 2) + '\n')
    await rename(temporaryPath, requirementsPath)
  } finally {
    await rm(temporaryPath, { force: true })
  }
  return result
}

if (background) {
  const status = await getPokemonRequirementStatus(targetDirectory, await loadRequirements())
  if (status.status === 'complete') {
    console.log(`Pokemon resources: complete (${status.count} entries)`)
  } else if (status.status === 'running') {
    console.log('Pokemon resources: download already running in the background')
  } else {
    const child = spawn(process.execPath, [scriptPath], { detached: true, stdio: 'ignore', windowsHide: true })
    child.unref()
    console.log('Pokemon resources: download started in the background')
  }
} else {
  try {
    const result = refresh
      ? await refreshRequirements()
      : await syncPokemonRequirements({ targetDirectory, requirements: await loadRequirements(), download, imageProcessor: sharp })
    console.log(`Pokemon resources: ${result.status} (${result.count} entries)`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    if (!optional) process.exitCode = 1
  }
}
