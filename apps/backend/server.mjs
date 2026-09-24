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
import { createRedisUserPreferencesStore } from '../packages/user-preferences-store.mjs'
import { createSaveStore } from '../packages/save-store.mjs'
import { createSnapshotStore } from '../packages/snapshot-store.mjs'
import { createContainerPipelineLogger } from '../packages/snapshot-telemetry.mjs'
import { decodeSnapshotBundle, encodeSnapshotBundle } from '../packages/emulator-snapshot.mjs'
import { createRedisPokemonHubStore } from '../packages/pokemon-hub-store.mjs'
import { createRedisPokemonHubProfileStore } from '../packages/pokemon-hub-profile-store.mjs'
import { createPokemonHubSessionStore } from '../packages/pokemon-hub-session-store.mjs'
import { createPokemonHubSnapshotStore } from '../packages/pokemon-hub-snapshot-store.mjs'
import { createPokemonHubService } from '../packages/pokemon-hub-service.mjs'
import { createPokemonHubGridTransferService } from '../packages/pokemon-hub-grid-transfer-service.mjs'
import { createPokemonHubTransferPlacementPolicy } from '../packages/pokemon-hub-transfer-placement-policy.mjs'
import { createPokemonHubEventStore } from '../packages/pokemon-hub-event-store.mjs'
import { createPokemonHubSnapshotCoordinator } from '../packages/pokemon-hub-snapshot-coordinator.mjs'
import { createPokemonHubSessionService } from '../packages/pokemon-hub-session-service.mjs'
import { adoptPokemonHubSave } from '../packages/pokemon-hub-save-adoption.mjs'
import { createPokemonHubSaveFlushService } from '../packages/pokemon-hub-save-flush.mjs'
import { createPokemonSaveAdapterRegistry } from '../packages/pokemon-save-adapter-registry.mjs'
import { pokemonGen3Adapter } from '../packages/pokemon-gen3-adapter.mjs'
import { getPokemonSaveLayout, getPokemonSaveMetadataForTitle } from '../packages/pokemon-save-layouts.mjs'
import { pokemonHubLocationKey } from '../packages/pokemon-hub-location-key.mjs'
import { createRomDiscovery } from '../packages/rom-discovery.mjs'
import { createRedisRomRegistry } from '../packages/rom-registry.mjs'
import { createRedisPersistence } from '../packages/redis-persistence.mjs'
import { migrateLegacyJsonData } from '../packages/redis-legacy-migration.mjs'
import { createClientDiagnosticStore } from '../packages/client-diagnostic-store.mjs'
import { createPlayerLeaseCoordinator } from '../packages/player-lease-coordinator.mjs'
import { createGameSaveLeaseCoordinator } from '../packages/game-save-lease-coordinator.mjs'
import { createIpsPatchRegistry } from '../packages/game-patches.mjs'
import { createBackendStateBackup } from '../packages/backend-state-backup.mjs'

