# Spec 053: Profile-scoped EmulatorJS save namespace

## Runtime correction — 2026-10-03

The `EJS_gameID` namespace does not isolate battery saves in EmulatorJS 4.2.3.
Battery saves use a filename derived from `EJS_gameName`, and the runtime mounts
`/data/saves` in IndexedDB independently of its cache/settings flags. A profile
without a backend save could therefore start with another profile's cached save
and upload it as its own first save.

The approved hotfix supersedes the browser-save namespace design below. Keep
the existing runtime identity for diagnostics, but mount `/data/saves` in MEMFS
only. Disable upstream automatic startup, install the mount adapter at readiness,
then start the core explicitly. The adapter must run before any persistent save
mount or read and must fail startup rather than fall back to IndexedDB.

The existing backend fetch on every launch remains authoritative. A save response
loads through the current canonical restore flow; a missing save leaves the fresh
memory filesystem empty, without creating a synthetic save. Normal in-game saves
continue through the current backend synchronization. Browser recovery snapshots
remain a separate, explicitly selected mechanism under Spec 059. This hotfix does
not delete browser data, change backend save paths, repair existing production
duplicates, commit, build, or deploy.

Regression coverage must prove that old browser saves cannot enter a new profile
or its first upload, existing backend saves still load and synchronize, identical
filenames remain isolated between instances, and incompatible/late adapter
installation never starts with persistent save storage.

Local runtime verification used the actual pinned 4.2.3 browser runtime and Ruby
in an isolated browser context. The legacy mount persisted a 128 KiB fixture;
the subsequent fresh launch mounted MEMFS, opened no `/data/saves` IndexedDB
database, and exposed no save bytes. Loading the existing fixture into MEMFS
preserved its SHA-256 exactly. Unit tests also verify that missing saves produce
no upload and that later changed in-game saves still synchronize to the backend.

## Save-facing consumer: Hoenn starter hunts — 2026-10-03

The approved extension to the existing Spec 076 hunter adds one start method,
`hoenn-starter`, with one shared Poké Ball position (1/left, 2/center, 3/right)
for all active players. The existing modal reveals a compact selector only for
this method; no three separate hunt methods or modal redesign are introduced.
An explicit Hoenn ball choice and soft reset are required. Mixed-title hunts
resolve each verified ROM through a shared game-code/strategy registry. Ruby,
Sapphire and Emerald use the bag sequence below. FireRed and LeafGreen ignore
the Hoenn ball choice and use timed A interaction with the ball directly in
front of the saved player, reading the newly obtained Bulbasaur, Charmander or
Squirtle from the player party. They repeat A only while that record is absent,
with the existing 40 ms hold and one-second spacing, bounded by the encounter
timeout. No directional input is sent to these titles. Each player reports its
verified game code during prepare; every strategy must resolve before any reset.
Future title support adds registry data/strategies below the presentation layer,
without title branches in the Hub UI or controller.

After the existing four-A save-loading sequence, open the bag with A, navigate
once from the center if needed, then press A twice to select and confirm. A
presses keep the existing 40 ms holds and at least one-second spacing. The
directional tap runs inside the iframe for at least 8 ms (40 ms divided by the
locked 5× speed), then releases as soon as the core frame counter advances.
Polling is bounded to 50 checks; a stalled core stops the hunt. The bag handles
JOY_NEW, so this single press does not repeat across frames. Input releases
locally in a finally block and is never retried blindly.
Cancellation and stale-cycle guards must prevent a delayed tap from affecting
a subsequent attempt. Starter hunting reads the selected newly created player
party record, ignores the opposing Pokémon, waits through the confirmation-to-
battle delay, and preserves existing stop/state-save behavior. It never modifies
the canonical in-game save as part of generating a new attempt. Unsupported ROMs,
wrong starter species, invalid records, and timeout stop the hunt visibly.

Deployment validation exposed an existing Docker overlayfs EXDEV error when
the sprite synchronizer renamed an asset directory inherited from an image
layer. Recreate only the generated build asset directory in the synchronization
RUN layer; prefer current seed assets over older cached copies. Sprite hash and
completeness validation still runs normally. Persistent backend data is outside
this build stage and is not affected by the build correction.

## Startup failure correction — 2026-10-03

Explicit startup exposes an ordering requirement in pinned EmulatorJS 4.2.3:
`EJS_ready` runs before `emulator.Module` exists. Its volume setter dereferences
`Module.AL` without a module guard. Applying audio mute/volume in that callback
therefore throws before the memory-save adapter can start the core. Apply audio,
fast-forward and virtual-gamepad runtime settings only in `EJS_onGameStart`.
Keep the memory filesystem installation before core startup.

A missing snapshot (HTTP 404) remains a valid absence, independent from the
canonical in-game save. Existing and fresh profiles both dismiss the loading
gate after canonical restoration finishes. Synchronous readiness errors,
asynchronous game-start failures, loader failure and initial launch failure
must replace the loading text with a visible error, fence the player from
save writes and pause any initialized runtime. A failed canonical save load
must never mark the player ready or start save polling.

Validation reproduced the original `Module.AL` exception with the pinned
runtime and the real audio helper before the correction. The full player
then passed six isolated Chromium cases: fresh/existing Ruby saves with mute
on/off at requested 5× speed, save-service failure and loader failure. Both
snapshot endpoints returned 404 in each case. Successful starts hid the gate,
used MEMFS without opening `/data/saves` IndexedDB, and preserved the existing
128 KiB save hash exactly. Failure cases displayed an error without announcing
readiness or uploading any bytes. The 62 selected startup, recovery, save and
audio tests and frontend lint passed. The frontend production build passed
before publication of the correction. Deployment must verify the served player
startup and retain a complete, independently checked save backup.

## Problem

Production logs show that the backend returns the correct save on every launch, but reopening a profile can start EmulatorJS without that profile's data. Multiple profiles of the same game currently share `window.EJS_gameID = launch.gameId`, allowing EmulatorJS local state and battery-save paths to collide across profiles and sessions.

## Requirements

1. Every player instance must use a deterministic EmulatorJS identity scoped to both the verified game and the selected profile.
2. The namespace must be stable across close and reopen, and different for every profile of the same game.
3. The remote save endpoint and backend save identity remain unchanged: `profileId + gameId` continues to be authoritative.
4. Existing remote saves must load into the new namespace without requiring migration of backend data.
5. Snapshot compatibility must continue to use the canonical backend `gameId` and `profileId`; changing the EmulatorJS identity must not invalidate valid backend snapshots.
6. Initialisation must wait for remote save restoration before the player is released to the user.
7. Save diagnostics must record the profile-scoped EmulatorJS identity and hashes before and after restoration when diagnostics are enabled.
8. Closing one player must not write or clear another profile's local EmulatorJS data.
9. Tests must cover same-game different-profile isolation, stable identity across reopen, remote save restoration, and unchanged backend save URLs.

## Design

Use a namespaced runtime identity derived from the canonical game and profile identifiers, encoded so it is safe for EmulatorJS storage keys. Keep `launch.gameId` in all backend URLs and snapshot metadata. Set `window.EJS_gameID` to the derived runtime identity before loading EmulatorJS. Await the cloud save synchronizer before starting save polling and hiding the loading gate.

## Acceptance criteria

- Two profiles of Ruby can be opened sequentially and each displays its own save after reopening.
- Reopening the same profile reuses its own EmulatorJS namespace and never reads another profile's local save.
- Production logs show the same remote save revision and hash being applied to the matching profile-scoped runtime identity.
- Existing Pokémon Hub reads remain unchanged.
- Targeted tests, frontend build, backend build, and production health checks pass.
