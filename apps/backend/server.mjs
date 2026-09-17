import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { lstat, readFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createGameMetadataLoader } from '../packages/game-metadata.mjs'
import { createProfileStore } from '../packages/profile-store.mjs'
import { createControlProfileStore } from '../packages/control-profile-store.mjs'
import { createSaveStore } from '../packages/save-store.mjs'

const backendDirectory = dirname(fileURLToPath(import.meta.url))
const defaultCatalogPath = join(backendDirectory, 'catalog.json')
const defaultRomsDirectory = join(backendDirectory, 'roms')
const defaultProfilesPath = join(backendDirectory, 'data', 'profiles.json')
const defaultControlProfilePath = join(backendDirectory, 'data', 'control-profile.json')
const defaultSavesPath = join(backendDirectory, 'data', 'saves')
const loadGameMetadata = createGameMetadataLoader()

const systemExtensions = new Map([
  ['gb', ['.gb']],
  ['gbc', ['.gbc']],
  ['gba', ['.gba']],
])

const unavailableReasons = Object.freeze({
  catalogEntry: 'Catalog entry is incomplete.',
  catalogHash: 'Catalog entry must contain a trusted SHA-256 hash.',
  catalogId: 'Catalog entry must contain a safe game ID.',
  catalogFile: 'Catalog entry must contain a ROM filename.',
  catalogSystem: 'Catalog entry must contain a supported system.',
  filePath: 'ROM path must stay inside the ROM directory.',
  hashMismatch: 'ROM hash does not match the trusted catalog hash.',
  notFound: 'ROM file was not found.',
  notRegular: 'ROM path is not a regular file.',
  symlink: 'ROM path cannot use symbolic links.',
})

export function createHubServer(options = {}) {
  const config = {
    catalogPath: options.catalogPath ?? defaultCatalogPath,
    romsDirectory: options.romsDirectory ?? options.romsDir ?? defaultRomsDirectory,
    metadataLoader: options.metadataLoader ?? loadGameMetadata,
    profileStore: options.profileStore ?? createProfileStore({ dataPath: options.profilesPath ?? defaultProfilesPath }),
    controlProfileStore: options.controlProfileStore ?? createControlProfileStore({ dataPath: options.controlProfilePath ?? defaultControlProfilePath }),
    saveStore: options.saveStore ?? createSaveStore({ dataPath: options.savesPath ?? defaultSavesPath }),
  }

  return createServer((request, response) => {
    handleRequest(request, response, config).catch((error) => {
      if (response.headersSent) {
        response.destroy(error)
        return
      }

      json(response, 500, { error: 'Internal server error.' })
    })
  })
}

export async function loadCatalog(catalogPath = defaultCatalogPath) {
  try {
    const source = await readFile(catalogPath, 'utf8')
    const parsed = JSON.parse(source)
    const entries = Array.isArray(parsed) ? parsed : parsed?.games

    if (!Array.isArray(entries)) {
      throw new Error('Catalog root must be an array or an object with a games array.')
    }

    return entries
  } catch (error) {
    const catalogError = new Error('Catalog could not be loaded.', { cause: error })
    catalogError.code = 'CATALOG_LOAD_FAILED'
    throw catalogError
  }
}

export function stableGameId(id) {
  const digest = createHash('sha256').update(id).digest()
  const numericId = digest.readUInt32BE(0) & 0x7fffffff
  return numericId === 0 ? 1 : numericId
}

