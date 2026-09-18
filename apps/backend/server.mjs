import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { lstat, readFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { backendListenConfiguration } from './runtime-configuration.mjs'
import { createGameMetadataLoader } from '../packages/game-metadata.mjs'
import { createGameCatalogResponse } from '../packages/game-catalog-contract.mjs'
import { createRedisProfileStore } from '../packages/profile-store.mjs'
import { createRedisControlProfileStore } from '../packages/control-profile-store.mjs'
import { createSaveStore } from '../packages/save-store.mjs'
import { createRedisPokemonHubStore } from '../packages/pokemon-hub-store.mjs'
import { createRedisPokemonHubProfileStore } from '../packages/pokemon-hub-profile-store.mjs'
import { createPokemonHubSessionStore } from '../packages/pokemon-hub-session-store.mjs'
import { createPokemonHubSnapshotStore } from '../packages/pokemon-hub-snapshot-store.mjs'
import { createPokemonHubService } from '../packages/pokemon-hub-service.mjs'
import { createPokemonHubGridTransferService } from '../packages/pokemon-hub-grid-transfer-service.mjs'
import { validatePokemonHubTransferPlacement } from '../packages/pokemon-hub-transfer-placement-policy.mjs'
import { createPokemonHubEventStore } from '../packages/pokemon-hub-event-store.mjs'
import { createPokemonHubSnapshotCoordinator } from '../packages/pokemon-hub-snapshot-coordinator.mjs'
import { createPokemonHubSessionService } from '../packages/pokemon-hub-session-service.mjs'
import { adoptPokemonHubSave } from '../packages/pokemon-hub-save-adoption.mjs'
import { createPokemonHubSaveFlushService } from '../packages/pokemon-hub-save-flush.mjs'
import { createPokemonSaveAdapterRegistry } from '../packages/pokemon-save-adapter-registry.mjs'
import { pokemonGen3Adapter } from '../packages/pokemon-gen3-adapter.mjs'
import { getPokemonSaveLayout } from '../packages/pokemon-save-layouts.mjs'
import { pokemonHubLocationKey } from '../packages/pokemon-hub-location-key.mjs'
import { createRomDiscovery } from '../packages/rom-discovery.mjs'
import { createRedisRomRegistry } from '../packages/rom-registry.mjs'
import { createRedisPersistence } from '../packages/redis-persistence.mjs'
import { migrateLegacyJsonData } from '../packages/redis-legacy-migration.mjs'
import { createClientDiagnosticStore } from '../packages/client-diagnostic-store.mjs'

const backendDirectory = dirname(fileURLToPath(import.meta.url))
const defaultCatalogPath = join(backendDirectory, 'catalog.json')
const defaultRomsDirectory = join(backendDirectory, 'roms')
const defaultProfilesPath = join(backendDirectory, 'data', 'profiles')
const defaultControlProfilePath = join(backendDirectory, 'data', 'control-profile.json')
const defaultSavesPath = join(backendDirectory, 'data', 'saves')
const defaultPokemonHubPath = join(backendDirectory, 'data', 'pokemon-hub')
const defaultPokemonHubProfilesPath = join(backendDirectory, 'data', 'pokemon-hub-profiles')
const defaultRomRegistryPath = join(backendDirectory, 'data', 'rom-registry.json')
const loadGameMetadata = createGameMetadataLoader()
const execFileAsync = promisify(execFile)
const defaultJsonBodyMaximumBytes = 4 * 1024
const pokemonHubSnapshotMaximumBytes = 128 * 1024

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
  const romRegistryPath = options.romRegistryPath ?? (options.catalogPath ? join(dirname(options.catalogPath), 'data', 'rom-registry.json') : defaultRomRegistryPath)
  const persistence = options.persistence ?? createRedisPersistence(redisConfiguration(options))
  const config = {
    persistence,
    catalogPath: options.catalogPath ?? defaultCatalogPath,
    romsDirectory: options.romsDirectory ?? options.romsDir ?? defaultRomsDirectory,
    persistence,
    romRegistry: options.romRegistry ?? createRedisRomRegistry({ persistence }),
    romDiscovery: options.romDiscovery ?? createRomDiscovery({ lookupBatch: options.romLookupBatch ?? lookupRomBatch, refreshLegacyMetadata: options.refreshLegacyMetadata ?? !options.catalogPath }),
    metadataLoader: options.metadataLoader ?? loadGameMetadata,
    profileStore: options.profileStore ?? createRedisProfileStore({ persistence }),
    controlProfileStore: options.controlProfileStore ?? createRedisControlProfileStore({ persistence }),
    saveStore: options.saveStore ?? createSaveStore({ dataPath: options.savesPath ?? defaultSavesPath }),
    pokemonHubStore: options.pokemonHubStore ?? createRedisPokemonHubStore({ persistence }),
    pokemonHubProfileStore: options.pokemonHubProfileStore ?? createRedisPokemonHubProfileStore({ persistence }),
    pokemonHubSessions: options.pokemonHubSessions ?? createPokemonHubSessionStore(),
    pokemonHubSnapshots: options.pokemonHubSnapshots ?? createPokemonHubSnapshotStore(),
    pokemonSaveAdapters: options.pokemonSaveAdapters ?? createPokemonSaveAdapterRegistry([pokemonGen3Adapter]),
    pokemonHubEventStore: options.pokemonHubEventStore ?? createPokemonHubEventStore({ persistence }),
    pokemonHubLogger: normalizePokemonHubLogger(options.pokemonHubLogger),
    clientDiagnosticStore: options.clientDiagnosticStore ?? createClientDiagnosticStore(),
    clientDiagnosticLogger: normalizeClientDiagnosticLogger(options.clientDiagnosticLogger),
  }
  config.pokemonHubSnapshotCoordinator = options.pokemonHubSnapshotCoordinator ?? createPokemonHubSnapshotCoordinator({ persistence, eventStore: config.pokemonHubEventStore, logger: config.pokemonHubLogger, validatePlacementChange: validatePokemonHubTransferPlacement })
  const canCreatePokemonHubSessionService = ['getSnapshot', 'renew', 'release', 'sync', 'reconcileWorkspaceLeases'].every(method => typeof config.pokemonHubSnapshotCoordinator[method] === 'function')
  config.pokemonHubSessionService = options.pokemonHubSessionService ?? (canCreatePokemonHubSessionService
    ? createPokemonHubSessionService({ persistence, coordinator: config.pokemonHubSnapshotCoordinator, logger: config.pokemonHubLogger })
    : null)
  config.pokemonHubGridTransferService = options.pokemonHubGridTransferService
    ?? (typeof config.pokemonHubSnapshotCoordinator.ensureHubSource === 'function'
      ? createPokemonHubGridTransferService({ coordinator: config.pokemonHubSnapshotCoordinator, profileStore: config.pokemonHubProfileStore })
      : null)
  config.pokemonHubSaveFlush = options.pokemonHubSaveFlush ?? createPokemonHubSaveFlushService({
    coordinator: config.pokemonHubSnapshotCoordinator,
    saveStore: config.saveStore,
    resolveSaveSource: request => resolvePokemonHubSaveSource(config, request),
  })
  config.pokemonHubService = options.pokemonHubService ?? createPokemonHubService({
    profileStore: config.profileStore,
    saveStore: config.saveStore,
    hubStore: config.pokemonHubStore,
    registry: config.pokemonSaveAdapters,
    sessions: config.pokemonHubSessions,
    snapshots: config.pokemonHubSnapshots,
    catalogLoader: () => loadAvailableCatalog(config),
  })

  const server = createServer((request, response) => {
    handleRequest(request, response, config).catch((error) => {
      config.pokemonHubLogger.error('backend.http.unhandled-error', { method: request.method, url: request.url, error: errorDetails(error) })
      if (response.headersSent) {
        response.destroy(error)
        return
      }

      json(response, 500, { error: 'Internal server error.' })
    })
  })
  let expiredLeaseObserverRunning = false
  const observeExpiredLeases = async () => {
    if (typeof config.pokemonHubSaveFlush.flushExpiredLeases !== 'function' || expiredLeaseObserverRunning) return
    expiredLeaseObserverRunning = true
    try {
      if (config.pokemonHubSessionService?.listExpired) {
        for (const expired of await config.pokemonHubSessionService.listExpired()) {
          await config.pokemonHubSessionService.releaseExpired({
            ...expired,
            beforeClose: sources => releasePokemonHubSessionSources(config, expired.profileId, expired.sessionId, sources, { ignoreLeaseInvalid: true }),
          })
        }
      }
      await config.pokemonHubSaveFlush.flushExpiredLeases()
    } catch (error) {
      console.error('[Pokemon Hub] expired session observer failed', { code: error.code, message: error.message })
    } finally {
      expiredLeaseObserverRunning = false
    }
  }
  void observeExpiredLeases()
  const expiredLeaseTimer = typeof config.pokemonHubSaveFlush.flushExpiredLeases === 'function'
    ? setInterval(() => { void observeExpiredLeases() }, 1_000)
    : null
  expiredLeaseTimer?.unref?.()
  server.on('close', () => {
    if (expiredLeaseTimer !== null) clearInterval(expiredLeaseTimer)
    config.pokemonHubSaveFlush.dispose?.()
  })
  return server
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
  const gameProfilesRoute = parseGameProfilesRoute(route.pathname)
  const gameProfileRoute = parseGameProfileRoute(route.pathname)
  const isControlProfileRoute = route.pathname === '/api/control-profile'
  const saveRoute = parseSaveRoute(route.pathname)
  const pokemonHubRoute = parsePokemonHubRoute(route.pathname)
  const pokemonHubSessionRoute = parsePokemonHubSessionRoute(route.pathname)
  const pokemonHubSessionRequestLogger = ['snapshot', 'heartbeat'].includes(pokemonHubSessionRoute?.kind)
    ? childPokemonHubLogger(config.pokemonHubLogger, {
      requestId: randomUUID(),
      method: request.method,
      route: pokemonHubSessionRoute.kind,
      requestType: pokemonHubSessionRoute.kind === 'snapshot' ? 'snapshot-command' : 'heartbeat',
      profileId: pokemonHubSessionRoute.profileId,
      sessionId: pokemonHubSessionRoute.sessionId,
      idempotencyKey: pokemonHubSessionRoute.kind === 'snapshot' ? request.headers['idempotency-key'] ?? null : null,
    })
    : null
  if (pokemonHubSessionRequestLogger) {
    const startedAt = performance.now()
    let responseFinished = false
    const logEvent = `${pokemonHubSessionRoute.kind}.http`
    if (pokemonHubSessionRoute.kind === 'snapshot') pokemonHubSessionRequestLogger.info(`${logEvent}.received`, { contentLength: request.headers['content-length'] ?? null, contentType: request.headers['content-type'] ?? null })
    request.once('aborted', () => pokemonHubSessionRequestLogger.error(`${logEvent}.request-aborted`, { elapsedMs: elapsedMilliseconds(startedAt) }))
    request.once('error', error => pokemonHubSessionRequestLogger.error(`${logEvent}.request-error`, { elapsedMs: elapsedMilliseconds(startedAt), error: errorDetails(error) }))
    response.once('finish', () => {
      responseFinished = true
      if (pokemonHubSessionRoute.kind === 'snapshot') pokemonHubSessionRequestLogger.info(`${logEvent}.response`, { status: response.statusCode, elapsedMs: elapsedMilliseconds(startedAt), headersSent: response.headersSent, writableEnded: response.writableEnded })
    })
    response.once('close', () => {
      if (!responseFinished) pokemonHubSessionRequestLogger.error(`${logEvent}.response-closed`, { status: response.statusCode, elapsedMs: elapsedMilliseconds(startedAt), headersSent: response.headersSent, writableEnded: response.writableEnded })
    })
  }
  const saveLayoutRoute = parseSaveLayoutRoute(route.pathname)
  const isSaveProfileGamesRoute = route.pathname === '/api/pokemon-hub/save-profile-games'
  const pokemonHubProfilesRoute = route.pathname === '/api/pokemon-hub/profiles'
  const pokemonHubProfileRoute = parsePokemonHubProfileRoute(route.pathname)
  const isClientDiagnosticsRoute = route.pathname === '/api/debug/client-events'
  const supportedMethod = request.method === 'GET'
    || (request.method === 'HEAD' && isRomRoute)
    || (request.method === 'POST' && gameProfilesRoute)
    || (request.method === 'POST' && pokemonHubProfilesRoute)
    || ((request.method === 'PATCH' || request.method === 'DELETE') && pokemonHubProfileRoute)
    || (request.method === 'PUT' && (isControlProfileRoute || saveRoute))
    || (request.method === 'POST' && ['transfer', 'snapshot-acquire', 'snapshot-renew', 'snapshot-sync', 'snapshot-release'].includes(pokemonHubRoute?.kind))
    || (pokemonHubSessionRoute && ((request.method === 'POST' && ['open', 'attach', 'heartbeat', 'snapshot', 'close-command'].includes(pokemonHubSessionRoute.kind)) || (request.method === 'DELETE' && ['detach', 'close'].includes(pokemonHubSessionRoute.kind))))
    || (request.method === 'PATCH' && gameProfileRoute)
    || (request.method === 'DELETE' && gameProfileRoute)
    || (isClientDiagnosticsRoute && request.method === 'POST')
  if (!supportedMethod) {
    response.setHeader('Allow', isClientDiagnosticsRoute ? 'GET, POST' : pokemonHubSessionRoute ? pokemonHubSessionRoute.kind === 'detach' || pokemonHubSessionRoute.kind === 'close' ? 'DELETE' : 'POST' : pokemonHubRoute ? ['transfer', 'snapshot-acquire', 'snapshot-renew', 'snapshot-sync', 'snapshot-release'].includes(pokemonHubRoute.kind) ? 'POST' : 'GET' : pokemonHubProfileRoute ? 'PATCH, DELETE' : pokemonHubProfilesRoute || gameProfilesRoute ? 'GET, POST' : saveRoute || isControlProfileRoute ? 'GET, PUT' : gameProfileRoute ? 'PATCH, DELETE' : isRomRoute ? 'GET, HEAD' : 'GET')
    json(response, 405, { error: 'Method is not supported for this route.' })
    return
  }

  if (gameProfilesRoute) {
    await handleGameProfiles(request, response, config, gameProfilesRoute.gameId)
    return
  }

  if (isClientDiagnosticsRoute) {
    await handleClientDiagnostics(request, response, config, route.searchParams)
    return
  }

  if (isSaveProfileGamesRoute) {
    await listSaveProfileGames(response, config)
    return
  }

  if (saveLayoutRoute) {
    await getSaveLayout(response, config, saveLayoutRoute)
    return
  }

  if (pokemonHubProfilesRoute) {
    await handlePokemonHubProfiles(request, response, config)
    return
  }

  if (pokemonHubProfileRoute) {
    await handlePokemonHubProfile(request, response, config, pokemonHubProfileRoute, route.searchParams)
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

  if (pokemonHubSessionRoute) {
    await handlePokemonHubSession(request, response, config, pokemonHubSessionRoute, pokemonHubSessionRequestLogger)
    return
  }

  if (pokemonHubRoute) {
    await handlePokemonHub(request, response, config, pokemonHubRoute)
    return
  }

  if (gameProfileRoute) {
    await handleGameProfile(request, response, config, gameProfileRoute)
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

function parseGameProfilesRoute(pathname) {
  const match = /^\/api\/games\/([^/]+)\/profiles$/.exec(pathname)
  return match ? { gameId: match[1] } : null
}

async function loadAvailableCatalog(config) {
  const legacyEntries = await loadCatalog(config.catalogPath)
  const cachedEntries = await config.romRegistry.load()
  const scan = await config.romDiscovery.scan({
    romsDirectory: config.romsDirectory,
    cachedEntries,
    legacyEntries,
  })
  const accepted = await config.romRegistry.replace(scan.accepted)
  const byId = new Map(accepted.map(entry => [entry.id, entry]))

  for (let index = 0; index < legacyEntries.length; index += 1) {
    const legacy = normalizeEntry(legacyEntries[index], index)
    const existing = byId.get(legacy.id)
    if (!existing) {
      byId.set(legacy.id, legacy)
      continue
    }
    if (legacy.pokemonSave && !existing.pokemonSave) byId.set(legacy.id, { ...existing, pokemonSave: structuredClone(legacy.pokemonSave) })
  }
  return [...byId.values()]
}

async function lookupRomBatch(lookups) {
  const response = await fetch('https://retrobase-collection.com/api/public/v1/lookup/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(6000),
    body: JSON.stringify({ lookups: lookups.map(({ sha1, md5, size }) => ({ sha1, md5, size })) }),
  })
  if (!response.ok) throw new Error(`ROM lookup returned ${response.status}.`)
  const body = await response.json()
  if (!Array.isArray(body?.data)) throw new Error('ROM lookup returned malformed data.')
  return body.data
}

function parseGameProfileRoute(pathname) {
  const match = /^\/api\/games\/([^/]+)\/profiles\/([^/]+)$/.exec(pathname)
  return match ? { gameId: match[1], profileId: match[2] } : null
}

async function handleGameProfiles(request, response, config, encodedGameId) {
  const entry = await findProfileGame(response, config, encodedGameId)
  if (entry === null) return
  if (request.method === 'GET') await listProfiles(response, config, entry.id)
  else await createProfile(request, response, config, entry.id)
}

async function handleGameProfile(request, response, config, route) {
  const entry = await findProfileGame(response, config, route.gameId)
  if (entry === null) return
  if (request.method === 'PATCH') await updateProfile(request, response, config, entry.id, route.profileId)
  else await deleteProfile(response, config, entry.id, route.profileId)
}

async function findProfileGame(response, config, encodedGameId) {
  const gameId = decodeId(encodedGameId)
  if (gameId === null) {
    json(response, 400, { error: 'Malformed game ID.' })
    return null
  }
  let entry
  try { entry = await findEntry(config, gameId) } catch (error) {
    if (error.code === 'CATALOG_LOAD_FAILED') {
      json(response, 500, { error: 'Catalog could not be loaded.' })
      return null
    }
    throw error
  }
  if (entry === null) json(response, 404, { error: 'Game was not found.' })
  return entry
}

async function listProfiles(response, config, gameId) {
  json(response, 200, { profiles: await config.profileStore.list(gameId) })
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

async function createProfile(request, response, config, gameId) {
  let body
  try {
    body = await readJsonBody(request)
  } catch (error) {
    const status = error.code === 'REQUEST_BODY_TOO_LARGE' ? 413 : error.code === 'UNSUPPORTED_CONTENT_TYPE' ? 415 : 400
    json(response, status, { error: error.message })
    return
  }

  try {
    const profile = await config.profileStore.create(gameId, body.name)
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

async function deleteProfile(response, config, gameId, id) {
  const profile = await config.profileStore.remove(gameId, id)
  if (profile === null) {
    json(response, 404, { error: 'Profile was not found.' })
    return
  }

  json(response, 200, profile)
}

async function updateProfile(request, response, config, gameId, id) {
  let body
  try {
    body = await readJsonBody(request)
  } catch (error) {
    const status = error.code === 'REQUEST_BODY_TOO_LARGE' ? 413 : error.code === 'UNSUPPORTED_CONTENT_TYPE' ? 415 : 400
    json(response, status, { error: error.message })
    return
  }

  try {
    const profile = await config.profileStore.update(gameId, id, body.name)
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
    entries = await loadAvailableCatalog(config)
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
      pokemonHubSaveSupported: Boolean(getPokemonSaveLayout(entry.pokemonSave?.layoutProfile, entry.pokemonSave?.adapter) && config.pokemonSaveAdapters.get(entry.pokemonSave?.adapter)),
    }

    if (!verification.ok) {
      game.reason = verification.reason
    }

    if (verification.ok) {
      if (entry.coverUrl) game.coverUrl = entry.coverUrl
      if (entry.region && entry.region !== 'legacy') game.region = entry.region
      if (entry.language) game.language = entry.language
      const metadata = await config.metadataLoader(entry)
      if (metadata) {
        if (metadata.versionName) game.title = `Pokémon ${metadata.versionName} Version`
        if (metadata.coverUrl) game.coverUrl = metadata.coverUrl
      }
    }

    if (verification.ok) {
      const profiles = await config.profileStore.list(entry.id)
      game.profiles = await Promise.all(profiles.map(async profile => ({
        ...profile,
        hasSave: await config.saveStore.get(profile.id, entry.id) !== null,
      })))
    } else {
      game.profiles = []
    }

    games.push(game)
  }

  json(response, 200, createGameCatalogResponse(games))
}

export async function createListenFailureDiagnostic({ error, host, port, runtime = process, lookupListeners = lookupListeningProcesses } = {}) {
  const diagnostic = {
    event: 'BACKEND_LISTEN_FAILED',
    endpoint: { host, port },
    error: {
      code: error?.code,
      errno: error?.errno,
      syscall: error?.syscall,
      address: error?.address,
      port: error?.port,
      message: error?.message,
    },
    process: {
      pid: runtime.pid,
      parentPid: runtime.ppid,
      platform: runtime.platform,
      executable: runtime.execPath,
      arguments: runtime.argv,
    },
    listeners: [],
  }
  if (error?.code !== 'EADDRINUSE') return diagnostic
  try {
    diagnostic.listeners = await lookupListeners({ port, platform: runtime.platform })
  } catch (lookupError) {
    diagnostic.listenerLookupError = lookupError?.message ?? String(lookupError)
  }
  return diagnostic
}

async function lookupListeningProcesses({ port, platform = process.platform }) {
  if (platform !== 'win32') return []
  const { stdout } = await execFileAsync('netstat', ['-ano', '-p', 'tcp'], { windowsHide: true })
  return stdout
    .split(/\r?\n/)
    .map(line => line.trim().split(/\s+/))
    .filter(parts => parts.length >= 5 && parts[0].toUpperCase() === 'TCP' && parts[3].toUpperCase() === 'LISTENING' && parts[1].endsWith(`:${port}`))
    .map(parts => ({ protocol: parts[0], endpoint: parts[1], state: parts[3], pid: Number.parseInt(parts.at(-1), 10) }))
    .filter(listener => Number.isInteger(listener.pid))
}

async function listSaveProfileGames(response, config) {
  let entries
  try {
    entries = await loadAvailableCatalog(config)
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
    const layout = getPokemonSaveLayout(entry.pokemonSave?.layoutProfile, entry.pokemonSave?.adapter)
    const adapter = layout && config.pokemonSaveAdapters.get(entry.pokemonSave.adapter)
    if (!adapter) continue
    const verification = await verifyRom(entry, config.romsDirectory)
    if (!verification.ok) continue
    const profiles = await config.profileStore.list(entry.id)
    const savedProfiles = await Promise.all(profiles.map(async profile => ({ profile, saved: await config.saveStore.get(profile.id, entry.id) !== null })))
    const loadableProfiles = savedProfiles.flatMap(({ profile, saved }) => saved ? [{ ...profile, hasSave: true }] : [])
    if (loadableProfiles.length === 0) continue

    const game = { id: entry.id, title: entry.title, system: entry.system, status: 'ready', pokemonHubSaveSupported: true, profiles: loadableProfiles }
    if (entry.region && entry.region !== 'legacy') game.region = entry.region
    if (entry.coverUrl) game.coverUrl = entry.coverUrl
    games.push(game)
  }

  games.sort((left, right) => left.title.localeCompare(right.title) || left.id.localeCompare(right.id))
  json(response, 200, createGameCatalogResponse(games))
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

  let entry
  try {
    entry = await findEntry(config, id)
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

  const profile = await config.profileStore.get(entry.id, profileId)
  if (profile === null) {
    json(response, 404, { error: 'Profile was not found.' })
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

function parsePokemonHubRoute(pathname) {
  const match = /^\/api\/profiles\/([^/]+)\/pokemon-hub(?:\/(transfers|snapshots\/acquire|snapshots\/renew|snapshots\/sync|snapshots\/release))?$/.exec(pathname)
  if (!match) return null
  return { profileId: match[1], kind: match[2] === 'transfers' ? 'transfer' : match[2] === 'snapshots/acquire' ? 'snapshot-acquire' : match[2] === 'snapshots/renew' ? 'snapshot-renew' : match[2] === 'snapshots/sync' ? 'snapshot-sync' : match[2] === 'snapshots/release' ? 'snapshot-release' : 'inventory' }
}

function parsePokemonHubSessionRoute(pathname) {
  const match = /^\/api\/profiles\/([^/]+)\/pokemon-hub\/sessions(?:\/([^/]+)(?:\/(sources)(?:\/([^/]+))?|\/(heartbeat|snapshots|close))?)?$/.exec(pathname)
  if (!match) return null
  const [, profileId, sessionId, sources, sourceId, action] = match
  if (!sessionId) return { profileId, kind: 'open' }
  if (sources && sourceId) return { profileId, sessionId, sourceId, kind: 'detach' }
  if (sources) return { profileId, sessionId, kind: 'attach' }
  if (action === 'heartbeat') return { profileId, sessionId, kind: 'heartbeat' }
  if (action === 'snapshots') return { profileId, sessionId, kind: 'snapshot' }
  if (action === 'close') return { profileId, sessionId, kind: 'close-command' }
  return { profileId, sessionId, kind: 'close' }
}

function parseSaveLayoutRoute(pathname) {
  const match = /^\/api\/pokemon-hub\/save-profiles\/([^/]+)\/([^/]+)\/layout$/.exec(pathname)
  return match ? { gameId: match[1], profileId: match[2] } : null
}

async function getSaveLayout(response, config, { gameId, profileId }) {
  const entry = await findEntry(config, gameId)
  if (entry === null) return json(response, 404, { error: 'Game was not found.' })
  if (await config.profileStore.get(entry.id, profileId) === null) return json(response, 404, { error: 'Profile was not found.' })
  const save = await config.saveStore.get(profileId, entry.id)
  if (save === null) return json(response, 404, { error: 'Save was not found.', code: 'SAVE_MISSING' })
  const layout = getPokemonSaveLayout(entry.pokemonSave?.layoutProfile, entry.pokemonSave?.adapter)
  if (!layout) {
    console.error('[Pokemon Hub] save layout rejected', { gameId, profileId, code: 'SAVE_LAYOUT_UNSUPPORTED' })
    return json(response, 409, { error: 'Save layout is not supported.', code: 'SAVE_LAYOUT_UNSUPPORTED' })
  }
  const adapter = config.pokemonSaveAdapters.get(entry.pokemonSave.adapter)
  if (!adapter) {
    console.error('[Pokemon Hub] save layout rejected', { gameId, profileId, code: 'SAVE_ADAPTER_UNAVAILABLE' })
    return json(response, 409, { error: 'Save adapter is not available.', code: 'SAVE_ADAPTER_UNAVAILABLE' })
  }
  try {
    const inspection = adapter.inspect(save.bytes, layout)
    let snapshot
    try {
      snapshot = await config.pokemonHubSnapshotCoordinator.getSnapshot({ profileId, sourceKey: `save:${profileId}:${gameId}` })
    } catch (error) {
      if (error.code !== 'SOURCE_NOT_ADOPTED') throw error
      if (typeof adapter.readAllSlots === 'function') snapshot = await adoptPokemonHubSave({ coordinator: config.pokemonHubSnapshotCoordinator, profileId, gameId, saved: save, adapter, layout })
    }
    const pokemonInstanceIds = new Map((snapshot?.placements ?? []).map(placement => [pokemonHubLocationKey(placement.location), placement.pokemonInstanceId]))
    const withPokemonId = (slot, location) => slot.occupied && pokemonInstanceIds.get(pokemonHubLocationKey(location))
      ? { ...slot, pokemonInstanceId: pokemonInstanceIds.get(pokemonHubLocationKey(location)) }
      : slot
    json(response, 200, {
      layout: { id: layout.id, party: { slots: layout.party.slots }, boxes: layout.boxes },
      party: inspection.party.map((slot, index) => withPokemonId(slot, { kind: 'game', area: 'party', slot: index })),
      boxes: inspection.boxes.map((box, boxIndex) => ({ ...box, slots: box.slots.map((slot, index) => withPokemonId(slot, { kind: 'game', area: 'box', box: boxIndex, slot: index })) })),
    })
  } catch (error) {
    console.error('[Pokemon Hub] save layout inspection failed', { gameId, profileId, code: error.code ?? 'SAVE_LAYOUT_READ_FAILED', message: error.message })
    json(response, 409, { error: 'Save layout could not be read.', code: error.code ?? 'SAVE_LAYOUT_READ_FAILED' })
  }
}

async function handlePokemonHub(request, response, config, route) {
  if (route.kind === 'inventory') {
    try {
      json(response, 200, await config.pokemonHubService.getInventory(route.profileId))
    } catch (error) { jsonPokemonHubError(response, error) }
    return
  }
  let body
  try {
    body = await readJsonBody(request, route.kind === 'snapshot-sync' || route.kind === 'transfer' ? pokemonHubSnapshotMaximumBytes : defaultJsonBodyMaximumBytes)
  } catch (error) {
    const status = error.code === 'REQUEST_BODY_TOO_LARGE' ? 413 : error.code === 'UNSUPPORTED_CONTENT_TYPE' ? 415 : 400
    json(response, status, { error: error.message })
    return
  }
  try {
    if (route.kind === 'transfer') {
      const result = body.workspaceId && Array.isArray(body.sources)
        ? await transferPokemonHubGrid(config, route.profileId, body)
        : await config.pokemonHubService.transfer({ ...body, profileId: route.profileId })
      if (result.status === 'accepted') for (const snapshot of result.snapshots ?? []) {
        if (snapshot.sourceKey.startsWith(`save:${route.profileId}:`)) config.pokemonHubSaveFlush.markDirty({ profileId: route.profileId, sourceKey: snapshot.sourceKey })
      }
      json(response, 200, result)
    }
    else if (route.kind === 'snapshot-acquire') json(response, 200, await acquirePokemonHubSnapshot(config, route.profileId, body))
    else if (route.kind === 'snapshot-renew') json(response, 200, await config.pokemonHubSnapshotCoordinator.renew({ ...body, profileId: route.profileId }))
    else if (route.kind === 'snapshot-release') {
      const flushed = await config.pokemonHubSaveFlush.flushSource({ profileId: route.profileId, sourceKey: body.sourceKey })
      if (flushed.status === 'failed') throw serverError('SAVE_FLUSH_FAILED', 'Pokemon Hub save could not be flushed before source release.')
      json(response, 200, await config.pokemonHubSnapshotCoordinator.release({ ...body, profileId: route.profileId }))
    } else {
      const result = await config.pokemonHubSnapshotCoordinator.sync({ ...body, profileId: route.profileId })
      if (result.status === 'accepted') for (const snapshot of result.snapshots) config.pokemonHubSaveFlush.markDirty({ profileId: route.profileId, sourceKey: snapshot.sourceKey })
      json(response, 200, result)
    }
  } catch (error) { jsonPokemonHubError(response, error) }
}

async function handlePokemonHubSession(request, response, config, route, logger = null) {
  const trace = logger ?? config.pokemonHubLogger
  try {
    if (!config.pokemonHubSessionService) throw serverError('POKEMON_HUB_SESSION_UNAVAILABLE', 'Pokemon Hub sessions are unavailable.')
    if (route.kind === 'open') {
      json(response, 201, await config.pokemonHubSessionService.open({ profileId: route.profileId }))
      return
    }
    if (route.kind === 'close') {
      await config.pokemonHubSessionService.close({
        profileId: route.profileId,
        sessionId: route.sessionId,
        beforeClose: sources => releasePokemonHubSessionSources(config, route.profileId, route.sessionId, sources),
      })
      json(response, 200, { ok: true })
      return
    }
    if (route.kind === 'detach') {
      const detached = await config.pokemonHubSessionService.detach({
        profileId: route.profileId,
        sessionId: route.sessionId,
        sourceId: route.sourceId,
        beforeDetach: source => releasePokemonHubSessionSources(config, route.profileId, route.sessionId, [source]),
      })
      json(response, 200, { ok: true, snapshot: detached.snapshot, pokemonDisplay: detached.pokemonDisplay })
      return
    }

    let body
    try {
      body = await readJsonBody(request, ['snapshot', 'close-command'].includes(route.kind) ? pokemonHubSnapshotMaximumBytes : defaultJsonBodyMaximumBytes)
    } catch (error) {
      if (route.kind === 'snapshot' && typeof config.pokemonHubSessionService.getCanonicalSnapshot === 'function') {
        trace.error('snapshot.http.body-read-failed', { error: errorDetails(error) })
        try {
          const snapshot = await config.pokemonHubSessionService.getCanonicalSnapshot({ profileId: route.profileId, sessionId: route.sessionId })
          trace.warn('snapshot.http.corrected-after-body-read-failure', { snapshot: summarizeCanonicalSnapshot(snapshot) })
          json(response, 409, snapshot)
          return
        } catch (correctionError) {
          trace.error('snapshot.http.correction-read-failed', { bodyError: errorDetails(error), correctionError: errorDetails(correctionError) })
          throw correctionError
        }
      }
      throw error
    }
    if (route.kind === 'close-command') {
      const idempotencyKey = request.headers['idempotency-key']
      if (typeof idempotencyKey !== 'string' || idempotencyKey.length === 0) throw serverError('IDEMPOTENCY_KEY_REQUIRED', 'Pokemon Hub close idempotency key is required.')
      const result = await config.pokemonHubSessionService.closeCanonicalSession({
        profileId: route.profileId,
        sessionId: route.sessionId,
        snapshot: body,
        idempotencyKey,
        logger: trace,
        acquireSource: sourceKey => acquirePokemonHubSnapshot(config, route.profileId, { sourceKey, workspaceId: route.sessionId }, trace),
        flushOutgoingSource: source => flushPokemonHubSessionSource(config, route.profileId, source, trace),
        releaseSource: source => releasePokemonHubSessionSourceLease(config, route.profileId, route.sessionId, source, trace),
      })
      if (result.status === 'corrected') json(response, 409, result.snapshot)
      else empty(response, 200)
      return
    }
    if (route.kind === 'attach') {
      json(response, 200, await config.pokemonHubSessionService.attach({
        profileId: route.profileId,
        sessionId: route.sessionId,
        sourceKey: body.sourceKey,
        acquireSource: () => acquirePokemonHubSnapshot(config, route.profileId, { sourceKey: body.sourceKey, workspaceId: route.sessionId }),
      }))
      return
    }
    if (route.kind === 'heartbeat') {
      const result = await config.pokemonHubSessionService.heartbeat({ profileId: route.profileId, sessionId: route.sessionId, sequence: body.sequence })
      json(response, 200, result)
      return
    }
    const idempotencyKey = request.headers['idempotency-key']
    if (typeof idempotencyKey !== 'string' || idempotencyKey.length === 0) throw serverError('SNAPSHOT_IDEMPOTENCY_REQUIRED', 'Snapshot idempotency key is required.')
    trace.info('snapshot.http.body-read', { snapshot: summarizeCanonicalSnapshot(body) })
    let result
    try {
      result = await config.pokemonHubSessionService.syncCanonicalSnapshot({
        profileId: route.profileId,
        sessionId: route.sessionId,
        snapshot: body,
        idempotencyKey,
        logger: trace,
        acquireSource: sourceKey => acquirePokemonHubSnapshot(config, route.profileId, { sourceKey, workspaceId: route.sessionId }, trace),
        flushOutgoingSource: source => flushPokemonHubSessionSource(config, route.profileId, source, trace),
        releaseSource: source => releasePokemonHubSessionSourceLease(config, route.profileId, route.sessionId, source, trace),
      })
    } catch (error) {
      trace.error('snapshot.http.session-sync-failed', { error: errorDetails(error) })
      throw error
    }
    if (result.status === 'accepted') {
      for (const sourceKey of result.dirtySourceKeys ?? []) config.pokemonHubSaveFlush.markDirty({ profileId: route.profileId, sourceKey })
      trace.info('snapshot.http.accepted', { dirtySourceKeys: result.dirtySourceKeys ?? [] })
      empty(response, 200)
      return
    }
    trace.warn('snapshot.http.corrected', { snapshot: summarizeCanonicalSnapshot(result.snapshot) })
    json(response, 409, result.snapshot)
  } catch (error) {
    if (route.kind === 'snapshot') trace.error('snapshot.http.failed', { error: errorDetails(error) })
    if (route.kind === 'heartbeat') trace.error('heartbeat.http.failed', { error: errorDetails(error) })
    jsonPokemonHubError(response, error)
  }
}

async function releasePokemonHubSessionSources(config, profileId, sessionId, sources, { ignoreLeaseInvalid = false } = {}) {
  for (const source of sources) {
    await flushPokemonHubSessionSource(config, profileId, source)
    try {
      await config.pokemonHubSnapshotCoordinator.release({ profileId, sourceKey: source.sourceKey, workspaceId: sessionId, sourceSessionId: source.sourceSessionId, leaseToken: source.leaseToken })
    } catch (error) {
      // An expired workspace no longer owns a lease that another cleanup path has already released.
      if (!ignoreLeaseInvalid || error.code !== 'LEASE_INVALID') throw error
    }
  }
}

async function flushPokemonHubSessionSource(config, profileId, source, logger = config.pokemonHubLogger, generation) {
  if (!source.sourceKey.startsWith(`save:${profileId}:`)) return
  logger.info('snapshot.http.save-flush-started', { profileId, sourceKey: source.sourceKey })
  try {
    const flushed = await config.pokemonHubSaveFlush.flushSource({ profileId, sourceKey: source.sourceKey, ...(generation === undefined ? {} : { generation }) })
    logger.info('snapshot.http.save-flush-finished', { profileId, sourceKey: source.sourceKey, status: flushed.status })
    if (flushed.status === 'failed') throw serverError('SAVE_FLUSH_FAILED', 'Pokemon Hub save could not be flushed before source release.')
  } catch (error) {
    logger.error('snapshot.http.save-flush-failed', { profileId, sourceKey: source.sourceKey, error: errorDetails(error) })
    throw error
  }
}

async function releasePokemonHubSessionSourceLease(config, profileId, sessionId, source, logger = config.pokemonHubLogger) {
  logger.info('snapshot.http.lease-release-started', { profileId, sessionId, sourceKey: source.sourceKey })
  try {
    const released = await config.pokemonHubSnapshotCoordinator.release({ profileId, sourceKey: source.sourceKey, workspaceId: sessionId, sourceSessionId: source.sourceSessionId, leaseToken: source.leaseToken })
    logger.info('snapshot.http.lease-release-finished', { profileId, sessionId, sourceKey: source.sourceKey, released: released.released ?? null })
    return released
  } catch (error) {
    logger.error('snapshot.http.lease-release-failed', { profileId, sessionId, sourceKey: source.sourceKey, error: errorDetails(error) })
    throw error
  }
}

async function transferPokemonHubGrid(config, profileId, body) {
  if (!config.pokemonHubGridTransferService) throw serverError('POKEMON_HUB_TRANSFER_UNAVAILABLE', 'Pokemon Hub grid transfers are unavailable.')
  return config.pokemonHubGridTransferService.transfer({ ...body, profileId })
}

function parsePokemonHubProfileRoute(pathname) {
  const match = /^\/api\/pokemon-hub\/profiles\/([^/]+)$/.exec(pathname)
  return match ? { hubProfileId: match[1] } : null
}

async function handlePokemonHubProfiles(request, response, config) {
  if (request.method === 'GET') {
    json(response, 200, { profiles: await readProjectedPokemonHubProfiles(config) })
    return
  }
  let body
  try { body = await readJsonBody(request) } catch (error) { json(response, 400, { error: error.message }); return }
  try {
    json(response, 201, await config.pokemonHubProfileStore.create(body))
  } catch (error) {
    if (error.code === 'POKEMON_HUB_PROFILE_INVALID') {
      json(response, 400, { error: error.message })
      return
    }
    if (error.code === 'POKEMON_HUB_PROFILE_NAME_DUPLICATE') {
      json(response, 409, { error: error.message })
      return
    }
    throw error
  }
}

async function handlePokemonHubProfile(request, response, config, route, searchParams) {
  if (request.method === 'DELETE') {
    try {
      json(response, 200, await config.pokemonHubProfileStore.delete(route.hubProfileId, { discardOccupied: searchParams.get('discardOccupied') === 'true' }))
    } catch (error) { jsonPokemonHubProfileError(response, error) }
    return
  }
  let body
  try { body = await readJsonBody(request) } catch (error) { json(response, 400, { error: error.message }); return }
  try {
    json(response, 200, await config.pokemonHubProfileStore.rename(route.hubProfileId, body.name))
  } catch (error) { jsonPokemonHubProfileError(response, error) }
}

function jsonPokemonHubProfileError(response, error) {
  const status = error.code === 'POKEMON_HUB_PROFILE_NOT_FOUND' ? 404 : error.code === 'POKEMON_HUB_PROFILE_NAME_DUPLICATE' || error.code === 'POKEMON_HUB_PROFILE_NOT_EMPTY' ? 409 : 400
  json(response, status, { error: error.message })
}

function jsonPokemonHubError(response, error) {
  const status = error.code === 'PROFILE_NOT_FOUND' || error.code === 'SOURCE_NOT_ADOPTED' ? 404 : error.code === 'SESSION_INVALID' ? 410 : error.code === 'POKEMON_HUB_REVISION_CONFLICT' || error.code === 'SNAPSHOT_STALE' ? 412 : error.code === 'SOURCE_RESERVED' || error.code === 'LEASE_INVALID' || error.code === 'SESSION_SOURCE_INVALID' || error.code === 'POKEMON_HUB_GAME_ACTIVE' || error.code === 'POKEMON_HUB_DESTINATION_OCCUPIED' || error.code === 'POKEMON_HUB_SOURCE_EMPTY' || error.code === 'CLOSE_IDEMPOTENCY_CONFLICT' || error.code === 'CLOSE_IN_PROGRESS' || error.code === 'CLOSE_GENERATION_FENCED' || error.code === 'SESSION_TRANSITION_IN_PROGRESS' || error.code === 'SESSION_TRANSITION_FENCED' ? 409 : 400
  json(response, status, { error: error.message, ...(typeof error.code === 'string' ? { code: error.code } : {}) })
}

async function handleSave(request, response, config, { profileId, gameId }) {
  const entry = await findEntry(config, gameId)
  if (entry === null) return json(response, 404, { error: 'Game was not found.' })
  const profile = await config.profileStore.get(entry.id, profileId)
  if (profile === null) return json(response, 404, { error: 'Profile was not found.' })
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
    await adoptSaveIfSupported(config, profileId, entry, { bytes, revision: saved.revision })
    json(response, expectedRevision === null ? 201 : 200, { revision: saved.revision, sha256: saved.sha256 })
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
    entry = await findEntry(config, id)
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

async function findEntry(config, id) {
  const entries = await loadAvailableCatalog(config)
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
    sha1: typeof entry.sha1 === 'string' ? entry.sha1.trim().toLowerCase() : '',
    md5: typeof entry.md5 === 'string' ? entry.md5.trim().toLowerCase() : '',
    sha256: typeof entry.sha256 === 'string' ? entry.sha256.trim().toLowerCase() : '',
    size: Number.isSafeInteger(entry.size) ? entry.size : undefined,
    source: typeof entry.source === 'string' ? entry.source.trim().toLowerCase() : '',
    coverUrl: typeof entry.coverUrl === 'string' ? entry.coverUrl.trim() : '',
    pokeapiVersion: typeof entry.pokeapiVersion === 'string' ? entry.pokeapiVersion.trim().toLowerCase() : '',
    wikipediaPage: typeof entry.wikipediaPage === 'string' ? entry.wikipediaPage.trim() : '',
    region: typeof entry.region === 'string' ? entry.region.trim() : '',
    language: typeof entry.language === 'string' ? entry.language.trim() : '',
    ...(entry.pokemonSave && typeof entry.pokemonSave === 'object' ? { pokemonSave: structuredClone(entry.pokemonSave) } : {}),
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

async function readJsonBody(request, maximumBytes = defaultJsonBodyMaximumBytes) {
  if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
    const error = new Error('Content-Type must be application/json.')
    error.code = 'UNSUPPORTED_CONTENT_TYPE'
    throw error
  }

  const chunks = []
  let length = 0
  for await (const chunk of request) {
    length += chunk.length
    if (length > maximumBytes) {
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

async function handleClientDiagnostics(request, response, config, searchParams) {
  if (request.method === 'GET') {
    json(response, 200, { events: config.clientDiagnosticStore.list({ sessionId: searchParams.get('sessionId') ?? undefined }) })
    return
  }

  try {
    const event = config.clientDiagnosticStore.append(await readJsonBody(request))
    config.clientDiagnosticLogger.info('mobile.client-diagnostic', event)
    empty(response, 204)
  } catch (error) {
    if (error.code === 'CLIENT_DIAGNOSTIC_INVALID' || error.code === 'UNSUPPORTED_CONTENT_TYPE' || error.code === 'REQUEST_BODY_TOO_LARGE' || error.code === 'INVALID_JSON_BODY') {
      json(response, 400, { error: error.message })
      return
    }
    throw error
  }
}

function json(response, status, payload) {
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    'Content-Type': 'application/json; charset=utf-8',
    'X-Emulator-Hub-Backend': '1',
    'X-Content-Type-Options': 'nosniff',
  })
  response.end(body)
}

function isMainModule() {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
}

if (isMainModule()) {
  void startMainServer()
}

function empty(response, status) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Length': 0,
    'X-Emulator-Hub-Backend': '1',
    'X-Content-Type-Options': 'nosniff',
  })
  response.end()
}

async function readProjectedPokemonHubProfiles(config) {
  const profiles = await config.pokemonHubProfileStore.list()
  if (typeof config.pokemonHubSnapshotCoordinator.getSnapshot !== 'function') return profiles
  return Promise.all(profiles.map(async profile => {
    if (!profile.ownerProfileId) return profile
    try {
      const snapshot = await config.pokemonHubSnapshotCoordinator.getSnapshot({ profileId: profile.ownerProfileId, sourceKey: `hub:${profile.hubProfileId}` })
      const entries = Object.fromEntries(snapshot.placements.flatMap(placement => {
        if (!placement.pokemonInstanceId) return []
        return [[String(placement.location.slot), { pokemonInstanceId: placement.pokemonInstanceId, ...(snapshot.pokemonDisplay?.[placement.pokemonInstanceId] ?? {}) }]]
      }))
      return { ...profile, grid: { entries } }
    } catch (error) {
      if (error.code === 'SOURCE_NOT_ADOPTED') return profile
      throw error
    }
  }))
}

async function adoptSaveIfSupported(config, profileId, entry, saved) {
  const layout = getPokemonSaveLayout(entry.pokemonSave?.layoutProfile, entry.pokemonSave?.adapter)
  const adapter = layout && config.pokemonSaveAdapters.get(entry.pokemonSave.adapter)
  if (!adapter) return
  await adoptPokemonHubSave({ coordinator: config.pokemonHubSnapshotCoordinator, profileId, gameId: entry.id, saved, adapter, layout })
}

async function resolvePokemonHubSaveSource(config, { profileId, sourceKey }) {
  const prefix = `save:${profileId}:`
  if (typeof sourceKey !== 'string' || !sourceKey.startsWith(prefix)) return null
  const gameId = sourceKey.slice(prefix.length)
  const entry = await findEntry(config, gameId)
  if (!entry) throw serverError('SAVE_SOURCE_INVALID', 'Pokemon Hub save source is invalid.')
  const layout = getPokemonSaveLayout(entry.pokemonSave?.layoutProfile, entry.pokemonSave?.adapter)
  const adapter = layout && config.pokemonSaveAdapters.get(entry.pokemonSave.adapter)
  if (!adapter) throw serverError('SAVE_SOURCE_UNSUPPORTED', 'Pokemon Hub save source is not supported.')
  return { gameId, adapter, layout }
}

async function acquirePokemonHubSnapshot(config, profileId, request, logger = config.pokemonHubLogger) {
  const input = { ...request, profileId }
  logger.info('snapshot.http.lease-acquire-started', { profileId, workspaceId: request.workspaceId ?? null, sourceKey: request.sourceKey })
  try {
    const acquired = await config.pokemonHubSnapshotCoordinator.acquire(input)
    logger.info('snapshot.http.lease-acquired', { profileId, workspaceId: request.workspaceId ?? null, sourceKey: request.sourceKey, expiresAt: acquired.expiresAt ?? null })
    return acquired
  } catch (error) {
    logger.warn('snapshot.http.lease-acquire-initial-failed', { profileId, workspaceId: request.workspaceId ?? null, sourceKey: request.sourceKey, error: errorDetails(error) })
    if (error.code === 'SOURCE_FLUSH_PENDING') {
      try {
        logger.info('snapshot.http.expired-lease-flush-started', { profileId, sourceKey: request.sourceKey })
        await config.pokemonHubSaveFlush.flushExpiredLeases()
        const acquired = await config.pokemonHubSnapshotCoordinator.acquire(input)
        logger.info('snapshot.http.lease-acquired-after-expired-flush', { profileId, workspaceId: request.workspaceId ?? null, sourceKey: request.sourceKey, expiresAt: acquired.expiresAt ?? null })
        return acquired
      } catch (retryError) {
        logger.error('snapshot.http.lease-acquire-after-expired-flush-failed', { profileId, workspaceId: request.workspaceId ?? null, sourceKey: request.sourceKey, error: errorDetails(retryError) })
        throw retryError
      }
    }
    if (error.code !== 'SOURCE_NOT_ADOPTED') throw error
    const hubProfileId = hubProfileIdFromSourceKey(request.sourceKey)
    if (hubProfileId) {
      try {
        logger.info('snapshot.http.hub-source-adoption-started', { profileId, sourceKey: request.sourceKey, hubProfileId })
        await config.pokemonHubProfileStore.bindOwner(hubProfileId, profileId)
        await config.pokemonHubSnapshotCoordinator.ensureHubSource({
          profileId,
          sourceKey: request.sourceKey,
          hubProfileId,
          minimumSlotCount: 60,
        })
        const acquired = await config.pokemonHubSnapshotCoordinator.acquire(input)
        logger.info('snapshot.http.hub-source-adopted', { profileId, workspaceId: request.workspaceId ?? null, sourceKey: request.sourceKey, expiresAt: acquired.expiresAt ?? null })
        return acquired
      } catch (adoptionError) {
        logger.error('snapshot.http.hub-source-adoption-failed', { profileId, workspaceId: request.workspaceId ?? null, sourceKey: request.sourceKey, error: errorDetails(adoptionError) })
        throw adoptionError
      }
    }
    try {
      logger.info('snapshot.http.save-source-adoption-started', { profileId, workspaceId: request.workspaceId ?? null, sourceKey: request.sourceKey })
      const target = await resolvePokemonHubSaveSource(config, { profileId, sourceKey: request.sourceKey })
      if (!target) throw error
      if (await config.profileStore.get(target.gameId, profileId) === null) throw serverError('PROFILE_NOT_FOUND', 'Profile was not found.')
      const saved = await config.saveStore.get(profileId, target.gameId)
      if (!saved) throw serverError('SAVE_MISSING', 'Save was not found.')
      await adoptPokemonHubSave({ coordinator: config.pokemonHubSnapshotCoordinator, profileId, gameId: target.gameId, saved, adapter: target.adapter, layout: target.layout })
      const acquired = await config.pokemonHubSnapshotCoordinator.acquire(input)
      logger.info('snapshot.http.save-source-adopted', { profileId, workspaceId: request.workspaceId ?? null, sourceKey: request.sourceKey, gameId: target.gameId, expiresAt: acquired.expiresAt ?? null })
      return acquired
    } catch (adoptionError) {
      logger.error('snapshot.http.save-source-adoption-failed', { profileId, workspaceId: request.workspaceId ?? null, sourceKey: request.sourceKey, error: errorDetails(adoptionError) })
      throw adoptionError
    }
  }
}

function hubProfileIdFromSourceKey(sourceKey) {
  if (typeof sourceKey !== 'string' || !sourceKey.startsWith('hub:')) return null
  const hubProfileId = sourceKey.slice('hub:'.length)
  return hubProfileId.length > 0 && !hubProfileId.includes(':') ? hubProfileId : null
}

function normalizePokemonHubLogger(logger) {
  if (logger && typeof logger.info === 'function' && typeof logger.warn === 'function' && typeof logger.error === 'function') {
    return {
      info() {},
      warn() {},
      error(event, context = {}) { logger.error(event, context) },
    }
  }
  return {
    info() {},
    warn() {},
    error(event, context = {}) { console.error(pokemonHubLogLabel(context), { timestamp: new Date().toISOString(), level: 'error', event, ...context }) },
  }
}

function normalizeClientDiagnosticLogger(logger) {
  if (logger && typeof logger.info === 'function') return logger
  return {
    info(event, context = {}) { console.info('[Mobile client diagnostic]', { timestamp: new Date().toISOString(), event, ...context }) },
  }
}

function pokemonHubLogLabel(context) {
  return context.requestType ? `[Pokemon Hub ${context.requestType}]` : '[Pokemon Hub internal]'
}

function childPokemonHubLogger(logger, context) {
  const parent = normalizePokemonHubLogger(logger)
  return {
    info(event, details = {}) { parent.info(event, { ...context, ...details }) },
    warn(event, details = {}) { parent.warn(event, { ...context, ...details }) },
    error(event, details = {}) { parent.error(event, { ...context, ...details }) },
  }
}

function summarizeCanonicalSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return { type: snapshot === null ? 'null' : typeof snapshot }
  const panes = Array.isArray(snapshot.panes) ? snapshot.panes : null
  return {
    revision: Number.isInteger(snapshot.revision) ? snapshot.revision : null,
    paneCount: panes?.length ?? null,
    panes: panes?.map(pane => pane === null ? null : {
      pane: pane.pane ?? null,
      profileType: pane.profile?.type ?? null,
      gameId: pane.profile?.gameId ?? null,
      hubProfileId: pane.profile?.hubProfileId ?? null,
      partyCount: Array.isArray(pane.party) ? pane.party.length : null,
      boxCount: Array.isArray(pane.boxes) ? pane.boxes.length : null,
      hubCount: Array.isArray(pane.hub) ? pane.hub.length : null,
    }) ?? null,
  }
}

function errorDetails(error) {
  return {
    name: error?.name ?? 'Error',
    code: error?.code ?? null,
    message: error?.message ?? String(error),
    stack: error?.stack ?? null,
  }
}

function elapsedMilliseconds(startedAt) {
  return Math.round((performance.now() - startedAt) * 100) / 100
}

function serverError(code, message) { const error = new Error(message); error.code = code; return error }

export async function bootstrapHubServer({
  persistence,
  host,
  port,
  legacyMigrationOptions,
  migrateLegacy = migrateLegacyJsonData,
  makeServer = () => createHubServer({ persistence }),
  onListenError = error => reportListenFailure({ error, host, port, persistence }),
  onListening = () => {},
} = {}) {
  if (!persistence) throw new TypeError('Persistence is required to bootstrap the backend.')
  try {
    await persistence.connect()
    await migrateLegacy({ persistence, ...legacyMigrationOptions })
    const server = makeServer()
    server.once('error', error => { void onListenError(error) })
    server.listen(port, host, onListening)
    return server
  } catch (error) {
    try { await persistence.close() } catch (closeError) { console.error('[Emulator Hub] Redis connection cleanup failed', { message: closeError.message }) }
    throw error
  }
}

async function startMainServer() {
  const { host, port } = backendListenConfiguration()
  const persistence = createRedisPersistence(redisConfiguration())
  try {
    await bootstrapHubServer({
      persistence,
      host,
      port,
      legacyMigrationOptions: {
        profilesPath: defaultProfilesPath,
        controlProfilePath: defaultControlProfilePath,
        pokemonHubProfilesPath: defaultPokemonHubProfilesPath,
        pokemonHubPath: defaultPokemonHubPath,
        romRegistryPath: defaultRomRegistryPath,
      },
      onListening: () => {
        console.log(`Emulator Hub backend listening on http://${host}:${port}`)
      },
    })
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}

async function reportListenFailure({ error, host, port, persistence }) {
  console.error('[Emulator Hub] backend listener failed', await createListenFailureDiagnostic({ error, host, port }))
  try { await persistence.close() } catch (closeError) { console.error('[Emulator Hub] Redis connection cleanup failed', { message: closeError.message }) }
  process.exitCode = 1
}

function redisConfiguration(options = {}) {
  return {
    url: options.redisUrl ?? process.env.REDIS_URL,
    namespace: options.redisNamespace ?? process.env.REDIS_NAMESPACE,
  }
}
