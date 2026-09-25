import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, test } from 'node:test'

import { bootstrapHubServer, createHubServer, createListenFailureDiagnostic } from '../server.mjs'
import { createMemoryRedisPersistence } from '../../packages/redis-persistence.mjs'
import { decodeSnapshotBundle, encodeSnapshotBundle } from '../../packages/emulator-snapshot.mjs'
import { createCloudSaveSynchronizer } from '../../packages/cloud-save-sync.mjs'
import { observeEmulatorSaveFiles } from '../../packages/emulator-save-events.mjs'
import { createSaveStore } from '../../packages/save-store.mjs'
import { createSnapshotStore } from '../../packages/snapshot-store.mjs'

const liveServers = new Set()
const liveFixtures = new Set()

test('backend bootstrap runs only the legacy JSON import before listening', async () => {
  const events = []
  const persistence = {
    async connect() { events.push('connect') },
    async close() { events.push('close') },
  }
  const server = {
    once(event) { events.push(`once:${event}`) },
    listen(port, host, callback) { events.push(`listen:${host}:${port}`); callback() },
  }

  const result = await bootstrapHubServer({
    persistence,
    host: '127.0.0.1',
    port: 0,
    migrateLegacy: async () => { events.push('legacy') },
    makeServer: () => { events.push('create'); return server },
    onListening: () => { events.push('listening') },
  })

  assert.equal(result, server)
  assert.deepEqual(events, ['connect', 'legacy', 'create', 'once:error', 'listen:127.0.0.1:0', 'listening'])
})

test('backend bootstrap completes the startup backup before listening', async () => {
  const events = []
  const persistence = { async connect() { events.push('connect') }, async close() { events.push('close') } }
  const server = {
    backendStateBackup: { async create(reason) { events.push(`backup:${reason}`) } },
    once(event) { events.push(`once:${event}`) },
    listen(port, host, callback) { events.push(`listen:${host}:${port}`); callback() },
  }
  await bootstrapHubServer({ persistence, host: '127.0.0.1', port: 0, migrateLegacy: async () => { events.push('legacy') }, makeServer: () => server })
  assert.deepEqual(events, ['connect', 'legacy', 'backup:startup', 'once:error', 'listen:127.0.0.1:0'])
})

test('backend bootstrap closes persistence and never listens when the legacy import fails', async () => {
  const events = []
  const failure = Object.assign(new Error('marker missing'), { code: 'REDIS_MIGRATION_MARKER_MISSING' })
  const persistence = {
    async connect() { events.push('connect') },
    async close() { events.push('close') },
  }

  await assert.rejects(() => bootstrapHubServer({
    persistence,
    host: '127.0.0.1',
    port: 0,
    migrateLegacy: async () => { events.push('legacy'); throw failure },
    makeServer: () => { events.push('create'); return { once() {}, listen() { events.push('listen') } } },
  }), failure)

  assert.deepEqual(events, ['connect', 'legacy', 'close'])
})

test('creates an authenticated backend state backup without exposing its contents', async () => {
  const root = await mkdtemp(join(tmpdir(), 'emulator-hub-backup-endpoint-'))
  liveFixtures.add(root)
  const rom = Buffer.from('backup endpoint rom')
  const fixture = await createFixture([{ id: 'pokemon-red', title: 'Pokémon Red', system: 'gb', core: 'gambatte', file: 'pokemon-red.gb', sha256: sha256(rom) }], { 'pokemon-red.gb': rom })
  const server = createHubServer({ ...fixture, backupToken: 'test-backup-token', backupsPath: join(root, 'backups') })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  liveServers.add(server)
  const baseUrl = `http://127.0.0.1:${server.address().port}`
  const unauthorized = await fetch(`${baseUrl}/api/ops/backups/backend-state`, { method: 'POST' })
  assert.equal(unauthorized.status, 401)
  const authorized = await fetch(`${baseUrl}/api/ops/backups/backend-state`, { method: 'POST', headers: { Authorization: 'Bearer test-backup-token' } })
  assert.equal(authorized.status, 201)
  const result = await authorized.json()
  assert.equal(result.reason, 'operator')
  assert.equal('saves' in result, false)
})

afterEach(async () => {
  await Promise.all([...liveServers].map((server) => closeServer(server)))
  liveServers.clear()
  await Promise.all([...liveFixtures].map((root) => rm(root, { recursive: true, force: true })))
  liveFixtures.clear()
})

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function validIps(value = 1) {
  return Buffer.from([...Buffer.from('PATCH'), 0, 0, 1, 0, 1, value, ...Buffer.from('EOF')])
}

function ipsManifestEntry(rom, patch, file, patchSha256 = sha256(patch)) {
  return Buffer.from(JSON.stringify({ version: 1, patches: [{ romSha256: sha256(rom), file, patchSha256 }] }))
}

async function createFixture(entries, files = {}, patches = {}) {
  const root = await mkdtemp(join(tmpdir(), 'emulator-hub-backend-'))
  const romsDir = join(root, 'roms')
  const patchesDir = join(root, 'patches')
  await mkdir(romsDir, { recursive: true })
  await mkdir(patchesDir, { recursive: true })

  for (const [file, content] of Object.entries(files)) {
    const destination = join(romsDir, file)
    await mkdir(join(destination, '..'), { recursive: true })
    await writeFile(destination, content)
  }
  for (const [file, content] of Object.entries(patches)) await writeFile(join(patchesDir, file), content)

  const catalogPath = join(root, 'catalog.json')
  await writeFile(catalogPath, JSON.stringify(entries, null, 2))
  liveFixtures.add(root)
  return {
    root,
    romsDir,
    patchesDir,
    catalogPath,
    profilesPath: join(root, 'data', 'profiles'),
    controlProfilePath: join(root, 'data', 'control-profile.json'),
    savesPath: join(root, 'data', 'saves'),
    pokemonHubPath: join(root, 'data', 'pokemon-hub'),
    pokemonHubProfilesPath: join(root, 'data', 'pokemon-hub-profiles'),
    persistence: createMemoryRedisPersistence(),
  }
}

async function startFixture(entries, files = {}, patches = {}, options = {}) {
  const fixture = await createFixture(entries, files, patches)
  const server = createHubServer({ ...fixture, ...options })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  liveServers.add(server)
  const { port } = server.address()
  return { ...fixture, server, baseUrl: `http://127.0.0.1:${port}` }
}

async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}

async function jsonResponse(response) {
  return response.json()
}

async function acquirePlayerLease(baseUrl, gameId, profileId, sessionId = 'player-session-a', cookie = '') {
  const response = await fetch(`${baseUrl}/api/games/${gameId}/player-leases`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify({ profileId, sessionId }),
  })
  return { response, body: await jsonResponse(response), cookie: response.headers.get('set-cookie')?.split(';')[0] }
}

