import {createHash,randomUUID} from 'node:crypto'
import {cp,lstat,readdir,readFile,realpath,rename,writeFile} from 'node:fs/promises'
import {join,resolve,relative,isAbsolute} from 'node:path'
import {captureRedisNamespace,restoreDevelopmentNamespace,validateRedisNamespaceArchive} from './redis-namespace-archive.mjs'

export async function restoreDevelopmentBaseline({client,archive,...filesOptions}) {
 validateRedisNamespaceArchive(archive)
 const files=await restoreDevelopmentFiles(filesOptions)
 const statePath=join(filesOptions.baselineDirectory,'restore-state-'+randomUUID()+'.json')
 const state={files,phase:'files-restored',startedAt:new Date().toISOString()}
 const saveState=()=>writeFile(statePath,JSON.stringify(state,null,2))
 try {
  await saveState()
  const redis=await restoreDevelopmentNamespace(client,archive,'emulator-hub:dev')
  state.phase='redis-restored';state.redis=redis;await saveState()
  const check=await captureRedisNamespace(client,'emulator-hub:dev')
  if(check.contentFingerprint!==archive.contentFingerprint)throw new Error('Restored Redis does not match baseline')
  state.phase='verified';await saveState()
  return {files,redis,statePath,verified:true}
 }catch(error){state.error=error.message;await saveState().catch(()=>{});throw error}
}

export async function manifestDevelopmentFiles(directory) {
 const entries=[]
 async function walk(dir) {
  for(const name of (await readdir(dir)).sort()) {
   const file=join(dir,name),stat=await lstat(file)
   if(stat.isSymbolicLink())throw new Error('Symlinks are not supported by the rehearsal archive')
   if(stat.isDirectory())await walk(file)
   else if(stat.isFile())entries.push({path:relative(directory,file).replaceAll('\\','/'),size:stat.size,sha256:createHash('sha256').update(await readFile(file)).digest('hex')})
  }
 }
 await walk(directory)
 return entries
}
export async function restoreDevelopmentFiles({workspaceRoot,baselineDirectory,targetDirectory}) {
 const workspace=await realpath(workspaceRoot)
 const allowed=join(workspace,'apps','backend','data')
 if(resolve(targetDirectory)!==allowed || await realpath(targetDirectory)!==allowed)throw new Error('Invalid development files destination')
 const baseline=await realpath(baselineDirectory)
 const child=relative(join(workspace,'test-data'),baseline)
 if(!child||child.startsWith('..')||isAbsolute(child))throw new Error('Backup must stay within workspace test-data')
 const source=join(baseline,'production-data')
 if(await realpath(source)!==source)throw new Error('Backup source must not be a symlink')
 const manifest=JSON.parse(await readFile(join(baseline,'production-files-manifest.json'),'utf8'))
 if(JSON.stringify(await manifestDevelopmentFiles(source))!==JSON.stringify(manifest))throw new Error('Backup file manifest mismatch')
 const id=randomUUID(),stagedDirectory=join(baseline,'staging-'+id),retiredDirectory=join(baseline,'retired-dev-'+id)
 await cp(source,stagedDirectory,{recursive:true,force:false,errorOnExist:true})
 if(JSON.stringify(await manifestDevelopmentFiles(stagedDirectory))!==JSON.stringify(manifest))throw new Error('Staged file manifest mismatch')
 await rename(allowed,retiredDirectory)
 try {await rename(stagedDirectory,allowed)} catch(error) {await rename(retiredDirectory,allowed);throw error}
 return {targetDirectory:allowed,retiredDirectory,files:manifest.length}
}
