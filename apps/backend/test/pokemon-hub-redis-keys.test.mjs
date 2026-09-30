import assert from 'node:assert/strict'
import test from 'node:test'
import clusterKeySlot from 'cluster-key-slot'
import { pokemonHubRedisKeys as keys } from '../../packages/pokemon-hub-redis-keys.mjs'

test('independent sources and session transaction keys share an atomic Redis Cluster slot', () => {
  const values = [keys.source('hub:one'), keys.source('save:two:emerald'), keys.record('pokemon'),
    keys.lease('hub:one'), keys.workspaceLease('session'), keys.session('session'),
    keys.sessionOperation('session', 'op'), keys.sessionTerminal('session', 'close'),
    keys.sessionHistory('session'), keys.snapshotSync('session', 'op'), keys.event('pokemon', 'event')]
  assert.equal(new Set(values.map(clusterKeySlot)).size, 1)
  assert.equal(new Set(values).size, values.length)
})

test('key components cannot collide or introduce another hash tag', () => {
  assert.notEqual(keys.source('save:a:b'), keys.source('save:a%3Ab'))
  assert.notEqual(keys.sessionTerminal('one', 'same'), keys.sessionTerminal('two', 'same'))
  assert.equal(clusterKeySlot(keys.source('{other}')), clusterKeySlot(keys.source('hub:one')))
  assert.throws(() => keys.session(''), /required/)
  assert.throws(() => keys.source(''), /required/)
  assert.throws(() => keys.sessionOperation('session', ''), /required/)
})