async function handleRequest(request, response, config) {
  const route = parseRoute(request.url)
  if (route.error) {
    json(response, 400, { error: route.error })
    return
  }

  const isRomRoute = route.pathname.startsWith('/roms/')
  const isProfilesRoute = route.pathname === '/api/profiles'
  const isProfileRoute = route.pathname.startsWith('/api/profiles/')
  const isControlProfileRoute = route.pathname === '/api/control-profile'
  const saveRoute = parseSaveRoute(route.pathname)
  const supportedMethod = request.method === 'GET'
    || (request.method === 'HEAD' && isRomRoute)
    || (request.method === 'POST' && isProfilesRoute)
    || (request.method === 'PUT' && (isControlProfileRoute || saveRoute))
    || (request.method === 'PATCH' && isProfileRoute)
    || (request.method === 'DELETE' && isProfileRoute)
  if (!supportedMethod) {
    response.setHeader('Allow', saveRoute || isControlProfileRoute ? 'GET, PUT' : isProfilesRoute ? 'GET, POST' : isProfileRoute ? 'PATCH, DELETE' : isRomRoute ? 'GET, HEAD' : 'GET')
    json(response, 405, { error: 'Method is not supported for this route.' })
    return
  }

  if (isProfilesRoute) {
    if (request.method === 'GET') await listProfiles(response, config)
    else await createProfile(request, response, config)
    return
  }

  if (isControlProfileRoute) {
    if (request.method === 'GET') await getControlProfile(response, config)
    else await replaceControlProfile(request, response, config)
    return
  }

  if (saveRoute) {
    await handleSave(request, response, config, saveRoute)
    return
  }

  if (isProfileRoute) {
    const id = route.pathname.slice('/api/profiles/'.length)
    if (request.method === 'PATCH') await updateProfile(request, response, config, id)
    else await deleteProfile(response, config, id)
    return
  }

  if (route.pathname === '/api/games') {
    await listGames(response, config)
    return
  }

  if (route.pathname.startsWith('/api/games/') && route.pathname.endsWith('/launch')) {
    const id = route.pathname.slice('/api/games/'.length, -'/launch'.length)
    await launchGame(response, config, id, route.searchParams.get('profileId'))
    return
  }

  if (isRomRoute) {
    const id = route.pathname.slice('/roms/'.length)
    await streamRom(response, config, id, request.method === 'HEAD')
    return
  }

  json(response, 404, { error: 'Route was not found.' })
}

function parseRoute(rawUrl) {
  let url
  try {
    url = new URL(rawUrl ?? '/', 'http://127.0.0.1')
  } catch {
    return { error: 'Malformed URL.' }
  }

  let pathname
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    return { error: 'Malformed URL.' }
  }

  if (pathname.length > 1 && pathname.endsWith('/')) {
    pathname = pathname.slice(0, -1)
  }

  return { pathname, searchParams: url.searchParams }
}

async function listProfiles(response, config) {
  json(response, 200, { profiles: await config.profileStore.list() })
}

async function getControlProfile(response, config) {
  json(response, 200, await config.controlProfileStore.get())
}

async function replaceControlProfile(request, response, config) {
  let body
  try {
    body = await readJsonBody(request)
  } catch (error) {
    const status = error.code === 'REQUEST_BODY_TOO_LARGE' ? 413 : error.code === 'UNSUPPORTED_CONTENT_TYPE' ? 415 : 400
    json(response, status, { error: error.message })
    return
  }

  try {
    json(response, 200, await config.controlProfileStore.replace(body))
  } catch (error) {
    if (error.code === 'CONTROL_PROFILE_INVALID') {
      json(response, 400, { error: error.message })
      return
    }
    throw error
  }
}

async function createProfile(request, response, config) {
  let body
  try {
    body = await readJsonBody(request)
  } catch (error) {
    const status = error.code === 'REQUEST_BODY_TOO_LARGE' ? 413 : error.code === 'UNSUPPORTED_CONTENT_TYPE' ? 415 : 400
    json(response, status, { error: error.message })
    return
  }

  try {
    const profile = await config.profileStore.create(body.name)
    json(response, 201, profile)
  } catch (error) {
    if (error.code === 'PROFILE_NAME_INVALID') {
      json(response, 400, { error: error.message })
      return
    }
    if (error.code === 'PROFILE_NAME_DUPLICATE') {
      json(response, 409, { error: error.message })
      return
    }
    throw error
  }
}

async function deleteProfile(response, config, id) {
  const profile = await config.profileStore.remove(id)
  if (profile === null) {
    json(response, 404, { error: 'Profile was not found.' })
    return
  }

  json(response, 200, profile)
}

