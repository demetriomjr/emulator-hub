import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHubServer } from '../../backend/server.mjs'
import { createMemoryRedisPersistence } from '../../packages/redis-persistence.mjs'
import { createRedisProfileStore } from '../../packages/profile-store.mjs'
import { createSaveStore } from '../../packages/save-store.mjs'
import { createEmeraldSave, createItemSave } from './gen3-fixture.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const frontend = resolve(here, '../../frontend')
const runRoot = await mkdtemp(join(tmpdir(), 'pokemon-hub-e2e-'))
const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`
const artifactDirectory = resolve(here, 'test-results', 'runtime', runId)
await mkdir(artifactDirectory, { recursive: true })
await mkdir(join(runRoot, 'roms'))
const backendLog = createWriteStream(join(artifactDirectory, 'backend.ndjson'), { flags: 'w' })
const frontendLog = createWriteStream(join(artifactDirectory, 'frontend.log'), { flags: 'w' })
let backend
let vite
let control

try {
  const rom = Buffer.alloc(0xc0)
  rom.write('BPEE', 0xac, 'ascii')
  const entry = {
    id: 'e2e-emerald', title: 'Pokémon Emerald Version', system: 'gba', core: 'gba',
    file: 'e2e-emerald.gba', sha256: createHash('sha256').update(rom).digest('hex'),
    pokemonSave: { adapter: 'gen3-gba-v1', layoutProfile: 'pokemon-emerald-gba', title: 'pokemon-emerald', saveKind: 'battery', supported: true },
  }
  const itemEntries = Object.fromEntries([
    ['ruby', 'pokemon-ruby', 'pokemon-ruby-sapphire-gba', 'AXVE'],
    ['sapphire', 'pokemon-sapphire', 'pokemon-ruby-sapphire-gba', 'AXPE'],
    ['emerald', 'pokemon-emerald', 'pokemon-emerald-gba', 'BPEE'],
  ].map(([key, title, layoutProfile, gameCode]) => {
    const itemRom = Buffer.alloc(0xc0)
    itemRom.write(gameCode, 0xac, 'ascii')
    return [key, { id: `e2e-items-${key}`, title: `Pokémon ${key[0].toUpperCase()}${key.slice(1)} Items Fixture`, system: 'gba', core: 'gba',
      file: `e2e-items-${key}.gba`, sha256: createHash('sha256').update(itemRom).digest('hex'), romBytes: itemRom,
      pokemonSave: { adapter: 'gen3-gba-v1', layoutProfile, title, saveKind: 'battery', supported: true } }]
  }))
  await writeFile(join(runRoot, 'roms', entry.file), rom)
  for (const itemEntry of Object.values(itemEntries)) await writeFile(join(runRoot, 'roms', itemEntry.file), itemEntry.romBytes)
  await writeFile(join(runRoot, 'catalog.json'), JSON.stringify([entry, ...Object.values(itemEntries).map(({ romBytes, ...itemEntry }) => itemEntry)]))
  const logger = Object.fromEntries(['info', 'warn', 'error'].map(level => [level, (event, context = {}) => {
    backendLog.write(`${JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...context })}\n`)
  }]))
  const persistence = createMemoryRedisPersistence({ namespace: `e2e:${Date.now()}` })
  const profileStore = createRedisProfileStore({ persistence })
  const saveStore = createSaveStore({ dataPath: join(runRoot, 'saves') })
  const fixtureProfiles = {}
  for (const name of ['intra', 'roundtrip', 'direct-a', 'direct-b', 'negative', 'rapid', 'profile-a', 'profile-b', 'party', 'swap', 'hub-hub', 'outside', 'guard', 'occupied-a', 'occupied-b', 'boxes', 'race-delayed', 'race-replay', 'race-stale', 'race-cancel-drag', 'race-close-hub', 'stress-drags', 'stress-cycles', 'stress-reload', 'stress-tabs', 'stress-response', 'stress-idempotent', 'stress-conflict', 'stress-lost-ack', 'stress-random', 'stress-cross-a', 'stress-cross-b', 'stress-before-debounce', 'stress-held-reload', 'stress-ui-correction', 'stress-snapshot-queue', 'stress-browser-tabs', 'stress-pane-a', 'stress-pane-b', 'stress-hub-selector', 'stress-backend-restart', 'adversarial-duplicate', 'adversarial-parallel', 'adversarial-payload', 'fault-flush']) {
    const profile = await profileStore.create(entry.id, name)
    fixtureProfiles[name] = profile.id
    await saveStore.put(profile.id, entry.id, createEmeraldSave(name === 'guard' ? { party: [10] } : name === 'boxes' ? { secondBox: [25] } : {}), null)
  }
  const itemProfiles = {}
  const seed = { pc: [[13, 10], [14, 5], [19, 1]], items: [[13, 10], [14, 5], [15, 1]], 'key-items': [[262, 1], [263, 1]], 'poke-balls': [[4, 12], [2, 3]], 'tm-hm': [[289, 3], [339, 1]], berries: [[133, 5], [134, 2]] }
  for (const [name, game, options] of [
    ['ruby-a', 'ruby', {}], ['ruby-b', 'ruby', {}], ['sapphire-a', 'sapphire', {}],
    ['sapphire-locked', 'sapphire', { tradeReady: false }], ['emerald-a', 'emerald', {}],
    ['emerald-full', 'emerald', { areas: { ...seed, items: [[13, 99], [14, 5]] } }],
    ['sapphire-empty', 'sapphire', { areas: { ...seed, 'tm-hm': [], berries: [] } }],
    ['emerald-nearfull', 'emerald', { areas: { ...seed, items: [[13, 90], [14, 5]] } }],
    ['ruby-reorder', 'ruby', {}], ['sapphire-reorder', 'sapphire', {}], ['emerald-reorder', 'emerald', {}],
    ['ruby-limit', 'ruby', {}],
    ['ruby-insert', 'ruby', { areas: { ...seed, pc: [[13, 2]] } }],
    ['sapphire-insert', 'sapphire', { areas: { ...seed, pc: [[14, 1], [19, 1]] } }],
    ['ruby-blocked', 'ruby', {}],
    ['ruby-stack', 'ruby', {}], ['sapphire-stack', 'sapphire', {}],
    ['sapphire-pc-49', 'sapphire', { areas: { ...seed, pc: Array.from({ length: 51 }, (_, index) => index + 1).filter(id => id !== 13 && id !== 14).map(id => [id, 1]) } }],
    ['ruby-items-19', 'ruby', { areas: { ...seed, items: Array.from({ length: 19 }, (_, index) => [index + 15, 1]) } }],
    ['emerald-stack-98', 'emerald', { areas: { ...seed, items: [[13, 98], [14, 5]] } }],
    ['ruby-pc-capacity-source', 'ruby', {}],
    ['sapphire-bag-capacity-source', 'sapphire', {}],
    ['ruby-stack-capacity-source', 'ruby', {}],
    ['ruby-hub-items-source', 'ruby', {}],
    ['sapphire-hub-items-target', 'sapphire', {}],
    ['ruby-hub-stack-source', 'ruby', {}],
    ['emerald-hub-nearfull', 'emerald', { areas: { ...seed, items: [[13, 90], [14, 5]] } }],
    ['ruby-hub-capacity-source', 'ruby', {}],
    ['ruby-hub-items-19', 'ruby', { areas: { ...seed, items: Array.from({ length: 19 }, (_, index) => [index + 15, 1]) } }],
    ['sapphire-hub-concurrent-source', 'sapphire', {}],
    ['sapphire-hub-merge-source', 'sapphire', {}],
    ['ruby-hub-merge-source', 'ruby', {}],
  ]) {
    const itemEntry = itemEntries[game]
    const profile = await profileStore.create(itemEntry.id, name)
    itemProfiles[name] = { gameId: itemEntry.id, profileId: profile.id, title: itemEntry.pokemonSave.title }
    await saveStore.put(profile.id, itemEntry.id, createItemSave(itemEntry.pokemonSave.title, { areas: seed, ...options }), null)
  }
  await writeFile(join(artifactDirectory, 'fixture.json'), JSON.stringify({ gameId: entry.id, profiles: fixtureProfiles,
    itemGames: Object.fromEntries(Object.entries(itemEntries).map(([key, itemEntry]) => [key, itemEntry.id])), itemProfiles }))
  const faultProfileId = fixtureProfiles[process.env.E2E_FAULT_FLUSH_PROFILE]
  let faultRemaining = faultProfileId ? 1 : 0
  const injectedSaveStore = faultProfileId ? {
    ...saveStore,
    async put(profileId, gameId, bytes, expectedRevision, options) {
      if (profileId === faultProfileId && expectedRevision !== null && faultRemaining > 0) {
        faultRemaining -= 1
        const error = new Error('Injected one-time Pokemon Hub save flush failure')
        error.code = 'E2E_SAVE_FLUSH_FAILURE'
        throw error
      }
      return saveStore.put(profileId, gameId, bytes, expectedRevision, options)
    },
  } : saveStore
  for (const level of ['error', 'warn']) {
    const original = console[level].bind(console)
    console[level] = (...values) => {
      backendLog.write(`${JSON.stringify({ timestamp: new Date().toISOString(), level, event: 'backend.console', values: values.map(value => value instanceof Error ? { message: value.message, stack: value.stack } : value) })}\n`)
      original(...values)
    }
  }
  const backendOptions = {
    persistence, profileStore, saveStore: injectedSaveStore,
    catalogPath: join(runRoot, 'catalog.json'), romsDirectory: join(runRoot, 'roms'),
    savesPath: join(runRoot, 'saves'), snapshotsPath: join(runRoot, 'snapshots'),
    backupsPath: join(runRoot, 'backups'),
    metadataLoader: async () => null,
    romDiscovery: { scan: async () => ({ accepted: [] }) },
    pokemonHubLogger: logger, savePipelineLogger: logger,
  }
  backend = createHubServer(backendOptions)
  await new Promise((resolveListen, reject) => backend.listen(0, '127.0.0.1', error => error ? reject(error) : resolveListen()))
  const backendPort = backend.address().port
  control = createHttpServer((request, response) => {
    if (request.method !== 'POST' || request.url !== '/restart-backend') {
      response.writeHead(404).end()
      return
    }
    void (async () => {
      logger.info('e2e.backend-restart-start', { backendPort })
      await new Promise(resolveClose => backend.close(resolveClose))
      backend = createHubServer(backendOptions)
      await new Promise((resolveListen, reject) => backend.listen(backendPort, '127.0.0.1', error => error ? reject(error) : resolveListen()))
      logger.info('e2e.backend-restart-complete', { backendPort })
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ backendPort }))
    })().catch(error => {
      logger.error('e2e.backend-restart-failed', { message: error.message, stack: error.stack })
      response.writeHead(500).end(error.message)
    })
  })
  await new Promise((resolveListen, reject) => control.listen(0, '127.0.0.1', error => error ? reject(error) : resolveListen()))
  const controlPort = control.address().port
  const frontendPort = await availablePort()
  vite = spawn(process.execPath, [resolve(frontend, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(frontendPort)], {
    cwd: frontend, windowsHide: true,
    env: { ...process.env, BACKEND_URL: `http://127.0.0.1:${backendPort}`, PORT: String(frontendPort), E2E_DISABLE_HMR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  vite.stdout.pipe(frontendLog, { end: false })
  vite.stderr.pipe(frontendLog, { end: false })
  await waitForUrl(`http://127.0.0.1:${frontendPort}/`)
  const command = resolve(here, 'node_modules/@playwright/test/cli.js')
  const args = [command, 'test', ...process.argv.slice(2)]
  const tests = spawn(process.execPath, args, {
    cwd: here, stdio: 'inherit', windowsHide: true,
    env: {
      ...process.env,
      E2E_BASE_URL: `http://127.0.0.1:${frontendPort}`,
      E2E_API_URL: `http://127.0.0.1:${backendPort}`,
      E2E_CONTROL_URL: `http://127.0.0.1:${controlPort}`,
      E2E_ARTIFACT_DIR: artifactDirectory,
    },
  })
  process.exitCode = await new Promise(resolveExit => tests.once('exit', code => resolveExit(code ?? 1)))
  console.log(`Backend log: ${join(artifactDirectory, 'backend.ndjson')}`)
  console.log(`Frontend log: ${join(artifactDirectory, 'frontend.log')}`)
} finally {
  if (vite) await stop(vite)
  if (control) await new Promise(resolveClose => control.close(resolveClose))
  if (backend) await new Promise(resolveClose => backend.close(resolveClose))
  backendLog.end()
  frontendLog.end()
  await rm(runRoot, { recursive: true, force: true })
}

async function availablePort() {
  const server = createNetServer()
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen))
  const port = server.address().port
  await new Promise(resolveClose => server.close(resolveClose))
  return port
}

async function waitForUrl(url) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (vite.exitCode !== null) throw new Error('Vite exited before becoming ready.')
    try { if ((await fetch(url)).ok) return } catch {}
    await new Promise(resolveWait => setTimeout(resolveWait, 100))
  }
  throw new Error(`Vite did not become ready at ${url}.`)
}

async function stop(child) {
  if (child.exitCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([
    new Promise(resolveExit => child.once('exit', resolveExit)),
    new Promise(resolveTimeout => setTimeout(resolveTimeout, 2_000)),
  ])
  if (child.exitCode === null) child.kill('SIGKILL')
}
