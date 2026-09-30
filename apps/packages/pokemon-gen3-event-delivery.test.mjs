import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createSaveStore } from './save-store.mjs'
import { createPokemonGen3EventDeliveryService } from './pokemon-gen3-event-delivery.mjs'
import { inspectPokemonGen3Inventory } from './pokemon-gen3-inventory.mjs'
import { editPokemonGen3Flags, readPokemonGen3Flags } from './pokemon-gen3-event-flags.mjs'
import { inspectPokemonGen3EventEligibility } from './pokemon-gen3-event-eligibility.mjs'
import { materializePokemonGen3EventGrant } from './pokemon-gen3-event-grant.mjs'
import { pokemonGen3SaveByteOffset, refreshPokemonGen3SaveSectionChecksums, selectUnambiguousPokemonGen3SaveCopy } from './pokemon-gen3-save-validation.mjs'
import { stopPokemonGen3GabbyTy, validatePokemonGen3GabbyTyCandidate } from './pokemon-gen3-gabby-ty.mjs'

const profileId = 'profile-1'
const gameId = 'firered-1'
const romSha256 = 'a'.repeat(64)

test('leaves Gabby and Ty unchanged before Ruby League completion, then pins them once', async () => {
  const root = await mkdtemp(join(tmpdir(), 'emulator-hub-gabby-ty-'))
  try {
    const saveStore = createSaveStore({ dataPath: join(root, 'saves'), eventBackupsPath: join(root, 'event-backups') })
    const original = rubySave({ league: false })
    await saveStore.put(profileId, 'ruby-early', original, null)
    const service = createPokemonGen3EventDeliveryService({
      saveStore,
      gameSaveLeases: { async get() { return null } },
      resolveGame: async () => ({ title: 'pokemon-ruby', romSha256 }),
    })

    assert.deepEqual(await service.attempt({ profileId, gameId: 'ruby-early' }), { status: 'pending-progression' })
    const beforeLeague = await saveStore.get(profileId, 'ruby-early')
    assert.equal(beforeLeague.revision, 1)
    assert.deepEqual(beforeLeague.bytes, original)
    assert.equal(beforeLeague.eventGrantReceipt, undefined)
    await assert.rejects(() => readdir(join(root, 'event-backups')), { code: 'ENOENT' })
    await saveStore.put(profileId, 'ruby-early', editPokemonGen3Flags(beforeLeague.bytes, 'pokemon-ruby', [{ flagId: 0x804, value: true }]), 1)
    assert.deepEqual(await service.attempt({ profileId, gameId: 'ruby-early' }), { status: 'delivered', revision: 3 })
    const stored = await saveStore.get(profileId, 'ruby-early')
    const copy = selectUnambiguousPokemonGen3SaveCopy(stored.bytes)
    assert.equal(stored.bytes[pokemonGen3SaveByteOffset(copy, 'large', 0x2b19)], 0xff)
    assert.deepEqual(readPokemonGen3Flags(stored.bytes, 'pokemon-ruby', [0x31c, 0x31d, 0x31e, 0x31f, 0x385, 0x386, 0x387, 0x388]), [true, true, true, true, true, true, false, true])
    assert.deepEqual(stored.eventGrantReceipt.eventIds, ['southern-island'])
    assert.deepEqual(stored.eventGrantReceipt.adjustmentIds, ['gabby-ty-route111'])
    assert.equal(stored.runtimeStateInvalidatedAtRevision, 3)
    assert.equal((await readdir(join(root, 'event-backups'))).length, 1)
    assert.deepEqual(await service.attempt({ profileId, gameId: 'ruby-early' }), { status: 'already-delivered', revision: 3 })
    const later = Buffer.from(stored.bytes)
    later[pokemonGen3SaveByteOffset(copy, 'large', 0x2b19)] = 0
    refreshPokemonGen3SaveSectionChecksums(later, copy, new Set([1 + Math.floor(0x2b19 / 0xf80)]))
    await saveStore.put(profileId, 'ruby-early', later, 3)
    assert.deepEqual(await service.attempt({ profileId, gameId: 'ruby-early' }), { status: 'already-delivered', revision: 4 })
    assert.equal((await saveStore.get(profileId, 'ruby-early')).revision, 4)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('delivers FireRed tickets after release with a backup, readback, and durable receipt', async () => {
  const root = await mkdtemp(join(tmpdir(), 'emulator-hub-event-delivery-'))
  try {
    const saveStore = createSaveStore({ dataPath: join(root, 'saves'), eventBackupsPath: join(root, 'event-backups') })
    const original = fireRedSave({ eligible: true })
    await saveStore.put(profileId, gameId, original, null)
    const deleted = []
    const service = createPokemonGen3EventDeliveryService({
      saveStore,
      gameSaveLeases: { async get() { return null } },
      snapshotStore: { async delete(_profile, _game, options) { deleted.push(options.kind) } },
      resolveGame: async () => ({ title: 'pokemon-firered', romSha256 }),
      now: () => new Date('2026-09-26T12:00:00.000Z'),
    })

    assert.deepEqual(await service.attempt({ profileId, gameId }), { status: 'delivered', revision: 2 })
    const stored = await saveStore.get(profileId, gameId)
    assert.deepEqual(inspectPokemonGen3Inventory(stored.bytes, 'pokemon-firered').keyItems.slots.slice(0, 2).map(slot => slot.itemId), [370, 371])
    assert.deepEqual(readPokemonGen3Flags(stored.bytes, 'pokemon-firered', [0x839, 0x84a, 0x84b, 0x2a7, 0x2a8]), [true, true, true, true, true])
    assert.equal(stored.runtimeStateInvalidatedAtRevision, 2)
    assert.deepEqual(stored.eventGrantReceipt.eventIds, ['navel-rock', 'birth-island'])
    assert.equal(stored.eventGrantReceipt.romSha256, romSha256)
    assert.deepEqual(deleted, ['cloud-recovery'])
    assert.equal((await readdir(join(root, 'event-backups'))).length, 1)
    assert.deepEqual(original, fireRedSave({ eligible: true }))
    assert.deepEqual(await service.attempt({ profileId, gameId }), { status: 'already-delivered', revision: 2 })
    assert.equal((await readdir(join(root, 'event-backups'))).length, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('delivers Ruby National Dex and Eon Ticket in one backed-up save revision', async () => {
  const root = await mkdtemp(join(tmpdir(), 'emulator-hub-event-delivery-'))
  try {
    const saveStore = createSaveStore({ dataPath: join(root, 'saves'), eventBackupsPath: join(root, 'event-backups') })
    const original = rubySave({ league: true })
    await saveStore.put(profileId, 'ruby-1', original, null)
    const service = createPokemonGen3EventDeliveryService({
      saveStore,
      gameSaveLeases: { async get() { return null } },
      resolveGame: async () => ({ title: 'pokemon-ruby', romSha256 }),
    })
    assert.deepEqual(await service.attempt({ profileId, gameId: 'ruby-1' }), { status: 'delivered', revision: 2 })
    const stored = await saveStore.get(profileId, 'ruby-1')
    assert.equal(stored.revision, 2)
    assert.equal(inspectPokemonGen3EventEligibility(stored.bytes, 'pokemon-ruby').nationalDexUnlocked, true)
    assert.equal(inspectPokemonGen3Inventory(stored.bytes, 'pokemon-ruby').keyItems.slots[0].itemId, 275)
    assert.deepEqual(stored.eventGrantReceipt.eventIds, ['southern-island'])
    assert.deepEqual(stored.eventGrantReceipt.adjustmentIds, ['gabby-ty-route111'])
    assert.equal((await readdir(join(root, 'event-backups'))).length, 1)
    assert.deepEqual(original, rubySave({ league: true }))
    assert.deepEqual(await service.attempt({ profileId, gameId: 'ruby-1' }), { status: 'already-delivered', revision: 2 })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('pins Emerald Gabby and Ty after the League while National Dex events remain pending', async () => {
  const root = await mkdtemp(join(tmpdir(), 'emulator-hub-gabby-ty-progression-'))
  try {
    const saveStore = createSaveStore({ dataPath: join(root, 'saves'), eventBackupsPath: join(root, 'event-backups') })
    await saveStore.put(profileId, 'emerald-later', editPokemonGen3Flags(emeraldSave(), 'pokemon-emerald', [{ flagId: 0x896, value: false }]), null)
    const service = createPokemonGen3EventDeliveryService({ saveStore, gameSaveLeases: { async get() { return null } }, resolveGame: async () => ({ title: 'pokemon-emerald', romSha256 }) })
    assert.deepEqual(await service.attempt({ profileId, gameId: 'emerald-later' }), { status: 'adjusted', revision: 2 })
    const adjusted = await saveStore.get(profileId, 'emerald-later')
    assert.deepEqual(adjusted.eventGrantReceipt.eventIds, [])
    assert.deepEqual(adjusted.eventGrantReceipt.adjustmentIds, ['gabby-ty-route111'])
    assert.deepEqual(await service.attempt({ profileId, gameId: 'emerald-later' }), { status: 'pending-progression' })
    await saveStore.put(profileId, 'emerald-later', editPokemonGen3Flags(adjusted.bytes, 'pokemon-emerald', [{ flagId: 0x896, value: true }]), adjusted.revision)
    assert.deepEqual(await service.attempt({ profileId, gameId: 'emerald-later' }), { status: 'delivered', revision: 4 })
    const delivered = await saveStore.get(profileId, 'emerald-later')
    assert.deepEqual(delivered.eventGrantReceipt.eventIds, ['southern-island', 'faraway-island', 'navel-rock', 'birth-island'])
    assert.deepEqual(delivered.eventGrantReceipt.adjustmentIds, ['gabby-ty-route111'])
    assert.equal(inspectPokemonGen3Inventory(delivered.bytes, 'pokemon-emerald').keyItems.slots[0].itemId, 275)
    assert.deepEqual(await service.attempt({ profileId, gameId: 'emerald-later' }), { status: 'already-delivered', revision: 4 })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('upgrades an existing Emerald event receipt and backs up the Match Call change', async () => {
  const root = await mkdtemp(join(tmpdir(), 'emulator-hub-event-delivery-'))
  try {
    const saveStore = createSaveStore({ dataPath: join(root, 'saves'), eventBackupsPath: join(root, 'event-backups') })
    const original = emeraldSave()
    await saveStore.put(profileId, 'emerald-1', original, null)
    const eventIds = ['southern-island', 'faraway-island', 'navel-rock', 'birth-island']
    const previousGrant = editPokemonGen3Flags(
      materializePokemonGen3EventGrant(original, 'pokemon-emerald', eventIds),
      'pokemon-emerald', [{ flagId: 0x12f, value: true }],
    )
    await saveStore.put(profileId, 'emerald-1', previousGrant, 1, {
      eventGrantReceipt: { romSha256, recipeVersion: 1, eventIds, deliveredAt: '2026-09-26T00:00:00.000Z' },
    })
    const changes = []
    const service = createPokemonGen3EventDeliveryService({
      saveStore,
      gameSaveLeases: { async get() { return null } },
      resolveGame: async () => ({ title: 'pokemon-emerald', romSha256 }),
      onEvent(phase, details) { if (phase === 'committed') changes.push(details) },
    })

    assert.deepEqual(await service.attempt({ profileId, gameId: 'emerald-1' }), { status: 'delivered', revision: 3 })
    const stored = await saveStore.get(profileId, 'emerald-1')
    assert.deepEqual(readPokemonGen3Flags(stored.bytes, 'pokemon-emerald', [0x12f, 0x8ac, 0x8db]), [false, true, true])
    assert.equal(stored.eventGrantReceipt.recipeVersion, 3)
    assert.deepEqual(stored.eventGrantReceipt.adjustmentIds, ['gabby-ty-route111'])
    assert.deepEqual(changes[0].clearedFlagIds, [0x12f])
    assert.equal((await readdir(join(root, 'event-backups'))).length, 2)
    assert.deepEqual(await service.attempt({ profileId, gameId: 'emerald-1' }), { status: 'already-delivered', revision: 3 })
    assert.equal((await readdir(join(root, 'event-backups'))).length, 2)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Gabby and Ty editor uses Emerald offset, preserves inactive copy, and rejects unrelated changes', () => {
  const original = emeraldSave()
  const candidate = stopPokemonGen3GabbyTy(original, 'pokemon-emerald')
  const selected = selectUnambiguousPokemonGen3SaveCopy(candidate)
  assert.equal(candidate[pokemonGen3SaveByteOffset(selected, 'large', 0x2bad)], 0xff)
  assert.deepEqual(readPokemonGen3Flags(candidate, 'pokemon-emerald', [0x31c, 0x31d, 0x31e, 0x31f, 0x385, 0x386, 0x387, 0x388]), [true, true, true, true, true, true, false, true])
  assert.deepEqual(candidate.subarray(0, 0xe000), original.subarray(0, 0xe000))
  assert.deepEqual(original, emeraldSave())
  assert.equal(validatePokemonGen3GabbyTyCandidate(original, candidate, 'pokemon-emerald').changed, true)
  const corrupted = Buffer.from(candidate)
  corrupted[pokemonGen3SaveByteOffset(selected, 'large', 0x2bad) + 1] ^= 1
  refreshPokemonGen3SaveSectionChecksums(corrupted, selected, new Set([1 + Math.floor(0x2bad / 0xf80)]))
  assert.throws(() => validatePokemonGen3GabbyTyCandidate(original, corrupted, 'pokemon-emerald'), { code: 'SAVE_CANDIDATE_INVALID' })
})

test('Gabby and Ty editor supports Sapphire with the Ruby save layout', () => {
  const original = rubySave({ league: false })
  const candidate = stopPokemonGen3GabbyTy(original, 'pokemon-sapphire')
  const selected = selectUnambiguousPokemonGen3SaveCopy(candidate)
  assert.equal(candidate[pokemonGen3SaveByteOffset(selected, 'large', 0x2b19)], 0xff)
  assert.equal(validatePokemonGen3GabbyTyCandidate(original, candidate, 'pokemon-sapphire').changed, true)
})

test('event delivery skips a save before Celio repairs the machine without touching it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'emulator-hub-event-delivery-'))
  try {
    const saveStore = createSaveStore({ dataPath: join(root, 'saves'), eventBackupsPath: join(root, 'event-backups') })
    const original = fireRedSave({ eligible: false })
    await saveStore.put(profileId, gameId, original, null)
    const service = createPokemonGen3EventDeliveryService({ saveStore, gameSaveLeases: { async get() { return null } }, resolveGame: async () => ({ title: 'pokemon-firered', romSha256 }) })
    assert.deepEqual(await service.attempt({ profileId, gameId }), { status: 'pending-progression' })
    assert.deepEqual((await saveStore.get(profileId, gameId)).bytes, original)
    await assert.rejects(() => readdir(join(root, 'event-backups')), error => error.code === 'ENOENT')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('event delivery skips a save when a lease appears just before commit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'emulator-hub-event-delivery-'))
  try {
    const saveStore = createSaveStore({ dataPath: join(root, 'saves'), eventBackupsPath: join(root, 'event-backups') })
    const original = fireRedSave({ eligible: true })
    await saveStore.put(profileId, gameId, original, null)
    let checks = 0
    const service = createPokemonGen3EventDeliveryService({
      saveStore,
      gameSaveLeases: { async get() { checks += 1; return checks === 1 ? null : { ownerKind: 'player' } } },
      resolveGame: async () => ({ title: 'pokemon-firered', romSha256 }),
    })
    assert.deepEqual(await service.attempt({ profileId, gameId }), { status: 'deferred-lease' })
    assert.deepEqual((await saveStore.get(profileId, gameId)).bytes, original)
    await assert.rejects(() => readdir(join(root, 'event-backups')), error => error.code === 'ENOENT')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('event delivery leaves the canonical save intact when its preimage cannot be backed up', async () => {
  const root = await mkdtemp(join(tmpdir(), 'emulator-hub-event-delivery-'))
  try {
    const blockedPath = join(root, 'blocked-backups')
    await writeFile(blockedPath, 'not a directory')
    const saveStore = createSaveStore({ dataPath: join(root, 'saves'), eventBackupsPath: blockedPath })
    const original = fireRedSave({ eligible: true })
    await saveStore.put(profileId, gameId, original, null)
    const service = createPokemonGen3EventDeliveryService({ saveStore, gameSaveLeases: { async get() { return null } }, resolveGame: async () => ({ title: 'pokemon-firered', romSha256 }), onError() {} })
    assert.equal((await service.attempt({ profileId, gameId })).status, 'skipped')
    const saved = await saveStore.get(profileId, gameId)
    assert.deepEqual(saved.bytes, original)
    assert.equal(saved.revision, 1)
    assert.equal(saved.eventGrantReceipt, undefined)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

function fireRedSave({ eligible }) {
  const bytes = Buffer.alloc(0x20000)
  for (const [copy, index] of [[0, 1], [0xe000, 2]]) {
    for (let section = 0; section < 14; section += 1) {
      const start = physical(copy, section)
      bytes.writeUInt16LE(section, start + 0xff4)
      bytes.writeUInt32LE(0x08012025, start + 0xff8)
      bytes.writeUInt32LE(index, start + 0xffc)
    }
    if (copy === 0xe000) {
      bytes[physical(copy, 0) + 0x1b] = 0xb9
      bytes.writeUInt16LE(0x6258, large(copy, 0x109c))
      for (const flagId of [0x82c, 0x840, ...(eligible ? [0x844] : [])]) {
        bytes[large(copy, 0xee0 + (flagId >> 3))] |= 1 << (flagId & 7)
      }
    }
    for (let section = 0; section < 14; section += 1) {
      const start = physical(copy, section)
      const length = section === 0 ? 3884 : section === 13 ? 2000 : 3968
      let sum = 0
      for (let offset = 0; offset < length; offset += 4) sum = (sum + bytes.readUInt32LE(start + offset)) >>> 0
      bytes.writeUInt16LE(((sum & 0xffff) + (sum >>> 16)) & 0xffff, start + 0xff6)
    }
  }
  return bytes
}

function rubySave({ league }) {
  const bytes = Buffer.alloc(0x20000)
  for (const [copy, index] of [[0, 1], [0xe000, 2]]) {
    for (let section = 0; section < 14; section += 1) {
      const start = physical(copy, section)
      bytes.writeUInt16LE(section, start + 0xff4)
      bytes.writeUInt32LE(0x08012025, start + 0xff8)
      bytes.writeUInt32LE(index, start + 0xffc)
    }
    if (copy === 0xe000 && league) bytes[large(copy, 0x1220 + (0x804 >> 3))] |= 1 << (0x804 & 7)
    for (let section = 0; section < 14; section += 1) {
      const start = physical(copy, section)
      const length = section === 0 ? 3884 : section === 13 ? 2000 : 3968
      let sum = 0
      for (let offset = 0; offset < length; offset += 4) sum = (sum + bytes.readUInt32LE(start + offset)) >>> 0
      bytes.writeUInt16LE(((sum & 0xffff) + (sum >>> 16)) & 0xffff, start + 0xff6)
    }
  }
  return bytes
}

function emeraldSave() {
  const bytes = fireRedSave({ eligible: false })
  const copy = 0xe000
  bytes[physical(copy, 0) + 0x1a] = 0xda
  bytes.writeUInt16LE(0x0302, large(copy, 0x1428))
  for (const flagId of [0x864, 0x896, 0x12f, 0x130, 0x15c]) {
    bytes[large(copy, 0x1270 + (flagId >> 3))] |= 1 << (flagId & 7)
  }
  for (let section = 0; section < 14; section += 1) {
    const start = physical(copy, section)
    const length = section === 0 ? 3884 : section === 13 ? 2000 : 3968
    let sum = 0
    for (let offset = 0; offset < length; offset += 4) sum = (sum + bytes.readUInt32LE(start + offset)) >>> 0
    bytes.writeUInt16LE(((sum & 0xffff) + (sum >>> 16)) & 0xffff, start + 0xff6)
  }
  return bytes
}

function physical(copy, section) { return copy + ((section * 5 + 3) % 14) * 0x1000 }
function large(copy, offset) { return physical(copy, 1 + Math.floor(offset / 0xf80)) + offset % 0xf80 }
