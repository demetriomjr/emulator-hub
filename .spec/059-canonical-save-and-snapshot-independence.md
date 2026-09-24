---
title: Canonical game save and snapshot independence
date: 2026-09-24
tags: [spec, snapshots, recovery, save-integrity]
status: implemented-awaiting-browser-validation
---

# 059 — Canonical game save and snapshot independence

## Permanent invariant

The canonical in-game `.sav` is the separately persisted save created by the game's own Save command. It is the authoritative saved progress for the selected game/profile. A runtime snapshot is a recoverable emulator state; it is never a replacement for that `.sav`. Choosing, loading, or discarding a snapshot must not change the canonical `.sav` stored by the backend.

Manual **Carregar estado** changes only runtime state. The canonical `.sav` must remain byte-for-byte the save that was loaded when the emulator opened; only a later save performed inside the game may change it. Snapshot creation, restoration and deletion are not evidence of an in-game save and must not trigger a canonical save upload.

The canonical `.sav` is fetched independently of all local, cloud-recovery, and user-state snapshots. After the player chooses a startup state, the iframe applies that runtime state if selected, then injects the already fetched canonical `.sav` bytes into EmulatorJS and invokes `loadSaveFiles()` before enabling gameplay, save synchronization, or automatic captures. This injection is a read of the persisted save into the emulator, not an update to the backend `.sav`. Continue starts from the canonical `.sav`. Loading a snapshot must leave the in-game save available inside the emulator so the player can later abandon the runtime state and return to their saved game through the game's normal reset/load path. A state load does not itself issue a canonical save `PUT`.

When no canonical `.sav` exists for a new profile, play may start without one. When a snapshot's acknowledged `saveRevision` proves that a canonical `.sav` should exist but the save fetch returns none, the player is warned. A failed save fetch, save injection, chosen snapshot load, or user-initiated manual Save/Load state is reported in that player's UI. Automatic recovery cleanup failures are logged and do not create player-facing alerts or block a successfully applied state and save.

## Current implementation boundary

- `apps/packages/cloud-save-sync.mjs` owns canonical `.sav` fetch, emulator injection, independent revision tracking, and the runtime-state save-byte guard. Snapshot selection does not call its upload path. Bytes flushed from a restored runtime state are excluded from periodic and close-time uploads; a later distinct game-save payload remains eligible for synchronization.
- `apps/frontend/src/player.js` applies the selected startup runtime state, then always invokes the canonical `.sav` restore before enabling synchronization and captures. Manual **Carregar estado** applies only runtime state and records the resulting emulator save bytes immediately as a baseline to exclude from upload; it does not fetch, inject or upload the canonical backend `.sav`. If the chosen startup state cannot be applied, the player is warned and the existing canonical-save startup path runs. If canonical save injection throws at startup, startup remains unready and the player is warned.
- In-game save observation calls `queueCloudSave()`; snapshot capture is invoked independently by its periodic timer or explicit **Salvar estado** command. An in-game save does not call snapshot capture. The reverse path also stays separate: creating a snapshot reads `getState()` and does not upload a `.sav`.
- `apps/frontend/src/main.jsx` renders errors only for scoped player actions and expected canonical-save failures. The player can still close the emulator; automatic deletion errors remain internal.
- A snapshot recovery may change live runtime memory. Later explicit in-game saving may legitimately create a new canonical `.sav`; that is a new user save, not an effect of choosing the snapshot.

## Verification

Frontend unit/integration tests must prove that local and remote snapshot selection calls canonical `.sav` restore afterward; Continue also restores it; failure to discard local recovery does not block play; state/save/manual-action failures reach the correct player; automatic discard failures do not. They must also prove that bytes resulting from manual `loadState()` are ignored on subsequent observations and at close, while distinct game-save bytes can upload; an in-game save must not invoke snapshot capture. Browser validation of the pinned EmulatorJS core must confirm that an in-game reset after snapshot restoration sees the latest canonical `.sav` and that restoring a snapshot alone does not upload stale save bytes. Browser end-to-end validation belongs to the user.

## Deferred decision

The revision-control response-loss scenario from the branch review is intentionally deferred. A stale `If-Match` is rejected by the backend; client reconciliation after an ambiguous remote delete response will be reviewed separately.

## Final code review, 2026-09-24

The reviewed write paths are independent: the in-game save observer and close-time save flush feed the canonical save synchronizer; the local and cloud recovery timers capture `getState()` only; **Salvar estado** writes only the separate `user-state` slot. Neither a snapshot PUT/DELETE nor `loadState()` directly sends a save PUT. Startup loads the chosen runtime state first and then injects the separately fetched canonical `.sav`. With no canonical `.sav`, the startup path now records the restored runtime's save bytes as excluded from later synchronization, matching the manual state-load guard. Frontend tests cover this path and the backend tests verify that typed snapshot writes and deletion leave the save endpoint independent.