async function updateProfile(request, response, config, id) {
  let body
  try {
    body = await readJsonBody(request)
  } catch (error) {
    const status = error.code === 'REQUEST_BODY_TOO_LARGE' ? 413 : error.code === 'UNSUPPORTED_CONTENT_TYPE' ? 415 : 400
    json(response, status, { error: error.message })
    return
  }

  try {
    const profile = await config.profileStore.update(id, body.name)
    if (profile === null) {
      json(response, 404, { error: 'Profile was not found.' })
      return
    }
    json(response, 200, profile)
  } catch (error) {
    if (error.code === 'PROFILE_NAME_INVALID') {
      json(response, 400, { error: error.message })
      return
    }
    if (error.code === 'PROFILE_NAME_DUPLICATE') {
      json(response, 409, { error: error.message })
      return
    }
    throw error
  }
}

async function listGames(response, config) {
  let entries
  try {
    entries = await loadCatalog(config.catalogPath)
  } catch (error) {
    if (error.code === 'CATALOG_LOAD_FAILED') {
      json(response, 500, { error: 'Catalog could not be loaded.' })
      return
    }
    throw error
  }

  const games = []
  for (let index = 0; index < entries.length; index += 1) {
    const entry = normalizeEntry(entries[index], index)
    const verification = await verifyRom(entry, config.romsDirectory)
    const game = {
      id: entry.id,
      title: entry.title,
      system: entry.system,
      core: entry.core,
      status: verification.ok ? 'ready' : 'unavailable',
    }

    if (!verification.ok) {
      game.reason = verification.reason
    }

    if (verification.ok) {
      const metadata = await config.metadataLoader(entry)
      if (metadata) {
        if (metadata.versionName) game.title = `Pokémon ${metadata.versionName} Version`
        if (metadata.coverUrl) game.coverUrl = metadata.coverUrl
        if (entry.region) game.region = entry.region
        if (entry.language) game.language = entry.language
      }
    }

    games.push(game)
  }

  json(response, 200, { games })
}

async function launchGame(response, config, encodedId, profileId) {
  const id = decodeId(encodedId)
  if (id === null) {
    json(response, 400, { error: 'Malformed game ID.' })
    return
  }

  if (!profileId) {
    json(response, 400, { error: 'A profile is required to launch a game.' })
    return
  }

  const profile = await config.profileStore.get(profileId)
  if (profile === null) {
    json(response, 404, { error: 'Profile was not found.' })
    return
  }

  let entry
  try {
    entry = await findEntry(config.catalogPath, id)
  } catch (error) {
    if (error.code === 'CATALOG_LOAD_FAILED') {
      json(response, 500, { error: 'Catalog could not be loaded.' })
      return
    }
    throw error
  }

  if (entry === null) {
    json(response, 404, { error: 'Game was not found.' })
    return
  }

  const verification = await verifyRom(entry, config.romsDirectory)
  if (!verification.ok) {
    json(response, 409, { error: verification.reason })
    return
  }

  json(response, 200, {
    id: entry.id,
    title: entry.title,
    core: entry.core,
    profileId: profile.id,
    gameId: stableGameId(`${profile.id}:${entry.id}`),
    romUrl: `/roms/${encodeURIComponent(entry.id)}`,
    saveUrl: `/api/profiles/${encodeURIComponent(profile.id)}/games/${encodeURIComponent(entry.id)}/save`,
  })
}

function parseSaveRoute(pathname) {
  const match = /^\/api\/profiles\/([^/]+)\/games\/([^/]+)\/save$/.exec(pathname)
  return match ? { profileId: match[1], gameId: match[2] } : null
}

