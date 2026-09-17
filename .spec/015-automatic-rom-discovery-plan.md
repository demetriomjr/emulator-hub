# Automatic trusted ROM discovery implementation plan

**Goal:** Automatically register trusted GB/GBC/GBA files and reject unmatched content.

**Architecture:** A shared scanner validates hash-first lookup results; a shared
atomic registry caches accepted records; the backend combines it with the legacy
overlay before all catalog-dependent routes.

**Spec:** `.spec/015-automatic-rom-discovery.md`

## Constraints

- No build; no ROM/save-byte upload; shared code stays in `apps/packages/`.
- Exact No-Intro fingerprint/platform match is mandatory; unknown/hacked input fails closed.
- Preserve legacy Emerald identity and explicit metadata.

### Task 1: Registry package

**Files:** Create `apps/packages/rom-registry.mjs`, `apps/packages/rom-registry.test.mjs`.

**Contract:** `createRomRegistry({ dataPath })` exposes async `load()` and
`replace(entries)`, returns cloned schema-v1 entries, and atomically writes only
valid data.

1. Write a failing test for missing -> persisted -> reloaded registration.
2. Run `node --test apps/packages/rom-registry.test.mjs`; confirm missing-module failure.
3. Implement schema validation, cloning, parent creation, temp write/rename.
4. Add tests for malformed JSON and invalid replacement without partial write.
5. Run the registry test green.

### Task 2: Discovery package

**Files:** Create `apps/packages/rom-discovery.mjs`, `apps/packages/rom-discovery.test.mjs`.

**Contract:** `createRomDiscovery({ lookupBatch, ...io })` exposes
`scan({ romsDirectory, cachedEntries, legacyEntries })` -> `{ accepted, rejected }`.

1. Write a failing accepted No-Intro GBA test expecting US title and HTTPS box art.
2. Run its test and confirm absent factory failure.
3. Implement safe non-recursive candidates, streamed SHA-1/MD5/SHA-256/length,
   <=100 grouping, exact result validation, metadata selection, duplicates, cache
   rehash, and legacy matching.
4. Add red cases for symlink/directory/extension/missing result/non-No-Intro/
   platform/hash mismatch/non-HTTPS art/101 values/rename/duplicate.
5. Run discovery test green.

### Task 3: Backend integration

**Files:** Modify `apps/backend/server.mjs`, `apps/backend/test/server.test.mjs`,
`apps/backend/README.md`.

**Contract:** Extend `createHubServer` with injectable registry/discovery/lookup;
one combined loader is used by list, profile, launch, save, hub, and ROM routes.

1. Add failing HTTP test: overlay Emerald + unlisted accepted FireRed appear in
   `GET /api/games`, with legacy ID retained.
2. Run the targeted test; confirm automatic behavior is absent.
3. Add abort-timed public batch adapter sending only SHA-1/MD5/size; reject
   HTTP/non-JSON/429 without a key.
4. Route all catalog consumers through the combined scan/persist loader while
   retaining safety/hash checks.
5. Add red HTTP tests for unmatched/changed invisibility, offline cached entry,
   duplicate content, profile eligibility, and HEAD/GET streaming.
6. Implement minimum code per red test; run `npm test` from `apps/backend`.
7. Update backend README to document automatic No-Intro discovery.

### Task 4: Final evidence

**Files:** Modify `.spec/README.md`; frontend only if the current API response
is proven not to render returned title/cover.

1. Run `node --test --test-isolation=none apps/packages/*.test.mjs` and backend
   `npm test`; inspect all output.
2. Scan the current five local files through the real adapter without modifying
   catalog.json; confirm registration and existing profile/ROM contracts.
3. Index Spec 015 and compare fresh evidence with every acceptance criterion.
4. State real rendered EmulatorJS confirmation as pending unless actually done.