Recovery slots are bounded to one local record, one cloud recovery and one user state per game/profile. The local and cloud captures overwrite their respective slots, and backend revisions/fences reject stale writers and conditional deletes. Manual state is replaced only by another explicit manual save or deleted by the user. A normal close creates no snapshot; it finishes save synchronization, then clears the automatic local and cloud recoveries. Closing before a restore choice preserves the existing candidates. An explicit choice deletes the prior local record immediately as applicable and schedules the prior cloud record for conditional deletion ten seconds after runtime readiness. A selected cloud state that fails to load is reported and is not queued for that delayed deletion. Automatic capture and synchronization start only after the chooser and canonical save load complete.

Automatic cleanup and local capture failures no longer turn a successful save flush into a failed close: the iframe logs cloud delete and local capture failures, the hub logs local delete failures, and the backend releases the lease even when its final cloud cleanup fails. Canonical save upload failures remain visible and block successful close. User-initiated state load/save failures and missing or unloadable canonical saves remain visible to the owning player. Failed automatic cleanup can leave a stale recovery candidate for a later launch; it is never presented as a failed game save.

Verification in this review: the focused frontend/package snapshot and save run passed 146/146 tests; backend HTTP tests passed 63/63. The complete frontend test run passed 81/85; four existing source-shape tests outside this snapshot/save scope still fail (`catalog-card-actions`, `fast-forward-startup`, `mobile-profile-picker`, `mobile-standalone`). JavaScript syntax checks and `git diff --check` passed. No project build or browser end-to-end test was run.

**Remaining runtime limit:** the pinned EmulatorJS integration exposes save bytes through `saveSaveFiles` polling and `getSaveFile`, without an explicit, game-verified Save command event in this path. The synchronizer excludes bytes matching a loaded runtime state and uploads a later distinct payload. A genuine later in-game save whose bytes are exactly equal to that excluded payload remains indistinguishable by these bytes alone and can be skipped. Conversely, browser validation is still needed to confirm that this core's `loadSaveFiles()` and save event ordering preserve the canonical `.sav` during real state restore, reset and in-game save. This limitation is documented rather than treated as a proven guarantee.

## Snapshot and save observability

The frontend emits structured `snapshot-flow` events through the existing `/api/debug/client-events` endpoint even when broad browser diagnostics are disabled. The backend writes them to the container log as `snapshot.front.<event>` with the original severity. The diagnostic store keeps its bounded recent-event backlog. The player and hub also write the same record to their browser consoles. Delivery is best effort: a disconnected browser or abrupt termination can lose a frontend event, while backend HTTP decision/failure logs remain available independently.

Each event carries the session, game and profile identities plus only relevant kind, candidate ID, snapshot/save revision, phase, reason, status and error code. The endpoint allowlists these fields; runtime state bytes, `.sav` bytes, installation IDs and arbitrary nested data are not logged. No successful 2.5-second local capture, 15-second cloud capture or unchanged save poll creates an event. A persistent restored-state save-byte exclusion is logged once per player session. Repeated automatic frontend failures are emitted at most once per matching event/kind/phase/reason/code every 60 seconds; the default backend logger applies the same limit to recurring cloud PUT/lease rejections. A user-initiated failure is logged each time.

| Boundary | Decision and failure events |
| --- | --- |
| Startup chooser | Candidates offered, explicit Restore/Continue, applied or failed state load, canonical `.sav` loaded/missing, incompatible candidate, startup failure, lost lease. |
| User state | Explicit save/load outcome, and selected-candidate delete outcome with kind and revision. |
| Automatic recovery | Delayed cloud deletion scheduled/completed/failed; local deletion completed/changed/failed; recurring capture failures only. |
| Normal or unresolved close | Whether recovery was preserved, completed normal close, cleanup failures and backend release cleanup decision. |
| Backend snapshot HTTP | Candidate availability, manual state persistence, explicit deletion, invalid request/revision/lease/metadata, and storage errors. Routine successful cloud PUTs and missing GETs are silent. |
| Canonical save | Existing save pipeline keeps accepted writes and failures in container logs. Frontend suppresses unchanged-poll chatter and forwards significant sync/restore failures. Snapshot events never imply a `.sav` write. |

These event names are diagnostic contracts for this branch, not user-facing messages. Logging must never change whether a save, snapshot capture, restore, deletion or close succeeds; frontend forwarding errors are swallowed.

Pre-integration verification: the full frontend suite passed 93/93 tests after updating four stale source-shape assertions; the packages suite passed 388/390 tests with two environment-dependent symbolic-link tests skipped; and the backend suite passed 80/80. The package gamepad player-boot harness was updated for the current player initialization. Syntax checks for the edited JavaScript modules and `git diff --check` passed. Browser end-to-end validation remains with the user.
