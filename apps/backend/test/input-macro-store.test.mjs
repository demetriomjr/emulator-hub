import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'

import { createInputMacroStore, createRedisInputMacroStore } from '../../packages/input-macro-store.mjs'
import { createMemoryRedisPersistence } from '../../packages/redis-persistence.mjs'

const roots = new Set()

afterEach(async () => {
  await Promise.all([...roots].map(root => rm(root, { recursive: true, force: true })))
  roots.clear()
})

async function macroPath() {
  const root = await mkdtemp(join(tmpdir(), 'emulator-hub-macros-'))
  roots.add(root)
  return join(root, 'data', 'input-macros.json')
}

function sampleMacro() {
  return {
    id: 'macro-1',
    name: 'Dash Combo',
    steps: [{ id: 'step-1', input: 'up', action: 'press', delay: 0 }],
    createdAt: 1780000000000,
    updatedAt: 1780000000000,
  }
}

test('stores, lists and deletes input macros on the JSON file store', async () => {
  const store = createInputMacroStore({ dataPath: await macroPath() })
  assert.deepEqual(await store.list(), [])

  const saved = await store.save(sampleMacro())
  assert.equal(saved.id, 'macro-1')
  assert.equal(saved.createdAt, 1780000000000)
  assert.deepEqual(await store.list(), [saved])

  await assert.rejects(() => store.save({ name: 'Broken', steps: [] }), { code: 'INPUT_MACRO_INVALID' })

  assert.deepEqual(await store.delete('macro-1'), saved)
  assert.deepEqual(await store.list(), [])
  await assert.rejects(() => store.delete('macro-1'), { code: 'INPUT_MACRO_NOT_FOUND' })
})

test('persists macros across reopened JSON store instances', async () => {
  const dataPath = await macroPath()
  const saved = await createInputMacroStore({ dataPath }).save(sampleMacro())
  assert.deepEqual(await createInputMacroStore({ dataPath }).list(), [saved])
})

test('stores, lists and deletes input macros on the Redis store', async () => {
  const persistence = createMemoryRedisPersistence()
  const store = createRedisInputMacroStore({ persistence })
  assert.deepEqual(await store.list(), [])

  const saved = await store.save(sampleMacro())
  assert.equal(saved.id, 'macro-1')
  assert.deepEqual(await store.list(), [saved])

  await assert.rejects(() => store.save({ name: 'Broken', steps: [] }), { code: 'INPUT_MACRO_INVALID' })

  assert.deepEqual(await store.delete('macro-1'), saved)
  assert.deepEqual(await store.list(), [])
})