import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import * as gamePatches from './game-patches.mjs'

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function validIps(value = 1) {
  return Buffer.from([...
    Buffer.from('PATCH'),
    0, 0, 1, // offset
    0, 1, // data length
    value,
    ...Buffer.from('EOF'),
  ])
}

async function fixture(t, { patchFiles = {}, entries = [] } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'emulator-hub-ips-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  for (const [file, bytes] of Object.entries(patchFiles)) {
    await mkdir(dirname(join(directory, file)), { recursive: true })
    await writeFile(join(directory, file), bytes)
  }
  await writeFile(join(directory, 'manifest.json'), JSON.stringify({ version: 1, patches: entries }))
  return directory
}

test('discovers a verified IPS by ROM hash for any game identity', async (t) => {
  assert.equal(typeof gamePatches.createIpsPatchRegistry, 'function', 'patch discovery must be a reusable registry, not a game-specific lookup')
  const patchA = validIps(17)
  const patchB = validIps(29)
  const romA = Buffer.from('unrelated arbitrary game ROM A')
  const romB = Buffer.from('unrelated arbitrary game ROM B')
  const directory = await fixture(t, {
    patchFiles: { 'translation.ips': patchA, 'bugfix.ips': patchB },
    entries: [
      { romSha256: sha256(romA), file: 'translation.ips', patchSha256: sha256(patchA) },
      { romSha256: sha256(romB), file: 'bugfix.ips', patchSha256: sha256(patchB) },
    ],
  })
  const registry = gamePatches.createIpsPatchRegistry({ patchesDirectory: directory })

  const matchA = await registry.findForRomSha256(sha256(romA))
  const matchB = await registry.findForRomSha256(sha256(romB))
  const noMatch = await registry.findForRomSha256(sha256(Buffer.from('no registered patch')))

  assert.equal(matchA.patch.file, 'translation.ips')
  assert.deepEqual(matchA.patch.bytes, patchA)
  assert.equal(matchB.patch.file, 'bugfix.ips')
  assert.deepEqual(matchB.patch.bytes, patchB)
  assert.equal(noMatch.patch, null)
  assert.equal(noMatch.warning, null)
})

test('discovers a hash-named IPS inside a game directory', async (t) => {
  const romSha256 = sha256(Buffer.from('nested patch ROM'))
  const patch = validIps(37)
  const file = `Pokemon Emerald/${romSha256}.ips`
  const directory = await fixture(t, {
    patchFiles: { [file]: patch },
    entries: [{ romSha256, file, patchSha256: sha256(patch) }],
  })
  const result = await gamePatches.createIpsPatchRegistry({ patchesDirectory: directory }).findForRomSha256(romSha256)
  assert.equal(result.warning, null)
  assert.equal(result.patch.file, file)
  assert.deepEqual(result.patch.bytes, patch)
})

test('skips duplicate, missing, tampered, unsafe, and malformed IPS entries', async (t) => {
  assert.equal(typeof gamePatches.createIpsPatchRegistry, 'function')
  const patch = validIps()
  const romSha256 = sha256(Buffer.from('registry error fixture'))
  const cases = [
    { name: 'duplicate', entries: [
      { romSha256, file: 'patch.ips', patchSha256: sha256(patch) },
      { romSha256, file: 'patch.ips', patchSha256: sha256(patch) },
    ], patchFiles: { 'patch.ips': patch }, reason: /ambiguous/i },
    { name: 'missing', entries: [{ romSha256, file: 'missing.ips', patchSha256: sha256(patch) }], reason: /missing|not found/i },
    { name: 'tampered', entries: [{ romSha256, file: 'patch.ips', patchSha256: sha256(validIps(99)) }], patchFiles: { 'patch.ips': patch }, reason: /hash/i },
    { name: 'unsafe', entries: [{ romSha256, file: '../outside.ips', patchSha256: sha256(patch) }], reason: /path|safe/i },
    { name: 'nested traversal', entries: [{ romSha256, file: 'Pokemon Emerald/../outside.ips', patchSha256: sha256(patch) }], reason: /path|safe/i },
    { name: 'malformed IPS', entries: [{ romSha256, file: 'patch.ips', patchSha256: sha256(Buffer.from('not IPS')) }], patchFiles: { 'patch.ips': Buffer.from('not IPS') }, reason: /IPS|format/i },
  ]

  for (const scenario of cases) {
    await t.test(scenario.name, async (subtest) => {
      const directory = await fixture(subtest, scenario)
      const registry = gamePatches.createIpsPatchRegistry({ patchesDirectory: directory })
      const result = await registry.findForRomSha256(romSha256)
      assert.equal(result.patch, null)
      assert.match(result.warning, scenario.reason)
    })
  }
})

