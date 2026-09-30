import { createHash } from 'node:crypto'
import { mkdir, open, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { pokemonHubRedisKeys } from './pokemon-hub-redis-keys.mjs'
import { hubItemLedgerGameId } from './pokemon-hub-item-ledger.mjs'
import { compareAndWriteJson } from './redis-json-transaction.mjs'

const markerKey = 'pokemon-hub:v3:{pokemon-hub}:migration'
const legacyKey = /^pokemon-hub:v[23]:\{ph:[^}]+\}:(source|record|event|lease|session):/
const failure = (code, message) => Object.assign(new Error(message), { code })
const withoutOwner = document => { const { profileId, ownerProfileId, ...rest } = document; return rest }
const canonical = value => JSON.stringify(order(value))
function order(value) { return Array.isArray(value) ? value.map(order) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, order(value[key])])) : value }
async function readMany(persistence, keys) {
 const values = []
 for (let offset=0; offset<keys.length; offset+=100) values.push(...await Promise.all(keys.slice(offset,offset+100).map(key=>persistence.get(key))))
 return values
}

export async function assertPokemonHubStorageReady(persistence) {
 const marker = JSON.parse(await persistence.get(markerKey) ?? 'null')
 if (marker?.state === 'complete') return
 if (marker) throw failure('POKEMON_HUB_MIGRATION_REQUIRED', 'Pokemon Hub migration must finish before opening this version.')
 const keys = await persistence.keys('pokemon-hub:')
 const profiles = JSON.parse(await persistence.get('pokemon-hub:profiles') ?? '[]')
 if (keys.some(key => legacyKey.test(key)) || profiles.some(profile => profile.ownerProfileId)) {
  throw failure('POKEMON_HUB_MIGRATION_REQUIRED', 'Pokemon Hub legacy data requires an inspected migration before opening this version.')
 }
}