describe('hub backend HTTP contract', () => {
  test('launch signals a Hub save and hides runtime states older than that save', async () => {
    const rom = Buffer.from('hub-invalidated-state-rom')
    const fixture = await createFixture([{ id: 'ruby', title: 'Ruby', system: 'gba', core: 'gba', file: 'ruby.gba', sha256: sha256(rom) }], { 'ruby.gba': rom })
    const snapshotStore = createSnapshotStore({ dataPath: join(fixture.root, 'data', 'snapshots') })
    const server = createHubServer({ ...fixture, snapshotStore })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    liveServers.add(server)
    const baseUrl = `http://127.0.0.1:${server.address().port}`
    const profile = await jsonResponse(await fetch(`${baseUrl}/api/games/ruby/profiles`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'May' }) }))
    const saves = createSaveStore({ dataPath: fixture.savesPath })
    await saves.put(profile.id, 'ruby', Buffer.from([1]), null)
    for (const kind of ['cloud-recovery', 'user-state']) {
      await snapshotStore.put(profile.id, 'ruby', { metadata: { core: 'gba', romSha256: sha256(rom), runtimeId: 'emulatorjs-4.2.3', saveRevision: 1, kind }, state: new Uint8Array([1]) }, null, { kind })
    }
    await saves.put(profile.id, 'ruby', Buffer.from([2]), 1, { invalidateRuntimeStates: true })
    const lease = await acquirePlayerLease(baseUrl, 'ruby', profile.id, 'hub-state-session')
    assert.equal(lease.response.status, 200)
    assert.equal(lease.body.runtimeStateInvalidatedAtRevision, 2)
    const headers = { Cookie: lease.cookie, 'X-Player-Session-Id': 'hub-state-session', 'X-Player-Lease-Generation': String(lease.body.leaseGeneration) }
    assert.equal((await fetch(`${baseUrl}${lease.body.snapshotUrl}`, { headers })).status, 404)
    assert.equal((await fetch(`${baseUrl}${lease.body.snapshotUrl}?kind=user-state`, { headers })).status, 404)
    const launch = await jsonResponse(await fetch(`${baseUrl}/api/player-leases/hub-state-session/launch?profileId=${profile.id}&gameId=ruby&generation=${lease.body.leaseGeneration}`, { headers }))
    assert.equal(launch.runtimeStateInvalidatedAtRevision, 2)
  })
  test('discovers and serves an IPS for an arbitrary game identity using the verified ROM hash', async () => {
    const rom = Buffer.from('arbitrary fixture ROM')
    const ips = validIps(42)
    const { baseUrl } = await startFixture([
      { id: 'custom-adventure', title: 'Unrelated Adventure', system: 'gba', core: 'gba', file: 'adventure.gba', sha256: sha256(rom) },
    ], { 'adventure.gba': rom }, { 'adventure-fix.ips': ips, 'manifest.json': ipsManifestEntry(rom, ips, 'adventure-fix.ips') })
    const profile = await jsonResponse(await fetch(`${baseUrl}/api/games/custom-adventure/profiles`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'May' }),
    }))

    const launch = await jsonResponse(await fetch(`${baseUrl}/api/games/custom-adventure/launch?profileId=${profile.id}`))
    assert.equal(launch.patchUrl, '/roms/custom-adventure/patch')
    assert.equal(launch.patchSha256, sha256(ips))
    const patchResponse = await fetch(`${baseUrl}${launch.patchUrl}`)
    assert.equal(patchResponse.status, 200)
    assert.equal(patchResponse.headers.get('cache-control'), 'no-store')
    assert.equal(patchResponse.headers.get('content-length'), String(ips.length))
    assert.deepEqual(Buffer.from(await patchResponse.arrayBuffer()), ips)
  })

  test('launches a compatible game without an optional IPS when the patch file is missing', async () => {
    const rom = Buffer.from('emerald fixture ROM without its optional patch')
    const { baseUrl } = await startFixture([
      { id: 'pokemon-emerald', title: 'Pokémon Emerald', system: 'gba', core: 'gba', file: 'emerald.gba', sha256: sha256(rom) },
    ], { 'emerald.gba': rom }, { 'manifest.json': ipsManifestEntry(rom, validIps(), 'emerald-rng.ips') })
    const games = await jsonResponse(await fetch(`${baseUrl}/api/games`))
    assert.equal(games.games[0].status, 'ready')

    const profile = await jsonResponse(await fetch(`${baseUrl}/api/games/pokemon-emerald/profiles`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'May' }),
    }))
    const launch = await fetch(`${baseUrl}/api/games/pokemon-emerald/launch?profileId=${profile.id}`)
    assert.equal(launch.status, 200)
    const descriptor = await launch.json()
    assert.equal('patchUrl' in descriptor, false)
    assert.equal('patchSha256' in descriptor, false)
    const lease = await acquirePlayerLease(baseUrl, 'pokemon-emerald', profile.id)
    assert.equal(lease.response.status, 200)
    assert.equal('patchUrl' in lease.body, false)
    assert.equal('patchSha256' in lease.body, false)
  })

  test('launches a compatible game without an optional IPS when its hash is invalid', async () => {
    const rom = Buffer.from('emerald fixture ROM with an invalid optional patch')
    const ips = validIps(2)
    const { baseUrl } = await startFixture([
      { id: 'pokemon-emerald', title: 'Pokémon Emerald', system: 'gba', core: 'gba', file: 'emerald.gba', sha256: sha256(rom) },
    ], { 'emerald.gba': rom }, { 'emerald-rng.ips': ips, 'manifest.json': ipsManifestEntry(rom, ips, 'emerald-rng.ips', sha256(validIps(3))) })
    const profile = await jsonResponse(await fetch(`${baseUrl}/api/games/pokemon-emerald/profiles`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'May' }),
    }))

    const lease = await acquirePlayerLease(baseUrl, 'pokemon-emerald', profile.id)
    assert.equal(lease.response.status, 200)
    assert.equal('patchUrl' in lease.body, false)
    assert.equal('patchSha256' in lease.body, false)
  })

  test('keeps a game launchable when its IPS manifest has ambiguous entries', async () => {
    const rom = Buffer.from('ambiguous IPS registry ROM')
    const ips = validIps(8)
    const manifest = Buffer.from(JSON.stringify({ version: 1, patches: [
      { romSha256: sha256(rom), file: 'fix.ips', patchSha256: sha256(ips) },
      { romSha256: sha256(rom), file: 'fix.ips', patchSha256: sha256(ips) },
    ] }))
    const { baseUrl } = await startFixture([
      { id: 'custom-game', title: 'Custom Game', system: 'gb', core: 'gambatte', file: 'custom.gb', sha256: sha256(rom) },
    ], { 'custom.gb': rom }, { 'fix.ips': ips, 'manifest.json': manifest })
    const gameList = await jsonResponse(await fetch(`${baseUrl}/api/games`))
    const profile = await jsonResponse(await fetch(`${baseUrl}/api/games/custom-game/profiles`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Player' }),
    }))

    assert.equal(gameList.games[0].status, 'ready')
    const lease = await acquirePlayerLease(baseUrl, 'custom-game', profile.id)
    assert.equal(lease.response.status, 200)
    assert.equal('patchUrl' in lease.body, false)
    assert.equal('patchSha256' in lease.body, false)
  })

  test('serves one lease-protected state-only snapshot slot from the launch descriptor', async () => {
    const rom = Buffer.from('snapshot game')
    const { baseUrl } = await startFixture([{ id: 'pokemon-red', title: 'Pokémon Red', system: 'gb', core: 'gambatte', file: 'pokemon-red.gb', sha256: sha256(rom) }], { 'pokemon-red.gb': rom })
    const profile = await jsonResponse(await fetch(`${baseUrl}/api/games/pokemon-red/profiles`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Red' }) }))
    const lease = await acquirePlayerLease(baseUrl, 'pokemon-red', profile.id)
    const headers = { Cookie: lease.cookie, 'X-Player-Session-Id': 'player-session-a', 'X-Player-Lease-Generation': String(lease.body.leaseGeneration) }

    assert.match(lease.body.snapshotUrl, /\/snapshot$/)
    assert.equal(lease.body.romSha256, sha256(rom))
    assert.equal(typeof lease.body.runtimeId, 'string')
    assert.equal((await fetch(`${baseUrl}${lease.body.snapshotUrl}`, { headers })).status, 404)

    const body = await encodeSnapshotBundle({
      metadata: { profileId: profile.id, gameId: 'pokemon-red', core: 'gambatte', romSha256: sha256(rom), runtimeId: lease.body.runtimeId, saveRevision: 0 },
      state: new Uint8Array([1]),
    })
    const written = await fetch(`${baseUrl}${lease.body.snapshotUrl}`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/vnd.emulator-hub.snapshot', 'If-Match': '*' }, body })
    assert.equal(written.status, 201)
    const read = await fetch(`${baseUrl}${lease.body.snapshotUrl}`, { headers })
    assert.equal(read.status, 200)
    assert.equal(read.headers.get('etag'), '"1"')
    const decoded = await decodeSnapshotBundle(new Uint8Array(await read.arrayBuffer()))
    assert.deepEqual([...decoded.state], [1])
    assert.equal('save' in decoded, false)
  })

  test('deletes a remote restore candidate only with its revision and active lease, preserving the game save', async () => {
    const rom = Buffer.from('delete snapshot game')
    const { baseUrl } = await startFixture([{ id: 'pokemon-red', title: 'Pokémon Red', system: 'gb', core: 'gambatte', file: 'pokemon-red.gb', sha256: sha256(rom) }], { 'pokemon-red.gb': rom })
    const profile = await jsonResponse(await fetch(`${baseUrl}/api/games/pokemon-red/profiles`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Red' }) }))
    const lease = await acquirePlayerLease(baseUrl, 'pokemon-red', profile.id, 'delete-session')
    const headers = { Cookie: lease.cookie, 'X-Player-Session-Id': 'delete-session', 'X-Player-Lease-Generation': String(lease.body.leaseGeneration) }
    const snapshotUrl = `${baseUrl}${lease.body.snapshotUrl}`
    const saveUrl = `${baseUrl}${lease.body.saveUrl}`
    const saveBytes = new Uint8Array([4, 5, 6])
    assert.equal((await fetch(saveUrl, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/octet-stream', 'If-Match': '*' }, body: saveBytes })).status, 201)
    const snapshot = await encodeSnapshotBundle({ metadata: { profileId: profile.id, gameId: 'pokemon-red', core: 'gambatte', romSha256: sha256(rom), runtimeId: lease.body.runtimeId, saveRevision: 1 }, state: new Uint8Array([7, 8]) })
    assert.equal((await fetch(snapshotUrl, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/vnd.emulator-hub.snapshot', 'If-Match': '*' }, body: snapshot })).status, 201)
    assert.equal((await fetch(snapshotUrl, { method: 'DELETE', headers })).status, 428)
    assert.equal((await fetch(snapshotUrl, { method: 'DELETE', headers: { ...headers, 'If-Match': '"2"' } })).status, 412)
    assert.equal((await fetch(snapshotUrl, { method: 'DELETE', headers: { ...headers, 'If-Match': '"1"', 'X-Player-Lease-Generation': String(lease.body.leaseGeneration + 1) } })).status, 410)
    assert.equal((await fetch(snapshotUrl, { headers })).status, 200)
    assert.equal((await fetch(snapshotUrl, { method: 'DELETE', headers: { ...headers, 'If-Match': '"1"' } })).status, 204)
    assert.equal((await fetch(snapshotUrl, { headers })).status, 404)
    assert.deepEqual([...new Uint8Array(await (await fetch(saveUrl, { headers })).arrayBuffer())], [...saveBytes])
  })

  test('keeps user states separate from cloud recovery across capture, deletion and lease release', async () => {
    const rom = Buffer.from('typed state fixture')
    const { baseUrl } = await startFixture([{ id: 'pokemon-red', title: 'Pokémon Red', system: 'gb', core: 'gambatte', file: 'pokemon-red.gb', sha256: sha256(rom) }], { 'pokemon-red.gb': rom })
    const profile = await jsonResponse(await fetch(`${baseUrl}/api/games/pokemon-red/profiles`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Red' }) }))
    const lease = await acquirePlayerLease(baseUrl, 'pokemon-red', profile.id, 'typed-session')
    const headers = { Cookie: lease.cookie, 'X-Player-Session-Id': 'typed-session', 'X-Player-Lease-Generation': String(lease.body.leaseGeneration) }
    const cloudUrl = `${baseUrl}${lease.body.snapshotUrl}`
    const userUrl = `${cloudUrl}?kind=user-state`
    const body = (kind, reasonCode, value) => encodeSnapshotBundle({ metadata: { profileId: profile.id, gameId: 'pokemon-red', core: 'gambatte', romSha256: sha256(rom), runtimeId: lease.body.runtimeId, saveRevision: 0, kind, reasonCode, originInstallationId: 'installation-123', capturedAt: '2000-01-01T00:00:00.000Z' }, state: new Uint8Array([value]) })
    const put = (url, bytes) => fetch(url, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/vnd.emulator-hub.snapshot', 'If-Match': '*' }, body: bytes })
    assert.equal((await put(userUrl, await body('user-state', 'user-request', 7))).status, 201)
    assert.equal((await put(cloudUrl, await body('cloud-recovery', 'periodic-recovery', 9))).status, 201)
    const userRead = await fetch(userUrl, { headers })
    assert.equal(userRead.status, 200)
    const decoded = await decodeSnapshotBundle(new Uint8Array(await userRead.arrayBuffer()))
    assert.equal(decoded.metadata.kind, 'user-state')
    assert.equal(decoded.metadata.reasonCode, 'user-request')
    assert.equal(decoded.metadata.originInstallationId, 'installation-123')
    assert.ok(Number.isFinite(Date.parse(decoded.metadata.capturedAt)))
    assert.notEqual(decoded.metadata.capturedAt, '2000-01-01T00:00:00.000Z')
    assert.deepEqual([...decoded.state], [7])
    assert.equal((await fetch(cloudUrl, { method: 'DELETE', headers: { ...headers, 'If-Match': '"1"' } })).status, 204)
    assert.equal((await fetch(userUrl, { headers })).status, 200)
    assert.equal((await put(cloudUrl, await body('cloud-recovery', 'periodic-recovery', 8))).status, 201)
    const replacementRead = await fetch(cloudUrl, { headers })
    assert.equal(replacementRead.headers.get('etag'), '"2"')
    assert.equal((await fetch(cloudUrl, { method: 'DELETE', headers: { ...headers, 'If-Match': '"1"' } })).status, 412)
    assert.deepEqual([...(await decodeSnapshotBundle(new Uint8Array(await (await fetch(cloudUrl, { headers })).arrayBuffer()))).state], [8])
    assert.equal((await fetch(`${baseUrl}${lease.body.saveUrl}`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/octet-stream', 'If-Match': '*' }, body: new Uint8Array([4]) })).status, 201)
    assert.equal((await fetch(`${baseUrl}/api/player-leases/typed-session`, { method: 'DELETE', headers: { Cookie: lease.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ profileId: profile.id, gameId: 'pokemon-red', generation: lease.body.leaseGeneration }) })).status, 200)
    const next = await acquirePlayerLease(baseUrl, 'pokemon-red', profile.id, 'typed-next', lease.cookie)
    const nextHeaders = { Cookie: lease.cookie, 'X-Player-Session-Id': 'typed-next', 'X-Player-Lease-Generation': String(next.body.leaseGeneration) }
    assert.equal((await fetch(userUrl, { headers: nextHeaders })).status, 200)
    assert.equal((await fetch(cloudUrl, { headers: nextHeaders })).status, 404)
    assert.equal((await fetch(`${cloudUrl}?kind=unknown`, { headers: nextHeaders })).status, 400)
  })

  test('logs snapshot decisions and failures without logging every periodic capture', async () => {
    const rom = Buffer.from('snapshot observability fixture')
    const events = []
    const logger = Object.fromEntries(['info', 'warn', 'error'].map(level => [level, (event, context) => events.push({ level, event, context })]))
    const { baseUrl } = await startFixture([{ id: 'pokemon-red', title: 'Pokémon Red', system: 'gb', core: 'gambatte', file: 'pokemon-red.gb', sha256: sha256(rom) }], { 'pokemon-red.gb': rom }, {}, { savePipelineLogger: logger })
    const profile = await jsonResponse(await fetch(`${baseUrl}/api/games/pokemon-red/profiles`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Red' }) }))
    const lease = await acquirePlayerLease(baseUrl, 'pokemon-red', profile.id, 'snapshot-observe')
    const headers = { Cookie: lease.cookie, 'X-Player-Session-Id': 'snapshot-observe', 'X-Player-Lease-Generation': String(lease.body.leaseGeneration) }
    const cloudUrl = `${baseUrl}${lease.body.snapshotUrl}`
    const userUrl = `${cloudUrl}?kind=user-state`
    const bundle = (kind, value) => encodeSnapshotBundle({ metadata: { profileId: profile.id, gameId: 'pokemon-red', core: 'gambatte', romSha256: sha256(rom), runtimeId: lease.body.runtimeId, saveRevision: 0, kind, reasonCode: kind === 'user-state' ? 'user-request' : 'periodic-recovery' }, state: new Uint8Array([value]) })
    assert.equal((await fetch(cloudUrl, { headers })).status, 404)
    assert.equal((await fetch(cloudUrl, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/vnd.emulator-hub.snapshot', 'If-Match': '*' }, body: await bundle('cloud-recovery', 1) })).status, 201)
    assert.equal((await fetch(cloudUrl, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/vnd.emulator-hub.snapshot', 'If-Match': '"1"' }, body: await bundle('cloud-recovery', 2) })).status, 200)
    assert.equal((await fetch(userUrl, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/vnd.emulator-hub.snapshot', 'If-Match': '*' }, body: await bundle('cloud-recovery', 8) })).status, 400)
    assert.equal((await fetch(userUrl, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/vnd.emulator-hub.snapshot', 'If-Match': '*' }, body: await bundle('user-state', 3) })).status, 201)
    assert.equal((await fetch(cloudUrl, { headers })).status, 200)
    assert.equal((await fetch(cloudUrl, { method: 'DELETE', headers: { ...headers, 'If-Match': '"1"' } })).status, 412)
    assert.equal((await fetch(cloudUrl, { method: 'DELETE', headers: { ...headers, 'If-Match': '"2"' } })).status, 204)
    assert.equal((await fetch(cloudUrl, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/vnd.emulator-hub.snapshot', 'If-Match': '*' }, body: await bundle('cloud-recovery', 4) })).status, 201)
    assert.equal((await fetch(`${baseUrl}/api/player-leases/snapshot-observe`, { method: 'DELETE', headers: { Cookie: lease.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ profileId: profile.id, gameId: 'pokemon-red', generation: lease.body.leaseGeneration }) })).status, 200)
    assert.deepEqual(events.filter(item => item.event.startsWith('snapshot.backend.')).map(({ level, event }) => [level, event]), [
      ['warn', 'snapshot.backend.put-rejected'],
      ['info', 'snapshot.backend.user-state-persisted'],
      ['info', 'snapshot.backend.candidate-available'],
      ['warn', 'snapshot.backend.delete-rejected'],
      ['info', 'snapshot.backend.deleted'],
      ['info', 'snapshot.backend.release-deleted'],
    ])
    assert.ok(events.every(item => !('state' in item.context) && !('save' in item.context)))
  })

  test('a failing snapshot logger never changes snapshot HTTP or lease outcomes', async () => {
    const rom = Buffer.from('logger failure fixture')
    const throwLog = () => { throw new Error('logger unavailable') }
    const { baseUrl } = await startFixture([{ id: 'pokemon-red', title: 'Pokémon Red', system: 'gb', core: 'gambatte', file: 'pokemon-red.gb', sha256: sha256(rom) }], { 'pokemon-red.gb': rom }, {}, { savePipelineLogger: { info: throwLog, warn: throwLog, error: throwLog } })
    const profile = await jsonResponse(await fetch(`${baseUrl}/api/games/pokemon-red/profiles`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Red' }) }))
    const lease = await acquirePlayerLease(baseUrl, 'pokemon-red', profile.id, 'logger-failure')
    const headers = { Cookie: lease.cookie, 'X-Player-Session-Id': 'logger-failure', 'X-Player-Lease-Generation': String(lease.body.leaseGeneration) }
    const url = `${baseUrl}${lease.body.snapshotUrl}`
    const bundle = await encodeSnapshotBundle({ metadata: { profileId: profile.id, gameId: 'pokemon-red', core: 'gambatte', romSha256: sha256(rom), runtimeId: lease.body.runtimeId, saveRevision: 0, kind: 'cloud-recovery', reasonCode: 'periodic-recovery' }, state: new Uint8Array([3]) })
    assert.equal((await fetch(url, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/vnd.emulator-hub.snapshot', 'If-Match': '*' }, body: bundle })).status, 201)
    assert.equal((await fetch(url, { headers })).status, 200)
    assert.equal((await fetch(`${baseUrl}/api/player-leases/logger-failure`, { method: 'DELETE', headers: { Cookie: lease.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ profileId: profile.id, gameId: 'pokemon-red', generation: lease.body.leaseGeneration }) })).status, 200)
  })

  test('releasing an unopened restore chooser preserves older cloud recovery for later selection', async () => {
    const rom = Buffer.from('deferred restore fixture')
    const { baseUrl } = await startFixture([{ id: 'pokemon-red', title: 'Pokémon Red', system: 'gb', core: 'gambatte', file: 'pokemon-red.gb', sha256: sha256(rom) }], { 'pokemon-red.gb': rom })
    const profile = await jsonResponse(await fetch(`${baseUrl}/api/games/pokemon-red/profiles`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Red' }) }))
    const lease = await acquirePlayerLease(baseUrl, 'pokemon-red', profile.id, 'deferred-restore')
    const headers = { Cookie: lease.cookie, 'X-Player-Session-Id': 'deferred-restore', 'X-Player-Lease-Generation': String(lease.body.leaseGeneration) }
    const snapshotUrl = `${baseUrl}${lease.body.snapshotUrl}`
    const saveUrl = `${baseUrl}${lease.body.saveUrl}`
    const snapshot = await encodeSnapshotBundle({ metadata: { profileId: profile.id, gameId: 'pokemon-red', core: 'gambatte', romSha256: sha256(rom), runtimeId: lease.body.runtimeId, saveRevision: 0, kind: 'cloud-recovery', reasonCode: 'periodic-recovery' }, state: new Uint8Array([7]) })
    assert.equal((await fetch(snapshotUrl, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/vnd.emulator-hub.snapshot', 'If-Match': '*' }, body: snapshot })).status, 201)
    assert.equal((await fetch(saveUrl, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/octet-stream', 'If-Match': '*' }, body: new Uint8Array([3]) })).status, 201)
    assert.equal((await fetch(`${baseUrl}/api/player-leases/deferred-restore`, { method: 'DELETE', headers: { Cookie: lease.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ profileId: profile.id, gameId: 'pokemon-red', generation: lease.body.leaseGeneration, preserveRecovery: true }) })).status, 200)
    const later = await acquirePlayerLease(baseUrl, 'pokemon-red', profile.id, 'deferred-later', lease.cookie)
    const laterHeaders = { Cookie: lease.cookie, 'X-Player-Session-Id': 'deferred-later', 'X-Player-Lease-Generation': String(later.body.leaseGeneration) }
    assert.deepEqual([...(await decodeSnapshotBundle(new Uint8Array(await (await fetch(snapshotUrl, { headers: laterHeaders })).arrayBuffer()))).state], [7])
    assert.deepEqual([...new Uint8Array(await (await fetch(saveUrl, { headers: laterHeaders })).arrayBuffer())], [3])
  })

  test('normal lease release removes automatic cloud recovery even at the current save revision', async () => {
    const rom = Buffer.from('suppressed snapshot fixture')
    const { baseUrl } = await startFixture([{ id: 'pokemon-red', title: 'Pokémon Red', system: 'gb', core: 'gambatte', file: 'pokemon-red.gb', sha256: sha256(rom) }], { 'pokemon-red.gb': rom })
    const profile = await jsonResponse(await fetch(`${baseUrl}/api/games/pokemon-red/profiles`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Red' }) }))
    const first = await acquirePlayerLease(baseUrl, 'pokemon-red', profile.id, 'suppressed-one')
    const headers = { Cookie: first.cookie, 'X-Player-Session-Id': 'suppressed-one', 'X-Player-Lease-Generation': String(first.body.leaseGeneration) }
    const snapshotUrl = `${baseUrl}${first.body.snapshotUrl}`
    const snapshotBody = saveRevision => encodeSnapshotBundle({
      metadata: { profileId: profile.id, gameId: 'pokemon-red', core: 'gambatte', romSha256: sha256(rom), runtimeId: first.body.runtimeId, saveRevision, promptOnLaunch: false },
      state: new Uint8Array([7, 8]),
    })
    const putSnapshot = async (saveRevision, ifMatch = '*') => fetch(snapshotUrl, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/vnd.emulator-hub.snapshot', 'If-Match': ifMatch }, body: await snapshotBody(saveRevision) })

    const missingSave = await putSnapshot(0)
    assert.equal(missingSave.status, 409)
    assert.equal((await missingSave.json()).code, 'SNAPSHOT_SAVE_REVISION_MISMATCH')
    const saveBytes = new Uint8Array([4, 5, 6])
    const saveWrite = await fetch(`${baseUrl}${first.body.saveUrl}`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/octet-stream', 'If-Match': '*' }, body: saveBytes })
    assert.equal(saveWrite.status, 201)
    assert.equal((await putSnapshot(0)).status, 409)
    assert.equal((await putSnapshot(1)).status, 201)
    const release = await fetch(`${baseUrl}/api/player-leases/suppressed-one`, { method: 'DELETE', headers: { Cookie: first.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ profileId: profile.id, gameId: 'pokemon-red', generation: first.body.leaseGeneration }) })
    assert.equal(release.status, 200)

    const second = await acquirePlayerLease(baseUrl, 'pokemon-red', profile.id, 'suppressed-two', first.cookie)
    const secondHeaders = { Cookie: first.cookie, 'X-Player-Session-Id': 'suppressed-two', 'X-Player-Lease-Generation': String(second.body.leaseGeneration) }
    const read = await fetch(snapshotUrl, { headers: secondHeaders })
    assert.equal(read.status, 404)
    const save = await fetch(`${baseUrl}${second.body.saveUrl}`, { headers: secondHeaders })
    assert.deepEqual([...new Uint8Array(await save.arrayBuffer())], [...saveBytes])
  })

  test('lease release succeeds when automatic cloud recovery cleanup fails', async () => {
    const rom = Buffer.from('cleanup failure fixture')
    const warnings = []
    const snapshotStore = {
      async get() { return { metadata: { revision: 1, fenceGeneration: 1 } } },
      async advanceFence() {},
      async delete() { throw new Error('snapshot cleanup unavailable') },
    }
    const { baseUrl } = await startFixture([{ id: 'pokemon-red', title: 'Pokémon Red', system: 'gb', core: 'gambatte', file: 'pokemon-red.gb', sha256: sha256(rom) }], { 'pokemon-red.gb': rom }, {}, {
      snapshotStore,
      savePipelineLogger: { info() {}, warn: (event, context) => warnings.push({ event, context }), error() {} },
    })
    const profile = await jsonResponse(await fetch(`${baseUrl}/api/games/pokemon-red/profiles`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Red' }) }))
    const first = await acquirePlayerLease(baseUrl, 'pokemon-red', profile.id, 'cleanup-one')
    const release = await fetch(`${baseUrl}/api/player-leases/cleanup-one`, { method: 'DELETE', headers: { Cookie: first.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ profileId: profile.id, gameId: 'pokemon-red', generation: first.body.leaseGeneration }) })
    assert.equal(release.status, 200)
    const second = await acquirePlayerLease(baseUrl, 'pokemon-red', profile.id, 'cleanup-two', first.cookie)
    assert.equal(second.response.status, 200)
    assert.equal(warnings.length, 1)
  })

  test('simulates save events, snapshot upload, and close-time revision reconciliation across HTTP endpoints', async () => {
    const rom = Buffer.from('save and snapshot flow fixture')
    const backendEvents = []
    const frontendEvents = []
    const { baseUrl } = await startFixture([{ id: 'pokemon-red', title: 'Pokémon Red', system: 'gb', core: 'gambatte', file: 'pokemon-red.gb', sha256: sha256(rom) }], { 'pokemon-red.gb': rom }, {}, {
      savePipelineLogger: {
        info: (event, context) => backendEvents.push({ level: 'info', event, context }),
        warn: (event, context) => backendEvents.push({ level: 'warn', event, context }),
        error: (event, context) => backendEvents.push({ level: 'error', event, context }),
      },
    })
    const profile = await jsonResponse(await fetch(`${baseUrl}/api/games/pokemon-red/profiles`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Red' }) }))
    const firstLease = await acquirePlayerLease(baseUrl, 'pokemon-red', profile.id, 'save-flow-one')

    const leaseHeaders = lease => ({ Cookie: lease.cookie, 'X-Player-Session-Id': lease.sessionId, 'X-Player-Lease-Generation': String(lease.body.leaseGeneration) })
    firstLease.sessionId = 'save-flow-one'
    let headers = leaseHeaders(firstLease)
    const saveUrl = `${baseUrl}${firstLease.body.saveUrl}`
    const snapshotUrl = `${baseUrl}${firstLease.body.snapshotUrl}`
    const cloudSave = createCloudSaveSynchronizer({
      load: async () => {
        const response = await fetch(saveUrl, { headers })
        if (response.status === 404) return null
        assert.equal(response.status, 200)
        return { bytes: new Uint8Array(await response.arrayBuffer()), revision: Number(response.headers.get('etag').replaceAll('"', '')) }
      },
      upload: async (bytes, revision, traceId) => {
        const response = await fetch(saveUrl, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/octet-stream', 'If-Match': revision === null ? '*' : `"${revision}"`, 'X-Save-Trace-Id': traceId }, body: bytes })
        assert.equal(response.ok, true)
        return response.json()
      },
      hash: async bytes => sha256(bytes),
      logger: (event, context) => frontendEvents.push({ event, context }),
    })
    await cloudSave.load()
    let saveEvent
    let eventSequence = 0
    assert.equal(observeEmulatorSaveFiles({ on(name, handler) { assert.equal(name, 'saveSaveFiles'); saveEvent = handler } }, bytes => cloudSave.syncBytes(bytes, `save-flow-${++eventSequence}`)), true)

    const firstSave = new Uint8Array([11, 22, 33])
    await saveEvent(firstSave)
    await saveEvent(firstSave)
    assert.ok(frontendEvents.some(({ event, context }) => event === 'save.front.upload-accepted' && context.traceId === 'save-flow-1' && context.revision === 1))
    assert.ok(frontendEvents.some(({ event, context }) => event === 'save.front.deduplicated' && context.traceId === 'save-flow-2'))
    const firstTraceEvents = backendEvents.filter(({ context }) => context.traceId === 'save-flow-1')
    assert.ok(firstTraceEvents.some(({ event }) => event === 'save.backend.put-received'))
    assert.ok(firstTraceEvents.some(({ event, context }) => event === 'save.backend.persisted' && context.revision === 1))
    assert.ok(firstTraceEvents.some(({ event, context }) => event === 'save.backend.response' && context.status === 201))
    assert.equal(backendEvents.some(({ context }) => context.traceId === 'save-flow-2'), false, 'a deduplicated save must not issue an HTTP PUT')
    const saveAfterEvent = await fetch(saveUrl, { headers })
    assert.equal(saveAfterEvent.headers.get('etag'), '"1"')
    assert.deepEqual([...new Uint8Array(await saveAfterEvent.arrayBuffer())], [...firstSave])

    async function putSnapshot(state, expectedSnapshotRevision, saveRevision) {
      const body = await encodeSnapshotBundle({
        metadata: { profileId: profile.id, gameId: 'pokemon-red', core: 'gambatte', romSha256: sha256(rom), runtimeId: firstLease.body.runtimeId, saveRevision },
        state: new Uint8Array(state),
      })
      return fetch(snapshotUrl, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/vnd.emulator-hub.snapshot', 'If-Match': expectedSnapshotRevision === null ? '*' : `"${expectedSnapshotRevision}"` }, body })
    }
    const firstSnapshotWrite = await putSnapshot([91, 92], null, cloudSave.getRevision())
    assert.equal(firstSnapshotWrite.status, 201)
    const saveAfterSnapshot = await fetch(saveUrl, { headers })
    assert.deepEqual([...new Uint8Array(await saveAfterSnapshot.arrayBuffer())], [...firstSave], 'snapshot upload must not alter canonical .sav bytes')

    await saveEvent(new Uint8Array([44, 55, 66]))
    assert.equal(cloudSave.getRevision(), 2)
    const release = async lease => fetch(`${baseUrl}/api/player-leases/${lease.sessionId}`, {
      method: 'DELETE', headers: { Cookie: lease.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId: profile.id, gameId: 'pokemon-red', generation: lease.body.leaseGeneration }),
    })
    assert.equal((await release(firstLease)).status, 200)

    const secondLease = await acquirePlayerLease(baseUrl, 'pokemon-red', profile.id, 'save-flow-two', firstLease.cookie)
    secondLease.sessionId = 'save-flow-two'
    secondLease.cookie = firstLease.cookie
    headers = leaseHeaders(secondLease)
    const discardedSnapshot = await fetch(`${baseUrl}${secondLease.body.snapshotUrl}`, { headers })
    assert.equal(discardedSnapshot.status, 404, 'close must discard a snapshot older than the canonical save')

    const secondSnapshotWrite = await putSnapshot([71, 72, 73], null, cloudSave.getRevision())
    assert.equal(secondSnapshotWrite.status, 201)
    assert.equal((await release(secondLease)).status, 200)

    const thirdLease = await acquirePlayerLease(baseUrl, 'pokemon-red', profile.id, 'save-flow-three', firstLease.cookie)
    thirdLease.sessionId = 'save-flow-three'
    thirdLease.cookie = firstLease.cookie
    headers = leaseHeaders(thirdLease)
    const retainedSnapshotResponse = await fetch(`${baseUrl}${thirdLease.body.snapshotUrl}`, { headers })
    assert.equal(retainedSnapshotResponse.status, 404, 'normal close removes automatic recovery even at the current save revision')
  })

  test('fences a stale player session and rejects a foreign device while the lease is alive', async () => {
    const rom = Buffer.from('leased game')
    const { baseUrl } = await startFixture([{ id: 'pokemon-red', title: 'Pokémon Red', system: 'gb', core: 'gambatte', file: 'pokemon-red.gb', sha256: sha256(rom) }], { 'pokemon-red.gb': rom })
    const profile = await jsonResponse(await fetch(`${baseUrl}/api/games/pokemon-red/profiles`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Red' }) }))
    const first = await acquirePlayerLease(baseUrl, 'pokemon-red', profile.id, 'session-one')
    assert.equal(first.response.status, 200)
    const blocked = await acquirePlayerLease(baseUrl, 'pokemon-red', profile.id, 'foreign-session', 'emulator_hub_device=foreign-device-id')
    assert.equal(blocked.response.status, 409)
    const replacement = await acquirePlayerLease(baseUrl, 'pokemon-red', profile.id, 'session-two', first.cookie)
    assert.equal(replacement.response.status, 200)
    assert.equal(replacement.body.leaseGeneration, first.body.leaseGeneration + 1)
    const staleHeartbeat = await fetch(`${baseUrl}/api/player-leases/session-one/heartbeat`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: first.cookie }, body: JSON.stringify({ profileId: profile.id, gameId: 'pokemon-red', generation: first.body.leaseGeneration }) })
    assert.equal(staleHeartbeat.status, 410)
    const staleWrite = await fetch(`${baseUrl}/api/profiles/${profile.id}/games/pokemon-red/save`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'If-Match': '*', Cookie: first.cookie, 'X-Player-Session-Id': 'session-one', 'X-Player-Lease-Generation': String(first.body.leaseGeneration) }, body: Buffer.from([1]) })
    assert.equal(staleWrite.status, 410)
  })

  test('starts a new lease beyond the fence persisted before Redis was initialized', async () => {
    const rom = Buffer.from('migrated fenced game')
    const { baseUrl, savesPath } = await startFixture([{ id: 'pokemon-red', title: 'Pokémon Red', system: 'gb', core: 'gambatte', file: 'pokemon-red.gb', sha256: sha256(rom) }], { 'pokemon-red.gb': rom })
    const profile = await jsonResponse(await fetch(`${baseUrl}/api/games/pokemon-red/profiles`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Red' }) }))
    const persistedSave = createSaveStore({ dataPath: savesPath })
    await persistedSave.put(profile.id, 'pokemon-red', Buffer.from([1]), null, { fenceGeneration: 2 })

    const lease = await acquirePlayerLease(baseUrl, 'pokemon-red', profile.id)

    assert.equal(lease.response.status, 200)
    assert.equal(lease.body.leaseGeneration, 3)
    assert.equal((await persistedSave.get(profile.id, 'pokemon-red')).fenceGeneration, 3)
  })

  test('identifies Emulator Hub responses for the development supervisor', async () => {
    const { baseUrl } = await startFixture([])

    const response = await fetch(`${baseUrl}/api/games`)

    assert.equal(response.headers.get('x-emulator-hub-backend'), '1')
  })

  test('keeps a sanitized, session-filtered backlog of client diagnostics', async () => {
    const fixture = await createFixture([])
    const logged = []
    const server = createHubServer({
      ...fixture,
      clientDiagnosticLogger: { info: (event, context) => logged.push({ event, context }) },
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    liveServers.add(server)
    const baseUrl = `http://127.0.0.1:${server.address().port}`

    const accepted = await fetch(`${baseUrl}/api/debug/client-events`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'ios-session-1', source: 'player', kind: 'network-error', message: 'request failed',
        page: '/player.html?profileId=private', request: { method: 'GET', path: '/api/games?private=1', status: 503 },
      }),
    })
    assert.equal(accepted.status, 204)
    assert.equal(await accepted.text(), '')

    await fetch(`${baseUrl}/api/debug/client-events`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'ios-session-2', source: 'hub', kind: 'uncaught-error', message: 'catalog failed' }),
    })

    const response = await fetch(`${baseUrl}/api/debug/client-events?sessionId=ios-session-1`)
    assert.equal(response.status, 200)
    const { events } = await jsonResponse(response)
    assert.equal(events.length, 1)
    assert.equal(events[0].page, '/player.html')
    assert.deepEqual(events[0].request, { method: 'GET', path: '/api/games', status: 503 })
    assert.equal(logged.length, 2)
    assert.equal(logged[0].event, 'mobile.client-diagnostic')
  })

  test('rejects malformed and unsupported client diagnostic requests', async () => {
    const { baseUrl } = await startFixture([])

    const malformed = await fetch(`${baseUrl}/api/debug/client-events`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'ios-session-1', source: 'unknown', kind: 'uncaught-error' }),
    })
    assert.equal(malformed.status, 400)
    assert.deepEqual(await jsonResponse(malformed), { error: 'Client diagnostic is invalid.' })

    const unsupported = await fetch(`${baseUrl}/api/debug/client-events`, { method: 'PUT' })
    assert.equal(unsupported.status, 405)
    assert.equal(unsupported.headers.get('allow'), 'GET, POST')
  })

  test('reports the conflicting listener when the backend cannot bind its endpoint', async () => {
    const error = Object.assign(new Error('listen EADDRINUSE: address already in use 127.0.0.1:3000'), {
      code: 'EADDRINUSE', errno: -4091, syscall: 'listen', address: '127.0.0.1', port: 3000,
    })

    const diagnostic = await createListenFailureDiagnostic({
      error,
      host: '127.0.0.1',
      port: 3000,
      runtime: { pid: 9123, ppid: 4567, platform: 'win32', execPath: 'C:\\Program Files\\nodejs\\node.exe', argv: ['node', '--watch', 'server.mjs'] },
      lookupListeners: async () => [{ protocol: 'TCP', endpoint: '127.0.0.1:3000', state: 'LISTENING', pid: 38856 }],
    })

    assert.deepEqual(diagnostic, {
      event: 'BACKEND_LISTEN_FAILED',
      endpoint: { host: '127.0.0.1', port: 3000 },
      error: { code: 'EADDRINUSE', errno: -4091, syscall: 'listen', address: '127.0.0.1', port: 3000, message: 'listen EADDRINUSE: address already in use 127.0.0.1:3000' },
      process: { pid: 9123, parentPid: 4567, platform: 'win32', executable: 'C:\\Program Files\\nodejs\\node.exe', arguments: ['node', '--watch', 'server.mjs'] },
      listeners: [{ protocol: 'TCP', endpoint: '127.0.0.1:3000', state: 'LISTENING', pid: 38856 }],
    })
  })

  test('runs the expired-session finalization observer when the backend starts', async () => {
    const fixture = await createFixture([])
    let observations = 0
    const server = createHubServer({
      ...fixture,
      pokemonHubSaveFlush: {
        async flushExpiredLeases() { observations += 1 },
        markDirty() {},
        async flushSource() { return { status: 'clean' } },
      },
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    liveServers.add(server)

    await new Promise(resolve => setImmediate(resolve))

    assert.equal(observations, 1)
  })

  test('finalizes an expired workspace by flushing its save before releasing its lease', async () => {
    const fixture = await createFixture([])
    const actions = []
    let listed = false
    const source = { sourceKey: 'save:profile-may:emerald', sourceSessionId: 'source-session', leaseToken: 'lease-token' }
    const server = createHubServer({
      ...fixture,
      pokemonHubSessionService: {
        async listExpired() {
          if (listed) return []
          listed = true
          return [{ profileId: 'profile-may', sessionId: 'expired-session' }]
        },
        async releaseExpired({ beforeClose }) {
          await beforeClose([source])
          actions.push({ type: 'session-deleted' })
        },
      },
      pokemonHubSnapshotCoordinator: {
        async release(request) { actions.push({ type: 'lease-released', request }); return { released: true } },
      },
      pokemonHubSaveFlush: {
        async flushExpiredLeases() {},
        markDirty() {},
        async flushSource(request) { actions.push({ type: 'save-flushed', request }); return { status: 'flushed' } },
      },
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    liveServers.add(server)
    await new Promise(resolve => setImmediate(resolve))

    assert.deepEqual(actions.map(action => action.type), ['save-flushed', 'lease-released', 'session-deleted'])
    assert.deepEqual(actions[0].request, { profileId: 'profile-may', sourceKey: source.sourceKey })
    assert.deepEqual(actions[1].request, { profileId: 'profile-may', sourceKey: source.sourceKey, workspaceId: 'expired-session', sourceSessionId: source.sourceSessionId, leaseToken: source.leaseToken })
  })

  test('does not log an accepted canonical session snapshot', async () => {
    const fixture = await createFixture([])
    const requests = []
    const events = []
    const server = createHubServer({
      ...fixture,
      pokemonHubLogger: { info: (event, context) => events.push({ level: 'info', event, context }), warn: (event, context) => events.push({ level: 'warn', event, context }), error: (event, context) => events.push({ level: 'error', event, context }) },
      pokemonHubSessionService: {
        async syncCanonicalSnapshot(request) {
          requests.push(request)
          return { status: 'accepted', dirtySourceKeys: [] }
        },
      },
      pokemonHubSaveFlush: {
        async flushExpiredLeases() {},
        markDirty() {},
        async flushSource() { return { status: 'clean' } },
      },
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    liveServers.add(server)
    const baseUrl = `http://127.0.0.1:${server.address().port}`

    const response = await fetch(`${baseUrl}/api/profiles/profile-may/pokemon-hub/sessions/session-a/snapshots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'snapshot-7' },
      body: JSON.stringify({ revision: 0, panes: [null, null, null] }),
    })

    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-length'), '0')
    assert.equal(await response.text(), '')
    assert.deepEqual(requests.map(({ profileId, sessionId, idempotencyKey, snapshot }) => ({ profileId, sessionId, idempotencyKey, snapshot })), [{
      profileId: 'profile-may', sessionId: 'session-a', idempotencyKey: 'snapshot-7', snapshot: { revision: 0, panes: [null, null, null] },
    }])
    assert.deepEqual(events, [])
  })

  test('logs snapshot processing failures as errors', async () => {
    const fixture = await createFixture([])
    const events = []
    const server = createHubServer({
      ...fixture,
      pokemonHubLogger: { info: (event, context) => events.push({ level: 'info', event, context }), warn: (event, context) => events.push({ level: 'warn', event, context }), error: (event, context) => events.push({ level: 'error', event, context }) },
      pokemonHubSessionService: {
        async syncCanonicalSnapshot() { throw new Error('snapshot pipeline failed') },
      },
      pokemonHubSaveFlush: {
        async flushExpiredLeases() {},
        markDirty() {},
        async flushSource() { return { status: 'clean' } },
      },
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    liveServers.add(server)

    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/profiles/profile-may/pokemon-hub/sessions/session-a/snapshots`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'snapshot-error' }, body: JSON.stringify({ revision: 0, panes: [null, null, null] }),
    })

    assert.equal(response.status, 400)
    assert.equal(events.some(entry => entry.event === 'snapshot.http.failed'), true)
    assert.equal(events.every(entry => entry.level === 'error'), true)
  })

  test('does not log a successful heartbeat', async () => {
    const fixture = await createFixture([])
    const events = []
    const server = createHubServer({
      ...fixture,
      pokemonHubLogger: { info: (event, context) => events.push({ level: 'info', event, context }), warn: (event, context) => events.push({ level: 'warn', event, context }), error: (event, context) => events.push({ level: 'error', event, context }) },
      pokemonHubSessionService: {
        async heartbeat() { return { serverNow: 123 } },
      },
      pokemonHubSaveFlush: {
        async flushExpiredLeases() {},
        markDirty() {},
        async flushSource() { return { status: 'clean' } },
      },
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    liveServers.add(server)
    const baseUrl = `http://127.0.0.1:${server.address().port}`

    const response = await fetch(`${baseUrl}/api/profiles/profile-may/pokemon-hub/sessions/session-a/heartbeat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sequence: 8 }),
    })

    assert.equal(response.status, 200)
    assert.deepEqual(await jsonResponse(response), { serverNow: 123 })
    assert.deepEqual(events, [])
  })

  test('releases a Hub profile source on session close without attempting a save flush', async () => {
    const fixture = await createFixture([])
    const flushes = []
    const releases = []
    const server = createHubServer({
      ...fixture,
      pokemonHubSessionService: {
        async close({ beforeClose }) {
          await beforeClose([{ sourceKey: 'hub:profile-a', sourceSessionId: 'source-session', leaseToken: 'lease-token' }])
        },
      },
      pokemonHubSnapshotCoordinator: {
        async release(request) { releases.push(request) },
      },
      pokemonHubSaveFlush: {
        async flushExpiredLeases() {},
        markDirty() {},
        async flushSource(request) { flushes.push(request); return { status: 'clean' } },
      },
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    liveServers.add(server)

    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/profiles/profile-may/pokemon-hub/sessions/session-a`, { method: 'DELETE' })

    assert.equal(response.status, 200)
    assert.deepEqual(flushes, [])
    assert.deepEqual(releases, [{ profileId: 'profile-may', sourceKey: 'hub:profile-a', workspaceId: 'session-a', sourceSessionId: 'source-session', leaseToken: 'lease-token' }])
  })

  test('flushes a cross-profile game source to its save before closing the session', async () => {
    const fixture = await createFixture([])
    const flushes = []
    const releases = []
    const source = { sourceKey: 'save:profile-sapphire:sapphire', sourceSessionId: 'source-session', leaseToken: 'lease-token' }
    const server = createHubServer({
      ...fixture,
      pokemonHubSessionService: {
        async close({ beforeClose }) {
          await beforeClose([source])
        },
      },
      pokemonHubSnapshotCoordinator: {
        async release(request) { releases.push(request) },
      },
      pokemonHubSaveFlush: {
        async flushExpiredLeases() {},
        markDirty() {},
        async flushSource(request) { flushes.push(request); return { status: 'flushed' } },
      },
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    liveServers.add(server)

    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/profiles/profile-ruby/pokemon-hub/sessions/session-a`, { method: 'DELETE' })

    assert.equal(response.status, 200)
    assert.deepEqual(flushes, [{ profileId: 'profile-ruby', sourceKey: source.sourceKey }])
    assert.deepEqual(releases, [{ profileId: 'profile-ruby', sourceKey: source.sourceKey, workspaceId: 'session-a', sourceSessionId: 'source-session', leaseToken: 'lease-token' }])
  })

  test('flushes every save source in a three-save session before releasing its leases', async () => {
    const fixture = await createFixture([])
    const closes = []
    const releases = []
    const flushes = []
    const sources = [
      { sourceKey: 'save:profile-ruby:ruby', sourceSessionId: 'source-session-a', leaseToken: 'lease-a' },
      { sourceKey: 'save:profile-sapphire:sapphire', sourceSessionId: 'source-session-b', leaseToken: 'lease-b' },
      { sourceKey: 'save:profile-emerald:emerald', sourceSessionId: 'source-session-c', leaseToken: 'lease-c' },
    ]
    const snapshot = { revision: 4, panes: [null, null, null] }
    const server = createHubServer({
      ...fixture,
      pokemonHubSessionService: {
        async closeCanonicalSession(request) {
          closes.push(request)
          for (const source of sources) await request.flushOutgoingSource(source)
          for (const source of sources) await request.releaseSource(source)
          return { status: 'complete' }
        },
      },
      pokemonHubSnapshotCoordinator: {
        async release(request) { releases.push(request); return { released: true } },
      },
      pokemonHubSaveFlush: {
        async flushExpiredLeases() {},
        markDirty() {},
        async flushSource(request) { flushes.push(request); return { status: 'flushed' } },
      },
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    liveServers.add(server)

    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/profiles/profile-may/pokemon-hub/sessions/session-a/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'close-4' },
      body: JSON.stringify(snapshot),
    })

    assert.equal(response.status, 200)
    assert.equal(await response.text(), '')
    assert.deepEqual(flushes, sources.map(source => ({ profileId: 'profile-may', sourceKey: source.sourceKey })))
    assert.deepEqual(releases, sources.map(source => ({ profileId: 'profile-may', sourceKey: source.sourceKey, workspaceId: 'session-a', sourceSessionId: source.sourceSessionId, leaseToken: source.leaseToken })))
    assert.equal(closes.length, 1)
    assert.equal(closes[0].profileId, 'profile-may')
    assert.equal(closes[0].sessionId, 'session-a')
    assert.equal(closes[0].idempotencyKey, 'close-4')
    assert.deepEqual(closes[0].snapshot, snapshot)
  })

  test('returns only the authoritative canonical snapshot on validation correction', async () => {
    const fixture = await createFixture([])
    const server = createHubServer({
      ...fixture,
      pokemonHubSessionService: { async syncCanonicalSnapshot() { return { status: 'corrected', snapshot: { revision: 3, panes: [null, null, null] } } } },
      pokemonHubSaveFlush: { async flushExpiredLeases() {}, markDirty() {}, async flushSource() { return { status: 'clean' } } },
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    liveServers.add(server)
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/profiles/profile-may/pokemon-hub/sessions/session-a/snapshots`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'snapshot-8' }, body: JSON.stringify({ revision: 2, panes: [null, null, null] }),
    })

    assert.equal(response.status, 409)
    assert.deepEqual(await jsonResponse(response), { revision: 3, panes: [null, null, null] })
  })

  test('passes profile-scoped snapshot acquire and sync requests to the coordinator', async () => {
    const fixture = await createFixture([])
    const requests = []
    const server = createHubServer({
      ...fixture,
      pokemonHubSnapshotCoordinator: {
        async acquire(request) { requests.push({ type: 'acquire', request }); return { status: 'acquired' } },
        async renew(request) { requests.push({ type: 'renew', request }); return { status: 'renewed' } },
        async sync(request) { requests.push({ type: 'sync', request }); return { status: 'accepted', snapshots: [] } },
      },
      pokemonHubSaveFlush: { markDirty() {}, async flushSource() { return { status: 'clean' } } },
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    liveServers.add(server)
    const baseUrl = `http://127.0.0.1:${server.address().port}`

    const acquire = await fetch(`${baseUrl}/api/profiles/profile-may/pokemon-hub/snapshots/acquire`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceKey: 'save:profile-may:emerald', workspaceId: 'workspace-a', profileId: 'forged' }),
    })
    const sync = await fetch(`${baseUrl}/api/profiles/profile-may/pokemon-hub/snapshots/sync`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId: 'workspace-a', clientSequence: 1, idempotencyKey: 'sync-1', sources: [], profileId: 'forged' }),
    })
    const renew = await fetch(`${baseUrl}/api/profiles/profile-may/pokemon-hub/snapshots/renew`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceKey: 'save:profile-may:emerald', workspaceId: 'workspace-a', sourceSessionId: 'session-a', leaseToken: 'token-a', profileId: 'forged' }),
    })

    assert.equal(acquire.status, 200)
    assert.equal(sync.status, 200)
    assert.equal(renew.status, 200)
    assert.deepEqual(requests, [
      { type: 'acquire', request: { sourceKey: 'save:profile-may:emerald', workspaceId: 'workspace-a', profileId: 'profile-may' } },
      { type: 'sync', request: { workspaceId: 'workspace-a', clientSequence: 1, idempotencyKey: 'sync-1', sources: [], profileId: 'profile-may' } },
      { type: 'renew', request: { sourceKey: 'save:profile-may:emerald', workspaceId: 'workspace-a', sourceSessionId: 'session-a', leaseToken: 'token-a', profileId: 'profile-may' } },
    ])
  })

  test('acquires an open grid pane as a workspace snapshot source', async () => {
    const fixture = await createFixture([])
    const requests = []
    const server = createHubServer({
      ...fixture,
      pokemonHubSnapshotCoordinator: {
        async acquire(request) {
          requests.push({ type: 'acquire', request })
          if (requests.filter(entry => entry.type === 'acquire').length === 1) {
            const error = new Error('source is not adopted')
            error.code = 'SOURCE_NOT_ADOPTED'
            throw error
          }
          return { sourceKey: request.sourceKey, sourceSessionId: 'workspace-source', leaseToken: 'lease-token', placements: [] }
        },
        async ensureHubSource(request) { requests.push({ type: 'ensure', request }) },
      },
      pokemonHubProfileStore: {
        async bindOwner(hubProfileId, profileId) { requests.push({ type: 'bind', hubProfileId, profileId }); return { hubProfileId } },
      },
      pokemonHubGridTransferService: {},
      pokemonHubSaveFlush: { markDirty() {}, async flushSource() { return { status: 'clean' } } },
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    liveServers.add(server)
    const baseUrl = `http://127.0.0.1:${server.address().port}`

    const response = await fetch(`${baseUrl}/api/profiles/profile-may/pokemon-hub/snapshots/acquire`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceKey: 'hub:grid-a', workspaceId: 'workspace-a' }),
    })

    assert.equal(response.status, 200)
    assert.deepEqual(requests, [
      { type: 'acquire', request: { sourceKey: 'hub:grid-a', workspaceId: 'workspace-a', profileId: 'profile-may' } },
      { type: 'bind', hubProfileId: 'grid-a', profileId: 'profile-may' },
      { type: 'ensure', request: { profileId: 'profile-may', sourceKey: 'hub:grid-a', hubProfileId: 'grid-a', minimumSlotCount: 60 } },
      { type: 'acquire', request: { sourceKey: 'hub:grid-a', workspaceId: 'workspace-a', profileId: 'profile-may' } },
    ])
  })

  test('delegates a persistent grid transfer and schedules only returned save sources for flushing', async () => {
    const fixture = await createFixture([])
    const requests = []
    const dirty = []
    const server = createHubServer({
      ...fixture,
      pokemonHubGridTransferService: {
        async transfer(request) {
          requests.push(request)
          return { status: 'accepted', snapshots: [{ sourceKey: 'save:profile-may:emerald' }, { sourceKey: 'hub:grid-a' }], hubProfile: { hubProfileId: 'grid-a', grid: { entries: {} } } }
        },
      },
      pokemonHubSaveFlush: { markDirty(request) { dirty.push(request) }, async flushSource() { return { status: 'clean' } } },
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    liveServers.add(server)

    const response = await fetch(`${`http://127.0.0.1:${server.address().port}`}/api/profiles/profile-may/pokemon-hub/transfers`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId: 'workspace-a', clientSequence: 3, idempotencyKey: 'transfer-3', source: { kind: 'game' }, target: { kind: 'hub' }, sources: [] }),
    })

    assert.equal(response.status, 200)
    assert.equal(requests.length, 1)
    assert.equal(requests[0].profileId, 'profile-may')
    assert.deepEqual(dirty, [{ profileId: 'profile-may', sourceKey: 'save:profile-may:emerald' }])
  })

  test('accepts a full snapshot payload larger than the default JSON request limit', async () => {
    const fixture = await createFixture([])
    const requests = []
    const server = createHubServer({
      ...fixture,
      pokemonHubSnapshotCoordinator: {
        async sync(request) { requests.push(request); return { status: 'accepted', snapshots: [] } },
      },
      pokemonHubSaveFlush: { markDirty() {}, async flushSource() { return { status: 'clean' } } },
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    liveServers.add(server)
    const baseUrl = `http://127.0.0.1:${server.address().port}`
    const payload = {
      workspaceId: 'workspace-a',
      clientSequence: 1,
      idempotencyKey: 'sync-large-1',
      sources: [{
        sourceKey: 'save:profile-may:emerald',
        sourceSessionId: 'session-a',
        leaseToken: 'token-a',
        placements: Array.from({ length: 420 }, (_, slot) => ({
          location: { kind: 'game', area: 'box', box: Math.floor(slot / 30), slot: slot % 30 },
          pokemonInstanceId: null,
        })),
      }],
    }

    const body = JSON.stringify(payload)
    assert.ok(Buffer.byteLength(body) > 4096)
    const response = await fetch(`${baseUrl}/api/profiles/profile-may/pokemon-hub/snapshots/sync`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    })

    assert.equal(response.status, 200)
    assert.equal(requests.length, 1)
    assert.equal(requests[0].sources[0].placements.length, 420)
  })

  test('accepts a persistent grid transfer carrying a full save snapshot', async () => {
    const fixture = await createFixture([])
    const requests = []
    const server = createHubServer({
      ...fixture,
      pokemonHubGridTransferService: { async transfer(request) { requests.push(request); return { status: 'accepted', snapshots: [], hubProfile: { hubProfileId: 'grid-a', grid: { entries: {} } } } } },
      pokemonHubSaveFlush: { markDirty() {}, async flushSource() { return { status: 'clean' } } },
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    liveServers.add(server)
    const payload = {
      workspaceId: 'workspace-a', clientSequence: 1, idempotencyKey: 'transfer-1', source: { kind: 'game' }, target: { kind: 'hub' },
      sources: [{ sourceKey: 'save:profile-may:emerald', sourceSessionId: 'session-a', leaseToken: 'token-a', baseRevision: 1, placements: Array.from({ length: 420 }, (_, slot) => ({ location: { kind: 'game', area: 'box', box: Math.floor(slot / 30), slot: slot % 30 }, pokemonInstanceId: null })) }],
    }
    const body = JSON.stringify(payload)
    assert.ok(Buffer.byteLength(body) > 4096)

    const response = await fetch(`${`http://127.0.0.1:${server.address().port}`}/api/profiles/profile-may/pokemon-hub/transfers`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    })

    assert.equal(response.status, 200)
    assert.equal(requests.length, 1)
  })

  test('finalizes an expired snapshot session before retrying its new acquisition', async () => {
    const fixture = await createFixture([])
    let acquireAttempts = 0
    let finalizations = 0
    const server = createHubServer({
      ...fixture,
      pokemonHubSnapshotCoordinator: {
        async acquire() {
          acquireAttempts += 1
          if (acquireAttempts === 1) {
            const error = new Error('Pokemon Hub source is waiting for its final save flush.')
            error.code = 'SOURCE_FLUSH_PENDING'
            throw error
          }
          return { sourceKey: 'save:profile-may:emerald', sourceSessionId: 'new-source-session', leaseToken: 'new-token', placements: [] }
        },
      },
      pokemonHubSaveFlush: {
        async flushExpiredLeases() { finalizations += 1 },
        markDirty() {},
        async flushSource() { return { status: 'clean' } },
      },
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    liveServers.add(server)
    const baseUrl = `http://127.0.0.1:${server.address().port}`

    const response = await fetch(`${baseUrl}/api/profiles/profile-may/pokemon-hub/snapshots/acquire`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceKey: 'save:profile-may:emerald', workspaceId: 'new-workspace-session' }),
    })

    assert.equal(response.status, 200)
    assert.equal(acquireAttempts, 2)
    assert.ok(finalizations >= 1)
  })

  test('marks accepted snapshots dirty and flushes before a source lease is released', async () => {
    const fixture = await createFixture([])
    const actions = []
    const server = createHubServer({
      ...fixture,
      pokemonHubSnapshotCoordinator: {
        async sync() { return { status: 'accepted', snapshots: [{ sourceKey: 'save:profile-may:emerald' }] } },
        async release(request) { actions.push({ type: 'release', request }); return { released: true } },
      },
      pokemonHubSaveFlush: {
        markDirty(request) { actions.push({ type: 'dirty', request }) },
        async flushSource(request) { actions.push({ type: 'flush', request }); return { status: 'flushed' } },
      },
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    liveServers.add(server)
    const baseUrl = `http://127.0.0.1:${server.address().port}`

    const synced = await fetch(`${baseUrl}/api/profiles/profile-may/pokemon-hub/snapshots/sync`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId: 'workspace-a', clientSequence: 1, idempotencyKey: 'sync-1', sources: [] }),
    })
    const released = await fetch(`${baseUrl}/api/profiles/profile-may/pokemon-hub/snapshots/release`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceKey: 'save:profile-may:emerald', workspaceId: 'workspace-a', sourceSessionId: 'session-a', leaseToken: 'token-a' }),
    })

    assert.equal(synced.status, 200)
    assert.equal(released.status, 200)
    assert.deepEqual(actions.map(action => action.type), ['dirty', 'flush', 'release'])
  })

  test('adopts supported save bytes into the snapshot coordinator after a save revision is stored', async () => {
    const rom = Buffer.from('pokemon snapshot adoption rom')
    const fixture = await createFixture([{
      id: 'pokemon-emerald', title: 'Pokémon Emerald', system: 'gba', core: 'mgba', file: 'pokemon-emerald.gba', sha256: sha256(rom),
      pokemonSave: { supported: true, adapter: 'gen3-gba-v1', layoutProfile: 'pokemon-emerald-gba' },
    }], { 'pokemon-emerald.gba': rom })
    const adopted = []
    const server = createHubServer({
      ...fixture,
      pokemonSaveAdapters: { get: () => ({ id: 'gen3-gba-v1', readAllSlots: () => [{ location: { kind: 'game', area: 'party', slot: 0 }, record: null }] }) },
      pokemonHubSnapshotCoordinator: { adopt: async (request) => { adopted.push(request); return { sourceKey: request.sourceKey } } },
      pokemonHubSaveFlush: { markDirty() {}, async flushSource() { return { status: 'clean' } } },
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    liveServers.add(server)
    const baseUrl = `http://127.0.0.1:${server.address().port}`
    const profile = await jsonResponse(await fetch(`${baseUrl}/api/games/pokemon-emerald/profiles`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'May' }),
    }))
    const bytes = Buffer.from([7, 8, 9])
    const lease = await acquirePlayerLease(baseUrl, 'pokemon-emerald', profile.id)

    const saved = await fetch(`${baseUrl}/api/profiles/${profile.id}/games/pokemon-emerald/save`, {
      method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'If-Match': '*', Cookie: lease.cookie, 'X-Player-Session-Id': 'player-session-a', 'X-Player-Lease-Generation': String(lease.body.leaseGeneration) }, body: bytes,
    })

    assert.equal(saved.status, 201)
    assert.equal(adopted.length, 1)
    assert.equal(adopted[0].profileId, profile.id)
    assert.equal(adopted[0].sourceKey, `save:${profile.id}:pokemon-emerald`)
    assert.equal(adopted[0].sourceRevision, 1)
    assert.equal(adopted[0].adapter, 'gen3-gba-v1')
  })

  test('retains legacy save-layout metadata when the verified registry entry omits it', async () => {
    const fixture = await createFixture([{
      id: 'pokemon-emerald', title: 'Pokémon Emerald', system: 'gba', core: 'mgba', file: 'pokemon-emerald.gba', sha256: 'a'.repeat(64),
      pokemonSave: { supported: true, adapter: 'gen3-gba-v1', layoutProfile: 'pokemon-emerald-gba' },
    }])
    const registryEntry = { id: 'pokemon-emerald', title: 'Pokémon Emerald', system: 'gba', core: 'mgba', file: 'pokemon-emerald.gba', sha256: 'a'.repeat(64) }
    const server = createHubServer({
      ...fixture,
      romDiscovery: { async scan() { return { accepted: [registryEntry] } } },
      romRegistry: { async load() { return [] }, async replace(entries) { return entries } },
      profileStore: { async get(gameId, profileId) { return gameId === 'pokemon-emerald' && profileId === 'profile-may' ? { id: profileId } : null } },
      saveStore: { async get() { return { bytes: Buffer.alloc(0x20000), revision: 1 } }, async put() { return { revision: 2 } } },
      pokemonSaveAdapters: { get(adapterId) { return adapterId === 'gen3-gba-v1' ? { inspect() { return { party: [], boxes: [], transferCapabilities: { game: 'pokemon-emerald', ordinaryTradeReady: true, nationalDexUnlocked: false, networkMachineRestored: null } } } } : null } },
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    liveServers.add(server)
    const baseUrl = `http://127.0.0.1:${server.address().port}`

    const response = await fetch(`${baseUrl}/api/pokemon-hub/save-profiles/pokemon-emerald/profile-may/layout`)

    assert.equal(response.status, 200)
    assert.deepEqual((await jsonResponse(response)).transferCapabilities, { game: 'pokemon-emerald', ordinaryTradeReady: true, nationalDexUnlocked: false, networkMachineRestored: null })
  })

  test('creates and lists Hub profiles from the Redis-backed Hub collection', async () => {
    const { baseUrl } = await startFixture([])

    assert.deepEqual(await jsonResponse(await fetch(`${baseUrl}/api/pokemon-hub/profiles`)), { profiles: [] })

    const createdResponse = await fetch(`${baseUrl}/api/pokemon-hub/profiles`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Shiny collection' }),
    })
    assert.equal(createdResponse.status, 201)
    const created = await jsonResponse(createdResponse)
    assert.equal(created.name, 'Shiny collection')
    assert.deepEqual(created.grid, { entries: {} })

    assert.deepEqual(await jsonResponse(await fetch(`${baseUrl}/api/pokemon-hub/profiles`)), { profiles: [created] })
  })

  test('renames and deletes a Hub profile through its own collection route', async () => {
    const { baseUrl } = await startFixture([])
    const created = await jsonResponse(await fetch(`${baseUrl}/api/pokemon-hub/profiles`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Shiny collection' }),
    }))

    const renamedResponse = await fetch(`${baseUrl}/api/pokemon-hub/profiles/${created.hubProfileId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Living dex' }),
    })
    assert.equal(renamedResponse.status, 200)
    const updated = await jsonResponse(renamedResponse)
    assert.equal(updated.name, 'Living dex')

    const deletedResponse = await fetch(`${baseUrl}/api/pokemon-hub/profiles/${created.hubProfileId}`, { method: 'DELETE' })
    assert.equal(deletedResponse.status, 200)
    assert.deepEqual(await jsonResponse(deletedResponse), { hubProfileId: created.hubProfileId, discardedPokemonCount: 0 })
  })

  test('returns a profile-scoped Pokémon Hub inventory', async () => {
    const rom = Buffer.from('pokemon hub test rom')
    const { baseUrl } = await startFixture([{
      id: 'pokemon-emerald', title: 'Pokémon Emerald', system: 'gba', core: 'mgba', file: 'pokemon-emerald.gba', sha256: sha256(rom),
      pokemonSave: { supported: true, adapter: 'gen3-gba-v1' },
    }], { 'pokemon-emerald.gba': rom })
    const profile = await jsonResponse(await fetch(`${baseUrl}/api/games/pokemon-emerald/profiles`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'May' }),
    }))

    const response = await fetch(`${baseUrl}/api/profiles/${profile.id}/pokemon-hub`)

    assert.equal(response.status, 200)
    const inventory = await jsonResponse(response)
    assert.equal(inventory.hubEpoch, 0)
    assert.equal(inventory.slots.length, 30)
    assert.deepEqual(inventory.games, [{ id: 'pokemon-emerald', title: 'Pokémon Emerald', status: 'save-missing' }])
  })

  test('stores and retrieves a changed in-game save for its selected profile', async () => {
    const rom = Buffer.from('pokemon save test rom')
    const { baseUrl } = await startFixture([{
      id: 'pokemon-emerald', title: 'Pokémon Emerald', system: 'gba', core: 'mgba', file: 'pokemon-emerald.gba', sha256: sha256(rom),
    }], { 'pokemon-emerald.gba': rom })
    const profile = await jsonResponse(await fetch(`${baseUrl}/api/games/pokemon-emerald/profiles`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'May' }),
    }))
    const saveUrl = `${baseUrl}/api/profiles/${profile.id}/games/pokemon-emerald/save`

    assert.equal((await fetch(saveUrl)).status, 404)

    const firstSave = Buffer.from([1, 2, 3, 4])
    const lease = await acquirePlayerLease(baseUrl, 'pokemon-emerald', profile.id)
    const created = await fetch(saveUrl, {
      method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'If-Match': '*', Cookie: lease.cookie, 'X-Player-Session-Id': 'player-session-a', 'X-Player-Lease-Generation': String(lease.body.leaseGeneration) }, body: firstSave,
    })
    assert.equal(created.status, 201)
    assert.deepEqual(await jsonResponse(created), { revision: 1, sha256: sha256(firstSave) })

    const restored = await fetch(saveUrl)
    assert.equal(restored.status, 200)
    assert.equal(restored.headers.get('etag'), '"1"')
    assert.equal(restored.headers.get('x-save-sha256'), sha256(firstSave))
    assert.deepEqual(Buffer.from(await restored.arrayBuffer()), firstSave)

    const changedSave = Buffer.from([4, 3, 2, 1])
    const updated = await fetch(saveUrl, {
      method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'If-Match': '"1"', Cookie: lease.cookie, 'X-Player-Session-Id': 'player-session-a', 'X-Player-Lease-Generation': String(lease.body.leaseGeneration) }, body: changedSave,
    })
    assert.equal(updated.status, 200)
    assert.deepEqual(await jsonResponse(updated), { revision: 2, sha256: sha256(changedSave) })
  })

  test('forwards scoped frontend snapshot failures to the backend container logger', async () => {
    const logged = []
    const logger = Object.fromEntries(['info', 'warn', 'error'].map(level => [level, (event, context) => logged.push({ level, event, context })]))
    const { baseUrl } = await startFixture([], {}, {}, { savePipelineLogger: logger })
    const response = await fetch(`${baseUrl}/api/debug/client-events`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'session-1', source: 'player', kind: 'snapshot-flow', level: 'error', message: 'restore-load-failed', gameId: 'game', profileId: 'profile', snapshotKind: 'cloud-recovery', candidateId: 'remote:4', revision: 4, code: 'LOAD_FAILED', error: 'invalid state', state: [7, 8] }),
    })
    assert.equal(response.status, 204)
    assert.deepEqual(logged.map(({ level, event }) => [level, event]), [['error', 'snapshot.front.restore-load-failed']])
    assert.equal(logged[0].context.candidateId, 'remote:4')
    assert.equal('state' in logged[0].context, false)
  })

  test('traces a binary save PUT from ingress through persistence and response without logging save bytes', async () => {
    const rom = Buffer.from('save trace integration rom')
    const events = []
    const { baseUrl } = await startFixture([{
      id: 'pokemon-emerald', title: 'Pokémon Emerald', system: 'gba', core: 'mgba', file: 'pokemon-emerald.gba', sha256: sha256(rom),
    }], { 'pokemon-emerald.gba': rom }, {}, {
      savePipelineLogger: {
        info: (event, context) => events.push({ level: 'info', event, context }),
        warn: (event, context) => events.push({ level: 'warn', event, context }),
        error: (event, context) => events.push({ level: 'error', event, context }),
      },
    })
    const profile = await jsonResponse(await fetch(`${baseUrl}/api/games/pokemon-emerald/profiles`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'May' }),
    }))
    const lease = await acquirePlayerLease(baseUrl, 'pokemon-emerald', profile.id)
    const traceId = 'save-trace-integration-1'
    const bytes = Buffer.from([0, 1, 2, 255])
    const response = await fetch(`${baseUrl}/api/profiles/${profile.id}/games/pokemon-emerald/save`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream', 'If-Match': '*', 'X-Save-Trace-Id': traceId,
        Cookie: lease.cookie, 'X-Player-Session-Id': 'player-session-a', 'X-Player-Lease-Generation': String(lease.body.leaseGeneration),
      },
      body: bytes,
    })

    assert.equal(response.status, 201)
    assert.equal(response.headers.get('x-save-trace-id'), traceId)
    const traceEvents = events.filter(({ context }) => context.traceId === traceId)
    assert.deepEqual(traceEvents.map(({ event }) => event), [
      'save.backend.put-received',
      'save.backend.body-received',
      'save.backend.lease-validated',
      'save.backend.persist-started',
      'save.backend.persisted',
      'save.backend.adoption-started',
      'save.backend.adoption-skipped',
      'save.backend.response',
    ])
    assert.equal(traceEvents.find(({ event }) => event === 'save.backend.body-received').context.sizeBytes, bytes.length)
    assert.equal(traceEvents.find(({ event }) => event === 'save.backend.persisted').context.revision, 1)
    assert.ok(traceEvents.every(({ context }) => !('bytes' in context) && !('body' in context)))
    assert.ok(!JSON.stringify(traceEvents).includes(bytes.toString('hex')))
  })

  test('traces battery-save GET from backend lookup through returned bytes', async () => {
    const rom = Buffer.from('save read trace integration rom')
    const events = []
    const { baseUrl } = await startFixture([{
      id: 'pokemon-emerald', title: 'Pokémon Emerald', system: 'gba', core: 'mgba', file: 'pokemon-emerald.gba', sha256: sha256(rom),
    }], { 'pokemon-emerald.gba': rom }, {}, {
      savePipelineLogger: {
        info: (event, context) => events.push({ level: 'info', event, context }),
        warn: (event, context) => events.push({ level: 'warn', event, context }),
        error: (event, context) => events.push({ level: 'error', event, context }),
      },
    })
    const profile = await jsonResponse(await fetch(`${baseUrl}/api/games/pokemon-emerald/profiles`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'May' }),
    }))
    const lease = await acquirePlayerLease(baseUrl, 'pokemon-emerald', profile.id)
    const leaseHeaders = { Cookie: lease.cookie, 'X-Player-Session-Id': 'player-session-a', 'X-Player-Lease-Generation': String(lease.body.leaseGeneration) }
    const bytes = Buffer.from([0, 4, 8, 255])
    const put = await fetch(`${baseUrl}/api/profiles/${profile.id}/games/pokemon-emerald/save`, {
      method: 'PUT', headers: { ...leaseHeaders, 'Content-Type': 'application/octet-stream', 'If-Match': '*' }, body: bytes,
    })
    assert.equal(put.status, 201)

    const traceId = 'save-read-trace-integration-1'
    const response = await fetch(`${baseUrl}/api/profiles/${profile.id}/games/pokemon-emerald/save`, {
      headers: { ...leaseHeaders, 'X-Save-Trace-Id': traceId },
    })

    assert.equal(response.status, 200)
    assert.equal(response.headers.get('x-save-trace-id'), traceId)
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [...bytes])
    const traceEvents = events.filter(({ context }) => context.traceId === traceId)
    assert.deepEqual(traceEvents.map(({ event }) => event), [
      'save.backend.get-received',
      'save.backend.read-started',
      'save.backend.read-completed',
      'save.backend.response',
    ])
    assert.equal(traceEvents.find(({ event }) => event === 'save.backend.read-completed').context.sizeBytes, bytes.length)
    assert.equal(traceEvents.find(({ event }) => event === 'save.backend.read-completed').context.revision, 1)
    assert.ok(traceEvents.every(({ context }) => !('bytes' in context) && !('body' in context)))
  })

  test('records a correlated reason when the save PUT lease is rejected', async () => {
    const rom = Buffer.from('save lease trace integration rom')
    const events = []
    const { baseUrl } = await startFixture([{
      id: 'pokemon-emerald', title: 'Pokémon Emerald', system: 'gba', core: 'mgba', file: 'pokemon-emerald.gba', sha256: sha256(rom),
    }], { 'pokemon-emerald.gba': rom }, {}, {
      savePipelineLogger: {
        info: (event, context) => events.push({ level: 'info', event, context }),
        warn: (event, context) => events.push({ level: 'warn', event, context }),
        error: (event, context) => events.push({ level: 'error', event, context }),
      },
    })
    const profile = await jsonResponse(await fetch(`${baseUrl}/api/games/pokemon-emerald/profiles`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'May' }),
    }))
    const lease = await acquirePlayerLease(baseUrl, 'pokemon-emerald', profile.id)
    const traceId = 'save-trace-invalid-lease'
    const response = await fetch(`${baseUrl}/api/profiles/${profile.id}/games/pokemon-emerald/save`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream', 'If-Match': '*', 'X-Save-Trace-Id': traceId,
        Cookie: lease.cookie, 'X-Player-Session-Id': 'player-session-a', 'X-Player-Lease-Generation': String(lease.body.leaseGeneration + 1),
      },
      body: Buffer.from([8, 7, 6]),
    })

    assert.equal(response.status, 410)
    const failed = events.find(({ event, context }) => event === 'save.backend.failed' && context.traceId === traceId)
    assert.equal(failed.context.stage, 'lease-validation')
    assert.equal(failed.context.code, 'PLAYER_LEASE_INVALID')
    assert.equal(events.some(({ event, context }) => event === 'save.backend.persisted' && context.traceId === traceId), false)
  })

  test('retrieves and replaces the global control profile', async () => {
    const { baseUrl } = await startFixture([])
    const current = await fetch(`${baseUrl}/api/control-profile`)
    assert.equal(current.status, 200)
    const profile = await jsonResponse(current)
    assert.equal(profile.system, 'gba')
    assert.equal(profile.bindings['8'].keyboard, 'z')

    const replacement = structuredClone(profile)
    replacement.name = 'Test mapping'
    replacement.bindings['8'] = { keyboard: 'k', gamepad: 'BUTTON_4' }
    const saved = await fetch(`${baseUrl}/api/control-profile`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(replacement),
    })
    assert.equal(saved.status, 200)
    assert.deepEqual(await jsonResponse(saved), replacement)

    const malformed = await fetch(`${baseUrl}/api/control-profile`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    })
    assert.equal(malformed.status, 400)
  })

  test('loads and atomically patches global user preferences', async () => {
    const { baseUrl } = await startFixture([])
    const initialResponse = await fetch(`${baseUrl}/api/user-preferences`)
    assert.equal(initialResponse.status, 200)
    assert.equal(initialResponse.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await jsonResponse(initialResponse), {
      preferences: { version: 1, fastForwardSpeed: 1.5, fastForwardEnabled: false, muted: false, triggerActions: { l2: 'none', r2: 'none' } },
      initialized: false,
    })

    const migratedResponse = await fetch(`${baseUrl}/api/user-preferences`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fastForwardSpeed: 3.5, initializeIfAbsent: true }),
    })
    assert.equal(migratedResponse.status, 200)
    assert.deepEqual(await jsonResponse(migratedResponse), {
      preferences: { version: 1, fastForwardSpeed: 3.5, fastForwardEnabled: false, muted: false, triggerActions: { l2: 'none', r2: 'none' } },
      initialized: true,
    })

    const updateResponse = await fetch(`${baseUrl}/api/user-preferences`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ triggerActions: { l2: 'fast-forward' }, muted: true }),
    })
    assert.equal(updateResponse.status, 200)
    assert.deepEqual(await jsonResponse(updateResponse), {
      preferences: { version: 1, fastForwardSpeed: 3.5, fastForwardEnabled: false, muted: true, triggerActions: { l2: 'fast-forward', r2: 'none' } },
      initialized: true,
    })

    const invalidResponse = await fetch(`${baseUrl}/api/user-preferences`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ muted: 'yes' }),
    })
    assert.equal(invalidResponse.status, 400)
    const storedResponse = await fetch(`${baseUrl}/api/user-preferences`)
    assert.deepEqual(await jsonResponse(storedResponse), {
      preferences: { version: 1, fastForwardSpeed: 3.5, fastForwardEnabled: false, muted: true, triggerActions: { l2: 'fast-forward', r2: 'none' } },
      initialized: true,
    })
  })

  test('first mute preference update persists before any other preference exists', async () => {
    const { baseUrl } = await startFixture([])
    const update = await fetch(`${baseUrl}/api/user-preferences`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ muted: true }),
    })
    assert.equal(update.status, 200)
    assert.equal((await jsonResponse(update)).preferences.muted, true)
    const stored = await fetch(`${baseUrl}/api/user-preferences`)
    assert.equal((await jsonResponse(stored)).preferences.muted, true)
  })

  test('creates profiles and requires one for a launch', async () => {
    const rom = Buffer.from('profiled launch test rom')
    const { baseUrl } = await startFixture([{
      id: 'pokemon-red', title: 'Pokémon Red', system: 'gb', core: 'gambatte', file: 'pokemon-red.gb', sha256: sha256(rom),
    }], { 'pokemon-red.gb': rom })

    const missing = await fetch(`${baseUrl}/api/games/pokemon-red/launch`)
    assert.equal(missing.status, 400)
    assert.deepEqual(await jsonResponse(missing), { error: 'A profile is required to launch a game.' })

    const created = await fetch(`${baseUrl}/api/games/pokemon-red/profiles`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Dawn' }),
    })
    assert.equal(created.status, 201)
    const profile = await jsonResponse(created)
    assert.equal(profile.name, 'Dawn')

    const listed = await fetch(`${baseUrl}/api/games/pokemon-red/profiles`)
    assert.deepEqual(await jsonResponse(listed), { profiles: [{ ...profile, leaseActive: false }] })

    const detail = await fetch(`${baseUrl}/api/games/pokemon-red/profiles/${profile.id}`)
    assert.equal(detail.status, 200)
    assert.deepEqual(await jsonResponse(detail), { ...profile, leaseActive: false })
    assert.equal((await fetch(`${baseUrl}/api/games/pokemon-red/profiles/missing`)).status, 404)
    assert.equal((await fetch(`${baseUrl}/api/games/missing/profiles/${profile.id}`)).status, 404)
    assert.equal((await fetch(`${baseUrl}/api/games/%ZZ/profiles/${profile.id}`)).status, 400)
    const unsupported = await fetch(`${baseUrl}/api/games/pokemon-red/profiles/${profile.id}`, { method: 'PUT' })
    assert.equal(unsupported.status, 405)
    assert.equal(unsupported.headers.get('allow'), 'GET, PATCH, DELETE')

    const renamed = await fetch(`${baseUrl}/api/games/pokemon-red/profiles/${profile.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Dawn II' }),
    })
    assert.equal(renamed.status, 200)
    const renamedProfile = await jsonResponse(renamed)
    assert.deepEqual(renamedProfile, { ...profile, name: 'Dawn II' })

    const unknownRename = await fetch(`${baseUrl}/api/games/pokemon-red/profiles/00000000-0000-0000-0000-000000000000`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Nobody' }),
    })
    assert.equal(unknownRename.status, 404)
    assert.deepEqual(await jsonResponse(unknownRename), { error: 'Profile was not found.' })

    const launched = await fetch(`${baseUrl}/api/games/pokemon-red/launch?profileId=${renamedProfile.id}`)
    assert.equal(launched.status, 200)
    const descriptor = await jsonResponse(launched)
    assert.equal(descriptor.profileId, renamedProfile.id)
    assert.equal(Number.isInteger(descriptor.gameId), true)

    const repeated = await jsonResponse(await fetch(`${baseUrl}/api/games/pokemon-red/launch?profileId=${renamedProfile.id}`))
    assert.equal(repeated.gameId, descriptor.gameId)

    const secondProfile = await jsonResponse(await fetch(`${baseUrl}/api/games/pokemon-red/profiles`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Lucas' }),
    }))
    const secondDescriptor = await jsonResponse(await fetch(`${baseUrl}/api/games/pokemon-red/launch?profileId=${secondProfile.id}`))
    assert.notEqual(secondDescriptor.gameId, descriptor.gameId)

    const deleted = await fetch(`${baseUrl}/api/games/pokemon-red/profiles/${secondProfile.id}`, { method: 'DELETE' })
    assert.equal(deleted.status, 200)
    assert.deepEqual(await jsonResponse(deleted), secondProfile)

    const missingProfile = await fetch(`${baseUrl}/api/games/pokemon-red/profiles/${secondProfile.id}`, { method: 'DELETE' })
    assert.equal(missingProfile.status, 404)
    assert.deepEqual(await jsonResponse(missingProfile), { error: 'Profile was not found.' })
  })

  test('renames a running save profile while its active lease still protects deletion', async () => {
    const rom = Buffer.from('running profile rename')
    const { baseUrl } = await startFixture([{
      id: 'pokemon-red', title: 'Pokémon Red', system: 'gb', core: 'gambatte', file: 'pokemon-red.gb', sha256: sha256(rom),
    }], { 'pokemon-red.gb': rom })
    const profile = await jsonResponse(await fetch(`${baseUrl}/api/games/pokemon-red/profiles`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Antes' }),
    }))
    const sameName = await fetch(`${baseUrl}/api/games/pokemon-red/profiles`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Depois' }),
    })
    assert.equal(sameName.status, 201)
    const otherProfile = await jsonResponse(sameName)
    const lease = await acquirePlayerLease(baseUrl, 'pokemon-red', profile.id, 'rename-active-session')
    assert.equal(lease.response.status, 200)
    const detail = await fetch(`${baseUrl}/api/games/pokemon-red/profiles/${profile.id}`, { headers: { Cookie: lease.cookie } })
    assert.deepEqual(await jsonResponse(detail), { ...profile, leaseActive: true })
    const renamed = await fetch(`${baseUrl}/api/games/pokemon-red/profiles/${profile.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: lease.cookie }, body: JSON.stringify({ name: 'Depois' }),
    })
    assert.equal(renamed.status, 200)
    assert.deepEqual(await jsonResponse(renamed), { ...profile, name: 'Depois' })
    const listed = await jsonResponse(await fetch(`${baseUrl}/api/games/pokemon-red/profiles`))
    assert.deepEqual(listed.profiles.map(candidate => [candidate.id, candidate.name]), [[profile.id, 'Depois'], [otherProfile.id, 'Depois']])
    assert.equal((await fetch(`${baseUrl}/api/games/pokemon-red/launch?profileId=${otherProfile.id}`)).status, 200)
    const deletion = await fetch(`${baseUrl}/api/games/pokemon-red/profiles/${profile.id}`, { method: 'DELETE', headers: { Cookie: lease.cookie } })
    assert.equal(deletion.status, 409)
  })

  test('keeps equally named profiles and saves isolated by ROM', async () => {
    const redRom = Buffer.from('profile isolation red rom')
    const blueRom = Buffer.from('profile isolation blue rom')
    const { baseUrl } = await startFixture([
      { id: 'pokemon-red', title: 'Pokémon Red', system: 'gb', core: 'gambatte', file: 'pokemon-red.gb', sha256: sha256(redRom) },
      { id: 'pokemon-blue', title: 'Pokémon Blue', system: 'gb', core: 'gambatte', file: 'pokemon-blue.gb', sha256: sha256(blueRom) },
    ], { 'pokemon-red.gb': redRom, 'pokemon-blue.gb': blueRom })

    const redProfile = await jsonResponse(await fetch(`${baseUrl}/api/games/pokemon-red/profiles`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Leaf' }),
    }))
    const blueProfile = await jsonResponse(await fetch(`${baseUrl}/api/games/pokemon-blue/profiles`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Leaf' }),
    }))

    assert.deepEqual(await jsonResponse(await fetch(`${baseUrl}/api/games/pokemon-red/profiles`)), { profiles: [{ ...redProfile, leaseActive: false }] })
    assert.deepEqual(await jsonResponse(await fetch(`${baseUrl}/api/games/pokemon-blue/profiles`)), { profiles: [{ ...blueProfile, leaseActive: false }] })
    assert.equal((await fetch(`${baseUrl}/api/games/pokemon-blue/launch?profileId=${redProfile.id}`)).status, 404)
    assert.equal((await fetch(`${baseUrl}/api/profiles/${redProfile.id}/games/pokemon-blue/save`)).status, 404)
  })

  test('automatically registers a trusted No-Intro ROM that is absent from the legacy catalog', async () => {
    const rom = Buffer.from('automatic trusted fire red rom')
    const fixture = await createFixture([], { 'fire-red.gba': rom })
    const server = createHubServer({
      ...fixture,
      romLookupBatch: async lookups => lookups.map(lookup => ({
        game: {
          name: 'Pokemon - Version Rouge Feu',
          names: { us: 'Pokémon FireRed Version' },
          platform: { slug: 'gba', name: 'Game Boy Advance' },
          media: [{ type: 'box-2D', region: 'wor', url: 'https://retrocollection.example/firered.png' }],
        },
        dump: { sha1: lookup.sha1.toUpperCase(), md5: lookup.md5.toUpperCase(), size: lookup.size, region: 'wor', dump_source: 'no-intro' },
      })),
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    liveServers.add(server)
    const baseUrl = `http://127.0.0.1:${server.address().port}`
    const sha1 = createHash('sha1').update(rom).digest('hex')
    const id = `rom-${sha1}`

    assert.deepEqual(await jsonResponse(await fetch(`${baseUrl}/api/games`)), {
      games: [{ id, title: 'Pokémon FireRed Version', system: 'gba', core: 'gba', status: 'ready', region: 'wor', coverUrl: 'https://retrocollection.example/firered.png', pokemonHubSaveSupported: true, profiles: [] }],
    })
    const profile = await jsonResponse(await fetch(`${baseUrl}/api/games/${id}/profiles`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Leaf' }),
    }))
    assert.equal(profile.name, 'Leaf')
    assert.equal((await fetch(`${baseUrl}/roms/${id}`, { method: 'HEAD' })).status, 200)
  })

  test('lists configured games and marks missing ROMs unavailable', async () => {
    const rom = Buffer.from('pokemon red test rom')
    const { baseUrl } = await startFixture([
      {
        id: 'pokemon-red',
        title: 'Pokémon Red',
        system: 'gb',
        core: 'gambatte',
        file: 'pokemon-red.gb',
        sha256: sha256(rom),
      },
      {
        id: 'pokemon-blue',
        title: 'Pokémon Blue',
        system: 'gb',
        core: 'gambatte',
        file: 'pokemon-blue.gb',
        sha256: '0'.repeat(64),
      },
    ], { 'pokemon-red.gb': rom })

    const response = await fetch(`${baseUrl}/api/games`)
    assert.equal(response.status, 200)
    assert.deepEqual(await jsonResponse(response), {
      games: [
        {
          id: 'pokemon-red',
          title: 'Pokémon Red',
          system: 'gb',
          core: 'gambatte',
          status: 'ready',
          pokemonHubSaveSupported: false,
          profiles: [],
        },
        {
          id: 'pokemon-blue',
          title: 'Pokémon Blue',
          system: 'gb',
          core: 'gambatte',
          status: 'unavailable',
          pokemonHubSaveSupported: false,
          reason: 'ROM file was not found.',
          profiles: [],
        },
      ],
    })
    const created = await fetch(`${baseUrl}/api/games/pokemon-blue/profiles`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Blue' }),
    })
    assert.equal(created.status, 201)
    const profile = await jsonResponse(created)
    const detail = await fetch(`${baseUrl}/api/games/pokemon-blue/profiles/${profile.id}`)
    assert.equal(detail.status, 200)
    assert.deepEqual(await jsonResponse(detail), { ...profile, leaseActive: false })
  })

  test('projects occupied Hub grid entries from their owner profile snapshot when listing profiles', async () => {
    const fixture = await createFixture([])
    const server = createHubServer({
      ...fixture,
      pokemonHubProfileStore: {
        async list() { return [{ hubProfileId: '11111111-1111-4111-8111-111111111111', ownerProfileId: 'profile-may', name: 'Transfer box', grid: { entries: {} } }] },
      },
      pokemonHubSnapshotCoordinator: {
        async getSnapshot() { return { placements: [{ location: { kind: 'hub', hubProfileId: '11111111-1111-4111-8111-111111111111', slot: 4 }, pokemonInstanceId: 'pokemon-alpha' }], pokemonDisplay: { 'pokemon-alpha': { species: 25, shiny: true } } } },
      },
      pokemonHubSaveFlush: { markDirty() {}, async flushSource() { return { status: 'clean' } } },
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    liveServers.add(server)

    const response = await fetch(`${`http://127.0.0.1:${server.address().port}`}/api/pokemon-hub/profiles`)
    const body = await jsonResponse(response)

    assert.equal(response.status, 200)
    assert.deepEqual(body.profiles[0].grid.entries, { 4: { pokemonInstanceId: 'pokemon-alpha', species: 25, shiny: true } })
  })

  test('includes each ready ROM profile list in the shared catalog response', async () => {
    const emerald = Buffer.from('emerald catalog profile')
    const { baseUrl } = await startFixture([
      { id: 'pokemon-emerald', title: 'Pokemon Emerald', system: 'gba', core: 'gba', file: 'pokemon-emerald.gba', sha256: sha256(emerald) },
    ], { 'pokemon-emerald.gba': emerald })
    const profile = await jsonResponse(await fetch(`${baseUrl}/api/games/pokemon-emerald/profiles`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'May' }),
    }))

    const catalog = await jsonResponse(await fetch(`${baseUrl}/api/games`))

    assert.deepEqual(catalog.games[0].profiles, [{ ...profile, hasSave: false, leaseActive: false }])
  })

  test('lists only loadable save profiles before the workspace selector opens them', async () => {
    const emerald = Buffer.from('emerald with save profile')
    const firered = Buffer.from('firered without save profile')
    const ruby = Buffer.from('unsupported ruby with save profile')
    const fixture = await createFixture([
      { id: 'pokemon-emerald', title: 'Pokemon Emerald', system: 'gba', core: 'gba', file: 'pokemon-emerald.gba', sha256: sha256(emerald), pokemonSave: { supported: true, adapter: 'gen3-gba-v1', layoutProfile: 'pokemon-emerald-gba' } },
      { id: 'pokemon-firered', title: 'Pokemon FireRed', system: 'gba', core: 'gba', file: 'pokemon-firered.gba', sha256: sha256(firered) },
      { id: 'pokemon-ruby', title: 'Pokemon Ruby', system: 'gba', core: 'gba', file: 'pokemon-ruby.gba', sha256: sha256(ruby) },
    ], { 'pokemon-emerald.gba': emerald, 'pokemon-firered.gba': firered, 'pokemon-ruby.gba': ruby })
    const profiles = {
      'pokemon-emerald': [{ id: 'may', name: 'May', createdAt: '2026-09-18T00:00:00.000Z' }, { id: 'wally', name: 'Wally', createdAt: '2026-09-18T00:00:01.000Z' }],
      'pokemon-ruby': [{ id: 'brendan', name: 'Brendan', createdAt: '2026-09-18T00:00:02.000Z' }],
    }
    const server = createHubServer({
      ...fixture,
      profileStore: { async list(gameId) { return profiles[gameId] ?? [] } },
      saveStore: { async get(profileId, gameId) { return gameId === 'pokemon-emerald' && profileId === 'may' ? { bytes: Buffer.from([1]), revision: 1, sha256: 'save', fenceGeneration: 0 } : null } },
      pokemonSaveAdapters: { get(adapterId) { return adapterId === 'gen3-gba-v1' ? { id: adapterId } : null } },
      pokemonHubSaveFlush: { markDirty() {}, async flushSource() { return { status: 'clean' } }, async flushExpiredLeases() {} },
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    liveServers.add(server)
    const baseUrl = `http://127.0.0.1:${server.address().port}`

    const catalogResponse = await fetch(`${baseUrl}/api/games`)
    const response = await fetch(`${baseUrl}/api/pokemon-hub/save-profile-games`)

    assert.equal(catalogResponse.status, 200)
    assert.deepEqual((await jsonResponse(catalogResponse)).games[0].profiles, [
      { ...profiles['pokemon-emerald'][0], hasSave: true, leaseActive: false },
      { ...profiles['pokemon-emerald'][1], hasSave: false, leaseActive: false },
    ])
    assert.equal(response.status, 200)
    assert.deepEqual(await jsonResponse(response), {
      games: [{ id: 'pokemon-emerald', title: 'Pokemon Emerald', system: 'gba', status: 'ready', pokemonHubSaveSupported: true, profiles: [{ ...profiles['pokemon-emerald'][0], hasSave: true }] }],
    })
  })

  test('reports a missing save before evaluating its layout support', async () => {
    const rom = Buffer.from('pokemon save layout test rom')
    const { baseUrl } = await startFixture([{
      id: 'pokemon-emerald', title: 'Pokémon Emerald', system: 'gba', core: 'mgba', file: 'pokemon-emerald.gba', sha256: sha256(rom),
    }], { 'pokemon-emerald.gba': rom })
    const profile = await jsonResponse(await fetch(`${baseUrl}/api/games/pokemon-emerald/profiles`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'May' }),
    }))

    const response = await fetch(`${baseUrl}/api/pokemon-hub/save-profiles/pokemon-emerald/${profile.id}/layout`)

    assert.equal(response.status, 404)
    assert.deepEqual(await jsonResponse(response), { error: 'Save was not found.', code: 'SAVE_MISSING' })
  })

  test('returns an empty save-profile ROM list when no profiles exist', async () => {
    const emerald = Buffer.from('emerald without save profile')
    const { baseUrl } = await startFixture([
      { id: 'pokemon-emerald', title: 'Pokemon Emerald', system: 'gba', core: 'gba', file: 'pokemon-emerald.gba', sha256: sha256(emerald) },
    ], { 'pokemon-emerald.gba': emerald })

    assert.deepEqual(await jsonResponse(await fetch(`${baseUrl}/api/pokemon-hub/save-profile-games`)), { games: [] })
  })

  test('returns a launch descriptor only for a verified game', async () => {
    const rom = Buffer.from('pokemon launch test rom')
    const { baseUrl } = await startFixture([
      {
        id: 'pokemon-red',
        title: 'Pokémon Red',
        system: 'gb',
        core: 'gambatte',
        file: 'pokemon-red.gb',
        sha256: sha256(rom),
      },
    ], { 'pokemon-red.gb': rom })

    const profile = await jsonResponse(await fetch(`${baseUrl}/api/games/pokemon-red/profiles`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Red' }),
    }))
    const launchUrl = `${baseUrl}/api/games/pokemon-red/launch?profileId=${profile.id}`
    const first = await fetch(launchUrl)
    const second = await fetch(launchUrl)
    assert.equal(first.status, 200)
    assert.deepEqual(await jsonResponse(first), await jsonResponse(second))
    const descriptor = await (await fetch(launchUrl)).json()
    assert.deepEqual(Object.keys(descriptor).sort(), ['core', 'gameId', 'id', 'profileId', 'romSha256', 'romUrl', 'runtimeId', 'saveAdapter', 'saveUrl', 'snapshotUrl', 'title'])
    assert.equal(descriptor.id, 'pokemon-red')
    assert.equal(descriptor.title, 'Pokémon Red')
    assert.equal(descriptor.core, 'gambatte')
    assert.equal(descriptor.romUrl, '/roms/pokemon-red')
    assert.equal(descriptor.profileId, profile.id)
    assert.equal(descriptor.saveUrl, `/api/profiles/${profile.id}/games/pokemon-red/save`)
    assert.equal(descriptor.snapshotUrl, `/api/profiles/${profile.id}/games/pokemon-red/snapshot`)
    assert.equal(descriptor.romSha256, sha256(rom))
    assert.equal(descriptor.saveAdapter, null)
    assert.equal(descriptor.runtimeId, 'emulatorjs-4.2.3')
    assert.equal(Number.isInteger(descriptor.gameId), true)

    const unknown = await fetch(`${baseUrl}/api/games/no-such-game/launch?profileId=${profile.id}`)
    assert.equal(unknown.status, 404)
    assert.deepEqual(await jsonResponse(unknown), { error: 'Game was not found.' })
  })

  test('serves verified ROM bytes without allowing browser caching', async () => {
    const rom = Buffer.from('pokemon stream test rom')
    const { baseUrl } = await startFixture([
      {
        id: 'pokemon-red',
        title: 'Pokémon Red',
        system: 'gb',
        core: 'gambatte',
        file: 'pokemon-red.gb',
        sha256: sha256(rom),
      },
    ], { 'pokemon-red.gb': rom })

    const response = await fetch(`${baseUrl}/roms/pokemon-red`)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal(response.headers.get('content-length'), String(rom.length))
    assert.equal(response.headers.get('content-type'), 'application/octet-stream')
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), rom)
  })

  test('returns verified ROM metadata for EmulatorJS repeat-load HEAD requests', async () => {
    const rom = Buffer.from('pokemon repeat load rom')
    const { baseUrl } = await startFixture([{
      id: 'pokemon-red',
      title: 'Pokémon Red',
      system: 'gb',
      core: 'gambatte',
      file: 'pokemon-red.gb',
      sha256: sha256(rom),
    }], { 'pokemon-red.gb': rom })

    const response = await fetch(`${baseUrl}/roms/pokemon-red`, { method: 'HEAD' })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-length'), String(rom.length))
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal(await response.text(), '')
  })

  test('rejects a ROM that changes after the catalog was read', async () => {
    const rom = Buffer.from('pokemon original rom')
    const changedRom = Buffer.from('pokemon changed rom')
    const { baseUrl, romsDir } = await startFixture([
      {
        id: 'pokemon-red',
        title: 'Pokémon Red',
        system: 'gb',
        core: 'gambatte',
        file: 'pokemon-red.gb',
        sha256: sha256(rom),
      },
    ], { 'pokemon-red.gb': rom })

    await writeFile(join(romsDir, 'pokemon-red.gb'), changedRom)
    const response = await fetch(`${baseUrl}/roms/pokemon-red`)
    assert.equal(response.status, 409)
    assert.deepEqual(await jsonResponse(response), { error: 'ROM hash does not match the trusted catalog hash.' })
  })

  test('rejects unsafe paths, symlinks, invalid hashes, and mismatched extensions', async () => {
    const rom = Buffer.from('pokemon safe rom')
    const fixture = await createFixture([
      {
        id: 'path-traversal',
        title: 'Path traversal',
        system: 'gb',
        core: 'gambatte',
        file: '../outside.gb',
        sha256: sha256(rom),
      },
      {
        id: 'bad-extension',
        title: 'Bad extension',
        system: 'gba',
        core: 'mgba',
        file: 'pokemon.gb',
        sha256: sha256(rom),
      },
      {
        id: 'bad-hash',
        title: 'Bad hash',
        system: 'gb',
        core: 'gambatte',
        file: 'pokemon-bad-hash.gb',
        sha256: 'not-a-sha256',
      },
    ], { 'pokemon.gb': rom, 'pokemon-bad-hash.gb': rom })
    const server = createHubServer(fixture)
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    liveServers.add(server)
    const { port } = server.address()
    const response = await fetch(`http://127.0.0.1:${port}/api/games`)
    assert.equal(response.status, 200)
    const { games } = await jsonResponse(response)
    assert.equal(games.every((game) => game.status === 'unavailable'), true)
    assert.match(games.find((game) => game.id === 'path-traversal').reason, /path/i)
    assert.match(games.find((game) => game.id === 'bad-extension').reason, /extension/i)
    assert.match(games.find((game) => game.id === 'bad-hash').reason, /SHA-256/i)

    const symlinkFixture = await createFixture([
      {
        id: 'pokemon-link',
        title: 'Pokémon link',
        system: 'gb',
        core: 'gambatte',
        file: 'pokemon-link.gb',
        sha256: sha256(rom),
      },
    ])
    try {
      await symlink(join(symlinkFixture.root, 'outside.gb'), join(symlinkFixture.romsDir, 'pokemon-link.gb'))
      const symlinkServer = createHubServer(symlinkFixture)
      await new Promise((resolve) => symlinkServer.listen(0, '127.0.0.1', resolve))
      liveServers.add(symlinkServer)
      const symlinkPort = symlinkServer.address().port
      const symlinkResponse = await fetch(`http://127.0.0.1:${symlinkPort}/api/games`)
      const symlinkGame = (await jsonResponse(symlinkResponse)).games[0]
      assert.equal(symlinkGame.status, 'unavailable')
      assert.match(symlinkGame.reason, /symbolic link|symlink/i)
    } catch (error) {
      if (error.code !== 'EPERM' && error.code !== 'EACCES') throw error
      assert.equal(process.platform, 'win32')
    }
  })

  test('returns a useful error for malformed catalog JSON', async () => {
    const fixture = await createFixture([])
    await writeFile(fixture.catalogPath, '{ malformed')
    const server = createHubServer(fixture)
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    liveServers.add(server)
    const { port } = server.address()
    const response = await fetch(`http://127.0.0.1:${port}/api/games`)
    assert.equal(response.status, 500)
    assert.deepEqual(await jsonResponse(response), { error: 'Catalog could not be loaded.' })
  })
})
