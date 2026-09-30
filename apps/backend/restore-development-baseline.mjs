import {readFile} from 'node:fs/promises'
import {dirname,join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {gunzipSync} from 'node:zlib'
import {createClient,RESP_TYPES} from 'redis'
import {validateRedisNamespaceArchive} from '../packages/redis-namespace-archive.mjs'
import {restoreDevelopmentBaseline} from '../packages/development-data-rehearsal.mjs'

const args=process.argv.slice(2)
const at=args.indexOf('--baseline'),baselineDirectory=at>=0?resolve(args[at+1]):null
if(!baselineDirectory||!args.includes('--writers-stopped')||process.env.REDIS_NAMESPACE!=='emulator-hub:dev')throw new Error('Requires --baseline <local directory>, --writers-stopped and REDIS_NAMESPACE=emulator-hub:dev')
const metadata=JSON.parse(await readFile(join(baselineDirectory,'baseline.json'),'utf8'))
if(!metadata.sourceStable||metadata.sourceNamespace!=='emulator-hub:v1')throw new Error('A verified production baseline is required')
const archive=JSON.parse(gunzipSync(await readFile(join(baselineDirectory,'production-redis.json.gz'))))
validateRedisNamespaceArchive(archive)
if(archive.contentFingerprint!==metadata.redisFingerprint)throw new Error('Baseline Redis fingerprint mismatch')
const workspaceRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../..')
const client=createClient({url:process.env.REDIS_URL,socket:{reconnectStrategy:false}}).withTypeMapping({[RESP_TYPES.BLOB_STRING]:Buffer})
client.on('error',()=>{})
try {
 await client.connect()
 console.log(JSON.stringify(await restoreDevelopmentBaseline({client,archive,workspaceRoot,baselineDirectory,targetDirectory:join(workspaceRoot,'apps','backend','data')}),null,2))
} finally {if(client.isOpen)await client.quit()}
