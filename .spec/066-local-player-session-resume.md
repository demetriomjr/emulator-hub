# Spec 066 — Local player session resume with durable lease history

## Goal

If a browser suspends or loses a running player wrapper, offer one local, time-limited, best-effort way to reopen its complete set of emulators at their latest successfully captured states. A normal user close does not offer resume. If recovery fails, discard the attempt and let the user open games normally. The backend remains authoritative for leases, ROMs, patches, profiles, and canonical in-game saves.

## Current system and gaps

- The parent owns an ordered list of up to six `activeSessions`. Each iframe has a random `sessionId` and a backend player lease, renewed every five seconds with a 45-second expiry.
- The active Redis game-save lease contains the session ID, `generation`, and `expiresAt`; release deletes it. It has no immutable start time or durable history of every acquisition. `leaseActive` exposes only current occupancy.
- Save and snapshot fence generations can survive in their own stored records, but a profile with no save or remote snapshot cannot prove that another lease was acquired and expired. A normal acquire also allows another session from the same device to replace a live one.
- Each iframe already captures a state-only local recovery record in IndexedDB every ten seconds. That single per-profile record is user-visible in the existing restore chooser and lacks a canonical save revision binding. It cannot serve as the complete hidden wrapper checkpoint without a separate namespace and manifest.
- Browser minimization or termination can stop JavaScript before an exit handler runs. Checkpoints must exist before suspension; `visibilitychange`/`pagehide` may only make a best-effort extra capture.

## Durable backend contract

1. Define a monotonically increasing `sessionRevision` per `(gameId, profileId)` in durable Redis storage, independent of the live lease key, canonical save, and snapshot slots. Every **new** successful player-session acquisition increments it exactly once, including a profile without a `.sav`. A heartbeat or idempotent reacquisition of the same live `sessionId` does not increment it. Revisions never reset when a live lease expires or is released.
2. Give each acquisition immutable server-authored `startedAt` and its `sessionRevision`. Keep `generation` as the existing write fence; do not rename it or use it as the new durable revision.
3. Keep backend session history for each game/profile: session ID, revision, startedAt, and the observed terminal status/time when explicit release or a later acquisition detects expiry. Do not append a record per heartbeat or expose the device cookie. Preserve the history independently of the live lease; the durable revision is the source of truth even if history is later archived.
4. Return `sessionRevision` and `startedAt` from the existing lease-acquire response. Preserve ROM, optional IPS, profile, save, snapshot, and fence behavior.
5. Resume acquisition accepts an optional expected `sessionRevision`. Atomically reject unless that expected revision is still current **and no active player or Pokémon Hub save lease exists**, including one from the same browser/device. On success, issue a new session ID/lease and increment the revision. The ordinary acquisition path retains its current behavior.
6. Do not expose another device's session ID or history through the profile catalog. The resume decision is made by the atomic acquire operation, not by a preceding advisory read.

## Local checkpoint contract

