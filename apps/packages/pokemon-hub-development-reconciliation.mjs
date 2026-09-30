import {createHash} from 'node:crypto'
import {compareAndWriteJson} from './redis-json-transaction.mjs'
const order=value=>Array.isArray(value)?value.map(order):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,order(value[key])])):value
const same=(a,b)=>JSON.stringify(order(a))===JSON.stringify(order(b))
function matchesNativeBytes(representation,slot) {
 if(representation.sha256!==slot.fullSha256||typeof representation.bytesBase64!=='string')return false
 const bytes=Buffer.from(representation.bytesBase64,'base64')
 return bytes.length===(slot.location.area==='party'?100:80)
  && bytes.toString('base64')===representation.bytesBase64
  && createHash('sha256').update(bytes).digest('hex')===slot.fullSha256
}

// An explicit development rehearsal step. Never infer an owner or select a
// greater logical revision from unrelated legacy partitions.
export function planDevelopmentReconciliation({rows,nativeSources,now=Date.now()}) {
 const documents=new Map(rows.map(row=>[row.key,JSON.parse(row.raw)]))
 const groups=new Map(),blockers=[],archive=[],selectedSources=[]
 for(const row of rows) {
  if(!/^pokemon-hub:v[23]:\{ph:[^}]+\}:/.test(row.key))continue
  const doc=documents.get(row.key)
  if(/\}:(session|lease):/.test(row.key)) {
   if(!Number.isFinite(doc.expiresAt)||doc.expiresAt>now)blockers.push({code:'LIVE_LEGACY_RESERVATION',key:row.key})
   else archive.push({...row,reason:'expired-session-or-lease'})
  }
  if(/\}:source:/.test(row.key)&&doc.sourceKey?.startsWith('save:')) {
   if(doc.needsSaveFlush)blockers.push({code:'UNPUBLISHED_SAVE',key:row.key})
   const group=groups.get(doc.sourceKey)??[];group.push(row);groups.set(doc.sourceKey,group)
  }
 }
 for(const [sourceKey,candidates]of groups) {
  const native=nativeSources.find(source=>source.sourceKey===sourceKey)
  if(!native){blockers.push({code:'NATIVE_SOURCE_UNAVAILABLE',sourceKey});continue}
  const matches=candidates.filter(row=>{
   const doc=documents.get(row.key),prefix=row.key.slice(0,row.key.indexOf(':source:'))
   if(doc.saveRevision!==native.revision||doc.needsSaveFlush)return false
   const placements=doc.placements.filter(p=>p.pokemonInstanceId)
   const ids=new Set(placements.map(p=>p.pokemonInstanceId))
   if(ids.size!==placements.length||placements.length!==native.slots.length)return false
   const covered=new Set()
   for(const placement of placements) {
    const index=native.slots.findIndex(slot=>same(slot.location,placement.location))
    const record=documents.get(prefix+':record:'+placement.pokemonInstanceId)
    if(index<0||covered.has(index)||!record?.representations?.some(r=>matchesNativeBytes(r,native.slots[index])))return false
    covered.add(index)
   }
   return true
  })
  if(matches.length!==1){blockers.push({code:matches.length?'NATIVE_MATCH_AMBIGUOUS':'NATIVE_MATCH_MISSING',sourceKey,matches:matches.map(row=>row.key)});continue}
  selectedSources.push({sourceKey,key:matches[0].key,saveRevision:native.revision})
  archive.push(...candidates.filter(row=>row!==matches[0]).map(row=>({...row,reason:'superseded-native-copy'})))
 }
 const checks=rows.filter(row=>/^pokemon-hub:v[23]:\{ph:[^}]+\}:(source|record|session|lease):/.test(row.key))
 const fingerprint=createHash('sha256').update(JSON.stringify({checks,nativeSources})).digest('hex')
 return {fingerprint,blockers,archive,selectedSources,checks}
}
export async function applyDevelopmentReconciliation({persistence,namespace,plan}) {
 if(namespace!=='emulator-hub:dev')throw new Error('Reconciliation is restricted to development')
 if(plan.blockers.length)throw new Error('Resolve development reconciliation blockers first')
 const writes=[],checks=plan.checks.map(({key,raw})=>({key,raw}))
 for(const row of plan.archive) {
  const archivedKey='pokemon-hub:migration-archive:'+plan.fingerprint+':'+encodeURIComponent(row.key)
  checks.push({key:archivedKey,absent:true})
  writes.push({key:archivedKey,value:row.raw},{key:row.key,value:null})
 }
 if(!await compareAndWriteJson(persistence,{checks,writes}))throw new Error('Development data changed since reconciliation inspection')
 return {archivedKeys:plan.archive.length,selectedSources:plan.selectedSources.length,fingerprint:plan.fingerprint}
}
