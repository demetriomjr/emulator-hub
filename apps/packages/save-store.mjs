import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const maximumSaveBytes = 2 * 1024 * 1024

export function createSaveStore({ dataPath }) {
  return {
    async get(profileId, gameId) {
      const paths = savePaths(dataPath, profileId, gameId)
      try {
        const [bytes, metadataSource] = await Promise.all([readFile(paths.bytes), readFile(paths.metadata, 'utf8')])
        const metadata = JSON.parse(metadataSource)
        if (!validMetadata(metadata, bytes)) throw new Error('Save metadata is invalid.')
        return { bytes, revision: metadata.revision, sha256: metadata.sha256 }
      } catch (error) {
        if (error.code === 'ENOENT') return null
        throw error
      }
    },
    async put(profileId, gameId, bytes, expectedRevision) {
      if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > maximumSaveBytes) {
        const error = new Error('Save bytes must be between 1 byte and 2 MiB.')
        error.code = 'SAVE_INVALID'
        throw error
      }
      const current = await this.get(profileId, gameId)
      if ((current === null && expectedRevision !== null) || (current !== null && expectedRevision !== current.revision)) {
        const error = new Error('Save revision does not match the current save.')
        error.code = 'SAVE_REVISION_CONFLICT'
        throw error
      }
      const revision = (current?.revision ?? 0) + 1
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      const paths = savePaths(dataPath, profileId, gameId)
      await mkdir(dirname(paths.bytes), { recursive: true })
      await writeAtomically(paths.bytes, bytes)
      await writeAtomically(paths.metadata, JSON.stringify({ revision, sha256 }))
      return { revision, sha256 }
    },
  }
}

function savePaths(dataPath, profileId, gameId) {
  return {
    bytes: join(dataPath, profileId, `${gameId}.sav`),
    metadata: join(dataPath, profileId, `${gameId}.json`),
  }
}

function validMetadata(metadata, bytes) {
  return metadata && Number.isInteger(metadata.revision) && metadata.revision > 0
    && typeof metadata.sha256 === 'string' && /^[a-f0-9]{64}$/.test(metadata.sha256)
    && createHash('sha256').update(bytes).digest('hex') === metadata.sha256
}

async function writeAtomically(path, data) {
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, data)
  await rename(temporary, path)
}