export async function inspectPokemonHubMigration({ persistence, saveStore } = {}) {
 const originals = [], blockers = [], proposed = new Map(), fileCopies = [], nativeSaves = []
 const catalogRaw = await persistence.get('pokemon-hub:profiles')
 const catalog = JSON.parse(catalogRaw ?? '[]')
 const keys = (await persistence.keys('pokemon-hub:')).filter(key => legacyKey.test(key)).sort()
 const rawValues = await readMany(persistence, keys)
 for (const [index,key] of keys.entries()) {
  const raw = rawValues[index]
  if (raw === null) continue
  originals.push({ key, raw })
  const kind = legacyKey.exec(key)[1]
  const original = JSON.parse(raw), document = withoutOwner(original)
  if (kind === 'lease' || kind === 'session') { blockers.push({ code: 'UNSETTLED_LEASE_OR_SESSION', key }); continue }
  if (kind === 'source' && document.sourceKey?.startsWith('save:') && document.needsSaveFlush) blockers.push({ code: 'UNPUBLISHED_SAVE', key })
  const target = kind === 'source' ? pokemonHubRedisKeys.source(document.sourceKey)
   : kind === 'record' ? pokemonHubRedisKeys.record(document.pokemonInstanceId)
   : pokemonHubRedisKeys.event(document.pokemonInstanceId, document.eventId)
  const previous = proposed.get(target)
  if (previous && canonical(previous.document) !== canonical(document)) blockers.push({ code: kind === 'source' ? 'CONFLICTING_SOURCE_COPIES' : 'CONFLICTING_RECORD_OR_EVENT', keys: [previous.legacyKey, key] })
  else proposed.set(target, { key: target, document, legacyKey: key })
 }
 const membership = new Map()
 const targetValues = new Map([...proposed.keys()].map((key,index)=>[key,index]))
 const existingTargets = await readMany(persistence,[...targetValues.keys()])
 for (const entry of proposed.values()) {
  const existing = existingTargets[targetValues.get(entry.key)]
  if (existing !== null && canonical(JSON.parse(existing)) !== canonical(entry.document)) blockers.push({ code: 'TARGET_ALREADY_DIFFERS', key: entry.key })
  if (!entry.document.sourceKey || !Array.isArray(entry.document.placements)) continue
  for (const placement of entry.document.placements) {
   const id = placement.pokemonInstanceId
   if (!id) continue
   if (membership.has(id)) blockers.push({ code: 'DUPLICATE_POKEMON_PLACEMENT', pokemonInstanceId: id })
   membership.set(id, entry.document.sourceKey)
   const record = proposed.get(pokemonHubRedisKeys.record(id))?.document
   if (!record || record.placement?.sourceKey !== entry.document.sourceKey) blockers.push({ code: 'MISSING_OR_MISPLACED_RECORD', pokemonInstanceId: id })
  }
  const match = /^save:([^:]+):([^:]+)$/.exec(entry.document.sourceKey)
  if (match && !saveStore) blockers.push({ code: 'NATIVE_SAVE_INSPECTION_REQUIRED', sourceKey: entry.document.sourceKey })
  if (match && saveStore) {
   const saved = await saveStore.get(match[1], match[2])
   if (!saved || saved.revision !== entry.document.saveRevision) blockers.push({ code: 'NATIVE_SAVE_REVISION_CONFLICT', sourceKey: entry.document.sourceKey })
   if (saved) nativeSaves.push({ profileId: match[1], gameId: match[2], saved: serializeSave(saved) })
  }
 }
 for (const profile of catalog) {
  if (Object.keys(profile.grid?.entries ?? {}).length && !proposed.has(pokemonHubRedisKeys.source('hub:' + profile.hubProfileId))) blockers.push({ code: 'HUB_CONTENT_WITHOUT_SOURCE', hubProfileId: profile.hubProfileId })
  if (!profile.ownerProfileId) continue
  if (!saveStore) { blockers.push({ code: 'ITEM_LEDGER_INSPECTION_REQUIRED', hubProfileId: profile.hubProfileId }); continue }
  const gameId = hubItemLedgerGameId(profile.hubProfileId)
  const saved = await saveStore.get(profile.ownerProfileId, gameId)
  if (!saved) continue
  const target = await saveStore.get(profile.hubProfileId, gameId)
  if (target && !Buffer.from(target.bytes).equals(Buffer.from(saved.bytes))) blockers.push({ code: 'CONFLICTING_ITEM_LEDGERS', hubProfileId: profile.hubProfileId })
  fileCopies.push({ fromProfileId: profile.ownerProfileId, toProfileId: profile.hubProfileId, gameId, saved: serializeSave(saved), targetExists: !!target })
 }
 const archive = { catalogRaw, originals, nativeSaves, fileCopies }
 const fingerprint = createHash('sha256').update(canonical(archive)).digest('hex')
 return { fingerprint, blockers, writes: [...proposed.values()], profiles: catalog.map(profile => { const { ownerProfileId, ...independent } = profile; return independent }), archive }
}

