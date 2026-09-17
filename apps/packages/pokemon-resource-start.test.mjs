import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('frontend lifecycle synchronizes local Pokemon resources before development starts', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../frontend/package.json', import.meta.url), 'utf8'))

  assert.equal(packageJson.scripts.predev, 'node scripts/sync-pokemon-resources.mjs --background')
  assert.equal(packageJson.scripts['sync:pokemon-resources'], 'node scripts/sync-pokemon-resources.mjs --refresh')
})
