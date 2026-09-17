import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRedisPersistence } from '../packages/redis-persistence.mjs'
import { migrateLegacyJsonData } from '../packages/redis-legacy-migration.mjs'

const backendDirectory = dirname(fileURLToPath(import.meta.url))
const persistence = createRedisPersistence({ url: process.env.REDIS_URL, namespace: process.env.REDIS_NAMESPACE })

try {
  await persistence.connect()
  const result = await migrateLegacyJsonData({
    persistence,
    profilesPath: join(backendDirectory, 'data', 'profiles'),
    controlProfilePath: join(backendDirectory, 'data', 'control-profile.json'),
    pokemonHubProfilesPath: join(backendDirectory, 'data', 'pokemon-hub-profiles'),
    pokemonHubPath: join(backendDirectory, 'data', 'pokemon-hub'),
    romRegistryPath: join(backendDirectory, 'data', 'rom-registry.json'),
  })
  console.log(result.migrated ? `Imported ${result.imported} legacy Redis documents.` : 'Legacy Redis import was already completed.')
} finally {
  await persistence.close()
}
