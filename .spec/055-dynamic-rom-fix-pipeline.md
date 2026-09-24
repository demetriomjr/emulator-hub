---
title: Dynamic verified ROM fix pipeline
date: 2026-09-22
tags: [spec, emulator, rom, gba, mgba, security, integrity]
status: proposed
---

# Spec 055 — Dynamic verified ROM fix pipeline

## Goal

Allow the player to apply a verified Emerald RNG fix to an exact original ROM
in memory immediately before EmulatorJS starts, without maintaining manually
generated IPS files for every ROM revision.

The ROM hash is the identity. A hash-specific profile supplies the exact
addresses, offsets, expected bytes, and replacement bytes required for that
revision. Unknown or modified ROMs are never patched.

This specification covers the patch pipeline and its safety boundary. It does
not choose the final Emerald RNG algorithm or fill the currently unknown ROM
offsets.

## Current startup requirements

The current player startup is:

1. player.js reads id, profileId, sessionId, and leaseGeneration from the URL.
2. It requires an active backend player lease.
3. It calls getPlayerLeaseLaunch and getControlProfile.
4. The backend resolves the catalog entry, profile, and ROM path.
5. The backend runs verifyRom before returning a launch descriptor.
6. The browser fetches the ROM with cache: no-store.
7. The browser hashes the fetched bytes and requires equality with
   launch.romSha256.
8. The current optional IPS patch is fetched separately and verified against
   launch.patchSha256.
9. The browser creates EJS_gameUrl from a Blob URL.
10. It sets the EmulatorJS configuration and appends the pinned 4.2.3 loader.
11. EmulatorJS creates the core and starts the game.
12. EJS_onGameStart restores a compatible state or restarts the core and
    restores the battery save.

Relevant files:

- apps/frontend/src/player.js
- apps/frontend/player.html
- apps/backend/server.mjs
- apps/packages/hub-client.js
- apps/packages/game-patches.mjs
- apps/packages/pokemon-emerald-rom-addresses.json

The new pipeline must preserve lease validation, save namespace identity,
snapshot compatibility, controls, and the existing EJS_onGameStart flow.

## Non-goals

- Do not modify mGBA or EmulatorJS.
- Do not patch emulator RAM after the core starts.
- Do not patch based on filename, title, header text, or a partial signature.
- Do not accept ROM hacks, translations, randomizers, corrupted dumps, or
  unknown revisions.
- Do not use generic byte-pattern search that can silently select the wrong
  function.
- Do not generate or store an IPS file in the runtime path.
- Do not delete or rewrite the existing Python test harness or its results.
- Do not build the project unless explicitly requested.

## Terminology

| Term | Meaning |
| --- | --- |
| Original ROM hash | SHA-256 of the bytes fetched before transformation. |
| ROM profile | Trusted data entry keyed by an exact original ROM hash. |
| Fix recipe | Bounded declarative byte operations for one ROM profile. |
| Patched ROM | Private in-memory copy after the recipe succeeds. |
| Runtime fix ID | Stable version identifier for the exact recipe and algorithm. |
| ROM offset | Byte index in the file image, beginning at zero. |
| GBA address | CPU-visible address mapped to a file offset by the profile. |
| Preimage | Bytes required before a write is allowed. |
| Postimage | Bytes required after a write succeeds. |

## Trust model

The backend remains authoritative for whether a ROM is launchable and which
hash-specific fix profile is allowed. The browser is an execution environment,
not a trust boundary: a user can inspect or modify browser code and bytes.

The browser must still validate everything locally because this prevents
accidental corruption and protects the EmulatorJS instance from malformed
recipes. The browser must never select an arbitrary profile, offset, or
replacement payload from a URL parameter.

The backend may expose a fix profile only when its original ROM hash exactly
matches the verified catalog ROM. A frontend catalog is useful for
transformation but is not sufficient to authorize a backend launch.

## Profile format

apps/packages/pokemon-emerald-rom-addresses.json remains the reviewable source
of hash-specific knowledge. An entry may contain documented RAM addresses and
unresolved fields. A ROM is patchable only when its profile has a complete,
valid recipe.

Completed profiles must contain:

    hash key -> title, region, revision, sha1, sha256, romSize
    symbols -> AgbMain, RtcInit, RtcGetMinuteCount or RtcGetRawInfo, SeedRng
    romOffsets -> corresponding physical offsets and optional code cave
    ramAddresses -> gRngValue and other runtime addresses
    fix -> id, algorithm, schema version, and bounded operations

