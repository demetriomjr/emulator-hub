import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPokemonHubSessionBackups } from './pokemon-hub-session-backups.mjs'

test('keeps the first original for every source across close, reopen and more than three profiles', async () => {
 const directory = await mkdtemp(join(tmpdir(), 'hub-originals-'))
 try {
  let current = { bytesBase64: 'original', revision: 1 }
  const backups = createPokemonHubSessionBackups({ directory, now: () => 1000 })
  for (const sourceKey of ['hub:one', 'save:a:emerald', 'save:b:sapphire', 'hub:two', 'save:c:ruby']) {
   await backups.capture({ sessionId: 'morning', sourceKey, readOriginal: async () => current })
  }
  current = { bytesBase64: 'changed', revision: 2 }
  const restarted = createPokemonHubSessionBackups({ directory })
  const original = await restarted.capture({ sessionId: 'morning', sourceKey: 'hub:one', readOriginal: async () => { throw new Error('must not recapture') } })
  assert.equal(original.original.bytesBase64, 'original')
  assert.equal((await restarted.list('morning')).length, 5)
  const next = await restarted.capture({ sessionId: 'afternoon', sourceKey: 'hub:one', readOriginal: async () => current })
  assert.equal(next.original.bytesBase64, 'changed')
 } finally { await rm(directory, { recursive: true, force: true }) }
})

test('a failed capture leaves no published backup and can be retried', async () => {
 const directory = await mkdtemp(join(tmpdir(), 'hub-originals-'))
 try {
  const backups = createPokemonHubSessionBackups({ directory })
  await assert.rejects(backups.capture({ sessionId: 'session', sourceKey: 'hub:one', readOriginal: async () => { throw new Error('read failure') } }), /read failure/)
  assert.deepEqual(await backups.list('session'), [])
  const results = await Promise.all([1, 2].map(revision => backups.capture({ sessionId: 'session', sourceKey: 'hub:one', readOriginal: async () => ({ revision }) })))
  assert.deepEqual(results[0], results[1])
  assert.equal((await backups.list('session')).length, 1)
 } finally { await rm(directory, { recursive: true, force: true }) }
})
