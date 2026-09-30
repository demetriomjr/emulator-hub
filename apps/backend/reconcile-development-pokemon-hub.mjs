import {readFile,writeFile} from 'node:fs/promises'
import {dirname,join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import {createClient} from 'redis'
import {createRedisPersistence} from '../packages/redis-persistence.mjs'
import {createSaveStore} from '../packages/save-store.mjs'
import {pokemonGen3Adapter} from '../packages/pokemon-gen3-adapter.mjs'
import {getPokemonSaveMetadataForTitle,getPokemonSaveLayout} from '../packages/pokemon-save-layouts.mjs'
import {manifestDevelopmentFiles} from '../packages/development-data-rehearsal.mjs'
import {planDevelopmentReconciliation,applyDevelopmentReconciliation} from '../packages/pokemon-hub-development-reconciliation.mjs'
const args=process.argv.slice(2),at=args.indexOf('--baseline')
if(process.env.REDIS_NAMESPACE!=='emulator-hub:dev'||at<0)throw new Error('Requires development namespace and --baseline directory')
const baseline=resolve(args[at+1]),backend=dirname(fileURLToPath(import.meta.url))
const manifest=JSON.parse(await readFile(join(baseline,'production-files-manifest.json'),'utf8'))
if(JSON.stringify(await manifestDevelopmentFiles(join(backend,'data')))!==JSON.stringify(manifest))throw new Error('Development files differ from the production baseline')
const persistence=createRedisPersistence({url:process.env.REDIS_URL,namespace:'emulator-hub:dev',createClient})
try {
 const keys=(await persistence.keys('pokemon-hub:')).filter(key=>/^pokemon-hub:v[23]:\{ph:[^}]+\}:(source|record|session|lease):/.test(key)).sort(),rows=[]
 for(let offset=0;offset<keys.length;offset+=100)rows.push(...await Promise.all(keys.slice(offset,offset+100).map(async key=>({key,raw:await persistence.get(key)}))))
 if(rows.some(row=>row.raw===null))throw new Error('Development data changed during inspection')
 const registry=JSON.parse(await persistence.get('rom-registry')).entries
 const saves=await createSaveStore({dataPath:join(backend,'data','saves')}).listAll({includeInternal:true})
 const nativeSources=[],unreadable=[]
 for(const save of saves) {
  if(save.gameId.startsWith('.hub-items-'))continue
  const entry=registry.find(game=>game.id===save.gameId),metadata=entry&&getPokemonSaveMetadataForTitle(entry.title)
  if(!metadata){unreadable.push({profileId:save.profileId,gameId:save.gameId,reason:'unsupported-title'});continue}
  const layout=getPokemonSaveLayout(metadata.layoutProfile,metadata.adapter,metadata.title)
  try {
   const slots=pokemonGen3Adapter.readAllSlots(save.bytes,layout).filter(slot=>slot.record).map(slot=>({location:slot.location,fullSha256:createHash('sha256').update(slot.record.representation.bytes).digest('hex')}))
   nativeSources.push({sourceKey:`save:${save.profileId}:${save.gameId}`,revision:save.revision,sha256:save.sha256,slots})
  }catch(error){unreadable.push({profileId:save.profileId,gameId:save.gameId,reason:error.message})}
 }
 const plan=planDevelopmentReconciliation({rows,nativeSources})
 const report=join(baseline,'development-reconciliation-'+Date.now()+'.json')
 await writeFile(report,JSON.stringify({...plan,unreadable},null,2),{flag:'wx'})
 console.log(JSON.stringify({report,selectedSources:plan.selectedSources,archived:plan.archive.length,blockers:plan.blockers,unreadable},null,2))
 if(args.includes('--apply')) {
  if(!args.includes('--writers-stopped'))throw new Error('Apply requires stopped development writers')
  if(JSON.stringify(await manifestDevelopmentFiles(join(backend,'data')))!==JSON.stringify(manifest))throw new Error('Native files changed during inspection')
  console.log(JSON.stringify(await applyDevelopmentReconciliation({persistence,namespace:'emulator-hub:dev',plan})))
 }
}finally{await persistence.close()}