async function handleSave(request, response, config, { profileId, gameId }) {
  const profile = await config.profileStore.get(profileId)
  if (profile === null) return json(response, 404, { error: 'Profile was not found.' })
  const entry = await findEntry(config.catalogPath, gameId)
  if (entry === null) return json(response, 404, { error: 'Game was not found.' })
  if (request.method === 'GET') {
    const save = await config.saveStore.get(profileId, gameId)
    if (save === null) return json(response, 404, { error: 'Save was not found.' })
    response.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Length': save.bytes.length, 'Content-Type': 'application/octet-stream', ETag: `"${save.revision}"`, 'X-Save-Sha256': save.sha256, 'X-Content-Type-Options': 'nosniff' })
    response.end(save.bytes)
    return
  }
  let bytes
  try {
    bytes = await readBinaryBody(request)
  } catch (error) {
    return json(response, error.code === 'REQUEST_BODY_TOO_LARGE' ? 413 : 415, { error: error.message })
  }
  const expectedRevision = parseExpectedRevision(request.headers['if-match'])
  if (expectedRevision === undefined) return json(response, 428, { error: 'If-Match is required.' })
  try {
    const saved = await config.saveStore.put(profileId, gameId, bytes, expectedRevision)
    json(response, expectedRevision === null ? 201 : 200, saved)
  } catch (error) {
    json(response, error.code === 'SAVE_REVISION_CONFLICT' ? 412 : 400, { error: error.message })
  }
}