1. IndexedDB stores a dedicated private checkpoint namespace, separate from the existing local-recovery candidate and user-managed snapshots. Each wrapper manifest is stored under its own `bundleId`, never under a shared `current` key. A manifest contains version, capture/expiry times, ordered game/profile identities, old `sessionRevision` values, each checkpoint reference, acknowledged canonical save revision and compatible ROM/core/runtime/patch identities, global runtime settings needed to reconstruct the wrapper, and the focused session. Do not store ROMs or a replacement canonical `.sav` in this bundle.
2. Each running iframe captures state-only bytes while its lease is valid and reports checkpoint metadata to its parent. The parent publishes a manifest only after all currently open sessions have a valid checkpoint. Use candidate identity/version checks so a concurrent capture, profile close, or new wrapper cannot mix checkpoints from different wrapper membership. A failed capture preserves the last complete bundle; it does not publish a partial one.
3. A successful normal close clears only its wrapper's `bundleId`; another tab's checkpoint remains intact. Adding or removing a member rotates the active wrapper ID and clears its previous bundle. Losing a lease, page suspension, tab termination, or network failure preserves the latest complete bundle. Bundles are not exposed in the ordinary snapshot chooser.
4. The offer expires 30 minutes after the most recent complete checkpoint. Delete expired or malformed local records when next read; browser storage eviction can remove the offer at any time. An interrupted session can be resumed only in the same browser installation/origin holding the bundle.
5. One card labeled **Continuar sessão anterior** appears before Pokémon Hub for each unexpired bundle while the user is not already in a player wrapper. Each card identifies its profiles. Clicking one loads that exact `bundleId`, validates its profiles, and acquires new leases with expected revisions before any snapshot is applied. If any member fails, release leases acquired in that attempt, do not load any checkpoint, and explain that the old session cannot be resumed. A later ordinary game launch is still available.
6. After all leases are acquired, follow the existing launch path for verified ROM, optional IPS, canonical `.sav`, and save synchronization. Each iframe loads only its own matching checkpoint state, then injects the independently fetched canonical `.sav` using the existing state/save isolation rules. A missing/incompatible checkpoint or changed canonical save revision invalidates the full resume attempt. Do not upload a `.sav` merely because a state was restored.
7. Preserve member order, count, relevant header preferences, focused member, and Odds Manipulator enabled/count state. Fullscreen may require a new user gesture and is not a prerequisite for recovery. The resume card is consumed only after all members reach ready state; if launch fails, release new leases and discard the unusable offer without silently starting partial emulators.

## Integrity and limits

- A browser cannot guarantee capture at its final frame. The promise is the most recent **completed** checkpoint, with its capture time visible in the offer or error copy.
- Known pending or failed `.sav` synchronization pauses private checkpoint publication. At resume time, a changed backend save revision invalidates the checkpoint. The existing save polling runs at a minimum interval of three seconds and uploads changed bytes; the optional resume feature does not need to prove that every in-memory save byte was observed before each state capture. Canonical `.sav` and runtime state remain independent.
- A different player lease, Pokémon Hub write, save revision, ROM/patch/runtime change, deleted profile, expired bundle, or occupied lease blocks the stale checkpoint. There is no overwrite/merge path.
- Unknown backend state, network outage, storage quota failure, or ambiguous validation fails closed for resume; normal launch remains available.

## Verification

- Package tests: durable revision across release/expiry and save-less profiles; same-session renew; same-device replacement; atomic stale/occupied conditional acquire; history start/end/expiry; Redis and memory transition parity.
- Backend HTTP tests: acquire response, conditional resume success/conflict, unchanged normal launch/save/heartbeat, no history leakage in profile listing.
- Frontend tests: multi-instance manifest completeness, 30-minute expiry, failed capture, normal close, lease loss, all-or-nothing reacquisition, checkpoint/save compatibility, hidden automatic restore, and original instance order/settings.
- When a local runtime test or deployment is requested, validate the Lua transition on real Redis and exercise five/six live emulator instances in a browser: minimize beyond lease expiry, reopen from a completed checkpoint, verify an intervening lease blocks resume, and check the canonical `.sav` after a reset. These are integration checks for that stage, not requirements to make this optional recovery flawless. No build is authorized by this spec.

## Implementation plan and progress

Keep the existing active lease and save fence. Add a persistent per-game/profile acquisition revision and session history in the shared lease coordinator. Store state-only iframe checkpoints and a complete wrapper manifest in IndexedDB. Resume through conditional lease acquisitions and the existing verified launch and canonical-save path. Do not weaken ROM/profile/lease validation or make optional IPS required.

### 1. Durable lease revision and history

Files: `apps/packages/game-save-lease-coordinator.mjs`, its tests, `apps/backend/server.mjs`, backend HTTP tests, and `apps/packages/hub-client.js`.

- [x] Test acquire, renew, release, expiry, legacy leases, stale expected revision, live-lease conflict, and history records.
- [x] Add the persistent revision key and session history; update them atomically on a new acquisition while retaining the existing `generation` write fence.
- [x] Reject a conditional acquisition without advancing the revision or changing the active lease when its expected revision is stale or a lease is active.
- [x] Return revision and start time from lease acquisition; provide a narrow history read outside the ordinary profile catalog.
- [x] Run package and backend HTTP tests against the memory transition.
- [ ] At the local runtime test or deployment stage, run the Lua transition against real Redis. No local Redis service is available in this checkout.

