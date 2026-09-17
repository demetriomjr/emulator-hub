import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

const markerKey = 'migrations:legacy-json:v1'

export async function migrateLegacyJsonData({ persistence, profilesPath, controlProfilePath, pokemonHubProfilesPath, pokemonHubPath, romRegistryPath }) {
  if (await persistence.get(markerKey)) return { migrated: false, imported: 0 }

  let imported = 0
  async function importIfAbsent(key, value) {
    if (await persistence.set(key, JSON.stringify(value), { NX: true })) imported += 1
  }

  for (const file of await jsonFiles(profilesPath)) {
    const gameId = file.slice(0, -'.json'.length)
    await importIfAbsent(`profiles:game:${gameId}`, await readJson(join(profilesPath, file)))
  }

  const controlProfile = await readOptionalJson(controlProfilePath)
  if (controlProfile) await importIfAbsent('control-profile', controlProfile)
  const hubProfiles = await readOptionalJson(join(pokemonHubProfilesPath, 'profiles.json'))
  if (hubProfiles) await importIfAbsent('pokemon-hub:profiles', hubProfiles)
  const romRegistry = await readOptionalJson(romRegistryPath)
  if (romRegistry) await importIfAbsent('rom-registry', romRegistry)

  for (const profileId of await directories(pokemonHubPath)) {
    const profileRoot = join(pokemonHubPath, profileId)
    const inventory = await readOptionalJson(join(profileRoot, 'inventory.json'))
    if (inventory) await importIfAbsent(`pokemon-hub:inventory:${profileId}`, inventory)
    for (const file of await jsonFiles(join(profileRoot, 'pokemon'))) {
      const hubPokemonId = file.slice(0, -'.json'.length)
      await importIfAbsent(`pokemon-hub:pokemon:${profileId}:${hubPokemonId}`, await readJson(join(profileRoot, 'pokemon', file)))
    }
  }

  await persistence.set(markerKey, JSON.stringify({ migratedAt: new Date().toISOString(), imported }))
  return { migrated: true, imported }
}

async function readJson(path) { return JSON.parse(await readFile(path, 'utf8')) }
async function readOptionalJson(path) {
  try { return await readJson(path) } catch (error) { if (error.code === 'ENOENT') return null; throw error }
}
async function jsonFiles(path) {
  try { return (await readdir(path)).filter(file => file.endsWith('.json')) } catch (error) { if (error.code === 'ENOENT') return []; throw error }
}
async function directories(path) {
  try { return (await readdir(path, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name) } catch (error) { if (error.code === 'ENOENT') return []; throw error }
}
