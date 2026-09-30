import assert from 'node:assert/strict'
import test from 'node:test'
import { createMemoryRedisPersistence } from './redis-persistence.mjs'
import { inspectPokemonHubMigration, assertPokemonHubStorageReady } from './pokemon-hub-source-migration.mjs'
import { pokemonHubRedisKeys } from './pokemon-hub-redis-keys.mjs'

test('legacy state blocks the new Hub and conflicting copies are never selected automatically', async () => {
 const persistence = createMemoryRedisPersistence()
 const source = { profileId: 'owner-a', sourceKey: 'hub:box', sourceRevision: 1, needsSaveFlush: false, placements: [] }
 await persistence.set('pokemon-hub:v2:{ph:owner-a}:source:hub%3Abox', JSON.stringify(source))
 await assert.rejects(assertPokemonHubStorageReady(persistence), { code: 'POKEMON_HUB_MIGRATION_REQUIRED' })
 const safe = await inspectPokemonHubMigration({ persistence })
 assert.deepEqual(safe.blockers, [])
 assert.equal(safe.writes.find(write => write.key === pokemonHubRedisKeys.source('hub:box')).document.profileId, undefined)
 await persistence.set('pokemon-hub:v2:{ph:owner-b}:source:hub%3Abox', JSON.stringify({ ...source, sourceRevision: 2 }))
 const conflict = await inspectPokemonHubMigration({ persistence })
 assert.ok(conflict.blockers.some(blocker => blocker.code === 'CONFLICTING_SOURCE_COPIES'))
 assert.equal(await persistence.get(pokemonHubRedisKeys.source('hub:box')), null)
})

test('dirty sources and live or expired unresolved leases block cutover', async () => {
 const persistence = createMemoryRedisPersistence()
 await persistence.set('pokemon-hub:v2:{ph:owner}:source:save%3Amay%3Aemerald', JSON.stringify({ sourceKey: 'save:may:emerald', needsSaveFlush: true, placements: [] }))
 await persistence.set('pokemon-hub:v2:{ph:owner}:lease:save%3Amay%3Aemerald', JSON.stringify({ expiresAt: 1 }))
 const result = await inspectPokemonHubMigration({ persistence })
 assert.ok(result.blockers.some(blocker => blocker.code === 'UNPUBLISHED_SAVE'))
 assert.ok(result.blockers.some(blocker => blocker.code === 'UNSETTLED_LEASE_OR_SESSION'))
})

test('offline migration archives originals, copies Hub items and preserves legacy evidence', async () => {
 const { mkdtemp, readFile, rm } = await import('node:fs/promises')
 const { tmpdir } = await import('node:os')
 const { join } = await import('node:path')
 const { createSaveStore } = await import('./save-store.mjs')
 const { hubItemLedgerGameId, encodeHubItemLedger } = await import('./pokemon-hub-item-ledger.mjs')
 const { applyPokemonHubMigration } = await import('./pokemon-hub-source-migration.mjs')
 const root=await mkdtemp(join(tmpdir(),'hub-migration-'))
 try {
  const persistence=createMemoryRedisPersistence(), saveStore=createSaveStore({dataPath:join(root,'saves')})
  const hubProfileId='11111111-1111-4111-8111-111111111111'
  const sourceKey='hub:'+hubProfileId
  const legacyKey='pokemon-hub:v2:{ph:may}:source:'+encodeURIComponent(sourceKey)
  const original=JSON.stringify({sourceKey,profileId:'may',sourceRevision:1,needsSaveFlush:true,placements:[]})
  await persistence.set(legacyKey,original)
  await persistence.set('pokemon-hub:profiles',JSON.stringify([{schemaVersion:6,hubProfileId,ownerProfileId:'may',name:'Old box',createdAt:new Date().toISOString(),grid:{entries:{}}}]))
  const gameId=hubItemLedgerGameId(hubProfileId)
  const bytes=encodeHubItemLedger({schemaVersion:1,slots:{0:{itemKey:'potion',quantity:3}}})
  await saveStore.put('may',gameId,bytes,null)
  const plan=await inspectPokemonHubMigration({persistence,saveStore})
  assert.deepEqual(plan.blockers,[])
  const archivePath=join(root,'migration-original.json')
  await assert.rejects(applyPokemonHubMigration({persistence,saveStore,archivePath,expectedFingerprint:plan.fingerprint}),{code:'MIGRATION_MAINTENANCE_REQUIRED'})
  await applyPokemonHubMigration({persistence,saveStore,archivePath,expectedFingerprint:plan.fingerprint,maintenanceMode:true})
  await assertPokemonHubStorageReady(persistence)
  assert.equal(await persistence.get(legacyKey),original)
  assert.equal(JSON.parse(await persistence.get(pokemonHubRedisKeys.source(sourceKey))).profileId,undefined)
  assert.deepEqual((await saveStore.get(hubProfileId,gameId)).bytes,bytes)
  assert.deepEqual((await saveStore.get('may',gameId)).bytes,bytes)
  const archive=JSON.parse(await readFile(archivePath,'utf8'))
  assert.equal(archive.archive.originals[0].raw,original)
  assert.equal(archive.archive.fileCopies[0].saved.bytesBase64,Buffer.from(bytes).toString('base64'))
 } finally { await rm(root,{recursive:true,force:true}) }
})

test('a catalogue write failure blocks startup and resumes from the original archive', async t => {
 const { mkdtemp, rm }=await import('node:fs/promises')
 const { tmpdir }=await import('node:os')
 const { join }=await import('node:path')
 const { applyPokemonHubMigration }=await import('./pokemon-hub-source-migration.mjs')
 const root=await mkdtemp(join(tmpdir(),'hub-migration-retry-'))
 t.after(()=>rm(root,{recursive:true,force:true}))
 const memory=createMemoryRedisPersistence()
 const saveStore={async get(){return null}}
 await memory.set('pokemon-hub:profiles',JSON.stringify([{hubProfileId:'11111111-1111-4111-8111-111111111111',ownerProfileId:'may',grid:{entries:{}}}]))
 let fail=true
 const persistence={...memory,async set(key,value,...args){if(fail && key==='pokemon-hub:profiles')throw new Error('catalogue unavailable');return memory.set(key,value,...args)}}
 const plan=await inspectPokemonHubMigration({persistence,saveStore})
 const request={persistence,saveStore,archivePath:join(root,'original.json'),expectedFingerprint:plan.fingerprint,maintenanceMode:true}
 await assert.rejects(applyPokemonHubMigration(request),/catalogue unavailable/)
 await assert.rejects(assertPokemonHubStorageReady(persistence),{code:'POKEMON_HUB_MIGRATION_REQUIRED'})
 fail=false
 await applyPokemonHubMigration(request)
 await assertPokemonHubStorageReady(persistence)
 assert.equal(JSON.parse(await memory.get('pokemon-hub:profiles'))[0].ownerProfileId,undefined)
})

