import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('frontend lifecycle synchronizes local Pokemon resources before development starts', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../frontend/package.json', import.meta.url), 'utf8'))

  assert.equal(packageJson.scripts.predev, 'node scripts/sync-pokemon-resources.mjs --background && node scripts/sync-pokemon-card-icons.mjs')
  assert.equal(packageJson.scripts.prebuild, 'node scripts/sync-pokemon-resources.mjs --optional && node scripts/sync-pokemon-card-icons.mjs && npm run lint')
  assert.equal(packageJson.scripts['sync:pokemon-resources'], 'node scripts/sync-pokemon-resources.mjs --refresh')
  assert.equal(packageJson.scripts['sync:pokemon-resources:force'], 'node scripts/sync-pokemon-resources.mjs --force')
  assert.equal(packageJson.scripts['sync:pokemon-sprite-resolution'], 'node scripts/sync-pokemon-resources.mjs')
  assert.equal(packageJson.scripts['sync:pokemon-card-icons'], 'node scripts/sync-pokemon-card-icons.mjs --refresh')
})