### 2. Private wrapper checkpoint

Files: `apps/packages/local-player-session-store.mjs`, its tests, and `apps/packages/player-origin-storage-bridge.mjs`.

- [x] Test the bounded bundle schema, expiry, complete-manifest publication, cleanup, and identity/version checks.
- [x] Store state-only checkpoints in a dedicated IndexedDB namespace, bound to the canonical save revision and launch identity.
- [x] Key every wrapper by its own `bundleId`; list valid bundles and delete or expire only the selected bundle so separate tabs cannot overwrite each other's checkpoints.
- [x] Scope private checkpoint reads to the matching iframe, bundle, and original session; validate capture messages against the current iframe and session.

### 3. Capture and resume

Files: `apps/frontend/src/player.js`, `apps/frontend/src/main.jsx`, focused frontend tests, and narrow shared packages.

- [x] Test complete and partial manifests, expiry, close versus lease loss, and the card position before Pokémon Hub.
- [x] Reuse the existing `getState()` cadence and publish a wrapper bundle only when every current member has a fresh capture.
- [x] Test conditional reacquisition, rollback, and checkpoint/save/ROM compatibility.
- [x] Load each private checkpoint in its iframe without the ordinary snapshot chooser, then restore the separate canonical `.sav`.
- [x] Restore emulator order, focus, and runtime controls; consume the offer only when every member reaches ready state.

### 4. Verification still required

- [x] Run package, backend, and frontend tests, lint, and `git diff --check` without a build.
- [x] Review stale-write, save-separation, and all-or-nothing failure paths.
- [ ] At the local runtime test or deployment stage, exercise actual EmulatorJS state/save behavior, browser suspension, and an intervening lease from another device.

## Review status (2026-09-25)

- The memory-backed lease transition and HTTP contract tests confirm revision increments, release/expiry history, active-lease rejection, and stale expected-revision rejection. The player-lease facade maps active save ownership to `PLAYER_LEASE_HELD` for retry while the old lease remains active.
- Package tests confirm complete local manifests, expiry, identity checks, scoped private checkpoint reads, and rollback of earlier lease acquisitions when a later member fails. Frontend tests exercise state-first/canonical-save-second restore and suppression of state-derived save uploads.
- Review found and closed two optional-feature isolation gaps: missing IndexedDB no longer prevents Hub startup, and an exception during `.sav` validation marks private checkpoint capture uncertain.
- The three-second save polling and change detection make an unnoticed in-game save a narrow timing window. If the optional checkpoint cannot be used, the user opens the games normally; no extra per-checkpoint proof of current `.sav` bytes is required.
- If save/snapshot fence advancement fails after lease creation, the resume attempt fails and the local checkpoint can be discarded. The user can launch normally after the lease expires. This optional recovery does not require rollback of the session revision.
- The Lua transition on real Redis and five/six-emulator browser suspension are integration checks for the local runtime test or deployment stage. Unit and HTTP tests do not substitute for those checks, but their absence at this development stage is not itself a feature defect.
- Review found that the original shared `current` checkpoint key let one tab overwrite or erase another's bundle. Checkpoints now use the wrapper `bundleId` as the IndexedDB key, each resume card selects a specific bundle, and cleanup is scoped to that key. Expiration during an attempted resume simply fails that optional recovery and needs no special continuation path.
- Different tabs normally use different profiles because active leases block the picker, but that is not a correctness guarantee: an ordinary same-device acquisition can replace a live lease. The local `bundleId` prevents the tabs from sharing a checkpoint key; the backend `sessionRevision` and conditional resume acquisition reject a bundle after a newer acquisition for any of its profiles, even if the intervening lease has already expired. An occupied lease also blocks resume regardless of device. No separate per-tab backend identity is needed for this optional recovery.
- The local store already serializes its writes and removals; a focused delayed-write test confirms that normal-close cleanup cannot finish before an earlier checkpoint write and leave the old bundle behind. At the runtime-test stage, observe IndexedDB cost with five/six checkpoint states and real browser suspension. Recovery failure may discard only the affected bundle; it must not affect a separate tab's bundle or the ordinary launch path.
