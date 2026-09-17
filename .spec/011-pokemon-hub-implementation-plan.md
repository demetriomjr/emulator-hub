# Pokémon Hub Implementation Plan

> **Current scope:** This plan targets the legacy profile-scoped transfer engine. Do not use its frontend tasks to alter the direct workspace entry or create Hub profiles. Those behaviors are defined by [Spec 012](012-pokemon-hub-workspace-frontend.md) and [Spec 013](013-pokemon-hub-profile-creation-plan.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first profile-scoped Pokémon Hub slice: inspect Gen III saves, move one PC Pokémon between inactive supported saves and Hub storage atomically, preserve a canonical extensible Pokémon document, and block stale state restoration.

**Architecture:** `apps/packages/` contains a Gen III binary adapter, adapter registry, JSON-document Pokémon Hub store, active-session/snapshot guards, and transfer service. The Node backend exposes projections and transfer endpoints; React opens a minimal Hub modal and never receives writable save bytes or canonical documents. A file-backed transaction journal stages save/document/snapshot changes and recovers them on the next backend start.

**Tech Stack:** Node.js ESM and `node:test`; native `node:fs/promises`, `node:crypto`, and JSON documents; existing React 19 frontend; existing Node HTTP backend. No database service or new runtime dependency is introduced.

**Spec:** [.spec/011-profile-pokemon-hub.md](011-profile-pokemon-hub.md)

## Global Constraints

- Do not copy OpenHome source, tests, generated files, or assets. It is technical reference material only.
- Do not run a project build. Run the targeted Node tests and the backend test suite only.
- Pokémon Hub is profile-scoped. The browser submits locations/revisions only and never binary save data or mutable Pokémon documents.
- First release supports only initialized Ruby, Sapphire, Emerald, FireRed, and LeafGreen battery saves through adapter ID `gen3-gba-v1`.
- Preserve unknown native bytes and all canonical fields outside an adapter's declared ownership.
- A transfer is all-or-nothing across saves, Hub documents, inventory, transaction journal, snapshot invalidations, and the monotonic profile `hubEpoch`.
- A game with a live backend session cannot participate in a transfer. A snapshot whose save revision/hash or `hubEpoch` differs from the current values cannot load.

---

## File structure

| File | Responsibility |
| --- | --- |
| `apps/packages/pokemon-hub-model.mjs` | Validate/copy public locations, revisions, document shape, projections, and identity observations. |
| `apps/packages/pokemon-save-adapter-registry.mjs` | Resolve a catalog adapter ID to its adapter; reject unknown adapters. |
| `apps/packages/pokemon-gen3-adapter.mjs` | Independently inspect and rewrite Gen III PC boxes, preserving 80-byte native records and updating sectors/checksums. |
| `apps/packages/pokemon-hub-store.mjs` | Persist profile inventory, Pokémon documents, `hubEpoch`, and audit/conflict records as local JSON documents. |
| `apps/packages/pokemon-hub-session-store.mjs` | Issue, renew, validate, and end backend-owned game-session leases. |
| `apps/packages/pokemon-hub-snapshot-store.mjs` | Persist snapshot bindings and invalidate them by game/profile during transfers. It stores metadata only in this slice. |
| `apps/packages/pokemon-hub-transaction-store.mjs` | Stage, commit, and recover multi-file save/document/snapshot mutations. |
| `apps/packages/pokemon-hub-service.mjs` | Build inventory projections and execute validated transfer transactions. |
| `apps/packages/hub-client.js` | Fetch Hub projections, request transfers, and manage game-session leases from React. |
| `apps/backend/server.mjs` | Configure stores, validate catalog metadata, route Hub/session calls, and map service errors to HTTP. |
| `apps/frontend/src/main.jsx` | Add the sidebar action and the narrow Pokémon Hub modal/selection/confirmation flow. |
| `apps/frontend/src/styles.css` | Style only the new Hub action and modal/slot grids in the existing dark-green visual language. |
| `apps/frontend/src/player.js` | Receive a lease, renew it while running, end it after final save sync, and require snapshot-binding checks before a later state-load feature. |
| `apps/backend/test/*.test.mjs` and `apps/packages/*.test.mjs` | Contract, adapter, persistence, transaction, service, and client-independent tests. |

## Task 1: Define the package contracts and catalog metadata

**Files:**

- Create: `apps/packages/pokemon-hub-model.mjs`
- Create: `apps/packages/pokemon-hub-model.test.mjs`
- Create: `apps/packages/pokemon-save-adapter-registry.mjs`
- Create: `apps/packages/pokemon-save-adapter-registry.test.mjs`
- Modify: `apps/backend/server.mjs`
- Modify: `apps/backend/test/server.test.mjs`

**Interfaces:**

- Produces `parseHubLocation(value)`, `parseExpectedRevisions(value)`, `createHubPokemonDocument(input)`, `projectPokemon(document)`, and `projectHubInventory(inventory, games)`.
- Produces `createPokemonSaveAdapterRegistry(adapters)` with `get(adapterId)` and `supports(adapterId)`.
- Extends normalized catalog entries with `pokemonSave: { adapter, saveKind, supported } | null`.

- [ ] **Step 1: Write contract tests before implementation.**

```js
test('accepts only bounded Hub and game locations', () => {
  assert.deepEqual(parseHubLocation({ kind: 'hub', slot: 0 }), { kind: 'hub', slot: 0 })
  assert.deepEqual(parseHubLocation({ kind: 'game', gameId: 'pokemon-emerald', box: 13, slot: 29 }), {
    kind: 'game', gameId: 'pokemon-emerald', box: 13, slot: 29,
  })
  assert.throws(() => parseHubLocation({ kind: 'game', gameId: '../x', box: -1, slot: 30 }))
})

test('rejects an unknown adapter', () => {
  const registry = createPokemonSaveAdapterRegistry([])
  assert.equal(registry.get('gen3-gba-v1'), null)
})
```

- [ ] **Step 2: Run the new tests to confirm the contracts are absent.**

Run: `node --test apps/packages/pokemon-hub-model.test.mjs apps/packages/pokemon-save-adapter-registry.test.mjs`

Expected: FAIL because the new modules do not exist.

- [ ] **Step 3: Implement strict parsers and projections.**

```js
export function parseHubLocation(value) {
  if (!value || typeof value !== 'object') throw invalidLocation()
  if (value.kind === 'hub' && Number.isInteger(value.slot) && value.slot >= 0 && value.slot < 30) {
    return { kind: 'hub', slot: value.slot }
  }
  if (value.kind === 'game' && validGameId(value.gameId) && Number.isInteger(value.box) && value.box >= 0 && value.box < 14
      && Number.isInteger(value.slot) && value.slot >= 0 && value.slot < 30) {
    return { kind: 'game', gameId: value.gameId, box: value.box, slot: value.slot }
  }
  throw invalidLocation()
}
```

Keep document validation versioned (`schemaVersion === 1`) and clone returned projections so callers cannot mutate stored state. Add `pokemonSave` only when the catalog has exact valid fields; invalid metadata makes the title ineligible for Hub, not unplayable.

- [ ] **Step 4: Run the package and backend catalog tests.**

Run: `node --test apps/packages/pokemon-hub-model.test.mjs apps/packages/pokemon-save-adapter-registry.test.mjs`

Then run: `npm test` from `apps/backend`.

Expected: PASS; non-Pokémon titles remain in `/api/games`, while only valid `pokemonSave.supported` entries are eligible later.

- [ ] **Step 5: Commit the contract seam.**

```powershell
git add apps/packages/pokemon-hub-model.mjs apps/packages/pokemon-hub-model.test.mjs apps/packages/pokemon-save-adapter-registry.mjs apps/packages/pokemon-save-adapter-registry.test.mjs apps/backend/server.mjs apps/backend/test/server.test.mjs
git commit -m "feat: define pokemon hub contracts"
```

## Task 2: Implement and fixture-test the independent Gen III adapter

**Files:**

- Create: `apps/packages/pokemon-gen3-adapter.mjs`
- Create: `apps/packages/pokemon-gen3-adapter.test.mjs`
- Create: `apps/packages/test-fixtures/gen3/README.md`
- Add: legally obtained, Git-appropriate binary fixture saves only if repository policy permits; otherwise keep fixture paths configurable outside Git and provide their SHA-256 manifest locally.

**Interfaces:**

- Produces adapter `{ id: 'gen3-gba-v1', inspect, readSlot, writeSlot, describe, spriteKey, toCanonical, nativeIdentity }`.
- `writeSlot(saveBytes, box, slot, recordOrNull)` returns a new `Buffer`; it never mutates its input.

- [ ] **Step 1: Add tests for rejection, inspection, and byte preservation.**

```js
test('rewrites one Gen III PC slot and preserves unrelated bytes', () => {
  const original = loadFixture('emerald-initialized.sav')
  const source = adapter.readSlot(original, 0, 0)
  const rewritten = adapter.writeSlot(original, 0, 1, source)
  assert.deepEqual(adapter.readSlot(rewritten, 0, 1).bytes, source.bytes)
  assert.equal(adapter.readSlot(rewritten, 0, 0), null)
  assertOnlyGen3PcSectorsAndChecksumsChanged(original, rewritten, [{ box: 0, slot: 0 }, { box: 0, slot: 1 }])
})
```

Cover malformed lengths, uninitialized all-`0xff` saves, invalid signatures/checksums, both physical save copies, all 14 boxes, empty slots, and source=destination rejection. The fixture README records acquisition, game/version, byte length, SHA-256, and that it may not be replaced with OpenHome test data.

- [ ] **Step 2: Run the failing adapter tests.**

Run: `node --test apps/packages/pokemon-gen3-adapter.test.mjs`

Expected: FAIL because the adapter is absent.

- [ ] **Step 3: Implement the adapter from the documented Gen III format, independently.**

```js
function selectNewestValidSave(saveBytes) {
  const candidates = [readSaveCopy(saveBytes, 0), readSaveCopy(saveBytes, 0xe000)].filter(candidate => candidate.valid)
  if (!candidates.length) throw adapterError('SAVE_UNSUPPORTED', 'A valid initialized Gen III save is required.')
  return candidates.reduce((newest, candidate) => candidate.saveIndex > newest.saveIndex ? candidate : newest)
}

export function writeSlot(saveBytes, box, slot, record) {
  const copy = Buffer.from(saveBytes)
  const save = selectNewestValidSave(copy)
  const offset = pcRecordOffset(save.sectionsById, box, slot)
  copy.fill(0, offset, offset + 80)
  if (record) Buffer.from(record.bytes).copy(copy, offset)
  refreshAffectedSectorChecksums(copy, save)
  return copy
}
```

Use `DataView`/Buffer little-endian reads, section IDs to map physical sectors, 14×30 PC offsets, 80-byte encrypted PC records, and the Gen III sector checksum algorithm. Do not decode/re-encrypt a record merely to move it. `describe` may expose species, form, shiny, and a display-safe native identity only after checksum-safe decoding; an undecodable occupied record is a rejected save, not an empty slot.

- [ ] **Step 4: Run adapter tests.**

Run: `node --test apps/packages/pokemon-gen3-adapter.test.mjs`

Expected: PASS, including round-trip and changed-byte assertions.

- [ ] **Step 5: Commit the adapter and fixture documentation.**

```powershell
git add apps/packages/pokemon-gen3-adapter.mjs apps/packages/pokemon-gen3-adapter.test.mjs apps/packages/test-fixtures/gen3/README.md
git commit -m "feat: add independent gen3 pokemon save adapter"
```

## Task 3: Add local NoSQL documents, identity, and audit history

**Files:**

- Create: `apps/packages/pokemon-hub-store.mjs`
- Create: `apps/packages/pokemon-hub-store.test.mjs`

**Interfaces:**

- Produces `createPokemonHubStore({ dataPath })`.
- Methods: `getProfileState(profileId)`, `getPokemon(profileId, hubPokemonId)`, `listStored(profileId)`, `stageProfileState(change)`, `stagePokemon(change)`, `findByRepresentation(profileId, observation)`, and `recordConflict(profileId, event)`.
- A profile state is `{ schemaVersion: 1, profileId, hubEpoch, slots: Array(30), revision }`; each slot is `null` or a `hubPokemonId`.

- [ ] **Step 1: Write document-store tests.**

```js
test('keeps unsupported canonical fields when a Gen III projection updates', async () => {
  const store = createPokemonHubStore({ dataPath: await temporaryPath() })
  const saved = await store.putPokemon(documentWith({ canonical: { gameData: { teraType: 'fire' } } }))
  const updated = await store.updateAdapterFields(saved.hubPokemonId, 'gen3-gba-v1', { moves: [{ id: 15 }] })
  assert.equal(updated.canonical.gameData.teraType, 'fire')
  assert.deepEqual(updated.canonical.moves, [{ id: 15 }])
})
```

Test UUID/profile validation, revision conflicts, deep-copy behavior, one-document-per-file paths, hash validation of Base64 representations, inventory occupancy consistency, representation lookup, audit append, and recovery from an interrupted atomic document write.

- [ ] **Step 2: Run the failing store tests.**

Run: `node --test apps/packages/pokemon-hub-store.test.mjs`

Expected: FAIL because the store is absent.

- [ ] **Step 3: Implement document paths and validated atomic writes.**

```js
function profilePaths(root, profileId) {
  return {
    inventory: join(root, profileId, 'inventory.json'),
    pokemon: id => join(root, profileId, 'pokemon', `${id}.json`),
    audit: join(root, profileId, 'audit.jsonl'),
  }
}

export function createPokemonHubStore({ dataPath }) {
  return { getProfileState, getPokemon, listStored, putPokemon, updateAdapterFields, findByRepresentation, recordConflict }
}
```

Write JSON to a same-directory temporary path then rename; validate before persistence; retain a single `*.previous.json` revision for a document changed by a transaction. Never delete canonical keys that the calling adapter did not declare in `ownedCanonicalPaths`.

- [ ] **Step 4: Run store tests.**

Run: `node --test apps/packages/pokemon-hub-store.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit the NoSQL store.**

```powershell
git add apps/packages/pokemon-hub-store.mjs apps/packages/pokemon-hub-store.test.mjs
git commit -m "feat: persist pokemon hub documents"
```

## Task 4: Create backend session and snapshot-integrity stores

**Files:**

- Create: `apps/packages/pokemon-hub-session-store.mjs`
- Create: `apps/packages/pokemon-hub-session-store.test.mjs`
- Create: `apps/packages/pokemon-hub-snapshot-store.mjs`
- Create: `apps/packages/pokemon-hub-snapshot-store.test.mjs`

**Interfaces:**

- Session methods: `open({ profileId, gameId })`, `renew({ sessionId, leaseToken })`, `close({ sessionId, leaseToken })`, `hasLiveSession(profileId, gameId)`.
- Snapshot methods: `createBinding(binding)`, `assertRestorable(binding, current)`, `invalidateGames(profileId, gameIds, hubEpoch)`, `listInvalidated(profileId, gameId)`.

- [ ] **Step 1: Write expiry and stale-binding tests.**

```js
test('invalidates a stale state binding after a Hub epoch advance', async () => {
  const snapshots = createPokemonHubSnapshotStore({ dataPath: await temporaryPath() })
  const binding = await snapshots.createBinding({ profileId: profile, gameId: 'pokemon-emerald', saveRevision: 4, saveSha256: hash, hubEpoch: 2 })
  await snapshots.invalidateGames(profile, ['pokemon-emerald'], 3)
  assert.throws(() => snapshots.assertRestorable(binding, { saveRevision: 4, saveSha256: hash, hubEpoch: 3 }), { code: 'SNAPSHOT_STALE' })
})
```

Cover expired leases, wrong token, a second live session for the same profile/game, valid exact bindings, changed revision, changed hash, changed epoch, and durable invalidation after reopening the store.

- [ ] **Step 2: Run the failing tests.**

Run: `node --test apps/packages/pokemon-hub-session-store.test.mjs apps/packages/pokemon-hub-snapshot-store.test.mjs`

Expected: FAIL because both stores are absent.

- [ ] **Step 3: Implement durable metadata-only stores.**

Use random opaque `sessionId` and `leaseToken`, a short renewal window, injected `now()` for deterministic tests, and atomic JSON writes. A session can only be closed by its token; expired sessions are treated as closed. Snapshot binding stores no state bytes in this slice, only `{ profileId, gameId, saveRevision, saveSha256, hubEpoch, invalidatedAt }`.

- [ ] **Step 4: Run session/snapshot tests.**

Run: `node --test apps/packages/pokemon-hub-session-store.test.mjs apps/packages/pokemon-hub-snapshot-store.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit the integrity stores.**

```powershell
git add apps/packages/pokemon-hub-session-store.mjs apps/packages/pokemon-hub-session-store.test.mjs apps/packages/pokemon-hub-snapshot-store.mjs apps/packages/pokemon-hub-snapshot-store.test.mjs
git commit -m "feat: track pokemon hub sessions and snapshot bindings"
```

## Task 5: Add journaled multi-record transactions and startup recovery

**Files:**

- Create: `apps/packages/pokemon-hub-transaction-store.mjs`
- Create: `apps/packages/pokemon-hub-transaction-store.test.mjs`
- Modify: `apps/packages/save-store.mjs`
- Modify: `apps/packages/save-store.test.mjs` (create if absent)

**Interfaces:**

- `createPokemonHubTransactionStore({ dataPath })` exposes `recover()`, `execute({ profileId, expected, prepare })`, and `withProfileLock(profileId, operation)`.
- `prepare` returns validated staged writes `{ targetPath, beforeSha256, afterBytes }` and staged JSON changes; it performs no rename itself.

- [ ] **Step 1: Write crash-window tests.**

```js
test('recovers a transaction interrupted after its first replacement', async () => {
  const transactions = createPokemonHubTransactionStore({ dataPath: root, failAfterCommitStep: 1 })
  await assert.rejects(() => transactions.execute(change))
  await createPokemonHubTransactionStore({ dataPath: root }).recover()
  assert.deepEqual(await readAllTargets(root), expectedAllBeforeOrAllAfter)
})
```

Test serial execution for one profile, independent profiles, stale source hash, journal `prepared`/`committing`/`committed` recovery, backup restoration, malformed journal quarantine, and that `save-store.put` cannot race a transfer while the profile lock is held.

- [ ] **Step 2: Run the failing transaction tests.**

Run: `node --test apps/packages/pokemon-hub-transaction-store.test.mjs apps/packages/save-store.test.mjs`

Expected: FAIL because the transaction store and save-store lock integration are absent.

- [ ] **Step 3: Implement the journal protocol.**

```text
lock profile -> recover unfinished journal -> read/verify expected hashes and revisions
-> write all staged files + immutable backups -> persist journal state=prepared
-> rename each staged file, persisting journal progress after each rename
-> persist document/inventory/audit/snapshot invalidations -> state=committed
-> retain recoverable journal then remove staging files
```

Use same-volume staging paths, SHA-256 before/after checks, and an in-process per-profile promise queue. On startup, call `recover()` before listening for requests. A recovery must either finish a verified staged transaction or restore the verified backups; it must not guess when neither digest matches.

- [ ] **Step 4: Run transaction/store tests.**

Run: `node --test apps/packages/pokemon-hub-transaction-store.test.mjs apps/packages/save-store.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit transactional persistence.**

```powershell
git add apps/packages/pokemon-hub-transaction-store.mjs apps/packages/pokemon-hub-transaction-store.test.mjs apps/packages/save-store.mjs apps/packages/save-store.test.mjs
git commit -m "feat: transact pokemon hub save mutations"
```

## Task 6: Build the Pokémon Hub service

**Files:**

- Create: `apps/packages/pokemon-hub-service.mjs`
- Create: `apps/packages/pokemon-hub-service.test.mjs`

**Interfaces:**

- `createPokemonHubService({ profileStore, saveStore, hubStore, registry, sessions, snapshots, transactions, catalogLoader })`.
- Methods: `getInventory(profileId)` and `transfer({ profileId, source, destination, expectedRevisions, expectedHubEpoch })`.

- [ ] **Step 1: Write service tests against fake stores and the real Gen III adapter.**

```js
test('moves one record from game to Hub exactly once', async () => {
  const before = await service.getInventory(profile)
  const result = await service.transfer({ profileId: profile, source: game(0, 0), destination: hub(0), expectedRevisions: before.revisions, expectedHubEpoch: before.hubEpoch })
  assert.equal(result.hubEpoch, before.hubEpoch + 1)
  assert.equal(result.source.slot.pokemon, null)
  assert.equal(result.destination.slot.pokemon.hubPokemonId.length, 36)
})
```

Cover game→Hub, Hub→game, game→game, source empty, target full, same source/target, profile mismatch, unsupported/missing/uninitialized save, active game, stale save revision, stale epoch, representation collision, suspected duplicate audit, adapter mismatch, and forced transaction recovery.

- [ ] **Step 2: Run the failing service tests.**

Run: `node --test apps/packages/pokemon-hub-service.test.mjs`

Expected: FAIL because the service is absent.

- [ ] **Step 3: Implement inventory loading and the one ownership-changing operation.**

```js
async function transfer(request) {
  return transactions.withProfileLock(request.profileId, async () => {
    const state = await loadValidatedState(request)
    rejectLiveSessions(state.affectedGames)
    const mutation = buildMutation(state, request.source, request.destination)
    return transactions.execute({ profileId: request.profileId, expected: state.revisions, prepare: () => mutation })
  })
}
```

On game deposit, derive a canonical projection and native observation; look up an existing current representation before allocating a new `hubPokemonId`. On withdraw, use the retained compatible representation. On same-adapter direct transfer, move the 80-byte record unchanged. Stage the source clear, destination write, Hub document/location/history, inventory state, `hubEpoch + 1`, snapshot invalidations, and audit entry together.

- [ ] **Step 4: Run service tests.**

Run: `node --test apps/packages/pokemon-hub-service.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit the service.**

```powershell
git add apps/packages/pokemon-hub-service.mjs apps/packages/pokemon-hub-service.test.mjs
git commit -m "feat: transfer pokemon through pokemon hub"
```

## Task 7: Expose authenticated profile routes and session lifecycle

**Files:**

- Modify: `apps/backend/server.mjs`
- Modify: `apps/backend/test/server.test.mjs`
- Modify: `apps/backend/catalog.json`

**Interfaces:**

- `GET /api/profiles/{profileId}/pokemon-hub`
- `POST /api/profiles/{profileId}/pokemon-hub/transfers`
- `POST /api/profiles/{profileId}/games/{gameId}/sessions`, `PATCH .../sessions/{sessionId}`, and `DELETE .../sessions/{sessionId}`.

- [ ] **Step 1: Add HTTP contract tests.**

```js
test('rejects a stale Pokémon Hub transfer without changing source bytes', async () => {
  const before = await fetchHub(profile.id)
  await replaceSave(profile.id, 'pokemon-emerald', changedBytes, before.revisions['pokemon-emerald'])
  const response = await fetch(transferUrl, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ ...move, expectedRevisions: before.revisions, expectedHubEpoch: before.hubEpoch }) })
  assert.equal(response.status, 412)
  assert.deepEqual(await getSave(profile.id, 'pokemon-emerald'), changedBytes)
})
```

Also cover 404 profile/game, 400 malformed bodies, 409 occupied/full/active/integrity conflicts, 412 stale revisions/epoch, no exposure of `bytesBase64` in GET projections, session token authorization, and recovery invoked before the server accepts requests.

- [ ] **Step 2: Run the failing backend tests.**

Run: `npm test`

Working directory: `apps/backend`

Expected: FAIL for missing Hub and session endpoints.

- [ ] **Step 3: Configure stores and routes.**

Pass `pokemonHubPath`, `pokemonHubTransactionsPath`, `pokemonHubSessionsPath`, and `pokemonHubSnapshotsPath` through `createHubServer(options)` for isolated tests. Instantiate the Gen III registry, call transaction recovery during server setup, ensure catalog entries explicitly opt into `pokemonSave`, and map typed package errors to the documented statuses. Keep existing save/launch routes and byte limits unchanged.

- [ ] **Step 4: Run the backend suite.**

Run: `npm test`

Working directory: `apps/backend`

Expected: PASS, with prior ROM/profile/save contracts unchanged.

- [ ] **Step 5: Commit backend integration.**

```powershell
git add apps/backend/server.mjs apps/backend/test/server.test.mjs apps/backend/catalog.json
git commit -m "feat: expose pokemon hub api"
```

## Task 8: Add client/session plumbing and state binding hooks

**Files:**

- Modify: `apps/packages/hub-client.js`
- Create: `apps/packages/hub-client.test.mjs`
- Modify: `apps/frontend/src/player.js`
- Create: `apps/frontend/src/player.test.mjs` only if the current browser seams can be unit-tested without a build; otherwise cover messages in the existing package-level tests.

**Interfaces:**

- Client functions: `getPokemonHub(profileId)`, `transferPokemonHub(profileId, request)`, `openGameSession(profileId, gameId)`, `renewGameSession(profileId, gameId, session)`, and `closeGameSession(profileId, gameId, session)`.
- Player receives `{ sessionId, leaseToken }` only after a successful launch/session open and sends status to the parent when the lease cannot renew.

- [ ] **Step 1: Write client failure-path tests.**

```js
test('sends expected revisions and epoch without binary bytes', async () => {
  global.fetch = async (_url, options) => response(200, { hubEpoch: 2 })
  await transferPokemonHub('profile', { source: { kind: 'hub', slot: 0 }, destination: gameLocation, expectedRevisions: {}, expectedHubEpoch: 1 })
  assert.match(lastRequest.body, /"expectedHubEpoch":1/)
  assert.doesNotMatch(lastRequest.body, /bytesBase64/)
})
```

- [ ] **Step 2: Run the failing client tests.**

Run: `node --test apps/packages/hub-client.test.mjs`

Expected: FAIL for the missing Hub/session functions.

- [ ] **Step 3: Implement client calls and player lifecycle.**

Open a backend lease before adding an iframe. Renew it at less than half the lease duration, stop input/save-state controls and notify the parent if renewal fails, flush the in-game save first, then close the lease on player close. Add a message contract now for a later state feature: the parent may request a binding, but `player.js` must only load a state after the backend says its exact `{ revision, sha256, hubEpoch }` binding is valid. Do not persist state bytes in this task.

- [ ] **Step 4: Run client tests and existing backend tests.**

Run: `node --test apps/packages/hub-client.test.mjs`

Then run: `npm test` from `apps/backend`.

Expected: PASS.

- [ ] **Step 5: Commit client/session plumbing.**

```powershell
git add apps/packages/hub-client.js apps/packages/hub-client.test.mjs apps/frontend/src/player.js
git commit -m "feat: bind player sessions to pokemon hub"
```

## Task 9: Build the minimal React Pokémon Hub surface

**Files:**

- Modify: `apps/frontend/src/main.jsx`
- Modify: `apps/frontend/src/styles.css`

**Interfaces:**

- Uses `getProfiles`, `getPokemonHub`, and `transferPokemonHub`.
- Local UI state: `{ hubOpen, hubProfile, hubInventory, selectedSource, selectedDestination, transferBusy, hubError }`.

- [ ] **Step 1: Add a focused interaction test seam or manual acceptance checklist.**

Because the frontend has no configured component-test runner, add pure helper tests if selection/state functions can be extracted without adding dependencies. Otherwise add an exact manual checklist to this task and do not add a test framework merely for one modal.

Checklist: open Pokémon Hub from the sidebar; choose a profile; see only eligible inactive games; choose occupied source then empty target; confirm; see refreshed source/destination; close; attempt the same while an emulator is active and see it disabled.

- [ ] **Step 2: Extract pure selection helpers and run their failing tests when extracted.**

Run: `node --test apps/packages/pokemon-hub-ui-state.test.mjs`

Expected: FAIL before helper implementation. If no helper is extracted, skip this command and use the checklist in Step 5.

- [ ] **Step 3: Implement only the prescribed UI.**

Add one sidebar icon/button, a modal matching `.profile-overlay`/`.profile-panel`, a profile selector, Hub's 30 slots, read-only game PC grids, source/destination highlights, a single confirm button, spinner/error text, and a close action. Use the projection's `spriteKey` to render only an independently licensed local sprite asset or a neutral placeholder until sprite provenance is approved. Do not add a Pokémon detail page, search, filters, editing, import/export, extra navigation, or an arbitrary-file control.

- [ ] **Step 4: Style the surface inside existing constraints.**

Reuse the dark green, compact sidebar, modal z-index, focus treatment, and responsive rules already in `styles.css`. Ensure the modal traps interaction through existing `inert` logic, labels every slot/button accessibly, and does not cover an active player with a way to transfer.

- [ ] **Step 5: Run targeted tests and manual browser verification without building.**

Run: `node --test apps/packages/pokemon-hub-ui-state.test.mjs` when the helper exists, then `npm test` from `apps/backend`.

Manual: use the existing dev-server flow; do not run `npm run build`. Verify game→Hub, Hub→game, direct game→game, full/empty rejection, stale transfer rejection, and active-session disablement with a valid local Gen III save.

- [ ] **Step 6: Commit the UI.**

```powershell
git add apps/frontend/src/main.jsx apps/frontend/src/styles.css apps/packages/pokemon-hub-ui-state.mjs apps/packages/pokemon-hub-ui-state.test.mjs
git commit -m "feat: add pokemon hub modal"
```

## Task 10: Final recovery, integrity, and acceptance pass

**Files:**

- Modify: `.spec/011-profile-pokemon-hub.md` only to record verified fixture hashes/adapter behavior and decisions actually made.
- Modify: `apps/packages/README.md`
- Modify: `apps/backend/README.md`

**Interfaces:**

- No new runtime interface. This task verifies the public contract established above.

- [ ] **Step 1: Add regression tests for the full failure matrix.**

```js
test('a pre-transfer snapshot cannot become restorable after recovery', async () => {
  const binding = await snapshots.createBinding(preTransferBinding)
  await forceInterruptedTransferAndRecover()
  assert.throws(() => snapshots.assertRestorable(binding, await currentBinding()), { code: 'SNAPSHOT_STALE' })
})
```

Include journal interruption before any replacement, between two replacements, after all replacements but before committed status, duplicate native observation, wrong profile, stale hash/revision/epoch, and a no-op direct transfer rejection.

- [ ] **Step 2: Run all targeted package tests.**

Run: `node --test apps/packages/pokemon-hub-*.test.mjs apps/packages/save-store.test.mjs apps/packages/hub-client.test.mjs`

Expected: PASS.

- [ ] **Step 3: Run the backend regression suite.**

Run: `npm test`

Working directory: `apps/backend`

Expected: PASS.

- [ ] **Step 4: Execute the manual acceptance flow without a build.**

Use two legitimate supported Gen III saves for one profile. Confirm a deposit, withdrawal, and direct transfer survive a full close/reopen; confirm an older state binding is refused after each move; inspect resulting save hashes and Hub audit/history; confirm no binary data appears in API projections.

- [ ] **Step 5: Document the actual contract and commit.**

Update package/backend READMEs with endpoint shapes, local data paths, recovery behavior, fixture provenance, and the rule that OpenHome was reference-only. Do not state broad anti-cheat claims; document the product-managed save-state guarantee and the manual-save trust boundary exactly.

```powershell
git add .spec/011-profile-pokemon-hub.md apps/packages/README.md apps/backend/README.md apps/backend/test apps/packages
git commit -m "docs: verify pokemon hub integrity contract"
```

## Plan self-review

- Spec coverage: Tasks 1–2 cover catalog selection and binary inspection; 3 covers extensible NoSQL documents; 4 covers leases/snapshot bindings; 5–6 cover atomic transfer/recovery/identity; 7–8 expose and bind the backend flow; 9 covers the prescribed UI; 10 covers the failure matrix and documentation.
- Scope: Gen III same-adapter moves only. Cross-generation conversion and saved-state byte persistence remain explicitly deferred; only their non-negotiable binding/invalidation contracts are introduced.
- Verification: all listed runtime checks are Node tests or manual dev-server flows. No build command appears in this plan.