// Offline only: the old backend must be stopped. This never deletes the legacy originals.
export async function applyPokemonHubMigration({ persistence, saveStore, archivePath, expectedFingerprint, maintenanceMode = false }) {
 if (!maintenanceMode) throw failure('MIGRATION_MAINTENANCE_REQUIRED', 'Stop all writers before applying the inspected migration.')
 const marker = JSON.parse(await persistence.get(markerKey) ?? 'null')
 if (marker?.state === 'complete') throw failure('MIGRATION_ALREADY_APPLIED', 'Migration already applied.')
 if (marker && (marker.state !== 'preparing' || marker.fingerprint !== expectedFingerprint || marker.archivePath !== archivePath)) throw failure('MIGRATION_PLAN_CHANGED', 'Resume the prepared migration with its original archive and fingerprint.')
 const plan = marker ? JSON.parse(await readFile(archivePath, 'utf8')) : await inspectPokemonHubMigration({ persistence, saveStore })
 if (plan.blockers.length) throw failure('MIGRATION_BLOCKED', 'Resolve the reported migration blockers first.')
 if (plan.fingerprint !== expectedFingerprint) throw failure('MIGRATION_PLAN_CHANGED', 'Data changed after inspection.')
 if (!marker) {
  await mkdir(dirname(archivePath), { recursive: true })
  const archive = await open(archivePath, 'wx')
  try { await archive.writeFile(JSON.stringify({ schemaVersion: 1, createdAt: new Date().toISOString(), ...plan })); await archive.sync() } finally { await archive.close() }
  if (await persistence.set(markerKey, JSON.stringify({state:'preparing',fingerprint:plan.fingerprint,archivePath}),{NX:true}) === null) throw failure('MIGRATION_PLAN_CHANGED','Another migration started.')
 }
 if (createHash('sha256').update(canonical(plan.archive)).digest('hex') !== plan.fingerprint) throw failure('MIGRATION_PLAN_CHANGED', 'Original migration archive failed verification.')
 const originalValues = await readMany(persistence,plan.archive.originals.map(original=>original.key))
 for (const [index,original] of plan.archive.originals.entries()) if (originalValues[index] !== original.raw) throw failure('MIGRATION_PLAN_CHANGED','Legacy data changed during migration.')
 const catalogue = await persistence.get('pokemon-hub:profiles')
 if (catalogue !== plan.archive.catalogRaw && catalogue !== JSON.stringify(plan.profiles)) throw failure('MIGRATION_PLAN_CHANGED','Catalogue changed during migration.')
 for (const copy of plan.archive.fileCopies) {
  const original=await saveStore.get(copy.fromProfileId,copy.gameId)
  if (!original || canonical(serializeSave(original)) !== canonical(copy.saved)) throw failure('MIGRATION_PLAN_CHANGED','Original item ledger changed.')
  const target=await saveStore.get(copy.toProfileId,copy.gameId)
  if (target && !Buffer.from(target.bytes).equals(Buffer.from(copy.saved.bytesBase64,'base64'))) throw failure('MIGRATION_PLAN_CHANGED','Target item ledger changed.')
  if (!target) await saveStore.put(copy.toProfileId, copy.gameId, Buffer.from(copy.saved.bytesBase64, 'base64'), null)
 }
 const rechecked = await inspectPokemonHubMigration({ persistence, saveStore })
 if (canonical(rechecked.archive.originals) !== canonical(plan.archive.originals) || canonical(rechecked.archive.nativeSaves) !== canonical(plan.archive.nativeSaves) || (rechecked.archive.catalogRaw !== plan.archive.catalogRaw && rechecked.archive.catalogRaw !== JSON.stringify(plan.profiles)) || rechecked.blockers.length) throw failure('MIGRATION_PLAN_CHANGED', 'Original data changed while preparing migration.')
 const writes = plan.writes.map(({key,document}) => ({key,value:JSON.stringify(document)}))
 const checks = []
 const currentValues = await readMany(persistence,writes.map(write=>write.key))
 for(const [index,write] of writes.entries()) {
  const current = currentValues[index]
  if(current !== null) {
   if(canonical(JSON.parse(current)) !== canonical(JSON.parse(write.value))) throw failure('MIGRATION_PLAN_CHANGED','Target data changed after inspection.')
   checks.push({key:write.key,raw:current}); continue
  }
  checks.push({key:write.key,absent:true})
 }
 if (!await compareAndWriteJson(persistence, { checks, writes })) throw failure('MIGRATION_PLAN_CHANGED', 'Target data changed before commit.')
 // Catalogue lives outside the authority hash slot. A preparing marker blocks
 // startup until both stores are complete; retries reuse the immutable archive.
 await persistence.set('pokemon-hub:profiles', JSON.stringify(plan.profiles))
 await persistence.set(markerKey, JSON.stringify({ state:'complete',fingerprint:plan.fingerprint,archivePath,completedAt:new Date().toISOString() }))
 return { migratedKeys: plan.writes.length, copiedItemLedgers: plan.archive.fileCopies.length, archivePath }
}
function serializeSave(saved) { return { ...saved, bytes: undefined, bytesBase64: Buffer.from(saved.bytes).toString('base64') } }
