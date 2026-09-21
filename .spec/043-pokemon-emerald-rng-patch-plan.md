# Pokémon Emerald RNG IPS Patch Implementation Plan

**Goal:** Attach and verify the supplied IPS only for its exact original Emerald dump.

**Architecture:** A package manifest maps the trusted base-ROM SHA-256 to an immutable IPS asset and its SHA-256. The backend validates and serves that asset, then the iframe validates it and sets the documented EmulatorJS patch URL.

**Tech stack:** Node.js, native `node:test`, React iframe player, EmulatorJS 4.2.3.

**Spec:** `.spec/043-pokemon-emerald-rng-patch.md`

## Global constraints

- Associate by exact SHA-256, never filename or title.
- Keep the original ROM unchanged and do not add UI.
- Refuse a compatible launch when its required patch is unavailable or altered.
- Do not run a project build.

## Review focus

- A same-title Emerald revision must not receive the patch.
- A missing or tampered IPS must not fall back to an unpatched launch.
- Legacy snapshots without a patch hash must be rejected by a patched launch.
- The original ROM and patch must be separately hash-checked before EmulatorJS starts.
- Non-target launch descriptors must remain byte-for-byte compatible in shape.

### Task 1: Patch manifest and backend HTTP contract

**Files:** Create `apps/packages/game-patches.mjs`, `apps/packages/game-patches.test.mjs`; modify `apps/backend/server.mjs`, `apps/backend/test/server.test.mjs`; add `apps/backend/patches/pokemon-emerald-rng.ips`.

- [ ] Write failing package tests for exact SHA matching and immutable manifest cloning.
- [ ] Run `node --test apps/packages/game-patches.test.mjs` and observe the missing-module failure.
- [ ] Add the one-entry Emerald manifest and copy the supplied IPS unchanged as the backend asset.
- [ ] Write failing backend tests for descriptor fields, patch GET metadata/bytes, non-target omission, and missing/tampered asset rejection.
- [ ] Add safe patch resolution, hash verification, the GET route, catalog/launch checks, and descriptor fields.
- [ ] Run the focused package and backend tests, then `npm test` in `apps/backend`.

### Task 2: Player patch loading and state compatibility

**Files:** Modify `apps/frontend/src/player.js`, `apps/packages/emulator-snapshot.mjs`, relevant package tests, and `apps/frontend/mobile-player-save-sync.test.mjs`.

- [ ] Write failing contract tests that require optional patch fetch/hash/Blob configuration and patch-aware recovery/snapshot metadata.
- [ ] Run those tests and observe their expected failures.
- [ ] Add the minimal optional-patch fetch and validation flow, set `EJS_gamePatchUrl`, and preserve patch identity in recovery/snapshot compatibility checks.
- [ ] Run focused frontend/package tests and the backend suite; do not build.

### Task 3: Spec and operational documentation

**Files:** Modify `apps/backend/README.md`, `.spec/043-pokemon-emerald-rng-patch.md` if implementation reveals a factual correction.

- [ ] Document the exact supported hashes, automatic association rule, and that the operator only supplies the original ROM.
- [ ] Run `git diff --check` and the focused test commands.
