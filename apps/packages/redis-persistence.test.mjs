import assert from 'node:assert/strict'
import test from 'node:test'

import { createRedisPersistence } from './redis-persistence.mjs'

test('uses direct Redis set operations for workspace lease indexes', async () => {
  const calls = []
  const client = {
    isOpen: false,
    on() {},
    async connect() { this.isOpen = true },
    async quit() { this.isOpen = false },
    async sAdd(key, member) { calls.push(['sAdd', key, member]); return 1 },
    async sRem(key, member) { calls.push(['sRem', key, member]); return 1 },
    async sMembers(key) { calls.push(['sMembers', key]); return ['save:a', 'save:b'] },
  }
  const persistence = createRedisPersistence({ url: 'redis://example.test:6379', namespace: 'test-namespace', client })

  await persistence.addToSet('pokemon-hub:snapshot-workspace-lease:profile:workspace', 'save:a')
  await persistence.removeFromSet('pokemon-hub:snapshot-workspace-lease:profile:workspace', 'save:b')
  const members = await persistence.members('pokemon-hub:snapshot-workspace-lease:profile:workspace')

  assert.deepEqual(members, ['save:a', 'save:b'])
  assert.deepEqual(calls, [
    ['sAdd', 'test-namespace:pokemon-hub:snapshot-workspace-lease:profile:workspace', 'save:a'],
    ['sRem', 'test-namespace:pokemon-hub:snapshot-workspace-lease:profile:workspace', 'save:b'],
    ['sMembers', 'test-namespace:pokemon-hub:snapshot-workspace-lease:profile:workspace'],
  ])
})

test('uses Redis sorted-set operations for expired lease observation', async () => {
  const calls = []
  const client = {
    isOpen: false,
    on() {},
    async connect() { this.isOpen = true },
    async quit() { this.isOpen = false },
    async zAdd(key, entry) { calls.push(['zAdd', key, entry]); return 1 },
    async zRem(key, member) { calls.push(['zRem', key, member]); return 1 },
    async zRangeByScore(key, minimum, maximum) { calls.push(['zRangeByScore', key, minimum, maximum]); return ['["profile-may","save:emerald"]'] },
  }
  const persistence = createRedisPersistence({ url: 'redis://example.test:6379', namespace: 'test-namespace', client })

  await persistence.addToSortedSet('pokemon-hub:snapshot-expiring-lease', '["profile-may","save:emerald"]', 123)
  await persistence.removeFromSortedSet('pokemon-hub:snapshot-expiring-lease', '["profile-may","save:emerald"]')
  const members = await persistence.rangeByScore('pokemon-hub:snapshot-expiring-lease', 0, 123)

  assert.deepEqual(members, ['["profile-may","save:emerald"]'])
  assert.deepEqual(calls, [
    ['zAdd', 'test-namespace:pokemon-hub:snapshot-expiring-lease', { score: 123, value: '["profile-may","save:emerald"]' }],
    ['zRem', 'test-namespace:pokemon-hub:snapshot-expiring-lease', '["profile-may","save:emerald"]'],
    ['zRangeByScore', 'test-namespace:pokemon-hub:snapshot-expiring-lease', 0, 123],
  ])
})

test('flattens batched Redis scan results into namespaced persistence keys', async () => {
  const client = {
    isOpen: false,
    on() {},
    async connect() { this.isOpen = true },
    async quit() { this.isOpen = false },
    async *scanIterator() {
      yield [
        'test-namespace:pokemon-hub:snapshot-lease:profile-a:save-a',
        'test-namespace:pokemon-hub:snapshot-lease:profile-b:save-b',
      ]
    },
  }
  const persistence = createRedisPersistence({ url: 'redis://example.test:6379', namespace: 'test-namespace', client })

  const keys = await persistence.keys('pokemon-hub:snapshot-lease:')

  assert.deepEqual(keys, [
    'pokemon-hub:snapshot-lease:profile-a:save-a',
    'pokemon-hub:snapshot-lease:profile-b:save-b',
  ])
})
