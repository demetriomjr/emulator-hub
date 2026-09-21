# Global emulator snapshots implementation plan

> Superseded by `.spec/044-save-and-snapshot-revisions.md`; retain as historical
> implementation record only.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist and restore one compatible raw EmulatorJS snapshot bundle per Save Profile and game across devices.

**Architecture:** A focused package encodes the deterministic snapshot envelope; a file-backed snapshot store atomically owns the current bundle and its fence. The backend exposes a lease-protected binary resource. The player completes ROM/save/snapshot preflight before appending the EmulatorJS loader, then restores the bundle before enabling input.

**Tech Stack:** Node.js HTTP server and test runner, ESM modules, browser Fetch/Blob/IndexedDB, EmulatorJS game manager.

**Spec:** `.spec/034-global-emulator-snapshots.md`

## Global constraints

- Never run a project build.
- Identity is exactly `(profileId, gameId)` and there is one replaceable slot.
- Snapshot bytes never enter cookies or localStorage; server storage is authoritative.
- Snapshot state and its capture-time `.sav` travel together in one binary envelope.
- Every write requires the current player lease generation and an `If-Match` revision.
- Do not start EmulatorJS until ROM, normal save, and snapshot preflight settle successfully.

---

### Task 1: Snapshot envelope and durable one-slot store

**Files:**
- Create: `apps/packages/emulator-snapshot.mjs`
- Create: `apps/packages/emulator-snapshot.test.mjs`
- Create: `apps/packages/snapshot-store.mjs`
- Create: `apps/packages/snapshot-store.test.mjs`

**Interfaces:**
- `encodeSnapshotBundle({ metadata, state, save })` returns one `Uint8Array` with a four-byte JSON-header length followed by metadata, state, and save bytes.
- `decodeSnapshotBundle(bytes)` verifies lengths, types, and SHA-256 values and returns `{ metadata, state, save }`.
- `createSnapshotStore({ dataPath })` exposes `get(profileId, gameId)`, `put(profileId, gameId, bundle, expectedRevision, { fenceGeneration })`, and `advanceFence(profileId, gameId, generation)`.

- [ ] Write failing envelope tests for round-trip, truncated header/body, inconsistent declared lengths, and tampered hashes.
- [ ] Run `node --test --test-isolation=none apps/packages/emulator-snapshot.test.mjs`; confirm the missing module fails.
- [ ] Implement the fixed-header encoder/decoder with a 32 MiB state limit and 2 MiB bundled-save limit.
- [ ] Run the envelope test again and confirm it passes.
- [ ] Write failing store tests for first write, one-slot replacement, stale revision, stale fence, tampered persisted object, and interrupted replacement retaining the last published bundle.
- [ ] Run `node --test --test-isolation=none apps/packages/snapshot-store.test.mjs`; confirm failure before implementation.
- [ ] Implement serialized, bounded-lock, atomic state/save/metadata publication under `data/snapshots/<profile>/<game>`.
- [ ] Run both package tests and confirm they pass.

### Task 2: Lease-protected backend snapshot resource

**Files:**
- Modify: `apps/backend/server.mjs`
- Modify: `apps/backend/test/server.test.mjs`
- Modify: `apps/packages/game-catalog-contract.mjs`
- Modify: `apps/packages/game-catalog-contract.test.mjs`

**Interfaces:**
- Launch descriptors add `snapshotUrl`, `romSha256`, and a stable `runtimeId`.
- `GET /api/profiles/:profileId/games/:gameId/snapshot` returns the encoded bundle or `404`.
- `PUT` at the same URL accepts `application/vnd.emulator-hub.snapshot` and `If-Match`, requires the current lease, and returns `{ revision, sha256, saveSha256 }`.

- [ ] Add failing server tests for 404 absence, profile/game ownership, lease-header enforcement, create/read/replace, ETag, stale revision, stale lease, malformed envelope, and mismatched descriptor compatibility.
- [ ] Run the selected backend test names with `node --test --test-isolation=none apps/backend/test/server.test.mjs`; confirm each new assertion fails before routes exist.
- [ ] Wire `snapshotStore` into server configuration, route parsing, binary-body limit, GET/PUT handling, descriptor fields, and lease-acquisition fence advancement.
- [ ] Extend catalog/descriptor tests with the three new descriptor fields and run backend plus catalog tests.

### Task 3: Browser snapshot client and atomic preflight

**Files:**
- Modify: `apps/packages/hub-client.js`
- Modify: `apps/packages/hub-client.test.mjs`
- Create: `apps/packages/emulator-preflight.mjs`
- Create: `apps/packages/emulator-preflight.test.mjs`

**Interfaces:**
- `getEmulatorSnapshot(url, lease)` returns `null` for 404 or a decoded bundle with revision.
- `putEmulatorSnapshot(url, bundle, revision, lease)` sends the envelope with its media type and optimistic precondition.
- `createEmulatorPreflight({ fetchRom, fetchSave, fetchSnapshot, verifyRom })` returns the settled `{ romBytes, save, snapshot }` only after parallel fetch and validation.

- [ ] Add failing client tests for headers, 404-to-null, ETag parsing, and envelope upload.
- [ ] Run the focused client test and confirm failure before helpers exist.
- [ ] Add the helpers using the shared envelope codec; confirm client tests pass.
- [ ] Add failing preflight tests for parallel resource start, ROM hash mismatch, normal-save 404, snapshot 404, snapshot mismatch, and a transport failure blocking completion.
- [ ] Run the preflight test, implement only the coordinator required by those tests, and rerun it green.

### Task 4: Player state lifecycle and controls

**Files:**
- Modify: `apps/frontend/src/player.js`
- Modify: `apps/frontend/src/main.jsx`
- Modify: `apps/frontend/mobile-player-save-sync.test.mjs`
- Create: `apps/frontend/global-emulator-snapshot.test.mjs`

**Interfaces:**
- `window.emulatorHubSaveSnapshot()` captures/flushed-save/synchronizes/puts one snapshot and exposes success or failure to the parent.
- `window.emulatorHubLoadSnapshot()` reapplies the validated preloaded bundle or reports no snapshot.
- The parent routes existing Save state and Load state controls through those functions/messages without adding new controls.

- [ ] Write failing player source-contract tests proving preflight precedes loader injection, `EJS_gameUrl` is a blob URL, snapshot save flushes normal save before `getState`, and snapshot restore writes its bundled save before `loadState`.
- [ ] Run the focused frontend test and confirm failure against the in-memory-only `savedState` path.
- [ ] Replace the transient snapshot path with the client/preflight helpers; retain object URLs until iframe cleanup; initialize EmulatorJS only after preflight; restore compatible snapshots before input and save polling.
- [ ] Add parent/iframe contract tests for global save/load dispatch, no file picker/download, no cookie/localStorage storage, lease-loss cancellation, and no-snapshot feedback.
- [ ] Run all focused frontend snapshot and existing player save tests under `node --test --test-isolation=none`.

### Task 5: Contract completion and verification

**Files:**
- Modify: `.spec/034-global-emulator-snapshots.md` only when implementation evidence changes the contract.
- Modify: `apps/backend/README.md` with the new resource and one-slot behavior.

- [ ] Run package snapshot, store, client, preflight, backend, and frontend snapshot/player tests together using `node --test --test-isolation=none`.
- [ ] Run `git diff --check` and inspect the final changed-file list; leave unrelated working-tree changes untouched.
- [ ] Re-read every Spec 034 acceptance item against the implementation and record any evidence-driven wording change in the spec.
