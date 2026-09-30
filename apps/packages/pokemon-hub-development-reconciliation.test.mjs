import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {planDevelopmentReconciliation} from './pokemon-hub-development-reconciliation.mjs'
const sourceKey='save:may:emerald',location={kind:'game',area:'box',box:0,slot:0}
const nativeBytes=Buffer.alloc(80,1),oldBytes=Buffer.alloc(80,2)
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const representation=bytes=>({kind:'pc-record',sha256:hash(bytes),bytesBase64:bytes.toString('base64')})
const row=(key,document)=>({key,raw:JSON.stringify(document)})
function fixture(){return [
 row('pokemon-hub:v2:{ph:a}:source:save',{sourceKey,saveRevision:1,needsSaveFlush:false,placements:[{location,pokemonInstanceId:'old'}]}),
 row('pokemon-hub:v2:{ph:b}:source:save',{sourceKey,saveRevision:2,needsSaveFlush:false,placements:[{location,pokemonInstanceId:'current'}]}),
 row('pokemon-hub:v2:{ph:a}:record:old',{pokemonInstanceId:'old',representations:[representation(oldBytes)]}),
 row('pokemon-hub:v2:{ph:b}:record:current',{pokemonInstanceId:'current',representations:[representation(nativeBytes)]}),
 row('pokemon-hub:v2:{ph:a}:session:old',{expiresAt:1}),
]}
const nativeSources=[{sourceKey,revision:2,slots:[{location,fullSha256:hash(nativeBytes)}]}]
test('selects only an exact native revision and payload match; archives stale sources and expired sessions',()=>{
 const plan=planDevelopmentReconciliation({rows:fixture(),nativeSources,now:100})
 assert.deepEqual(plan.blockers,[])
 assert.equal(plan.selectedSources[0].key,'pokemon-hub:v2:{ph:b}:source:save')
 assert.equal(plan.archive.length,2)
 assert.ok(plan.archive.every(r=>!r.key.includes(':record:')))
})
test('refuses ambiguous copies, dirty sources and active reservations instead of choosing by owner',()=>{
 const rows=fixture()
 rows.push(row('pokemon-hub:v2:{ph:c}:source:save',{sourceKey,saveRevision:2,needsSaveFlush:false,placements:[{location,pokemonInstanceId:'other'}]}))
 rows.push(row('pokemon-hub:v2:{ph:c}:record:other',{pokemonInstanceId:'other',representations:[representation(nativeBytes)]}))
 rows.push(row('pokemon-hub:v2:{ph:c}:lease:save',{expiresAt:200}))
 const result=planDevelopmentReconciliation({rows,nativeSources,now:100})
 assert.ok(result.blockers.some(b=>b.code==='NATIVE_MATCH_AMBIGUOUS'))
 assert.ok(result.blockers.some(b=>b.code==='LIVE_LEGACY_RESERVATION'))
 const dirty=fixture();dirty[0]=row(dirty[0].key,{sourceKey,needsSaveFlush:true,placements:[]})
 assert.ok(planDevelopmentReconciliation({rows:dirty,nativeSources,now:100}).blockers.some(b=>b.code==='UNPUBLISHED_SAVE'))
})
test('stored hashes cannot conceal corrupted or absent Pokémon payloads',()=>{
 for(const bytesBase64 of [undefined,oldBytes.toString('base64'),'!invalid!']) {
  const rows=fixture()
  rows[3]=row(rows[3].key,{pokemonInstanceId:'current',representations:[{...representation(nativeBytes),bytesBase64}]})
  const plan=planDevelopmentReconciliation({rows,nativeSources,now:100})
  assert.ok(plan.blockers.some(b=>b.code==='NATIVE_MATCH_MISSING'))
 }
})