Every operation must contain:

    kind, offset, expected bytes, replacement bytes

The schema must reject malformed hashes, duplicate identities, non-integer or
out-of-range offsets, malformed byte strings, missing expected bytes, writes
outside the ROM, oversized payloads, unsupported operation kinds, and embedded
code or JavaScript.

## Recipe operation model

The first implementation supports only fixed-size write operations. Every
write has an offset, expected bytes, and replacement bytes. Replacement length
must equal expected length. This keeps the first implementation in-place and
avoids code-cave branches until the Emerald routine is fully documented.

A later recipe version may support bounded branch and payload operations, but
every resulting byte must be reviewable in the profile. No operation may
generate arbitrary machine code at runtime.

## Runtime pipeline

The pipeline runs after fetching and hashing the original ROM, but before
creating EJS_gameUrl and before appending loader.js:

1. Fetch with cache: no-store.
2. Enforce the maximum ROM size before allocating a second copy.
3. Calculate the original SHA-256.
4. Require equality with the backend launch descriptor.
5. Look up the lowercase hash in the trusted profile catalog.
6. Require the profile hash and launch descriptor hash to match.
7. Validate the complete recipe schema.
8. Preflight every operation against the original bytes.
9. Allocate a new Uint8Array of exactly the original ROM length.
10. Copy the original bytes into the new array.
11. Apply all operations to the copy.
12. Verify every postimage in the copy.
13. Calculate the patched-ROM digest for diagnostics and runtime identity.
14. Create the Blob URL only from the patched copy.
15. Do not set EJS_gamePatchUrl for this path.
16. Start EmulatorJS only after all prior steps succeed.

The original bytes must never be mutated or stored as a patched artifact.

## Atomicity and race-condition rules

The transformation is a transaction:

    preflight(original) -> copy(original) -> apply(copy) -> verify(copy) -> publish(copy)

If preflight or postimage verification fails, the copy is discarded and the
original ROM is used under optional-fix policy. No partial copy may be
published.

The implementation must:

- run preflight and writes in one synchronous JavaScript turn;
- create no EmulatorJS instance before publish;
- avoid SharedArrayBuffer;
- avoid mutating a buffer after it is passed to a Blob;
- not transfer a buffer to a worker until verification is complete;
- revoke object URLs on startup failure, close, or replacement;
- serialize repeated launches so an old launch cannot publish after a newer one.

The patch operates on the ROM file image, not emulated cartridge RAM or
executable memory. It therefore cannot race with mGBA instruction execution
when applied at this stage.

## EmulatorJS integration

The existing EmulatorJS settings remain unchanged. Only the source assigned to
EJS_gameUrl changes: it is a Blob URL made from the verified patched copy when
an applicable profile exists, otherwise a Blob URL made from the original.

The existing IPS path must not run in addition to the dynamic recipe. During
migration the launch descriptor must make the source mutually exclusive:

    dynamic fix OR legacy IPS OR no fix

If both are advertised, startup must reject the fix selection rather than
apply two transformations.

## Launch and snapshot identity

The original ROM hash remains the stable game/save identity. Applying a fix
must not create a new save namespace or strand the battery save.

Runtime state is different: a snapshot created with one fix must not load into
another fix. Snapshot and local-recovery metadata must include:

    romSha256
    runtimeId
    romFixId or null

An absent romFixId means the unpatched original runtime.

The fix ID changes whenever the algorithm, operation list, operation bytes,
runtime, or profile interpretation changes. Battery saves remain keyed by the
original game/ROM/profile identity and continue through the existing adapter.

## Backend launch contract

The backend continues verifying the original ROM immediately before returning a
launch descriptor. The descriptor may add:

    romFix: {
      id,
      profileSha256,
      mode: "dynamic"
    }

The backend must not accept arbitrary replacement bytes through query
parameters. The browser compares the selected profile against the descriptor.

If no complete profile exists for the exact ROM, the ROM remains launchable
under optional-fix policy, romFix is null, and the original starts. A future
required-fix mode may reject launch explicitly, but missing recipes must not
accidentally block normal game operation.

## Security requirements

### Input and resource limits

