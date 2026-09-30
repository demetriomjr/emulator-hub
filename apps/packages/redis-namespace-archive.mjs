import { createHash } from 'node:crypto'

const digest = value => createHash('sha256').update(value).digest('hex')
const readLua = `local value=redis.call('DUMP',KEYS[1]); if not value then return false end; return {value,redis.call('TYPE',KEYS[1]).ok,redis.call('PTTL',KEYS[1])}`
const namespacePattern = /^[a-zA-Z0-9][a-zA-Z0-9:_-]*$/
async function namespaceKeys(client, namespace) {
 if (!namespacePattern.test(namespace)) throw new Error('Invalid namespace')
 const prefix = namespace + ':'
 const found = new Set()
 let cursor = '0'
 do {
  const batch = await client.scan(cursor, {MATCH: prefix + '*', COUNT: 1000})
  cursor = String(batch.cursor)
  for (const entry of batch.keys) {
   const key = String(entry)
   if (!key.startsWith(prefix)) throw new Error('Redis scan escaped the requested namespace')
   found.add(key)
  }
 } while (cursor !== '0')
 return [...found].sort()
}
export async function captureRedisNamespace(client, namespace) {
 const keys = await namespaceKeys(client, namespace)
 const records = []
 for (let offset=0; offset<keys.length; offset+=100) {
  const batch = await Promise.all(keys.slice(offset,offset+100).map(async key => {
   const result = await client.eval(readLua, { keys:[key], arguments:[] })
   if (!result) return null
   const [dump,type,ttlMs] = result
   if (!Buffer.isBuffer(dump)) throw new Error('Binary Redis response mapping is required for a lossless archive')
   return {key:key.slice(namespace.length+1),type:String(type),ttlMs,dumpBase64:dump.toString('base64')}
  }))
  records.push(...batch.filter(Boolean))
 }
 const checksum = digest(JSON.stringify(records))
 const contentFingerprint = digest(JSON.stringify(records.map(({ttlMs,...record}) => record)))
 return {schemaVersion:1,namespace,capturedAt:new Date().toISOString(),checksum,contentFingerprint,records}
}
export function validateRedisNamespaceArchive(archive) {
 if (archive?.schemaVersion !== 1 || !Array.isArray(archive.records) || digest(JSON.stringify(archive.records)) !== archive.checksum) throw new Error('Archive checksum failed')
 const seen = new Set()
 for (const record of archive.records) {
  if (typeof record.key !== 'string' || !record.key || seen.has(record.key) || !Number.isInteger(record.ttlMs) || record.ttlMs < -1 || typeof record.dumpBase64 !== 'string' || !record.dumpBase64) throw new Error('Invalid archive record')
  seen.add(record.key)
 }
 return archive
}
export async function restoreDevelopmentNamespace(client, archive, targetNamespace) {
 if (targetNamespace !== 'emulator-hub:dev') throw new Error('Restore is restricted to the development namespace emulator-hub:dev')
 validateRedisNamespaceArchive(archive)
 const oldKeys = await namespaceKeys(client, targetNamespace)
 for(let offset=0; offset<oldKeys.length; offset+=100) await client.del(oldKeys.slice(offset,offset+100))
 for(let offset=0; offset<archive.records.length; offset+=100) {
  await Promise.all(archive.records.slice(offset,offset+100).map(record => client.restore(targetNamespace+':'+record.key,record.ttlMs < 0 ? 0 : Math.max(1,record.ttlMs),Buffer.from(record.dumpBase64,'base64'))))
 }
 return {removed:oldKeys.length,restored:archive.records.length}
}
