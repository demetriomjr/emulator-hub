import { createHash } from 'node:crypto'
import { lstat, readFile } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'

const manifestFilename = 'manifest.json'
const manifestVersion = 1
const patchExtension = '.ips'
const ipsHeader = Buffer.from('PATCH')
const ipsEnd = Buffer.from('EOF')

export function createIpsPatchRegistry({ patchesDirectory }) {
  if (typeof patchesDirectory !== 'string' || patchesDirectory.length === 0) throw new TypeError('A patches directory is required.')
  const directory = resolve(patchesDirectory)

  return {
    async findForRomSha256(romSha256) {
      const manifestResult = await readPatchManifest(directory)
      if (manifestResult.warning) return { patch: null, warning: manifestResult.warning }
      if (manifestResult.manifest === null) return { patch: null, warning: null }

      const candidates = manifestResult.manifest.patches.filter(entry => entry && entry.romSha256 === romSha256)
      if (candidates.length === 0) return { patch: null, warning: null }
      if (candidates.length > 1) return { patch: null, warning: 'More than one IPS patch is registered for this ROM; the association is ambiguous.' }

      return readRegisteredPatch(directory, candidates[0])
    },
  }
}

export function isValidIps(input) {
  if (!(input instanceof Uint8Array)) return false
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength)
  if (bytes.length < ipsHeader.length + ipsEnd.length || !bytes.subarray(0, ipsHeader.length).equals(ipsHeader)) return false

  let offset = ipsHeader.length
  while (offset + ipsEnd.length <= bytes.length) {
    if (bytes.subarray(offset, offset + ipsEnd.length).equals(ipsEnd)) {
      const trailingBytes = bytes.length - (offset + ipsEnd.length)
      return trailingBytes === 0 || trailingBytes === 3
    }
    if (offset + 5 > bytes.length) return false

    offset += 3 // 24-bit ROM offset
    const recordSize = bytes.readUInt16BE(offset)
    offset += 2
    if (recordSize === 0) {
      if (offset + 3 > bytes.length) return false
      const repeatCount = bytes.readUInt16BE(offset)
      if (repeatCount === 0) return false
      offset += 3 // repeat count and repeated byte
    } else {
      offset += recordSize
      if (offset > bytes.length) return false
    }
  }

  return false
}

async function readPatchManifest(directory) {
  const manifestPath = resolve(directory, manifestFilename)
  let manifestStat
  try {
    manifestStat = await lstat(manifestPath)
  } catch (error) {
    if (error.code === 'ENOENT') return { manifest: null, warning: null }
    return { manifest: null, warning: `IPS manifest could not be read (${error.code ?? 'unknown error'}).` }
  }
  if (manifestStat.isSymbolicLink() || !manifestStat.isFile()) return { manifest: null, warning: 'IPS manifest must be a regular non-symlink file.' }

  let bytes
  try {
    bytes = await readFile(manifestPath)
  } catch (error) {
    return { manifest: null, warning: `IPS manifest could not be read (${error.code ?? 'unknown error'}).` }
  }

  let manifest
  try {
    manifest = JSON.parse(bytes.toString('utf8'))
  } catch {
    return { manifest: null, warning: 'IPS manifest is not valid JSON.' }
  }
  if (manifest?.version !== manifestVersion || !Array.isArray(manifest.patches)) {
    return { manifest: null, warning: `IPS manifest must use version ${manifestVersion} and include a patches array.` }
  }

  return { manifest, warning: null }
}

async function readRegisteredPatch(directory, entry) {
  if (!/^[a-f0-9]{64}$/.test(entry.romSha256) || !/^[a-f0-9]{64}$/.test(entry.patchSha256)) {
    return { patch: null, warning: 'IPS manifest entry must contain valid ROM and patch SHA-256 values.' }
  }
  if (typeof entry.file !== 'string' || entry.file.includes('\0') || entry.file.includes('/') || entry.file.includes('\\') || isAbsolute(entry.file) || extname(entry.file).toLowerCase() !== patchExtension) {
    return { patch: null, warning: 'IPS manifest patch path must be a safe .ips filename.' }
  }

  const patchPath = resolve(directory, entry.file)
  const relativePath = relative(directory, patchPath)
  if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    return { patch: null, warning: 'IPS manifest patch path must stay inside the patch directory.' }
  }

  let fileStat
  try {
    fileStat = await lstat(patchPath)
  } catch (error) {
    const reason = error.code === 'ENOENT' ? 'IPS patch file was not found.' : `IPS patch file could not be read (${error.code ?? 'unknown error'}).`
    return { patch: null, warning: reason }
  }
  if (fileStat.isSymbolicLink() || !fileStat.isFile()) return { patch: null, warning: 'IPS patch must be a regular non-symlink file.' }

  let bytes
  try {
    bytes = await readFile(patchPath)
  } catch (error) {
    return { patch: null, warning: `IPS patch file could not be read (${error.code ?? 'unknown error'}).` }
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  if (sha256 !== entry.patchSha256) return { patch: null, warning: 'IPS patch hash does not match its manifest entry.' }
  if (!isValidIps(bytes)) return { patch: null, warning: 'IPS patch contents are not a valid IPS file.' }

  return { patch: { file: entry.file, sha256, bytes }, warning: null }
}
