import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { createClient } from 'redis'
import { createRedisPersistence } from '../../packages/redis-persistence.mjs'
import { createPokemonHubSnapshotCoordinator } from '../../packages/pokemon-hub-snapshot-coordinator.mjs'
import { createPokemonHubSessionService } from '../../packages/pokemon-hub-session-service.mjs'
import { createPokemonHubEventStore } from '../../packages/pokemon-hub-event-store.mjs'
import { pokemonHubRedisKeys } from '../../packages/pokemon-hub-redis-keys.mjs'
import { createGameSaveLeaseCoordinator } from '../../packages/game-save-lease-coordinator.mjs'

test('real Redis executes independent leases, atomic movements and durable session publication', { skip: process.env.POKEMON_HUB_LIVE_REDIS !== '1' }, async () => {
 const base = process.env.REDIS_NAMESPACE
 assert.match(base ?? '', /:dev$/)
 const namespace = base + ':test:pokemon-hub:' + randomUUID()
 const persistence = createRedisPersistence({ url: process.env.REDIS_URL, namespace, createClient: options => createClient({ ...options, socket: { connectTimeout: 5000, reconnectStrategy: false } }) })
 try {
  await persistence.connect()
  const physical=createGameSaveLeaseCoordinator({persistence})
  const coordinator = createPokemonHubSnapshotCoordinator({ persistence, eventStore: createPokemonHubEventStore({ persistence }), gameSaveLeases:physical })
  const reserved=await coordinator.reserveSource({sourceKey:'save:real:emerald',workspaceId:'reserve'})
  assert.equal((await physical.get({profileId:'real',gameId:'emerald'})).workspaceId,'reserve')
  await coordinator.release(reserved)
  assert.equal(await physical.get({profileId:'real',gameId:'emerald'}),null)
  const source = await coordinator.adopt({ sourceKey: 'hub:a', sourceRevision: 1, adapter: 'hub-grid-v1', slots: [
   { location: {kind:'hub',hubProfileId:'a',slot:0}, record: {representation:{adapter:'gen3-gba-v1',kind:'pc-record',bytes:Buffer.alloc(80,1)},display:{species:25}} },
  ] })
  await coordinator.ensureHubSource({ sourceKey:'hub:b',hubProfileId:'b',minimumSlotCount:2 })
  const concurrent = await Promise.allSettled(['left','right'].map(workspaceId => coordinator.acquire({sourceKey:'hub:b',workspaceId})))
  assert.equal(concurrent.filter(result => result.status==='fulfilled').length,1)
  const index=concurrent.findIndex(result=>result.status==='fulfilled'), lease=concurrent[index].value
  const identity={sourceKey:'hub:b',workspaceId:['left','right'][index],sourceSessionId:lease.sourceSessionId,leaseToken:lease.leaseToken}
  await coordinator.renew(identity)
  await coordinator.release(identity)
  const sessions=createPokemonHubSessionService({persistence,coordinator})
  const opened=await sessions.open({sessionId:'opening'})
  let failRelease=false
  const lifecycle={acquireSource:sourceKey=>coordinator.acquire({sourceKey,workspaceId:opened.sessionId}),flushOutgoingSource:async()=>{},releaseSource:source=>{
   if(failRelease && source.sourceKey==='hub:c') throw new Error('release interrupted')
   return coordinator.release({...source,workspaceId:opened.sessionId})
  }}
  await sessions.loadCanonicalPane({sessionId:opened.sessionId,pane:0,sourceKey:'hub:a',profile:{type:'hub-profile',hubProfileId:'a'},...lifecycle})
  await sessions.loadCanonicalPane({sessionId:opened.sessionId,pane:1,sourceKey:'hub:b',profile:{type:'hub-profile',hubProfileId:'b'},...lifecycle})
  await coordinator.ensureHubSource({sourceKey:'hub:c',hubProfileId:'c',minimumSlotCount:1})
  await sessions.loadCanonicalPane({sessionId:opened.sessionId,pane:2,sourceKey:'hub:c',profile:{type:'hub-profile',hubProfileId:'c'},...lifecycle})
  const snapshot=await sessions.getCanonicalSnapshot({sessionId:opened.sessionId})
  snapshot.panes[1].hub=[{slot:0,pokemonInstanceId:source.placements[0].pokemonInstanceId}]
  snapshot.panes[0].hub=[]
  snapshot.panes[2]=null
  failRelease=true
  await assert.rejects(sessions.syncCanonicalSnapshot({sessionId:opened.sessionId,snapshot,idempotencyKey:'move',...lifecycle}),/release interrupted/)
  assert.equal(JSON.parse(await persistence.get(pokemonHubRedisKeys.session(opened.sessionId))).state,'publishing')
  failRelease=false
  assert.equal((await sessions.syncCanonicalSnapshot({sessionId:opened.sessionId,snapshot,idempotencyKey:'move',...lifecycle})).status,'accepted')
  assert.equal((await coordinator.getSnapshot({sourceKey:'hub:a'})).placements[0].pokemonInstanceId,null)
  assert.equal((await coordinator.getSnapshot({sourceKey:'hub:b'})).placements[0].pokemonInstanceId,source.placements[0].pokemonInstanceId)
  const final=await sessions.getCanonicalSnapshot({sessionId:opened.sessionId})
  assert.equal((await sessions.closeCanonicalSession({sessionId:opened.sessionId,snapshot:final,idempotencyKey:'close',...lifecycle})).status,'complete')
  assert.equal((await sessions.listHistory())[0].closedAt !== null,true)
 } finally {
  for(const key of await persistence.keys('')) await persistence.delete(key)
  await persistence.close()
 }
})
