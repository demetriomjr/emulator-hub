import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, test } from 'node:test'

import { createHubServer } from '../server.mjs'
import { createMemoryRedisPersistence } from '../../packages/redis-persistence.mjs'

const liveServers = new Set()
const liveFixtures = new Set()

afterEach(async () => {
  await Promise.all([...liveServers].map((server) => closeServer(server)))
  liveServers.clear()
  await Promise.all([...liveFixtures].map((root) => rm(root, { recursive: true, force: true })))
  liveFixtures.clear()
})

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

async function createFixture(entries, files = {}) {
  const root = await mkdtemp(join(tmpdir(), 'emulator-hub-backend-'))
  const romsDir = join(root, 'roms')
  await mkdir(romsDir, { recursive: true })

  for (const [file, content] of Object.entries(files)) {
    const destination = join(romsDir, file)
    await mkdir(join(destination, '..'), { recursive: true })
    await writeFile(destination, content)
  }

  const catalogPath = join(root, 'catalog.json')
  await writeFile(catalogPath, JSON.stringify(entries, null, 2))
  liveFixtures.add(root)
  return {
    root,
    romsDir,
    catalogPath,
    profilesPath: join(root, 'data', 'profiles'),
    controlProfilePath: join(root, 'data', 'control-profile.json'),
    savesPath: join(root, 'data', 'saves'),
    pokemonHubPath: join(root, 'data', 'pokemon-hub'),
    pokemonHubProfilesPath: join(root, 'data', 'pokemon-hub-profiles'),
    persistence: createMemoryRedisPersistence(),
  }
}

async function startFixture(entries, files = {}) {
  const fixture = await createFixture(entries, files)
  const server = createHubServer(fixture)
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

describe('hub backend HTTP contract', () => {
  test('passes profile-scoped snapshot acquire and sync requests to the coordinator', async () => {
    const fixture = await createFixture([])
    const requests = []
    const server = createHubServer({
      ...fixture,
      pokemonHubSnapshotCoordinator: {
        async acquire(request) { requests.push({ type: 'acquire', request }); return { status: 'acquired' } },
        async sync(request) { requests.push({ type: 'sync', request }); return { status: 'accepted' } },
      },
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

    assert.equal(acquire.status, 200)
    assert.equal(sync.status, 200)
    assert.deepEqual(requests, [
      { type: 'acquire', request: { sourceKey: 'save:profile-may:emerald', workspaceId: 'workspace-a', profileId: 'profile-may' } },
      { type: 'sync', request: { workspaceId: 'workspace-a', clientSequence: 1, idempotencyKey: 'sync-1', sources: [], profileId: 'profile-may' } },
    ])
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
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    liveServers.add(server)
    const baseUrl = `http://127.0.0.1:${server.address().port}`
    const profile = await jsonResponse(await fetch(`${baseUrl}/api/games/pokemon-emerald/profiles`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'May' }),
    }))
    const bytes = Buffer.from([7, 8, 9])

    const saved = await fetch(`${baseUrl}/api/profiles/${profile.id}/games/pokemon-emerald/save`, {
      method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'If-Match': '*' }, body: bytes,
    })

    assert.equal(saved.status, 201)
    assert.equal(adopted.length, 1)
    assert.equal(adopted[0].profileId, profile.id)
    assert.equal(adopted[0].sourceKey, `save:${profile.id}:pokemon-emerald`)
    assert.equal(adopted[0].sourceRevision, 1)
    assert.equal(adopted[0].adapter, 'gen3-gba-v1')
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
    const created = await fetch(saveUrl, {
      method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'If-Match': '*' }, body: firstSave,
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
      method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'If-Match': '"1"' }, body: changedSave,
    })
    assert.equal(updated.status, 200)
    assert.deepEqual(await jsonResponse(updated), { revision: 2, sha256: sha256(changedSave) })
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
    assert.deepEqual(await jsonResponse(listed), { profiles: [profile] })

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

    assert.deepEqual(await jsonResponse(await fetch(`${baseUrl}/api/games/pokemon-red/profiles`)), { profiles: [redProfile] })
    assert.deepEqual(await jsonResponse(await fetch(`${baseUrl}/api/games/pokemon-blue/profiles`)), { profiles: [blueProfile] })
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
      games: [{ id, title: 'Pokémon FireRed Version', system: 'gba', core: 'gba', status: 'ready', region: 'wor', coverUrl: 'https://retrocollection.example/firered.png', profiles: [] }],
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
          profiles: [],
        },
        {
          id: 'pokemon-blue',
          title: 'Pokémon Blue',
          system: 'gb',
          core: 'gambatte',
          status: 'unavailable',
          reason: 'ROM file was not found.',
          profiles: [],
        },
      ],
    })
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

    assert.deepEqual(catalog.games[0].profiles, [profile])
  })

  test('lists only ready ROMs that have save profiles', async () => {
    const emerald = Buffer.from('emerald with save profile')
    const firered = Buffer.from('firered without save profile')
    const ruby = Buffer.from('missing ruby with save profile')
    const { baseUrl } = await startFixture([
      { id: 'pokemon-emerald', title: 'Pokemon Emerald', system: 'gba', core: 'gba', file: 'pokemon-emerald.gba', sha256: sha256(emerald) },
      { id: 'pokemon-firered', title: 'Pokemon FireRed', system: 'gba', core: 'gba', file: 'pokemon-firered.gba', sha256: sha256(firered) },
      { id: 'pokemon-ruby', title: 'Pokemon Ruby', system: 'gba', core: 'gba', file: 'pokemon-ruby.gba', sha256: sha256(ruby) },
    ], { 'pokemon-emerald.gba': emerald, 'pokemon-firered.gba': firered })

    await fetch(`${baseUrl}/api/games/pokemon-emerald/profiles`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'May' }),
    })
    await fetch(`${baseUrl}/api/games/pokemon-ruby/profiles`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Brendan' }),
    })

    const response = await fetch(`${baseUrl}/api/pokemon-hub/save-profile-games`)

    assert.equal(response.status, 200)
    assert.deepEqual(await jsonResponse(response), {
      games: [{ id: 'pokemon-emerald', title: 'Pokemon Emerald', system: 'gba' }],
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
    assert.deepEqual(Object.keys(descriptor).sort(), ['core', 'gameId', 'id', 'profileId', 'romUrl', 'saveUrl', 'title'])
    assert.equal(descriptor.id, 'pokemon-red')
    assert.equal(descriptor.title, 'Pokémon Red')
    assert.equal(descriptor.core, 'gambatte')
    assert.equal(descriptor.romUrl, '/roms/pokemon-red')
    assert.equal(descriptor.profileId, profile.id)
    assert.equal(descriptor.saveUrl, `/api/profiles/${profile.id}/games/pokemon-red/save`)
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