const backendDirectory = dirname(fileURLToPath(import.meta.url))
const defaultCatalogPath = join(backendDirectory, 'catalog.json')
const defaultRomsDirectory = join(backendDirectory, 'roms')
const defaultPatchesDirectory = join(backendDirectory, 'patches')
const defaultProfilesPath = join(backendDirectory, 'data', 'profiles')
const defaultControlProfilePath = join(backendDirectory, 'data', 'control-profile.json')
const defaultSavesPath = join(backendDirectory, 'data', 'saves')
const defaultSnapshotsPath = join(backendDirectory, 'data', 'snapshots')
const defaultPokemonHubPath = join(backendDirectory, 'data', 'pokemon-hub')
const defaultPokemonHubProfilesPath = join(backendDirectory, 'data', 'pokemon-hub-profiles')
const defaultRomRegistryPath = join(backendDirectory, 'data', 'rom-registry.json')
const defaultBackupsPath = join(backendDirectory, 'data', 'backups')
const loadGameMetadata = createGameMetadataLoader()
const execFileAsync = promisify(execFile)
const defaultJsonBodyMaximumBytes = 4 * 1024
const pokemonHubSnapshotMaximumBytes = 128 * 1024
const reportedOptionalPatchWarnings = new Set()

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
  const gameSaveLeases = options.gameSaveLeases ?? createGameSaveLeaseCoordinator({ persistence })
  const config = {
    persistence,
    catalogPath: options.catalogPath ?? defaultCatalogPath,
    romsDirectory: options.romsDirectory ?? options.romsDir ?? defaultRomsDirectory,
    patchesDirectory: options.patchesDirectory ?? options.patchesDir ?? defaultPatchesDirectory,
    ipsPatchRegistry: options.ipsPatchRegistry ?? createIpsPatchRegistry({ patchesDirectory: options.patchesDirectory ?? options.patchesDir ?? defaultPatchesDirectory }),
    persistence,
    romRegistry: options.romRegistry ?? createRedisRomRegistry({ persistence }),
    romDiscovery: options.romDiscovery ?? createRomDiscovery({ lookupBatch: options.romLookupBatch ?? lookupRomBatch, refreshLegacyMetadata: options.refreshLegacyMetadata ?? !options.catalogPath }),
    metadataLoader: options.metadataLoader ?? loadGameMetadata,
    profileStore: options.profileStore ?? createRedisProfileStore({ persistence }),
    controlProfileStore: options.controlProfileStore ?? createRedisControlProfileStore({ persistence }),
    userPreferencesStore: options.userPreferencesStore ?? createRedisUserPreferencesStore({ persistence }),
    saveStore: options.saveStore ?? createSaveStore({ dataPath: options.savesPath ?? defaultSavesPath }),
    snapshotStore: options.snapshotStore ?? createSnapshotStore({ dataPath: options.snapshotsPath ?? defaultSnapshotsPath }),
    pokemonHubStore: options.pokemonHubStore ?? createRedisPokemonHubStore({ persistence }),
    pokemonHubProfileStore: options.pokemonHubProfileStore ?? createRedisPokemonHubProfileStore({ persistence }),
    pokemonHubSessions: options.pokemonHubSessions ?? createPokemonHubSessionStore(),
    pokemonHubSnapshots: options.pokemonHubSnapshots ?? createPokemonHubSnapshotStore(),
    pokemonSaveAdapters: options.pokemonSaveAdapters ?? createPokemonSaveAdapterRegistry([pokemonGen3Adapter]),
    pokemonHubEventStore: options.pokemonHubEventStore ?? createPokemonHubEventStore({ persistence }),
    pokemonHubLogger: normalizePokemonHubLogger(options.pokemonHubLogger),
    savePipelineLogger: normalizeSavePipelineLogger(options.savePipelineLogger),
    clientDiagnosticStore: options.clientDiagnosticStore ?? createClientDiagnosticStore(),
    clientDiagnosticLogger: normalizeClientDiagnosticLogger(options.clientDiagnosticLogger),
    gameSaveLeases,
    playerLeases: options.playerLeases ?? createPlayerLeaseCoordinator({ persistence, gameSaveLeases }),
    backupToken: options.backupToken ?? process.env.EMULATOR_HUB_BACKUP_TOKEN ?? '',
  }
  config.backupService = options.backupService ?? (typeof config.saveStore.listAll === 'function'
    ? createBackendStateBackup({ persistence, saveStore: config.saveStore, backupsPath: options.backupsPath ?? defaultBackupsPath, namespace: options.redisNamespace ?? process.env.REDIS_NAMESPACE ?? null })
    : null)
  config.pokemonHubSnapshotCoordinator = options.pokemonHubSnapshotCoordinator ?? createPokemonHubSnapshotCoordinator({ persistence, eventStore: config.pokemonHubEventStore, logger: config.pokemonHubLogger, validatePlacementChange: createPokemonHubTransferPlacementPolicy(), gameSaveLeases: config.gameSaveLeases })
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
  server.backendStateBackup = config.backupService
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

  const patchRoute = parsePatchRoute(route.pathname)
  const isRomRoute = route.pathname.startsWith('/roms/')
  const gameProfilesRoute = parseGameProfilesRoute(route.pathname)
  const gameProfileRoute = parseGameProfileRoute(route.pathname)
  const oddsStateRoute = parseOddsStateRoute(route.pathname)
  const isControlProfileRoute = route.pathname === '/api/control-profile'
  const isUserPreferencesRoute = route.pathname === '/api/user-preferences'
  const saveRoute = parseSaveRoute(route.pathname)
  const snapshotRoute = parseSnapshotRoute(route.pathname)
  const playerLeaseRoute = parsePlayerLeaseRoute(route.pathname)
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
  const isBackupRoute = route.pathname === '/api/ops/backups/backend-state'
  const supportedMethod = request.method === 'GET'
    || (request.method === 'HEAD' && isRomRoute && !patchRoute)
    || (request.method === 'POST' && gameProfilesRoute)
    || (request.method === 'POST' && pokemonHubProfilesRoute)
    || ((request.method === 'PATCH' || request.method === 'DELETE') && pokemonHubProfileRoute)
    || (request.method === 'PUT' && (isControlProfileRoute || saveRoute || snapshotRoute))
    || (request.method === 'DELETE' && snapshotRoute)
    || (request.method === 'PATCH' && isUserPreferencesRoute)
    || (playerLeaseRoute && ((request.method === 'POST' && ['acquire', 'heartbeat'].includes(playerLeaseRoute.kind)) || (request.method === 'DELETE' && playerLeaseRoute.kind === 'release') || (request.method === 'GET' && playerLeaseRoute.kind === 'launch')))
    || (request.method === 'POST' && ['transfer', 'snapshot-acquire', 'snapshot-renew', 'snapshot-sync', 'snapshot-release'].includes(pokemonHubRoute?.kind))
    || (pokemonHubSessionRoute && ((request.method === 'POST' && ['open', 'attach', 'pane-load', 'heartbeat', 'snapshot', 'close-command'].includes(pokemonHubSessionRoute.kind)) || (request.method === 'DELETE' && ['detach', 'close'].includes(pokemonHubSessionRoute.kind))))
    || (request.method === 'PATCH' && gameProfileRoute)
    || (request.method === 'PATCH' && oddsStateRoute)
    || (request.method === 'DELETE' && gameProfileRoute)
    || (isClientDiagnosticsRoute && request.method === 'POST')
    || (isBackupRoute && request.method === 'POST')
  if (!supportedMethod) {
    response.setHeader('Allow', isClientDiagnosticsRoute ? 'GET, POST' : isUserPreferencesRoute ? 'GET, PATCH' : pokemonHubSessionRoute ? pokemonHubSessionRoute.kind === 'detach' || pokemonHubSessionRoute.kind === 'close' ? 'DELETE' : 'POST' : pokemonHubRoute ? ['transfer', 'snapshot-acquire', 'snapshot-renew', 'snapshot-sync', 'snapshot-release'].includes(pokemonHubRoute.kind) ? 'POST' : 'GET' : pokemonHubProfileRoute ? 'PATCH, DELETE' : pokemonHubProfilesRoute || gameProfilesRoute ? 'GET, POST' : snapshotRoute ? 'GET, PUT, DELETE' : saveRoute || isControlProfileRoute ? 'GET, PUT' : gameProfileRoute ? 'PATCH, DELETE' : patchRoute ? 'GET' : isRomRoute ? 'GET, HEAD' : 'GET')
    json(response, 405, { error: 'Method is not supported for this route.' })
    return
  }

  if (isBackupRoute) {
    await handleBackendStateBackup(request, response, config)
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
    await getSaveLayout(response, config, { ...saveLayoutRoute, workspaceProfileId: route.searchParams.get('workspaceProfileId') || saveLayoutRoute.profileId })
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

  if (snapshotRoute) {
    await handleSnapshot(request, response, config, snapshotRoute, route.searchParams)
    return
  }

  if (playerLeaseRoute) {
    await handlePlayerLease(request, response, config, playerLeaseRoute, route.searchParams)
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

  if (patchRoute) {
    await streamGamePatch(response, config, patchRoute.id)
    return
  }

  if (oddsStateRoute) {
    await handleOddsState(request, response, config, oddsStateRoute)
    return
  }

  if (isUserPreferencesRoute) {
    if (request.method === 'GET') {
      response.setHeader('Cache-Control', 'no-store')
      json(response, 200, await config.userPreferencesStore.get())
    } else {
      let body
      try { body = await readJsonBody(request) } catch (error) { json(response, error.code === 'REQUEST_BODY_TOO_LARGE' ? 413 : 400, { error: error.message }); return }
      try {
        response.setHeader('Cache-Control', 'no-store')
        json(response, 200, await config.userPreferencesStore.patch(body))
      } catch (error) {
        if (error.code === 'USER_PREFERENCES_INVALID') { json(response, 400, { error: error.message }); return }
        throw error
      }
    }
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
  return [...byId.values()].map(entry => entry.pokemonSave ? entry : { ...entry, ...(getPokemonSaveMetadataForTitle(entry.title) ? { pokemonSave: getPokemonSaveMetadataForTitle(entry.title) } : {}) })
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

function parseOddsStateRoute(pathname) {
  const match = /^\/api\/games\/([^/]+)\/profiles\/([^/]+)\/odds-state$/.exec(pathname)
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
  if (await isGameSaveLeased(config, { profileId: route.profileId, gameId: entry.id })) {
    return json(response, 409, { error: 'This profile is open in an active game save session.', code: 'GAME_SAVE_LEASE_HELD' })
  }
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
  const profiles = await config.profileStore.list(gameId)
  json(response, 200, { profiles: await Promise.all(profiles.map(async profile => ({ ...profile, leaseActive: await isGameSaveLeased(config, { profileId: profile.id, gameId }) }))) })
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
    const romVerification = await verifyRom(entry, config.romsDirectory)
    const verification = romVerification
    const game = {
      id: entry.id,
      title: entry.title,
      system: entry.system,
      core: entry.core,
      status: verification.ok ? 'ready' : 'unavailable',
      pokemonHubSaveSupported: Boolean(getPokemonSaveLayout(entry.pokemonSave?.layoutProfile, entry.pokemonSave?.adapter, entry.pokemonSave?.title) && config.pokemonSaveAdapters.get(entry.pokemonSave?.adapter)),
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
        leaseActive: await isGameSaveLeased(config, { profileId: profile.id, gameId: entry.id }),
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
    const layout = getPokemonSaveLayout(entry.pokemonSave?.layoutProfile, entry.pokemonSave?.adapter, entry.pokemonSave?.title)
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

  const patchVerification = await verifyGamePatch(entry, config)
  if (!patchVerification.ok) {
    json(response, 409, { error: patchVerification.reason })
    return
  }

  json(response, 200, launchDescriptor(entry, profile.id, patchVerification.patch))
}

async function handleOddsState(request, response, config, route) {
  const entry = await findProfileGame(response, config, route.gameId)
  if (entry === null) return
  let body
  try {
    body = await readJsonBody(request)
  } catch (error) {
    json(response, error.code === 'REQUEST_BODY_TOO_LARGE' ? 413 : 400, { error: error.message })
    return
  }
  try {
    const profile = await config.profileStore.updateOddsResetCount(entry.id, route.profileId, body.oddsResetCount)
    if (profile === null) return json(response, 404, { error: 'Profile was not found.' })
    console.info('[odds-manipulator] odds.sync.persisted', { gameId: entry.id, profileId: route.profileId, oddsResetCount: profile.oddsResetCount })
    json(response, 200, profile)
  } catch (error) {
    if (error.code === 'PROFILE_ODDS_COUNT_INVALID') {
      console.warn('[odds-manipulator] odds.sync.rejected', { gameId: entry.id, profileId: route.profileId, error: error.message })
      return json(response, 400, { error: error.message, code: error.code })
    }
    throw error
  }
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
  const match = /^\/api\/profiles\/([^/]+)\/pokemon-hub\/sessions(?:\/([^/]+)(?:\/(sources)(?:\/([^/]+))?|\/(panes)\/(\d+)|\/(heartbeat|snapshots|close))?)?$/.exec(pathname)
  if (!match) return null
  const [, profileId, sessionId, sources, sourceId, panes, pane, action] = match
  if (!sessionId) return { profileId, kind: 'open' }
  if (sources && sourceId) return { profileId, sessionId, sourceId, kind: 'detach' }
  if (sources) return { profileId, sessionId, kind: 'attach' }
  if (panes) return { profileId, sessionId, pane: Number(pane), kind: 'pane-load' }
  if (action === 'heartbeat') return { profileId, sessionId, kind: 'heartbeat' }
  if (action === 'snapshots') return { profileId, sessionId, kind: 'snapshot' }
  if (action === 'close') return { profileId, sessionId, kind: 'close-command' }
  return { profileId, sessionId, kind: 'close' }
}

function parseSaveLayoutRoute(pathname) {
  const match = /^\/api\/pokemon-hub\/save-profiles\/([^/]+)\/([^/]+)\/layout$/.exec(pathname)
  return match ? { gameId: match[1], profileId: match[2] } : null
}

async function getSaveLayout(response, config, { gameId, profileId, workspaceProfileId = profileId }) {
  const entry = await findEntry(config, gameId)
  if (entry === null) return json(response, 404, { error: 'Game was not found.' })
  if (await config.profileStore.get(entry.id, profileId) === null) return json(response, 404, { error: 'Profile was not found.' })
  const activeLease = await config.gameSaveLeases.get({ profileId, gameId: entry.id })
  if (activeLease?.ownerKind === 'player') return json(response, 409, { error: 'This save is open in an active player session.', code: 'SAVE_IN_USE_BY_PLAYER' })
  const save = await config.saveStore.get(profileId, entry.id)
  if (save === null) return json(response, 404, { error: 'Save was not found.', code: 'SAVE_MISSING' })
  const layout = getPokemonSaveLayout(entry.pokemonSave?.layoutProfile, entry.pokemonSave?.adapter, entry.pokemonSave?.title)
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
      snapshot = await config.pokemonHubSnapshotCoordinator.getSnapshot({ profileId: workspaceProfileId, sourceKey: `save:${profileId}:${gameId}` })
      if (snapshot.saveRevision !== save.revision && !snapshot.needsSaveFlush && typeof adapter.readAllSlots === 'function') {
        snapshot = await adoptPokemonHubSave({ coordinator: config.pokemonHubSnapshotCoordinator, profileId: workspaceProfileId, sourceProfileId: profileId, gameId, saved: save, adapter, layout })
      }
    } catch (error) {
      if (error.code !== 'SOURCE_NOT_ADOPTED') throw error
      if (typeof adapter.readAllSlots === 'function') snapshot = await adoptPokemonHubSave({ coordinator: config.pokemonHubSnapshotCoordinator, profileId: workspaceProfileId, sourceProfileId: profileId, gameId, saved: save, adapter, layout })
    }
    const pokemonInstanceIds = new Map((snapshot?.placements ?? []).map(placement => [pokemonHubLocationKey(placement.location), placement.pokemonInstanceId]))
    const withPokemonId = (slot, location) => slot.occupied && pokemonInstanceIds.get(pokemonHubLocationKey(location))
      ? { ...slot, pokemonInstanceId: pokemonInstanceIds.get(pokemonHubLocationKey(location)) }
      : slot
    json(response, 200, {
      layout: { id: layout.id, party: { slots: layout.party.slots }, boxes: layout.boxes },
      ...(inspection.transferCapabilities ? { transferCapabilities: inspection.transferCapabilities } : {}),
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
      if (result.status === 'corrected') json(response, 409, { ...result.snapshot, ...(result.reason ? { reason: result.reason } : {}) })
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
    if (route.kind === 'pane-load') {
      const result = await loadPokemonHubSessionPane(config, route, body, trace)
      json(response, result.corrected ? 409 : 200, result.snapshot)
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
    json(response, 409, { ...result.snapshot, ...(result.reason ? { reason: result.reason } : {}) })
  } catch (error) {
    if (route.kind === 'snapshot') trace.error('snapshot.http.failed', { error: errorDetails(error) })
    if (route.kind === 'heartbeat') trace.error('heartbeat.http.failed', { error: errorDetails(error) })
    jsonPokemonHubError(response, error)
  }
}

async function loadPokemonHubSessionPane(config, route, body, logger) {
  const source = body?.source
  const sourceKey = pokemonHubPaneSourceKey(source)
  if (!sourceKey) throw serverError('SESSION_SOURCE_INVALID', 'Pokemon Hub pane source is invalid.')
  const profile = source.kind === 'hub'
    ? { type: 'hub-profile', hubProfileId: source.hubProfileId }
    : { type: 'save', profileId: source.profileId, gameId: source.gameId }
  const result = await config.pokemonHubSessionService.loadCanonicalPane({
    profileId: route.profileId,
    sessionId: route.sessionId,
    pane: route.pane,
    sourceKey,
    profile,
    acquireSource: requestedSourceKey => acquirePokemonHubSnapshot(config, route.profileId, { sourceKey: requestedSourceKey, workspaceId: route.sessionId }, logger),
    flushOutgoingSource: source => flushPokemonHubSessionSource(config, route.profileId, source, logger),
    releaseSource: source => releasePokemonHubSessionSourceLease(config, route.profileId, route.sessionId, source, logger),
  })
  return { corrected: result.status === 'corrected', snapshot: result.snapshot }
}

function pokemonHubPaneSourceKey(source) {
  if (source?.kind === 'hub' && typeof source.hubProfileId === 'string' && source.hubProfileId) return `hub:${source.hubProfileId}`
  if (source?.kind === 'game' && typeof source.profileId === 'string' && source.profileId && typeof source.gameId === 'string' && source.gameId) return `save:${source.profileId}:${source.gameId}`
  return null
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
  if (!source.sourceKey.startsWith('save:')) return
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

async function handleSnapshot(request, response, config, { profileId, gameId }, searchParams) {
  const kind = searchParams.get('kind') ?? 'cloud-recovery'
  const log = (level, event, details = {}) => emitSnapshotLog(config, level, `snapshot.backend.${event}`, { profileId, gameId, kind, ...details })
  if (!['cloud-recovery', 'user-state'].includes(kind)) {
    log('warn', 'request-rejected', { reason: 'invalid-kind' })
    return json(response, 400, { error: 'Snapshot kind is invalid.' })
  }
  const entry = await findEntry(config, gameId)
  if (entry === null) {
    log('warn', 'request-rejected', { reason: 'game-not-found' })
    return json(response, 404, { error: 'Game was not found.' })
  }
  if (await config.profileStore.get(entry.id, profileId) === null) {
    log('warn', 'request-rejected', { reason: 'profile-not-found' })
    return json(response, 404, { error: 'Profile was not found.' })
  }
  let lease
  try {
    lease = playerLeaseHeaders(request)
    await config.playerLeases.assertWrite({ profileId, gameId, ...lease })
  } catch (error) {
    log('warn', 'lease-rejected', { code: error.code ?? null, error: error.message })
    return json(response, 410, { error: error.message, ...(error.code ? { code: error.code } : {}) })
  }
  if (request.method === 'GET') {
    let snapshot
    try { snapshot = await config.snapshotStore.get(profileId, gameId, { kind }) }
    catch (error) { log('error', 'read-failed', { code: error.code ?? null, error: error.message }); throw error }
    if (!snapshot) return json(response, 404, { error: 'Snapshot was not found.' })
    log('info', 'candidate-available', { revision: snapshot.metadata.revision, reason: snapshot.metadata.reasonCode, saveRevision: snapshot.metadata.saveRevision })
    const bytes = await encodeSnapshotBundle({ metadata: { ...snapshot.metadata, profileId, gameId }, state: snapshot.state })
    response.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Length': bytes.length, 'Content-Type': 'application/vnd.emulator-hub.snapshot', ETag: `"${snapshot.metadata.revision}"`, 'X-Snapshot-Sha256': snapshot.metadata.sha256, 'X-Content-Type-Options': 'nosniff' })
    response.end(bytes)
    return
  }
  if (request.method === 'DELETE') {
    const expectedRevision = parseExpectedRevision(request.headers['if-match'])
    if (!Number.isInteger(expectedRevision)) {
      log('warn', 'delete-rejected', { reason: 'missing-revision' })
      return json(response, 428, { error: 'A specific If-Match snapshot revision is required.' })
    }
    try {
      await config.snapshotStore.delete(profileId, gameId, { expectedRevision, fenceGeneration: lease.generation, kind })
      log('info', 'deleted', { revision: expectedRevision, leaseGeneration: lease.generation })
      response.writeHead(204, { 'Cache-Control': 'no-store' })
      response.end()
    } catch (error) {
      const status = error.code === 'SNAPSHOT_REVISION_CONFLICT' ? 412 : error.code === 'SNAPSHOT_FENCE_CONFLICT' ? 409 : 400
      log(status === 400 ? 'error' : 'warn', 'delete-rejected', { revision: expectedRevision, status, code: error.code ?? null, error: error.message })
      json(response, status, { error: error.message, ...(error.code ? { code: error.code } : {}) })
    }
    return
  }
  let decoded
  try { decoded = await decodeSnapshotBundle(await readBinaryBody(request, 'application/vnd.emulator-hub.snapshot', 35 * 1024 * 1024)) }
  catch (error) {
    log('warn', 'put-rejected', { phase: 'decode', code: error.code ?? null, error: error.message })
    return json(response, error.code === 'REQUEST_BODY_TOO_LARGE' ? 413 : 400, { error: error.message, ...(error.code ? { code: error.code } : {}) })
  }
  const expectedRevision = parseExpectedRevision(request.headers['if-match'])
  if (expectedRevision === undefined) {
    log('warn', 'put-rejected', { reason: 'missing-revision' })
    return json(response, 428, { error: 'If-Match is required.' })
  }
  const patchVerification = await verifyGamePatch(entry, config)
  if (!patchVerification.ok) {
    log('warn', 'put-rejected', { reason: 'patch-incompatible' })
    return json(response, 409, { error: patchVerification.reason })
  }
  const runtimeId = 'emulatorjs-4.2.3'
  if (decoded.metadata.profileId !== profileId || decoded.metadata.gameId !== gameId || decoded.metadata.core !== entry.core || decoded.metadata.romSha256 !== entry.sha256 || decoded.metadata.runtimeId !== runtimeId || decoded.metadata.patchSha256 !== patchVerification.patch?.sha256) {
    log('warn', 'put-rejected', { reason: 'launch-incompatible' })
    return json(response, 400, { error: 'Snapshot metadata is incompatible with this launch.' })
  }
  if (decoded.metadata.kind !== undefined && decoded.metadata.kind !== kind) {
    log('warn', 'put-rejected', { reason: 'kind-mismatch' })
    return json(response, 400, { error: 'Snapshot kind does not match its route.' })
  }
  if (kind === 'user-state' && decoded.metadata.promptOnLaunch === false) {
    log('warn', 'put-rejected', { reason: 'manual-suppression-forbidden' })
    return json(response, 400, { error: 'User state cannot suppress the restore offer.' })
  }
  if (decoded.metadata.promptOnLaunch === false) {
    const save = await config.saveStore.get(profileId, gameId)
    if (!save || save.revision !== decoded.metadata.saveRevision) {
      log('warn', 'put-rejected', { reason: 'save-revision-mismatch', saveRevision: decoded.metadata.saveRevision, currentSaveRevision: save?.revision ?? null })
      return json(response, 409, { error: 'Snapshot suppression requires the current canonical save revision.', code: 'SNAPSHOT_SAVE_REVISION_MISMATCH' })
    }
  }
  try {
    const saved = await config.snapshotStore.put(profileId, gameId, decoded, expectedRevision, { fenceGeneration: lease.generation, kind })
    if (kind === 'user-state') log('info', 'user-state-persisted', { revision: saved.revision, saveRevision: decoded.metadata.saveRevision, reason: decoded.metadata.reasonCode })
    json(response, expectedRevision === null ? 201 : 200, saved)
  } catch (error) {
    const status = error.code === 'SNAPSHOT_REVISION_CONFLICT' ? 412 : error.code === 'SNAPSHOT_FENCE_CONFLICT' ? 409 : 400
    log(status === 400 ? 'error' : 'warn', 'put-rejected', { status, code: error.code ?? null, error: error.message, expectedRevision })
    json(response, status, { error: error.message, ...(error.code ? { code: error.code } : {}) })
  }
}

async function handleSave(request, response, config, { profileId, gameId }) {
  const tracingPut = request.method === 'PUT'
  const tracingGet = request.method === 'GET'
  const tracingRequest = tracingPut || tracingGet
  const traceId = tracingRequest ? getSaveTraceId(request) : null
  const startedAt = performance.now()
  const log = (event, details = {}, level = 'info') => {
    if (!tracingRequest) return
    config.savePipelineLogger[level](`save.backend.${event}`, { traceId, profileId, gameId, ...details })
  }
  if (tracingRequest) {
    response.setHeader('X-Save-Trace-Id', traceId)
    log(tracingPut ? 'put-received' : 'get-received', {
      contentType: request.headers['content-type'] ?? null,
      contentLength: parseContentLength(request.headers['content-length']),
      ifMatch: request.headers['if-match'] ?? null,
    })
    request.once('aborted', () => log('request-aborted', { elapsedMs: elapsedMilliseconds(startedAt) }, 'error'))
    request.once('error', error => log('request-error', { elapsedMs: elapsedMilliseconds(startedAt), error: error.message }, 'error'))
    response.once('finish', () => log('response', { status: response.statusCode, elapsedMs: elapsedMilliseconds(startedAt) }))
    response.once('close', () => {
      if (!response.writableFinished) log('response-closed', { status: response.statusCode, elapsedMs: elapsedMilliseconds(startedAt) }, 'error')
    })
  }
  let entry
  try {
    entry = await findEntry(config, gameId)
  } catch (error) {
    log('failed', { stage: 'catalog-lookup', code: error.code ?? null, error: error.message }, 'error')
    throw error
  }
  if (entry === null) {
    log('rejected', { stage: 'catalog-lookup', reason: 'game-not-found' }, 'warn')
    return json(response, 404, { error: 'Game was not found.' })
  }
  let profile
  try {
    profile = await config.profileStore.get(entry.id, profileId)
  } catch (error) {
    log('failed', { stage: 'profile-lookup', code: error.code ?? null, error: error.message }, 'error')
    throw error
  }
  if (profile === null) {
    log('rejected', { stage: 'profile-lookup', reason: 'profile-not-found' }, 'warn')
    return json(response, 404, { error: 'Profile was not found.' })
  }
  if (request.method === 'GET') {
    log('read-started')
    let save
    try {
      save = await config.saveStore.get(profileId, gameId)
    } catch (error) {
      log('failed', { stage: 'read', code: error.code ?? null, error: error.message }, 'error')
      throw error
    }
    if (save === null) {
      log('read-missing', {}, 'warn')
      return json(response, 404, { error: 'Save was not found.' })
    }
    log('read-completed', { sizeBytes: save.bytes.length, revision: save.revision, sha256: save.sha256 ?? null })
    response.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Length': save.bytes.length, 'Content-Type': 'application/octet-stream', ETag: `"${save.revision}"`, 'X-Save-Sha256': save.sha256, 'X-Content-Type-Options': 'nosniff' })
    response.end(save.bytes)
    return
  }
  let bytes
  try {
    bytes = await readBinaryBody(request)
  } catch (error) {
    log('body-rejected', { code: error.code ?? null, error: error.message }, 'warn')
    return json(response, error.code === 'REQUEST_BODY_TOO_LARGE' ? 413 : 415, { error: error.message })
  }
  const payloadHash = createHash('sha256').update(bytes).digest('hex')
  log('body-received', { sizeBytes: bytes.length, sha256: payloadHash })
  const expectedRevision = parseExpectedRevision(request.headers['if-match'])
  if (expectedRevision === undefined) {
    log('precondition-rejected', { reason: 'invalid-if-match' }, 'warn')
    return json(response, 428, { error: 'If-Match is required.' })
  }
  let pipelineStage = 'lease-validation'
  let persistedRevision = null
  try {
    const lease = playerLeaseHeaders(request)
    await config.playerLeases.assertWrite({ profileId, gameId, ...lease })
    log('lease-validated', { leaseGeneration: lease.generation })
    pipelineStage = 'persistence'
    log('persist-started', { sizeBytes: bytes.length, sha256: payloadHash, expectedRevision, fenceGeneration: lease.generation })
    const saved = await config.saveStore.put(profileId, gameId, bytes, expectedRevision, { fenceGeneration: lease.generation })
    persistedRevision = saved.revision
    log('persisted', { sizeBytes: bytes.length, sha256: saved.sha256 ?? payloadHash, revision: saved.revision })
    pipelineStage = 'adoption'
    log('adoption-started', { revision: saved.revision })
    const adopted = await adoptSaveIfSupported(config, profileId, entry, { bytes, revision: saved.revision })
    log(adopted ? 'adopted' : 'adoption-skipped', { revision: saved.revision, reason: adopted ? undefined : 'unsupported-save-adapter' })
    json(response, expectedRevision === null ? 201 : 200, { revision: saved.revision, sha256: saved.sha256 })
  } catch (error) {
    const status = error.code === 'SAVE_REVISION_CONFLICT' ? 412 : error.code === 'PLAYER_LEASE_INVALID' ? 410 : error.code === 'SAVE_FENCE_CONFLICT' ? 409 : 400
    log('failed', { stage: pipelineStage, persistedRevision, code: error.code ?? null, error: error.message }, 'error')
    json(response, status, { error: error.message, ...(error.code ? { code: error.code } : {}) })
  }
}

function getSaveTraceId(request) {
  const candidate = request.headers['x-save-trace-id']
  return typeof candidate === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(candidate) ? candidate : randomUUID()
}

async function handleBackendStateBackup(request, response, config) {
  if (!config.backupToken || !config.backupService) return json(response, 503, { error: 'Backend backups are not configured.' })
  const authorization = request.headers.authorization
  const expected = `Bearer ${config.backupToken}`
  if (authorization !== expected) return json(response, 401, { error: 'Backup authorization is required.' })
  try {
    const result = await config.backupService.create('operator')
    return json(response, 201, result)
  } catch (error) {
    console.error('[Emulator Hub] backend state backup failed', { code: error.code ?? null, message: error.message })
    return json(response, 500, { error: 'Backend state backup failed.' })
  }
}

async function readBinaryBody(request, expectedContentType = 'application/octet-stream', maximumBytes = 2 * 1024 * 1024) {
  if (request.headers['content-type']?.toLowerCase() !== expectedContentType) {
    const error = new Error(`Content-Type must be ${expectedContentType}.`)
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

async function streamGamePatch(response, config, encodedId) {
  const id = decodeId(encodedId)
  if (id === null) return json(response, 400, { error: 'Malformed game ID.' })
  const entry = await findEntry(config, id)
  if (entry === null) return json(response, 404, { error: 'Game was not found.' })
  const romVerification = await verifyRom(entry, config.romsDirectory)
  if (!romVerification.ok) return json(response, 409, { error: romVerification.reason })
  const patchVerification = await verifyGamePatch(entry, config)
  if (!patchVerification.ok) return json(response, patchVerification.status ?? 409, { error: patchVerification.reason })
  if (patchVerification.patch === null) return json(response, 404, { error: 'Game has no associated patch.' })
  response.writeHead(200, {
    'Cache-Control': 'no-store',
    'Content-Length': patchVerification.patch.bytes.length,
    'Content-Type': 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
  })
  response.end(patchVerification.patch.bytes)
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

async function verifyGamePatch(entry, config) {
  const { patch, warning } = await config.ipsPatchRegistry.findForRomSha256(entry.sha256)
  if (warning) return optionalPatchUnavailable(entry, warning)
  return { ok: true, patch }
}

function optionalPatchUnavailable(entry, reason) {
  const warningKey = `${entry.sha256}:${reason}`
  if (!reportedOptionalPatchWarnings.has(warningKey)) {
    reportedOptionalPatchWarnings.add(warningKey)
    console.warn('[game-patch]', { event: 'optional-patch-skipped', gameId: entry.id, reason })
  }
  return { ok: true, patch: null, warning: reason }
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

function parseSnapshotRoute(pathname) {
  const match = /^\/api\/profiles\/([^/]+)\/games\/([^/]+)\/snapshot$/.exec(pathname)
  return match ? { profileId: match[1], gameId: match[2] } : null
}

function parsePlayerLeaseRoute(pathname) {
  const acquire = /^\/api\/games\/([^/]+)\/player-leases$/.exec(pathname)
  if (acquire) return { kind: 'acquire', gameId: acquire[1] }
  const session = /^\/api\/player-leases\/([^/]+)(?:\/(launch|heartbeat))?$/.exec(pathname)
  if (!session) return null
  return { kind: session[2] ?? 'release', sessionId: session[1] }
}

function parsePatchRoute(pathname) {
  const match = /^\/roms\/([^/]+)\/patch$/.exec(pathname)
  return match ? { id: match[1] } : null
}

async function handlePlayerLease(request, response, config, route, searchParams) {
  const deviceId = playerDeviceId(request, response)
  if (route.kind === 'acquire') {
    let body
    try { body = await readJsonBody(request) } catch (error) { return json(response, 400, { error: error.message }) }
    const entry = await findEntry(config, decodeId(route.gameId))
    if (!entry) return json(response, 404, { error: 'Game was not found.' })
    if (await config.profileStore.get(entry.id, body.profileId) === null) return json(response, 404, { error: 'Profile was not found.' })
    const verification = await verifyRom(entry, config.romsDirectory)
    if (!verification.ok) return json(response, 409, { error: verification.reason })
    const patchVerification = await verifyGamePatch(entry, config)
    if (!patchVerification.ok) return json(response, 409, { error: patchVerification.reason })
    try {
      const minimumGeneration = await nextPlayerLeaseGeneration(config, body.profileId, entry.id)
      const lease = await config.playerLeases.acquire({ profileId: body.profileId, gameId: entry.id, deviceId, sessionId: body.sessionId, minimumGeneration })
      try { await config.saveStore.advanceFence(body.profileId, entry.id, lease.generation) } catch (error) { if (error.code !== 'SAVE_MISSING') throw error }
      try { await config.snapshotStore.advanceFence(body.profileId, entry.id, lease.generation) } catch (error) { if (error.code !== 'SNAPSHOT_MISSING') throw error }
      try { await config.snapshotStore.advanceFence(body.profileId, entry.id, lease.generation, { kind: 'user-state' }) } catch (error) { if (error.code !== 'SNAPSHOT_MISSING') throw error }
      return json(response, 200, { ...launchDescriptor(entry, body.profileId, patchVerification.patch), leaseGeneration: lease.generation })
    } catch (error) { return json(response, error.code === 'PLAYER_LEASE_HELD' ? 409 : 400, { error: error.message, code: error.code }) }
  }
  let body
  try { body = request.method === 'GET' ? Object.fromEntries(searchParams) : await readJsonBody(request) } catch (error) { return json(response, 400, { error: error.message }) }
  try {
    const input = { profileId: body.profileId, gameId: body.gameId, deviceId, sessionId: route.sessionId, generation: body.generation }
    if (route.kind === 'heartbeat') return json(response, 200, await config.playerLeases.renew(input))
    if (route.kind === 'release') {
      await config.playerLeases.assertWrite(input)
      if (body.preserveRecovery === true) {
        emitSnapshotLog(config, 'info', 'snapshot.backend.release-preserved', { profileId: input.profileId, gameId: input.gameId, kind: 'cloud-recovery', sessionId: input.sessionId, leaseGeneration: input.generation, reason: 'startup-unresolved-or-interrupted' })
      } else {
        try {
          const snapshot = await config.snapshotStore.get(input.profileId, input.gameId)
          if (snapshot) {
            await config.snapshotStore.delete(input.profileId, input.gameId, { expectedRevision: snapshot.metadata.revision, fenceGeneration: input.generation })
            emitSnapshotLog(config, 'info', 'snapshot.backend.release-deleted', { profileId: input.profileId, gameId: input.gameId, kind: 'cloud-recovery', sessionId: input.sessionId, leaseGeneration: input.generation, revision: snapshot.metadata.revision, reason: 'normal-close' })
          }
        } catch (error) {
          emitSnapshotLog(config, 'warn', 'snapshot.backend.release-cleanup-failed', { profileId: input.profileId, gameId: input.gameId, kind: 'cloud-recovery', sessionId: input.sessionId, leaseGeneration: input.generation, code: error.code ?? null, error: error.message })
        }
      }
      return json(response, 200, await config.playerLeases.release(input))
    }
    const entry = await findEntry(config, input.gameId)
    if (!entry) return json(response, 404, { error: 'Game was not found.' })
    if (await config.profileStore.get(entry.id, input.profileId) === null) return json(response, 404, { error: 'Profile was not found.' })
    const verification = await verifyRom(entry, config.romsDirectory)
    if (!verification.ok) return json(response, 409, { error: verification.reason })
    const patchVerification = await verifyGamePatch(entry, config)
    if (!patchVerification.ok) return json(response, 409, { error: patchVerification.reason })
    return json(response, 200, { ...launchDescriptor(entry, input.profileId, patchVerification.patch), leaseGeneration: input.generation })
  } catch (error) { return json(response, error.code === 'PLAYER_LEASE_INVALID' ? 410 : error.code === 'PLAYER_LEASE_HELD' ? 409 : 400, { error: error.message, code: error.code }) }
}

async function nextPlayerLeaseGeneration(config, profileId, gameId) {
  const [save, snapshot, userSnapshot] = await Promise.all([
    config.saveStore.get(profileId, gameId),
    config.snapshotStore.get(profileId, gameId),
    config.snapshotStore.get(profileId, gameId, { kind: 'user-state' }),
  ])
  return Math.max(save?.fenceGeneration ?? 0, snapshot?.metadata?.fenceGeneration ?? 0, userSnapshot?.metadata?.fenceGeneration ?? 0) + 1
}

async function isGameSaveLeased(config, identity) {
  return (await config.gameSaveLeases.get(identity)) !== null
}

function playerDeviceId(request, response) {
  const current = /(?:^|;\s*)emulator_hub_device=([^;]+)/.exec(request.headers.cookie ?? '')?.[1]
  if (current && /^[0-9a-f-]{36}$/i.test(current)) return current
  const deviceId = randomUUID()
  response.setHeader('Set-Cookie', `emulator_hub_device=${deviceId}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax`)
  return deviceId
}

function playerLeaseHeaders(request) {
  const sessionId = request.headers['x-player-session-id']
  const generation = Number(request.headers['x-player-lease-generation'])
  if (typeof sessionId !== 'string' || !sessionId || !Number.isInteger(generation) || generation < 1) {
    const error = new Error('An active player lease is required to save.')
    error.code = 'PLAYER_LEASE_INVALID'
    throw error
  }
  return { deviceId: playerDeviceId(request, { setHeader() {} }), sessionId, generation }
}

function launchDescriptor(entry, profileId, patch) {
  return {
    id: entry.id, title: entry.title, core: entry.core, profileId, gameId: stableGameId(`${profileId}:${entry.id}`), romUrl: `/roms/${encodeURIComponent(entry.id)}`,
    saveAdapter: entry.pokemonSave?.adapter ?? null,
    saveUrl: `/api/profiles/${encodeURIComponent(profileId)}/games/${encodeURIComponent(entry.id)}/save`, snapshotUrl: `/api/profiles/${encodeURIComponent(profileId)}/games/${encodeURIComponent(entry.id)}/snapshot`,
    romSha256: entry.sha256, runtimeId: 'emulatorjs-4.2.3',
    ...(patch ? { patchUrl: `/roms/${encodeURIComponent(entry.id)}/patch`, patchSha256: patch.sha256 } : {}),
  }
}

async function handleClientDiagnostics(request, response, config, searchParams) {
  if (request.method === 'GET') {
    json(response, 200, { events: config.clientDiagnosticStore.list({ sessionId: searchParams.get('sessionId') ?? undefined }) })
    return
  }
  try {
    const event = config.clientDiagnosticStore.append(await readJsonBody(request))
    if (event.kind === 'snapshot-flow') emitSnapshotLog(config, event.level ?? 'info', `snapshot.front.${event.message}`, event)
    else config.clientDiagnosticLogger.info('mobile.client-diagnostic', event)
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
  const layout = getPokemonSaveLayout(entry.pokemonSave?.layoutProfile, entry.pokemonSave?.adapter, entry.pokemonSave?.title)
  const adapter = layout && config.pokemonSaveAdapters.get(entry.pokemonSave.adapter)
  if (!adapter) return false
  await adoptPokemonHubSave({ coordinator: config.pokemonHubSnapshotCoordinator, profileId, gameId: entry.id, saved, adapter, layout })
  return true
}

async function resolvePokemonHubSaveSource(config, { profileId, sourceKey }) {
  const match = /^save:([^:]+):([^:]+)$/.exec(sourceKey ?? '')
  if (!match) return null
  const [, sourceProfileId, gameId] = match
  const entry = await findEntry(config, gameId)
  if (!entry) throw serverError('SAVE_SOURCE_INVALID', 'Pokemon Hub save source is invalid.')
  const layout = getPokemonSaveLayout(entry.pokemonSave?.layoutProfile, entry.pokemonSave?.adapter, entry.pokemonSave?.title)
  const adapter = layout && config.pokemonSaveAdapters.get(entry.pokemonSave.adapter)
  if (!adapter) throw serverError('SAVE_SOURCE_UNSUPPORTED', 'Pokemon Hub save source is not supported.')
  return { gameId, sourceProfileId, adapter, layout }
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
    let reservedGameSave = null
    try {
      logger.info('snapshot.http.save-source-adoption-started', { profileId, workspaceId: request.workspaceId ?? null, sourceKey: request.sourceKey })
      const target = await resolvePokemonHubSaveSource(config, { profileId, sourceKey: request.sourceKey })
      if (!target) throw error
      reservedGameSave = { profileId: target.sourceProfileId, gameId: target.gameId, workspaceId: request.workspaceId }
      await config.gameSaveLeases.acquireHub(reservedGameSave)
      if (await config.profileStore.get(target.gameId, target.sourceProfileId) === null) throw serverError('PROFILE_NOT_FOUND', 'Profile was not found.')
      const saved = await config.saveStore.get(target.sourceProfileId, target.gameId)
      if (!saved) throw serverError('SAVE_MISSING', 'Save was not found.')
      await adoptPokemonHubSave({ coordinator: config.pokemonHubSnapshotCoordinator, profileId, sourceProfileId: target.sourceProfileId, gameId: target.gameId, saved, adapter: target.adapter, layout: target.layout })
      const acquired = await config.pokemonHubSnapshotCoordinator.acquire(input)
      logger.info('snapshot.http.save-source-adopted', { profileId, workspaceId: request.workspaceId ?? null, sourceKey: request.sourceKey, gameId: target.gameId, expiresAt: acquired.expiresAt ?? null })
      return acquired
    } catch (adoptionError) {
      if (reservedGameSave) await config.gameSaveLeases.releaseHub(reservedGameSave).catch(releaseError => { if (releaseError.code !== 'HUB_LEASE_INVALID') throw releaseError })
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

function normalizeSavePipelineLogger(logger) {
  if (logger && ['info', 'warn', 'error'].every(level => typeof logger[level] === 'function')) return logger
  return createContainerPipelineLogger()
}

function emitSnapshotLog(config, level, event, context) {
  try { config.savePipelineLogger[level](event, context) } catch {}
}

function parseContentLength(value) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null
  const length = Number(value)
  return Number.isSafeInteger(length) ? length : null
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
    if (server.backendStateBackup && typeof server.backendStateBackup.create === 'function') {
      try {
        await server.backendStateBackup.create('startup')
      } catch (error) {
        throw error
      }
    }
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
