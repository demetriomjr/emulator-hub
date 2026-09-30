import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from 'redis'
import { createRedisPersistence } from '../packages/redis-persistence.mjs'
import { createSaveStore } from '../packages/save-store.mjs'
import { inspectPokemonHubMigration, applyPokemonHubMigration } from '../packages/pokemon-hub-source-migration.mjs'

const args = process.argv.slice(2)
const option = name => { const at = args.indexOf(name); return at < 0 ? null : args[at + 1] }
const backendDirectory = dirname(fileURLToPath(import.meta.url))
if (!process.env.REDIS_NAMESPACE) throw new Error('Set an explicit Redis namespace before inspecting migration.')
const persistence = createRedisPersistence({ url: process.env.REDIS_URL, namespace: process.env.REDIS_NAMESPACE, createClient })
const saveStore = createSaveStore({ dataPath: resolve(option('--saves') ?? join(backendDirectory, 'data', 'saves')) })
try {
 const plan = await inspectPokemonHubMigration({ persistence, saveStore })
 console.log(JSON.stringify({ namespace: process.env.REDIS_NAMESPACE, fingerprint: plan.fingerprint, blockers: plan.blockers, proposedKeys: plan.writes.length, itemLedgers: plan.archive.fileCopies.length }, null, 2))
 if (args.includes('--apply')) {
  if (!option('--archive') || !option('--fingerprint') || !args.includes('--writers-stopped')) throw new Error('Apply requires --archive, --fingerprint and --writers-stopped after stopping every writer.')
  console.log(JSON.stringify(await applyPokemonHubMigration({ persistence, saveStore, archivePath: resolve(option('--archive')), expectedFingerprint: option('--fingerprint'), maintenanceMode: true })))
 }
} finally { await persistence.close() }
