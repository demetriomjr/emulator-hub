import assert from 'node:assert/strict'
import test from 'node:test'

import { createMemoryRedisPersistence } from './redis-persistence.mjs'
import { createRedisUserPreferencesStore, defaultUserPreferences } from './user-preferences-store.mjs'

test('returns defaults until initialized and merges validated partial updates', async () => {
  const store = createRedisUserPreferencesStore({ persistence: createMemoryRedisPersistence() })
  assert.deepEqual(await store.get(), { preferences: defaultUserPreferences, initialized: false })
  assert.deepEqual(await store.patch({ fastForwardSpeed: 4, initializeIfAbsent: true }), {
    preferences: { version: 1, fastForwardSpeed: 4, triggerActions: { l2: 'none', r2: 'none' } }, initialized: true,
  })
  assert.deepEqual(await store.patch({ triggerActions: { l2: 'fast-forward' } }), {
    preferences: { version: 1, fastForwardSpeed: 4, triggerActions: { l2: 'fast-forward', r2: 'none' } }, initialized: true,
  })
})

test('rejects unsupported values without changing stored preferences', async () => {
  const store = createRedisUserPreferencesStore({ persistence: createMemoryRedisPersistence() })
  await assert.rejects(() => store.patch({ triggerActions: { r2: 'cheats' } }), error => error.code === 'USER_PREFERENCES_INVALID')
  assert.deepEqual(await store.get(), { preferences: defaultUserPreferences, initialized: false })
})

test('initialization does not overwrite an existing global document', async () => {
  const store = createRedisUserPreferencesStore({ persistence: createMemoryRedisPersistence() })
  await store.patch({ fastForwardSpeed: 2, initializeIfAbsent: true })
  const result = await store.patch({ fastForwardSpeed: 5, initializeIfAbsent: true })
  assert.equal(result.preferences.fastForwardSpeed, 2)
})
