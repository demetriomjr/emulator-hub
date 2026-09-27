import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
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
  return { schemaVersion: 2, id: 'macro-1', name: 'Dash Combo', items: [{ id: 'item-1', kind: 'button', input: 'up', action: 'press', count: 1, delayAfterMs: 0 }], createdAt: 1780000000000, updatedAt: 1780000000000 }
}

function sampleLegacyMacro() {
  return {
    id: 'macro-1',
    name: 'Dash Combo',
    steps: [{ id: 'step-1', input: 'up', action: 'press', delay: 0 }],
    createdAt: 1780000000000,
    updatedAt: 1780000000000,
  }
}

function sampleV2Macro() {
  return { schemaVersion: 2, id: 'macro-2', name: 'Novo', items: [{ id: 'item-1', kind: 'delay', durationMs: 1200 }], createdAt: 1780000000000, updatedAt: 1780000000000 }
}

test('JSON store reads mixed versions and preserves legacy records when saving v2', async () => {
  const dataPath = await macroPath()
  await mkdir(join(dataPath, '..'), { recursive: true })
  await writeFile(dataPath, JSON.stringify([sampleLegacyMacro()]))
  const store = createInputMacroStore({ dataPath })
  assert.deepEqual(await store.list(), [sampleLegacyMacro()])
  const saved = await store.save(sampleV2Macro())
  assert.equal(saved.schemaVersion, 2)
  assert.deepEqual((await store.list()).map(macro => macro.id), ['macro-1', 'macro-2'])
})

test('one malformed stored record does not hide or discard valid macros', async () => {
  const dataPath = await macroPath()
  await mkdir(join(dataPath, '..'), { recursive: true })
  await writeFile(dataPath, JSON.stringify([null, sampleLegacyMacro()]))
  const store = createInputMacroStore({ dataPath })
  assert.deepEqual(await store.list(), [sampleLegacyMacro()])
  await store.save(sampleV2Macro())
  assert.deepEqual((await store.list()).map(macro => macro.id), ['macro-1', 'macro-2'])
})

test('create fills absent identity but rejects a malformed supplied identity', async () => {
  const store = createInputMacroStore({ dataPath: await macroPath() })
  const { id: unused, ...withoutId } = sampleV2Macro()
  const created = await store.save(withoutId)
  assert.ok(created.id)
  await assert.rejects(() => store.save({ ...sampleV2Macro(), id: 42 }), { code: 'INPUT_MACRO_INVALID' })
  await assert.rejects(() => store.save({ ...sampleV2Macro(), id: null }), { code: 'INPUT_MACRO_INVALID' })
  await assert.rejects(() => store.save({ ...sampleV2Macro(), createdAt: 'yesterday' }), { code: 'INPUT_MACRO_INVALID' })
})

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

test('Redis store reads old and new macros in the same collection', async () => {
  const persistence = createMemoryRedisPersistence()
  await persistence.set('input-macros', JSON.stringify([sampleLegacyMacro()]))
  const store = createRedisInputMacroStore({ persistence })
  await store.save(sampleV2Macro())
  assert.deepEqual((await store.list()).map(macro => macro.id), ['macro-1', 'macro-2'])
  assert.equal((await store.list())[0].steps[0].action, 'press')
})