test('validates IPS record, RLE, EOF, and optional truncate records', () => {
  assert.equal(typeof gamePatches.isValidIps, 'function', 'IPS structural validation must be reusable')
  const rleIps = Buffer.from([...Buffer.from('PATCH'), 0, 0, 1, 0, 0, 0, 4, 0xaa, ...Buffer.from('EOF'), 0, 0, 8])
  assert.equal(gamePatches.isValidIps(validIps()), true)
  assert.equal(gamePatches.isValidIps(rleIps), true)
  assert.equal(gamePatches.isValidIps(Buffer.from('PATCH')), false)
  assert.equal(gamePatches.isValidIps(Buffer.from([...Buffer.from('PATCH'), 0, 0, 1, 0, 4, 7])), false)
})

test('registers and validates the shipped Emerald IPS as data instead of code', async () => {
  const patchesDirectory = fileURLToPath(new URL('../../assets/ips/', import.meta.url))
  const registry = gamePatches.createIpsPatchRegistry({ patchesDirectory })
  const result = await registry.findForRomSha256('a9dec84dfe7f62ab2220bafaef7479da0929d066ece16a6885f6226db19085af')
  const sourceBytes = await readFile(new URL(`../../assets/ips/Pokemon%20Emerald/a9dec84dfe7f62ab2220bafaef7479da0929d066ece16a6885f6226db19085af.ips`, import.meta.url))

  assert.equal(result.warning, null)
  assert.equal(result.patch.file, 'Pokemon Emerald/a9dec84dfe7f62ab2220bafaef7479da0929d066ece16a6885f6226db19085af.ips')
  assert.equal(result.patch.sha256, 'e12480bad322c9bbb20ebba943ab5d1987001657e0f69d74f5cd94d6ba20a6b3')
  assert.deepEqual(result.patch.bytes, sourceBytes)
})

test('skips a registered IPS symbolic link', async (t) => {
  const patch = validIps()
  const romSha256 = sha256(Buffer.from('symlinked patch target'))
  const directory = await fixture(t, { entries: [{ romSha256, file: 'linked.ips', patchSha256: sha256(patch) }] })
  const outsidePatch = join(directory, '..', 'outside.ips')
  await writeFile(outsidePatch, patch)
  t.after(() => rm(outsidePatch, { force: true }))
  try {
    await symlink(outsidePatch, join(directory, 'linked.ips'))
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return t.skip('symbolic links are unavailable in this environment')
    throw error
  }
  const registry = gamePatches.createIpsPatchRegistry({ patchesDirectory: directory })

  const result = await registry.findForRomSha256(romSha256)

  assert.equal(result.patch, null)
  assert.match(result.warning, /symlink/i)
})

test('skips a registered IPS inside a symbolic-link directory', async (t) => {
  const patch = validIps()
  const romSha256 = sha256(Buffer.from('symlinked patch directory'))
  const directory = await fixture(t, { entries: [{ romSha256, file: 'linked/patch.ips', patchSha256: sha256(patch) }] })
  const outsideDirectory = await mkdtemp(join(tmpdir(), 'emulator-hub-ips-outside-'))
  t.after(() => rm(outsideDirectory, { recursive: true, force: true }))
  await writeFile(join(outsideDirectory, 'patch.ips'), patch)
  try {
    await symlink(outsideDirectory, join(directory, 'linked'), 'dir')
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return t.skip('symbolic links are unavailable in this environment')
    throw error
  }
  const result = await gamePatches.createIpsPatchRegistry({ patchesDirectory: directory }).findForRomSha256(romSha256)
  assert.equal(result.patch, null)
  assert.match(result.warning, /symlink/i)
})