async function readBinaryBody(request) {
  if (request.headers['content-type']?.toLowerCase() !== 'application/octet-stream') {
    const error = new Error('Content-Type must be application/octet-stream.')
    error.code = 'UNSUPPORTED_CONTENT_TYPE'
    throw error
  }
  const chunks = []
  let length = 0
  for await (const chunk of request) {
    length += chunk.length
    if (length > 2 * 1024 * 1024) {
      const error = new Error('Request body is too large.')
      error.code = 'REQUEST_BODY_TOO_LARGE'
      throw error
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

function parseExpectedRevision(value) {
  if (value === '*') return null
  const match = /^"([1-9]\d*)"$/.exec(value ?? '')
  return match ? Number(match[1]) : undefined
}

async function streamRom(response, config, encodedId, headersOnly = false) {
  const id = decodeId(encodedId)
  if (id === null) {
    json(response, 400, { error: 'Malformed game ID.' })
    return
  }

  let entry
  try {
    entry = await findEntry(config.catalogPath, id)
  } catch (error) {
    if (error.code === 'CATALOG_LOAD_FAILED') {
      json(response, 500, { error: 'Catalog could not be loaded.' })
      return
    }
    throw error
  }

  if (entry === null) {
    json(response, 404, { error: 'Game was not found.' })
    return
  }

  const verification = await verifyRom(entry, config.romsDirectory)
  if (!verification.ok) {
    json(response, 409, { error: verification.reason })
    return
  }

  response.writeHead(200, {
    'Cache-Control': 'no-store',
    'Content-Length': verification.bytes.length,
    'Content-Type': 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
  })
  response.end(headersOnly ? undefined : verification.bytes)
}

async function findEntry(catalogPath, id) {
  const entries = await loadCatalog(catalogPath)
  const entry = entries.find((candidate) => normalizeEntry(candidate).id === id)
  return entry === undefined ? null : normalizeEntry(entry)
}

function normalizeEntry(rawEntry, index = 0) {
  const entry = rawEntry && typeof rawEntry === 'object' ? rawEntry : {}
  return {
    id: typeof entry.id === 'string' ? entry.id.trim() : `invalid-${index + 1}`,
    title: typeof entry.title === 'string' ? entry.title : 'Untitled game',
    system: typeof entry.system === 'string' ? entry.system.trim().toLowerCase() : '',
    core: typeof entry.core === 'string' ? entry.core.trim() : '',
    file: typeof entry.file === 'string' ? entry.file : '',
    sha256: typeof entry.sha256 === 'string' ? entry.sha256.trim().toLowerCase() : '',
    pokeapiVersion: typeof entry.pokeapiVersion === 'string' ? entry.pokeapiVersion.trim().toLowerCase() : '',
    wikipediaPage: typeof entry.wikipediaPage === 'string' ? entry.wikipediaPage.trim() : '',
    region: typeof entry.region === 'string' ? entry.region.trim() : '',
    language: typeof entry.language === 'string' ? entry.language.trim() : '',
  }
}

async function verifyRom(entry, romsDirectory) {
  const metadataReason = validateCatalogEntry(entry)
  if (metadataReason !== null) {
    return { ok: false, reason: metadataReason }
  }

  const safePath = resolveSafeRomPath(romsDirectory, entry.file)
  if (safePath === null) {
    return { ok: false, reason: unavailableReasons.filePath }
  }

  const fileCheck = await inspectRomPath(romsDirectory, safePath)
  if (!fileCheck.ok) {
    return fileCheck
  }

  let bytes
  try {
    bytes = await readFile(safePath)
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { ok: false, reason: unavailableReasons.notFound }
    }
    throw error
  }

  const actualHash = createHash('sha256').update(bytes).digest('hex')
  if (actualHash !== entry.sha256) {
    return { ok: false, reason: unavailableReasons.hashMismatch }
  }

  return { ok: true, bytes }
}

function validateCatalogEntry(entry) {
  if (!entry.id || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(entry.id)) {
    return unavailableReasons.catalogId
  }
  if (!entry.title || !entry.core || !entry.system) {
    return unavailableReasons.catalogEntry
  }
  if (!entry.file) {
    return unavailableReasons.catalogFile
  }
  if (!/^[a-f0-9]{64}$/.test(entry.sha256)) {
    return unavailableReasons.catalogHash
  }

  const allowedExtensions = systemExtensions.get(entry.system)
  if (!allowedExtensions) {
    return `System "${entry.system}" is not supported.`
  }

  const extension = extname(entry.file.replaceAll('\\', '/')).toLowerCase()
  if (!allowedExtensions.includes(extension)) {
    return `ROM file extension "${extension || '(none)'}" is not allowed for ${entry.system}.`
  }

  return null
}

function resolveSafeRomPath(romsDirectory, file) {
  if (file.includes('\0')) {
    return null
  }

  const normalized = file.replaceAll('\\', '/')
  const segments = normalized.split('/')
  if (isAbsolute(file) || normalized.startsWith('/') || normalized.includes(':')) {
    return null
  }
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return null
  }

  const root = resolve(romsDirectory)
  const candidate = resolve(root, file)
  const relativePath = relative(root, candidate)
  if (!relativePath || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    return null
  }

  return candidate
}

async function inspectRomPath(romsDirectory, candidate) {
  const root = resolve(romsDirectory)
  const relativePath = relative(root, candidate)
  let current = root

  try {
    const rootStats = await lstat(root)
    if (rootStats.isSymbolicLink()) {
      return { ok: false, reason: unavailableReasons.symlink }
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { ok: false, reason: unavailableReasons.notFound }
    }
    throw error
  }

  for (const segment of relativePath.split(sep)) {
    current = join(current, segment)
    let stats
    try {
      stats = await lstat(current)
    } catch (error) {
      if (error.code === 'ENOENT') {
        return { ok: false, reason: unavailableReasons.notFound }
      }
      if (error.code === 'ENOTDIR') {
        return { ok: false, reason: unavailableReasons.notRegular }
      }
      throw error
    }

    if (stats.isSymbolicLink()) {
      return { ok: false, reason: unavailableReasons.symlink }
    }

    if (current === candidate && !stats.isFile()) {
      return { ok: false, reason: unavailableReasons.notRegular }
    }
  }

  return { ok: true }
}

function decodeId(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

async function readJsonBody(request) {
  if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
    const error = new Error('Content-Type must be application/json.')
    error.code = 'UNSUPPORTED_CONTENT_TYPE'
    throw error
  }

  const chunks = []
  let length = 0
  for await (const chunk of request) {
    length += chunk.length
    if (length > 4096) {
      const error = new Error('Request body is too large.')
      error.code = 'REQUEST_BODY_TOO_LARGE'
      throw error
    }
    chunks.push(chunk)
  }

  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid')
    return parsed
  } catch {
    const error = new Error('Request body must be a JSON object.')
    error.code = 'INVALID_JSON_BODY'
    throw error
  }
}

function json(response, status, payload) {
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  })
  response.end(body)
}

function isMainModule() {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
}

if (isMainModule()) {
  const port = Number.parseInt(process.env.PORT ?? '3000', 10)
  const host = process.env.HOST ?? '127.0.0.1'
  const server = createHubServer()
  server.listen(port, host, () => {
    console.log(`Emulator Hub backend listening on http://${host}:${port}`)
  })
}
