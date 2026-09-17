import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { migrateLegacyJsonData } from './redis-legacy-migration.mjs'
import { createMemoryRedisPersistence } from './redis-persistence.mjs'

test('imports legacy JSON once without overwriting existing Redis records', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'emulator-hub-redis-migration-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const profilesPath = join(root, 'profiles')
  await mkdir(profilesPath, { recursive: true })
  await writeFile(join(profilesPath, 'emerald.json'), JSON.stringify([{ id: '11111111-1111-4111-8111-111111111111', name: 'Legacy', createdAt: '2026-09-17T00:00:00.000Z' }]))
  const persistence = createMemoryRedisPersistence()
  await persistence.set('profiles:game:emerald', JSON.stringify([{ id: '22222222-2222-4222-8222-222222222222', name: 'Redis', createdAt: '2026-09-17T00:00:00.000Z' }]))

  const options = { persistence, profilesPath, controlProfilePath: join(root, 'control.json'), pokemonHubProfilesPath: join(root, 'hub-profiles'), pokemonHubPath: join(root, 'hub'), romRegistryPath: join(root, 'rom-registry.json') }
  assert.deepEqual(await migrateLegacyJsonData(options), { migrated: true, imported: 0 })
  assert.match(await persistence.get('profiles:game:emerald'), /Redis/)
  assert.deepEqual(await migrateLegacyJsonData(options), { migrated: false, imported: 0 })
})
