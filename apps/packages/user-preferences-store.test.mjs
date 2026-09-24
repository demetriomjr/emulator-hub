import assert from 'node:assert/strict'
import test from 'node:test'

import { createMemoryRedisPersistence } from './redis-persistence.mjs'
import { createRedisUserPreferencesStore, defaultUserPreferences } from './user-preferences-store.mjs'

test('returns defaults until initialized and merges validated partial updates', async () => {
  const store = createRedisUserPreferencesStore({ persistence: createMemoryRedisPersistence() })
  assert.deepEqual(await store.get(), { preferences: defaultUserPreferences, initialized: false })
  assert.deepEqual(await store.patch({ fastForwardSpeed: 4, initializeIfAbsent: true }), {
    preferences: { version: 1, fastForwardSpeed: 4, fastForwardEnabled: false, muted: false, triggerActions: { l2: 'none', r2: 'none' } }, initialized: true,
  })
  assert.deepEqual(await store.patch({ triggerActions: { l2: 'fast-forward' } }), {
    preferences: { version: 1, fastForwardSpeed: 4, fastForwardEnabled: false, muted: false, triggerActions: { l2: 'fast-forward', r2: 'none' } }, initialized: true,
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

test('accepts Soft Reset as a persisted trigger action', async () => {
  const store = createRedisUserPreferencesStore({ persistence: createMemoryRedisPersistence() })
  const result = await store.patch({ triggerActions: { l2: 'soft-reset' } })
  assert.equal(result.preferences.triggerActions.l2, 'soft-reset')
})

test('persists mute without changing speed or trigger actions', async () => {
  const store = createRedisUserPreferencesStore({ persistence: createMemoryRedisPersistence() })
  await store.patch({ fastForwardSpeed: 3, triggerActions: { l2: 'soft-reset' }, initializeIfAbsent: true })
  const result = await store.patch({ muted: true })
  assert.equal(result.preferences.muted, true)
  assert.equal(result.preferences.fastForwardSpeed, 3)
  assert.equal(result.preferences.triggerActions.l2, 'soft-reset')
  assert.equal((await store.get()).preferences.muted, true)
})

test('legacy preference documents default mute to false', async () => {
  const persistence = createMemoryRedisPersistence()
  await persistence.set('user-preferences', JSON.stringify({ version: 1, fastForwardSpeed: 2, fastForwardEnabled: true, triggerActions: { l2: 'none', r2: 'none' } }))
  const store = createRedisUserPreferencesStore({ persistence })
  assert.equal((await store.get()).preferences.muted, false)
  assert.equal((await store.patch({ fastForwardSpeed: 2.5 })).preferences.muted, false)
})

test('rejects non-boolean mute without changing the document', async () => {
  const store = createRedisUserPreferencesStore({ persistence: createMemoryRedisPersistence() })
  await store.patch({ muted: true, initializeIfAbsent: true })
  await assert.rejects(() => store.patch({ muted: 'true' }), error => error.code === 'USER_PREFERENCES_INVALID')
  assert.equal((await store.get()).preferences.muted, true)
})

test('first mute toggle creates the global preference document', async () => {
  const store = createRedisUserPreferencesStore({ persistence: createMemoryRedisPersistence() })
  const updated = await store.patch({ muted: true })
  assert.equal(updated.initialized, true)
  assert.equal((await store.get()).preferences.muted, true)
})
