import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'

import { createRomRegistry } from './rom-registry.mjs'

const roots = new Set()

afterEach(async () => {
  await Promise.all([...roots].map(root => rm(root, { recursive: true, force: true })))
  roots.clear()
})

async function createRegistryPath() {
  const root = await mkdtemp(join(tmpdir(), 'emulator-hub-rom-registry-'))
  roots.add(root)
  return join(root, 'data', 'rom-registry.json')
}

function registration(overrides = {}) {
  return {
    schemaVersion: 1,
    id: 'rom-f3ae088181bf583e55daf962a92bb46f4f1d07b7',
    file: 'Pokemon - Emerald Version (USA, Europe).gba',
    system: 'gba',
    core: 'gba',
    title: 'Pokémon Emerald Version',
    sha1: 'f3ae088181bf583e55daf962a92bb46f4f1d07b7',
    md5: '605b89b67018abcea91e693a4dd25be3',
    sha256: 'a9dec84dfe7f62ab2220bafaef7479da0929d066ece16a6885f6226db19085af',
    size: 16777216,
    source: 'no-intro',
    region: 'wor',
    coverUrl: 'https://retrocollection.example/emerald.png',
    ...overrides,
  }
}

test('persists and reloads a valid ROM registration without exposing mutable state', async () => {
  const dataPath = await createRegistryPath()
  const entry = registration()
  const registry = createRomRegistry({ dataPath })

  assert.deepEqual(await registry.load(), [])
  assert.deepEqual(await registry.replace([entry]), [entry])

  const loaded = await createRomRegistry({ dataPath }).load()
  assert.deepEqual(loaded, [entry])
  loaded[0].title = 'Changed outside the store'
  assert.equal((await registry.load())[0].title, entry.title)
})

test('rejects invalid replacement and malformed persisted data without accepting it', async () => {
  const dataPath = await createRegistryPath()
  const registry = createRomRegistry({ dataPath })
  const entry = registration()
  await registry.replace([entry])

  await assert.rejects(() => registry.replace([registration({ source: 'community' })]), { code: 'ROM_REGISTRY_INVALID' })
  assert.deepEqual(await registry.load(), [entry])

  await writeFile(dataPath, '{ malformed')
  await assert.rejects(() => createRomRegistry({ dataPath }).load(), { code: 'ROM_REGISTRY_LOAD_FAILED' })
})
