import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { createServer as createNetServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHubServer } from '../../backend/server.mjs'
import { createMemoryRedisPersistence } from '../../packages/redis-persistence.mjs'
import { createRedisProfileStore } from '../../packages/profile-store.mjs'
import { createSaveStore } from '../../packages/save-store.mjs'
import { createEmeraldSave } from './gen3-fixture.mjs'

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

try {
  const rom = Buffer.alloc(0xc0)
  rom.write('BPEE', 0xac, 'ascii')
  const entry = {
    id: 'e2e-emerald', title: 'Pokémon Emerald Version', system: 'gba', core: 'gba',
    file: 'e2e-emerald.gba', sha256: createHash('sha256').update(rom).digest('hex'),
    pokemonSave: { adapter: 'gen3-gba-v1', layoutProfile: 'pokemon-emerald-gba', title: 'pokemon-emerald', saveKind: 'battery', supported: true },
  }
  await writeFile(join(runRoot, 'roms', entry.file), rom)
  await writeFile(join(runRoot, 'catalog.json'), JSON.stringify([entry]))
  const logger = Object.fromEntries(['info', 'warn', 'error'].map(level => [level, (event, context = {}) => {
    backendLog.write(`${JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...context })}\n`)
  }]))
  const persistence = createMemoryRedisPersistence({ namespace: `e2e:${Date.now()}` })
  const profileStore = createRedisProfileStore({ persistence })
  const saveStore = createSaveStore({ dataPath: join(runRoot, 'saves') })
  const fixtureProfiles = {}
  for (const name of ['intra', 'roundtrip', 'direct-a', 'direct-b', 'negative', 'rapid', 'profile-a', 'profile-b', 'party', 'swap', 'hub-hub', 'outside', 'guard', 'occupied-a', 'occupied-b', 'boxes', 'race-delayed', 'race-replay', 'race-stale', 'stress-drags', 'stress-cycles', 'stress-reload', 'stress-tabs', 'stress-response', 'stress-idempotent', 'stress-conflict', 'stress-lost-ack', 'stress-random', 'stress-cross-a', 'stress-cross-b', 'stress-before-debounce', 'stress-held-reload', 'stress-ui-correction', 'stress-snapshot-queue', 'stress-browser-tabs', 'stress-pane-a', 'stress-pane-b']) {
    const profile = await profileStore.create(entry.id, name)
    fixtureProfiles[name] = profile.id
    await saveStore.put(profile.id, entry.id, createEmeraldSave(name === 'guard' ? { party: [10] } : name === 'boxes' ? { secondBox: [25] } : {}), null)
  }
  await writeFile(join(artifactDirectory, 'fixture.json'), JSON.stringify({ gameId: entry.id, profiles: fixtureProfiles }))
  for (const level of ['error', 'warn']) {
    const original = console[level].bind(console)
    console[level] = (...values) => {
      backendLog.write(`${JSON.stringify({ timestamp: new Date().toISOString(), level, event: 'backend.console', values: values.map(value => value instanceof Error ? { message: value.message, stack: value.stack } : value) })}\n`)
      original(...values)
    }
  }
  backend = createHubServer({
    persistence, profileStore, saveStore,
    catalogPath: join(runRoot, 'catalog.json'), romsDirectory: join(runRoot, 'roms'),
    savesPath: join(runRoot, 'saves'), snapshotsPath: join(runRoot, 'snapshots'),
    backupsPath: join(runRoot, 'backups'),
    metadataLoader: async () => null,
    romDiscovery: { scan: async () => ({ accepted: [] }) },
    pokemonHubLogger: logger, savePipelineLogger: logger,
  })
  await new Promise((resolveListen, reject) => backend.listen(0, '127.0.0.1', error => error ? reject(error) : resolveListen()))
  const backendPort = backend.address().port
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
      E2E_ARTIFACT_DIR: artifactDirectory,
    },
  })
  process.exitCode = await new Promise(resolveExit => tests.once('exit', code => resolveExit(code ?? 1)))
  console.log(`Backend log: ${join(artifactDirectory, 'backend.ndjson')}`)
  console.log(`Frontend log: ${join(artifactDirectory, 'frontend.log')}`)
} finally {
  if (vite) await stop(vite)
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