- Accept only the configured GBA ROM size range.
- Bound operation count and expected/replacement lengths.
- Reject overlapping operations unless explicitly supported and tested.
- Reject writes outside the ROM image.
- Reject code-cave payloads outside declared free space.

### Integrity

- Use SHA-256 as primary profile key and SHA-1 as corroboration.
- Compare fetched bytes with the backend descriptor.
- Validate all preimages before the first write.
- Validate all postimages after the final write.
- Never trust filename, title, extension, or client-provided hash.
- Never log ROM bytes, save bytes, patch payloads, or full file contents.

### Isolation

- Keep original and patched buffers local to one launch.
- Do not persist patched ROM bytes in IndexedDB, localStorage, snapshots,
  cloud saves, or backend save storage.
- Do not send ROM bytes back to the backend.
- Revoke object URLs after the player closes.
- Do not share a patched buffer between player sessions.

### Fail-closed recipe handling

Malformed profiles, hash mismatch, preimage mismatch, postimage mismatch,
unsupported operations, ambiguity, or unexpected exceptions must never produce
a partially patched ROM. The player either uses the untouched verified ROM
under optional-fix policy or shows a controlled error under required-fix policy.

## Package boundaries

apps/packages/rom-fix-registry.mjs owns profile schema validation, hash lookup,
immutable normalized profiles, and fix ID validation.

apps/packages/rom-fix-applier.mjs owns preflight, copy allocation, bounded
byte operations, postimage verification, and patched digest calculation.

apps/frontend/src/player.js owns orchestration: fetch, original-hash
validation, profile selection, applier invocation before EJS_gameUrl, and
object-URL lifecycle.

apps/backend/server.mjs owns original-ROM verification, launch policy, profile
availability, and compatibility with the existing optional IPS registry.

The registry and applier must not import browser globals and must be testable
deterministically in Node.

## Observability

Allowed diagnostic events include rom-fix.lookup, rom-fix.not-applicable,
rom-fix.preflight-rejected, rom-fix.applied, rom-fix.postimage-rejected, and
rom-fix.publish-failed.

Events may include game ID, original ROM SHA-256, fix ID, operation count, and
byte lengths. They must not include raw bytes, save data, lease tokens, or full
ROM contents.

## Test strategy

Pure package tests must cover exact lookup, unknown hash, malformed profiles,
valid copy patching, unchanged original bytes, zero writes after any preimage
mismatch, postimage rejection, bounds, overlap, size and operation validation,
deterministic patched digest, rejection of double application, isolation of
concurrent calls, and safe diagnostics.

Frontend tests must cover hash validation before lookup, patched EJS_gameUrl
creation only after verification, absence of EJS_gamePatchUrl, loader ordering,
fallback to original when optional fix is unavailable, mutual exclusion with
legacy IPS, URL revocation on failure, and snapshot fix-ID compatibility.

Backend tests must cover exact-hash profile authorization, rejection of
modified ROMs, optional fallback, protection against query-parameter recipe
forgery, and unchanged legacy IPS behavior during migration.

No test requires a project build or a live third-party service.

## Acceptance criteria

1. A known original ROM is hashed and matched before any fix operation.
2. The fix runs only on a private copy before EmulatorJS starts.
3. The original ROM bytes are never mutated.
4. No partial recipe reaches EJS_gameUrl.
5. Unknown or modified ROMs are never patched.
6. Same ROM and profile produce byte-identical output.
7. Reapplication is rejected instead of double-patching.
8. Saves remain associated with the original ROM hash.
9. Snapshots cannot cross fix versions.
10. No manual IPS artifact is required for the dynamic path.
11. Existing Python artifacts remain untouched.
12. No project build is executed for this work.

## Current implementation boundary

The current catalog profile documents the original Emerald hashes, gRngValue,
RNG constants, and a complete byte-tested experimental recipe from
test-data/create_emerald_rtc_rng_fixed.py. That recipe is explicitly marked
experimental-failed-validation because its runtime behavior did not produce a
working Emerald fix. The final recipe must not be inferred to be correct merely
because its preimages, postimages, and byte placement are known.

Implementation must not add placeholder bytes or treat null offsets as
executable instructions. The next technical task is to decide whether the
existing experimental offsets can be reused for a new recipe or whether a new
call site/code cave is required.

The generic registry and applier can be implemented against this exact
experimental profile once the product direction authorizes it, while runtime
validation remains a separate acceptance criterion.
