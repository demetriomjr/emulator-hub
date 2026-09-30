import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {manifestDevelopmentFiles,restoreDevelopmentFiles,restoreDevelopmentBaseline} from './development-data-rehearsal.mjs'
test('restores the complete development tree and retains the replaced tree',async t=>{
 const workspaceRoot=await mkdtemp(join(tmpdir(),'hub-rehearsal-'))
 t.after(()=>rm(workspaceRoot,{recursive:true,force:true}))
 const baselineDirectory=join(workspaceRoot,'test-data','baseline'),targetDirectory=join(workspaceRoot,'apps','backend','data')
 await mkdir(join(baselineDirectory,'production-data','saves'),{recursive:true})
 await mkdir(targetDirectory,{recursive:true})
 await writeFile(join(targetDirectory,'old'),'old')
 await writeFile(join(baselineDirectory,'production-data','saves','original.sav'),Buffer.from([1,2,255]))
 await writeFile(join(baselineDirectory,'production-files-manifest.json'),JSON.stringify(await manifestDevelopmentFiles(join(baselineDirectory,'production-data'))))
 const archive={schemaVersion:1,records:[],checksum:'damaged'}
 await assert.rejects(restoreDevelopmentBaseline({client:{},archive,workspaceRoot,baselineDirectory,targetDirectory}),/checksum/)
 assert.equal(await readFile(join(targetDirectory,'old'),'utf8'),'old')
 const result=await restoreDevelopmentFiles({workspaceRoot,baselineDirectory,targetDirectory})
 assert.deepEqual(await readFile(join(targetDirectory,'saves','original.sav')),Buffer.from([1,2,255]))
 assert.equal(await readFile(join(result.retiredDirectory,'old'),'utf8'),'old')
 await writeFile(join(baselineDirectory,'production-data','saves','original.sav'),'bad')
 await assert.rejects(restoreDevelopmentFiles({workspaceRoot,baselineDirectory,targetDirectory}),/manifest/)
 assert.deepEqual(await readFile(join(targetDirectory,'saves','original.sav')),Buffer.from([1,2,255]))
 await assert.rejects(restoreDevelopmentFiles({workspaceRoot,baselineDirectory,targetDirectory:workspaceRoot}),/destination/)
})
