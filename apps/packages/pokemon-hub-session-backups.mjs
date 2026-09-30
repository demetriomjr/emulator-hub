import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, open, link, unlink } from 'node:fs/promises'
import { join } from 'node:path'

// A complete file is published once. Neither retries nor another process can replace it.
export function createPokemonHubSessionBackups({ directory, now = () => Date.now() }) {
 if (typeof directory !== 'string' || !directory) throw new TypeError('Backup directory is required')
 const digest = value => {
  if (typeof value !== 'string' || !value) throw new TypeError('Backup identity is required')
  return createHash('sha256').update(value).digest('hex')
 }
 const folder = sessionId => join(directory, digest(sessionId))
 async function read(path) {
  try { return JSON.parse(await readFile(path, 'utf8')) } catch (error) { if (error.code === 'ENOENT') return null; throw error }
 }
 return {
  async capture({ sessionId, sourceKey, readOriginal }) {
   const target = join(folder(sessionId), digest(sourceKey) + '.json')
   const existing = await read(target)
   if (existing) return existing
   const original = await readOriginal()
   const document = { schemaVersion: 1, sessionId, sourceKey, capturedAt: now(), original }
   await mkdir(folder(sessionId), { recursive: true })
   const temporary = target + '.' + randomUUID() + '.tmp'
   try {
    const handle = await open(temporary, 'wx')
    try { await handle.writeFile(JSON.stringify(document)); await handle.sync() } finally { await handle.close() }
    try { await link(temporary, target) } catch (error) { if (error.code !== 'EEXIST') throw error }
    return await read(target)
   } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error }) }
  },
  async list(sessionId) {
   let files
   try { files = await readdir(folder(sessionId)) } catch (error) { if (error.code === 'ENOENT') return []; throw error }
   const documents = await Promise.all(files.filter(name => /^[a-f0-9]{64}\.json$/.test(name)).map(name => read(join(folder(sessionId), name))))
   return documents.sort((a, b) => a.sourceKey.localeCompare(b.sourceKey))
  },
 }
}
