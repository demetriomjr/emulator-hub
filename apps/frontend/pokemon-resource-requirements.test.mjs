import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import sharp from 'sharp'

import { createPokemonRequirements, getPokemonRequirementStatus, syncPokemonRequirements } from '../packages/pokemon-resource-requirements.mjs'
import { normalizePokemonSprite } from '../packages/pokemon-resource-sync.mjs'

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'pokemon-requirements-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const source = await sharp({ create: { width: 10, height: 10, channels: 4, background: '#123456' } }).png().toBuffer()
  const image = await normalizePokemonSprite(source, sharp)
  return { directory, source, image }
}

function requirements(image) {
  return {
    schemaVersion: 1,
    spriteNormalizationVersion: 1,
    entries: [
      { file: '6.png', source: 'https://assets.example/6.png', sha256: sha256(image) },
      { file: 'egg.png', source: 'https://assets.example/egg.png', sha256: sha256(image) },
    ],
  }
}

test('subtracts matching local files from requirements and downloads only the absent file', async t => {
  const { directory, source, image } = await fixture(t)
  await writeFile(join(directory, '6.png'), image)
  const desired = requirements(image)
  assert.deepEqual(await getPokemonRequirementStatus(directory, desired), { status: 'incomplete', count: 1, missing: ['egg.png'] })

  const downloaded = []
  const result = await syncPokemonRequirements({ targetDirectory: directory, requirements: desired, imageProcessor: sharp, download: async url => {
    downloaded.push(url)
    return source
  } })

  assert.deepEqual(result, { status: 'synchronized', count: 2, downloaded: ['egg.png'] })
  assert.deepEqual(downloaded, ['https://assets.example/egg.png'])
  assert.deepEqual(await getPokemonRequirementStatus(directory, desired), { status: 'complete', count: 2, missing: [] })
  assert.equal((await readFile(join(directory, '6.png'))).equals(image), true)
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'inventory.json'), 'utf8')).entries, [
    { file: '6.png', sha256: sha256(image) },
    { file: 'egg.png', sha256: sha256(image) },
  ])
})

test('redownloads a file whose content differs from the required hash', async t => {
  const { directory, source, image } = await fixture(t)
  await writeFile(join(directory, '6.png'), 'outdated')
  await writeFile(join(directory, 'egg.png'), image)
  const desired = requirements(image)

  assert.deepEqual(await getPokemonRequirementStatus(directory, desired), { status: 'incomplete', count: 1, missing: ['6.png'] })
  const result = await syncPokemonRequirements({ targetDirectory: directory, requirements: desired, imageProcessor: sharp, download: async () => source })
  assert.deepEqual(result.downloaded, ['6.png'])
  assert.equal((await readFile(join(directory, '6.png'))).equals(image), true)
})

test('keeps existing files when downloaded content fails the required hash', async t => {
  const { directory, image } = await fixture(t)
  await writeFile(join(directory, '6.png'), image)
  const desired = requirements(image)
  await assert.rejects(() => syncPokemonRequirements({
    targetDirectory: directory,
    requirements: desired,
    imageProcessor: sharp,
    download: async () => Buffer.from('bad image'),
  }))
  assert.equal((await readFile(join(directory, '6.png'))).equals(image), true)
})

test('creates reviewable requirements with file hashes from the local catalog', async t => {
  const { directory, image } = await fixture(t)
  await writeFile(join(directory, '6.png'), image)
  await writeFile(join(directory, '6-shiny.png'), image)
  await writeFile(join(directory, 'egg.png'), image)

  const actual = await createPokemonRequirements(directory, [{
    sourceId: 6,
    normalFile: '6.png',
    shinyFile: '6-shiny.png',
    images: { normal: 'https://assets.example/6.png', shiny: 'https://assets.example/6-shiny.png' },
  }])

  assert.deepEqual(actual, {
    schemaVersion: 1,
    spriteNormalizationVersion: 1,
    entries: [
      { file: '6.png', source: 'https://assets.example/6.png', sha256: sha256(image) },
      { file: '6-shiny.png', source: 'https://assets.example/6-shiny.png', sha256: sha256(image) },
      { file: 'egg.png', source: 'https://raw.githubusercontent.com/pret/pokeemerald/master/graphics/pokemon/egg/front.png', sha256: sha256(image) },
    ],
  })
})
