---
title: Current snapshot system audit
date: 2026-09-24
tags: [spec, audit, snapshots, recovery, frontend, backend]
status: snapshot-types-architecture-proposed
---

# Spec 058 — Current snapshot system audit

## Purpose and scope

The audit sections record the implementation before the first fix on 2026-09-24; the final section records what changed. They describe the EmulatorJS runtime snapshot, local runtime recovery, their restore prompts, and the canonical battery save they interact with. The Pokémon Hub also calls its placement documents "snapshots"; those are identified separately below because they are not EmulatorJS states and never produce a game-state restore prompt. This audited baseline takes precedence over older intended behavior in Specs 034, 036, 044, 049, and 054.

## Three artifacts

| Artifact | Owner/key | Contents | Creation | Restore or use |
| --- | --- | --- | --- | --- |
| Remote runtime snapshot | Backend file store, currently one slot per `(profileId, gameId)` | EmulatorJS `getState()` bytes (nonempty, at most 32 MiB), core, ROM hash, runtime ID, optional patch hash, associated canonical `saveRevision`, state hash, revision and fence generation | Every 15 s, manual **Salvar estado**, and close when state remains useful | Current automatic/manual writes share one slot. The proposed typed design separates user saves from cloud recovery. |
| Local recovery | Browser IndexedDB `emulator-hub-local-recovery/bundles`, one record per `(profileId, gameId)` | Copied state bytes (nonempty, at most 32 MiB), core, ROM hash, runtime ID, optional patch hash, reason | Immediately after game start, then every 2.5 s | Surviving record is offered when that profile is selected; accepted state goes to `loadState()` after a new lease and compatibility check. |
| Canonical battery save | Backend save store, same profile/game identity but independent revision | Game `.sav` bytes | EmulatorJS save events/polling and final close flush, with hash deduplication | Loaded into EmulatorJS only when no runtime state was accepted; `FS.writeFile()` then `loadSaveFiles()`. |

Sources: `apps/frontend/src/player.js`, `apps/frontend/src/main.jsx`, `apps/packages/cloud-save-sync.mjs`, `apps/packages/local-runtime-recovery-store.mjs`, `apps/packages/snapshot-store.mjs`.

## Remote snapshot: capture and persistence

1. The parent acquires a player lease before creating the iframe. The backend verifies the game, profile, ROM and optional patch, assigns a lease generation, advances any existing save/snapshot fences, and returns `snapshotUrl` in the launch descriptor (`server.mjs:1619–1644`).
2. The iframe loads the canonical save, remote snapshot, ROM and optional patch concurrently before EmulatorJS starts (`player.js:478–530`). `getEmulatorSnapshot()` uses a lease-authenticated, uncached GET. HTTP 404 becomes `null`; other non-2xx responses, a missing numeric ETag, or an invalid envelope reject startup (`hub-client.js:367–376`).
3. A capture calls `gameManager.getState()`, copies its bytes, and sends only runtime state plus identity and the synchronizer's last acknowledged save revision. It does not read or upload `.sav` bytes (`player.js:349–368`). The 15 s timer is installed after `EJS_onGameStart`; a manual Save state message invokes the same capture. Concurrent capture requests reuse `snapshotCapture`; interval/manual errors are swallowed. Successful PUT updates the iframe's `snapshotRevision` and in-memory `savedSnapshot` (`player.js:448–450, 627`).
4. The client envelope is 4-byte header length + JSON metadata + state bytes; encode checks nonempty state up to 32 MiB, metadata, and SHA-256. Decode checks header/length/hash and accepts a legacy save tail only after validating its hash, but returns state only. `hub-client.js:378–390` uses `If-Match: *` for an empty slot or the quoted snapshot revision for replacement.
5. Backend GET/PUT require the current player lease, device cookie/session and generation. Missing game/profile returns 404; bad lease returns 410. PUT also requires the snapshot content type, bounded body, valid envelope, `If-Match`, verified launch identity and optional patch (`server.mjs:1161–1195`). The file store serializes operations by slot, uses a lock and atomic file replacement, rejects stale snapshot revisions or fence generations, and retains one state file plus metadata (`snapshot-store.mjs`). Snapshot `revision` is its own optimistic version; `saveRevision` is the associated canonical save version.
6. Normal close stops timers and save polling, drains pending save work, reads/queues final save bytes, waits for an in-flight snapshot, then captures final state. The parent clears local recovery and releases the lease. On release, the backend reads save and snapshot; it deletes the snapshot only if `snapshot.saveRevision < (save.revision ?? 0)`. Equal or greater values remain. The comparison is **on release**, not on snapshot GET or launch (`player.js:371–384`, `main.jsx:659–681`, `server.mjs:1650–1660`).

## Why the remote snapshot is offered

The frontend offers it only if GET returned a snapshot and its metadata exactly matches selected `profileId`, `gameId`, core, ROM SHA-256, runtime ID, and applied `patchSha256` (`player.js:528–530`). The match is strict, including both sides having no patch hash. An incompatible snapshot logs a warning and is not offered; its revision is still retained so a subsequent PUT can replace the slot. No snapshot (404) means no prompt. An HTTP/decoding error is a launch error, not a silent "no snapshot" case. The backend does not choose whether to prompt; it authenticates and serves the stored slot.

The restore request is emitted only after `EJS_onGameStart`, via same-origin `postMessage` to the parent. The parent identifies the originating iframe and verifies session, game and profile; the dialog is rendered in that emulator cell. The answer returns with request ID and those identities. The iframe rejects mismatched answers and resolves unanswered requests as `false` after 30 s (`player.js:114–126, 402–411`, `main.jsx:131–145, 304–329, 806–818`, `snapshot-restore-routing.mjs`).

Accepting calls `loadState()` and skips canonical `.sav` restore. Declining or timing out calls `restart()` followed by canonical `.sav` restore, if one exists. Declining does not directly delete the remote snapshot; a later capture may overwrite it and normal lease release may delete it under the revision rule. Manual **Carregar estado** is different: it loads `savedSnapshot` without compatibility recheck or confirmation, and silently does nothing if that in-memory slot is absent (`player.js:386–393, 452–455`). The header actions broadcast to all active player iframes (`main.jsx:1114–1119`), while launch prompts are per iframe.

## Why local recovery is offered

Each active player writes the latest state to a dedicated IndexedDB record immediately after startup and every 2.5 s. Concurrent captures coalesce; absence of a manager/state or lost lease skips capture. A normal close explicitly deletes the record before lease release, and `pagehide` attempts best-effort deletion. On lease heartbeat failure, the player stops synchronization, preserves the record, marks it `runtime-break`, and tells the parent the lease is lost (`player.js:84–96, 183–204, 628–629`, `main.jsx:659–681`).

When a user next selects the same game/profile, the parent calls `localRecoveryStore.get()`. Any surviving record produces a scoped local prompt after acquiring a new lease; `runtime-break` gets the confirmed-interruption text, while an `active` survivor gets possible-recovery text. There is no parent-side compatibility check before showing it (`main.jsx:766–818`). The iframe re-reads and checks core, ROM, runtime and patch against the new launch when restoration is selected. If the selected candidate is absent or incompatible at that point, it is not loaded (`player.js:483–490, 604–618`). A startup URL flag for direct local restore exists and revalidates the same fields, but the current `launchWithProfile()` passes `false` and uses the prompt path.

Accepting local recovery loads state only; declining clears its record. A timeout resolves as decline and likewise clears it. The code then asks about a compatible remote snapshot **even if local recovery was selected**. If both are accepted, local state wins, but the user receives both prompts. If neither runtime state is loaded, the player restarts the core and restores the canonical `.sav` (`player.js:600–624`). A prior `active` record is not explicitly rewritten as `possible-recovery`; that classification is expressed only by the prompt copy.

## Decision and condition matrix

| Case | Current result |
| --- | --- |
| No remote snapshot; no local record | No prompt; restart core and restore canonical `.sav` if present. |
| Remote snapshot compatible; no local record | Remote prompt; accept loads state, decline/timeout uses canonical `.sav`. |
| Remote snapshot incompatible with selected launch | Warning, no remote prompt; normal `.sav` path unless local recovery is selected. |
| Remote snapshot GET/decoding fails, including corrupt persisted bytes | Startup fails before a restore decision; backend 404 alone means absent. |
| Local record survives an unclean exit | Local possible-recovery prompt, then remote prompt if one is compatible. |
| Lease heartbeat fails with a captured local record | Record marked `runtime-break`; next selection gets interruption prompt. No captured record means no local prompt. |
| Local restore selected, record disappears or is incompatible on iframe re-read | No local state loaded; remote prompt may still be offered; otherwise canonical `.sav` path. |
| Local restore and remote restore both accepted | Two prompts; local state wins. |
| Restore answer absent or has wrong request/session/game/profile | Ignored; after 30 s request resolves to decline. |
| Snapshot state loaded | Canonical `.sav` is not restored at startup. Later save events and final close flush may still update it. |
| Manual Save state / Load state | Save captures remotely; Load replays the iframe's current `savedSnapshot` without a dialog. Both header controls broadcast to all active instances. |
| Normal close succeeds | Final save and state captured, local record cleared, remote slot deleted only when its associated save revision is older. |
| Save/capture/release fails during close | Close task fails and remains retryable in parent coordinator; successful local clear and lease release are downstream of successful flush. |
| Save advances and lease ends abnormally | Release reconciliation may not run; older remote snapshot can remain and is not filtered by save revision at startup. |

## Observed gaps and limits

1. **Patch identity is lost in backend storage.** The PUT handler verifies `patchSha256`, and the wire format accepts it, but `snapshot-store.mjs:94–102` constructs persisted metadata without that field. GET therefore serves a snapshot with no patch hash. A snapshot captured under a successfully applied patch becomes incompatible at the next patched launch and is not offered. This is a code-path finding; no patch-specific round-trip test was found.
2. **No startup save-revision comparison.** The compatibility expression in `player.js:528–530` omits `saveRevision`. A snapshot older than the canonical save is removed on a successful normal lease release, but can still be offered after an abnormal end that skipped release. This is a gap between the release-only safeguard and launch behavior.
3. **Double prompt.** `player.js:602–619` asks about remote state even after local state was accepted; the second answer cannot change which state loads. The selected remote state is effectively ignored when local state exists.
4. **Local prompt can precede compatibility filtering.** The parent offers any stored record for the selected key. The iframe checks compatibility later, so selecting Restore can yield the normal save path without an explanation if the record no longer matches.
5. **Manual Load state has no prompt and is global in multi-instance view.** The parent broadcasts the command, so every active iframe with `savedSnapshot` loads its own last fetched/captured state. This differs from scoped startup prompts.
6. **Capture/recovery failures are not surfaced consistently.** Periodic and manual remote capture errors are swallowed; local periodic capture is fire-and-forget. Normal close propagates errors through its retry UI. These statements describe error presentation, not evidence of successful persistence in a physical browser.

## Pokémon Hub terminology boundary

Pokémon Hub placement snapshots are canonical data documents and session commands in `apps/packages/pokemon-hub-*` and `/api/profiles/:profileId/pokemon-hub/.../snapshots`. They synchronize source/Hub positions, validate revisions and ownership, and can return authoritative corrections. They do **not** contain EmulatorJS CPU/memory state or trigger the `SnapshotRestorePrompt`. Their contract is in Specs 023–030. The player snapshot endpoint is the distinct `/api/profiles/:profileId/games/:gameId/snapshot` route.

## Evidence and verification boundary

The relevant existing tests are `apps/packages/emulator-snapshot.test.mjs`, `snapshot-store.test.mjs`, `emulator-snapshot-restore.test.mjs`, `local-runtime-recovery-store.test.mjs`, `snapshot-restore-routing.test.mjs`, `apps/frontend/mobile-player-save-sync.test.mjs`, `snapshot-restore-prompt.test.mjs`, `local-runtime-recovery.test.mjs`, and the snapshot HTTP cases in `apps/backend/test/server.test.mjs`. This audit traces current code and tests; it does not claim real-browser, cross-device, or physical-phone validation.

---

# Save-then-close snapshot offer Implementation Plan

> **For agentic workers:** Implement this plan task by task in the existing workspace. The user forbids project builds unless explicitly requested. This plan is written in this same spec at the user's request.

**Goal:** After a confirmed in-game save followed promptly by a normal close without further game input, reopen from the canonical `.sav` without showing a remote snapshot restore prompt, while retaining the snapshot bytes as a manual fallback.

**Architecture:** A shared pure policy tracks input sequence, the observation and successful acknowledgment of a live battery-save change, manual Save state intent, and a short close window. Snapshot metadata gains `promptOnLaunch`, defaulting to `true` for legacy records. The close-time snapshot PUT records the policy result after the final save flush; a suppressed snapshot remains stored and lease-fenced. Reopening a suppressed snapshot restores the canonical `.sav`, and automatic captures keep suppression until input or another confirmed save changes the baseline.

**Tech stack:** React parent/iframe, shared JavaScript packages, Node backend file store, existing lease and `If-Match` contracts, Node test runner.

**Spec:** This file, especially the current-state inventory and condition matrix above.

## Global constraints

- Do not run project builds.
- No new UI control, page, preference, dependency, or Pokémon Hub snapshot change.
- The canonical `.sav` and snapshot state remain separate; accepting a state still does not restore `.sav` bytes.
- Preserve one backend snapshot slot per profile/game, current lease fencing, optimistic snapshot revision, and local recovery behavior.
- Suppression changes only the *automatic offer*. GET and manual Load state can still access the retained bytes.
- Ten seconds is a fixed initial heuristic from live save observation to close, not a claim that the game has semantically finished saving. Ambiguity favors prompting.

## Contract and state machine

`promptOnLaunch` is an optional boolean in the snapshot envelope and persisted metadata. Missing means `true`; malformed non-boolean values are rejected. A false value may be accepted only with a current canonical save whose revision equals the snapshot's `saveRevision`. The backend retains the field on PUT and GET; it does not use it to skip hash, launch compatibility, lease, or revision checks. The frontend checks compatibility first, then prompts only when `promptOnLaunch !== false`. Manual Load state remains available from `savedSnapshot`.

The policy maintains a monotonically increasing `inputSequence`, a `latestCheckpoint` (`observedAt`, `inputSequence`, `revision`), a `manualStateSaveAfterCheckpoint` flag, and an optional `suppressedLaunchSaveRevision`. `beginLiveSave()` captures time and input sequence *when the changed save bytes are observed*; `confirmLiveSave(token, revision)` installs the checkpoint only after `syncBytes()` returns `true` and the new backend revision is known. An unchanged-byte poll, failed validation/upload, or final close read creates no checkpoint. Taking the sequence before awaiting upload prevents input during that await from disappearing. A later successful save supersedes the earlier checkpoint and clears the old suppressed-launch baseline.

`shouldPromptAtClose(currentRevision)` returns false only when a live checkpoint has that revision, close is no more than 10,000 ms after observation, no input occurred after observation, and no manual Save state occurred after it. A suppressed launch that restored the canonical save also returns false until actual game input, manual Save state, an explicit runtime restore, or a change from its baseline save revision occurs. The 10,000 ms limit applies to the first save-then-close decision, not to this carried-forward no-play state. Every other case returns true: no save, long delay, gameplay input, manual Save state, revision change, restore of any runtime state, uncertain input coverage, or failed save. There is no semantic comparison of EmulatorJS state bytes or frame count: frames can advance while idle and different games persist progress differently.

On a suppressed launch, periodic remote captures are skipped until actual game input, manual Save state, explicit runtime restore, or another confirmed save; the local 2.5 s recovery capture continues. This avoids recreating a restore prompt solely because the player was reopened and left idle. The final close retains state bytes as a manual fallback; unattended game progress without input is a documented heuristic limit. The final close performs one lease-protected snapshot PUT with the policy's `promptOnLaunch` value; it never omits the save flush. If that PUT fails, the close remains retryable under the existing coordinator rather than silently carrying a stale offer flag.

The integration should follow this ordering (illustrative interface, not a new endpoint):

```js
const policy = createSnapshotOfferPolicy({ now, closeWindowMs: 10_000, suppressedLaunchSaveRevision })
// In the live saveSaveFiles observer, before awaiting network work:
const token = policy.beginLiveSave()
if (await queueCloudSave(bytes)) policy.confirmLiveSave(token, cloudSaveSynchronizer.getRevision())
// In the normal close path, after the final save flush and in-flight capture:
await saveEmulatorState({ promptOnLaunch: policy.shouldPromptAtClose(cloudSaveSynchronizer.getRevision()) })
// A final getSaveFile() read never calls beginLiveSave().
```

## File map

| File | Planned responsibility |
| --- | --- |
| `apps/packages/snapshot-offer-policy.mjs` (new) and `.test.mjs` (new) | Pure clock/input/save-ack/close decision state machine; no DOM or network. |
| `apps/packages/emulator-snapshot.mjs` and `.test.mjs` | Encode/decode optional `promptOnLaunch`; legacy default and invalid-type tests. |
| `apps/packages/snapshot-store.mjs` and `.test.mjs` | Persist and read the flag without changing bytes, revision, locking, or fences. |
| `apps/backend/server.mjs` and `apps/backend/test/server.test.mjs` | Verify false flag against current canonical save revision, round-trip it, and preserve release reconciliation. |
| `apps/frontend/src/player.js` | Observe actual game input, live save acknowledgments, manual Save state, launch and close decisions; send the flag on snapshot PUT. |
| `apps/frontend/mobile-player-save-sync.test.mjs` | Exercise the integration branches and verify no close-time save omission. |
| `apps/frontend/src/main.jsx` | No behavior change expected; the existing prompt renders only when the iframe requests it. |

## Review focus

1. Input arriving while an upload is pending must invalidate a checkpoint even when the upload later succeeds (Task 1).
2. A periodic poll that reads identical `.sav` bytes must not be mistaken for a new manual save (Task 1).
3. A suppressed snapshot reopened on another device must avoid the prompt while preserving manual Load state (Tasks 2–4).
4. A suppressed launch must not produce an offered snapshot again merely because the 15 s timer fires before any gameplay (Task 4).
5. A final close flush that first discovers changed save bytes must not manufacture a live-save checkpoint and hide progress (Task 4).

### Task 1: Pure offer policy

**Files:** Create `apps/packages/snapshot-offer-policy.mjs` and `apps/packages/snapshot-offer-policy.test.mjs`.

**Interface:** `createSnapshotOfferPolicy({ now = () => Date.now(), closeWindowMs = 10_000, suppressedLaunchSaveRevision = null })` returns `recordInput()`, `beginLiveSave() -> token`, `confirmLiveSave(token, revision)`, `recordManualStateSave()`, `recordSaveUncertainty()`, `recordRuntimeRestore()`, `shouldCapturePeriodic() -> boolean`, and `shouldPromptAtClose(revision) -> boolean`. Tokens contain observed time and sequence, are single-use, and cannot confirm a different or older revision over a newer confirmed checkpoint. A suppressed launch starts in no-play state at construction and leaves that state on input, manual Save state, failed live save, runtime restore, or a new confirmed save.

- [ ] Write tests with an injected clock for immediate save/close, 10,000 ms boundary, later input, pending-upload input, late acknowledgment, two saves finishing in order, failed/unchanged save (no confirmation), manual Save state, runtime restore, suppressed-launch timer, changed baseline revision, and periodic-capture reenablement.
- [ ] Run `rtk node --test apps/packages/snapshot-offer-policy.test.mjs`; verify the new tests fail before implementation.
- [ ] Implement the policy without reading DOM, using `inputSequence` and save-observation tokens. `shouldPromptAtClose()` must fail toward `true` for invalid revision or clock state. `shouldCapturePeriodic()` is false only for an untouched suppressed launch.
- [ ] Rerun the same test command and confirm every case passes. Review that no `getFrameNum()` or snapshot-byte comparison is used.

### Task 2: Snapshot wire and store metadata

**Files:** Modify `apps/packages/emulator-snapshot.mjs`, `apps/packages/emulator-snapshot.test.mjs`, `apps/packages/snapshot-store.mjs`, and `apps/packages/snapshot-store.test.mjs`.

**Interface:** `metadata.promptOnLaunch?: boolean` on the existing envelope. `decodeSnapshotBundle()` and `snapshotStore.get()` return `promptOnLaunch: true` for legacy snapshots. `snapshotStore.put()` stores the supplied boolean; when missing it stores `true`.

- [ ] Add failing tests for `false` through encode/decode/store/get, omitted legacy field becoming `true`, malformed flag rejection, and replacement from false to true while snapshot revision/fence rules still apply.
- [ ] Run `rtk node --test apps/packages/emulator-snapshot.test.mjs apps/packages/snapshot-store.test.mjs`; verify the new cases fail.
- [ ] Update envelope metadata validation and `snapshot-store` validation/normalization; include the boolean in the store's allowlisted metadata. Do not change state bytes, SHA-256, maximum sizes, legacy save-tail handling, or revision generation.
- [ ] Rerun both test files and confirm the new and existing cases pass.

### Task 3: Backend authority and cross-device round trip

**Files:** Modify `apps/backend/server.mjs` and `apps/backend/test/server.test.mjs`.

**Interface:** Existing snapshot GET/PUT remains; add lease-protected DELETE with `If-Match` snapshot revision and current lease generation. Legacy PUT with `promptOnLaunch: false` still requires an equal canonical save revision. Release still deletes snapshots whose save revision is older than canonical.

- [ ] Add an HTTP test that writes a canonical save, writes a matching suppressed snapshot, releases the lease, reacquires from a fresh session/device, GETs it, verifies state bytes and `promptOnLaunch: false`, and confirms the save bytes were untouched.
- [ ] Add HTTP cases for absent/mismatched canonical save, invalid flag, legacy true, optimistic revision conflict, and a newer canonical save deleting an older suppressed snapshot at release. Run `rtk node --test apps/backend/test/server.test.mjs` and observe the new cases fail first.
- [ ] Implement the revision equality check in `handleSnapshot()` before `snapshotStore.put()`; preserve 410 for invalid lease and 412 for stale `If-Match`. Use the existing state-only GET path for the round trip.
- [ ] Rerun `rtk node --test apps/backend/test/server.test.mjs` and confirm the existing snapshot/save HTTP contract remains green.

### Task 4: Player integration and close ordering

**Files:** Modify `apps/frontend/src/player.js` and `apps/frontend/mobile-player-save-sync.test.mjs`; change `apps/frontend/src/main.jsx` only if an existing event hook cannot relay an actual input transition.

**Interface:** When the policy classifies a just-saved, untouched session as redundant, close deletes the remote snapshot using its revision and lease fence instead of writing final state. Manual Save state and useful remote recovery remain retained. A restored local or remote runtime state calls `recordRuntimeRestore()` so close cannot misclassify it as an unchanged canonical-save session.

- [ ] Add focused tests for: confirmed live save then immediate close with no input writes `promptOnLaunch: false`; input or manual Save state after observation writes true; a save upload failure/unchanged poll does not suppress; final close read alone does not suppress; suppressed launch makes no prompt and still restores `.sav`; manual Load remains possible; periodic capture skips during an untouched suppressed launch, then resumes after input or manual Save state; close waits for in-flight capture/save before its final PUT.
- [ ] Run `rtk node --test apps/frontend/mobile-player-save-sync.test.mjs`; verify new cases fail. Prefer a small injected player-policy harness for behavioral assertions over additional source-text regexes.
- [ ] Instantiate the shared policy after initial save/snapshot loading, passing the current canonical save revision only when a compatible suppressed snapshot will follow the canonical-save path. Count trusted `keydown` and `pointerdown` on the iframe game surface after game start, and count newly pressed gamepad bindings when `gamepadInput.update()` receives a changed binding set; avoid counting repeated 16 ms polls. Count unknown input conservatively. On `saveSaveFiles`, capture a token before calling `queueCloudSave()` and confirm it only when that call resolves `true`, using `cloudSaveSynchronizer.getRevision()`. Do not create a token for the final `getSaveFile()` close read.
- [ ] On snapshot GET, retain `savedSnapshot` but request the cloud prompt only when compatible and `metadata.promptOnLaunch !== false`; seed suppressed-launch policy only when the canonical-save path is chosen. Manual Save state marks the policy before invoking capture and always writes an offered snapshot. A manual Load state or accepted restore invalidates suppression. At close, stop timers, drain and flush saves exactly as today, await in-flight capture, then write the final snapshot with `shouldPromptAtClose(getRevision())`.
- [ ] Rerun focused frontend and package tests. Inspect one actual browser session for save → immediate close → reopen without prompt, and save → play → close → reopen with prompt; report browser/device scope separately. No project build.

## Completion gate

- [x] Run the focused package, frontend, and backend test commands above after integration; record counts and failures.
- [x] Run `git diff --check`, inspect full `git status` and diff, and ensure the existing uncommitted Spec 058 audit/README edits are handled intentionally rather than overwritten.
- [x] Confirm canonical `.sav` bytes and revisions are unchanged by snapshot GET/PUT, and local recovery/lease-release behavior remains covered.
- [x] Do not claim the heuristic proves that a player did not play; document that a save event is byte-change evidence, and uncertainty keeps the prompt.

## Initial implementation — superseded by discard behavior

The preceding audit records the behavior before this change; the implementation below supersedes its launch-offer description. The remote snapshot now carries `promptOnLaunch`, defaulting to `true` for legacy bundles and stored records. The backend accepts `false` only when the bundle's `saveRevision` equals the existing canonical `.sav` revision. Snapshot bytes remain available for manual **Carregar estado**, and the normal close still uploads the final `.sav` and state. The frontend skips the launch prompt for a compatible suppressed snapshot, restores the canonical `.sav`, and avoids periodic remote captures while that session has no new input. Local recovery continues independently.

The player records a live save checkpoint only when a changed `.sav` upload is acknowledged. It timestamps observation before the asynchronous upload and records input, manual state-save, and uncertain-save sequence numbers at that point. A later input or manual Save state, including one during the upload, makes the close snapshot promptable. Close within 10 seconds of the acknowledged live save with no later input writes `promptOnLaunch: false`; final close-time `.sav` reads do not create checkpoints. An untouched suppressed launch can close again without reintroducing an offer. Failed validation or upload invalidates that quiet baseline and any earlier checkpoint; an identical-byte poll does not. Any runtime-state restore, changed canonical revision, missing save, or uncertain observation preserves the prompt. This is a conservative input/save heuristic, not proof of zero game progress.

Verification: 30 focused package/frontend tests and 59 backend tests pass, covering policy timing and races, metadata round trips and legacy defaults, backend revision authority and a new lease, and the player wiring. A live browser/device save-close-reopen cycle remains to be checked. The project build was not run, as instructed. The repository-wide Node test run passed 497 of 504 tests, skipped 2, and exposed five existing unrelated assertions against unchanged UI or preexisting player syntax assumptions in a VM harness; those do not exercise this new behavior.

## Corrected behavior: delete redundant runtime snapshots

The automatic-save case is a destructive discard, not a hidden or unoffered snapshot. If a confirmed live `.sav` save is followed by close within 10 seconds with no subsequent gameplay input, manual **Salvar estado**, or runtime restore, the player drains save work and any in-flight capture, then deletes the current remote snapshot with a lease-protected, revision- and fence-checked DELETE. It does not upload another snapshot on that close. The state is removed from the backend slot, so a later launch cannot restore it or load it through **Carregar estado**. The canonical `.sav` flush remains first and is not deleted.

All other cases preserve runtime state: gameplay or a manual state save after the `.sav` save, an uncertain/failed save, a close outside the 10-second window, or a session that only loaded a remote snapshot without making a new live save. Manual Save state therefore stays available, as does runtime recovery from another device unless the current session itself produces the redundant-save condition. Legacy bundles carrying `promptOnLaunch: false` are deleted on launch only when compatible and tied to the current canonical save revision; if deletion fails, the snapshot remains offered for recovery.

The previous verification counts apply to the superseded marker-based behavior. The corrected deletion path has not yet been tested in a browser or through the project test suite. Project builds remain prohibited unless explicitly requested.

## Architecture proposal: typed restore candidates with provenance

### Goal and current gap

The restore experience must tell the user what state is available, why it exists, when it was captured, and whether the game's own save indicates newer progress. Today the backend has one remote snapshot slot per profile/game. Automatic 15-second captures and the user's **Salvar estado** overwrite the same slot; metadata does not say which action produced it. Local recovery is a separate IndexedDB record, but only a confirmed lease loss changes its reason to `runtime-break`; a surviving `active` record is described as possible recovery in UI copy. The modal receives only `kind`, session/profile/game, and optional local reason. It receives no capture time or remote snapshot details. The backend already stores remote `createdAt`, but the frontend does not present it.

The system therefore has three restore purposes, though only two runtime-state stores:

| Type | Purpose and writer | Storage and retention | User-facing explanation |
| --- | --- | --- | --- |
| `user-state` | Explicit **Salvar estado** action | Separate remote slot per profile/game; retained until replaced by another manual save or explicit deletion | “Estado salvo por você”; show capture time. **Carregar estado** targets this type only. |
| `cloud-recovery` | Periodic and useful close-time runtime capture, including recovery fetched by another browser/device | Separate remote slot per profile/game, shared across installations; latest successful recovery replaces the previous recovery. The 10-second save-then-close rule deletes only this type when proven redundant. | “Recuperação automática”; show whether it came from this installation, another installation, or unknown origin, why it exists, and when it was captured. |
| `local-recovery` | Frequent local capture and recovery after an abnormal interruption | IndexedDB on the current browser installation; cleared after normal close or explicit dismissal, retained after interruption | “Recuperação local”; explain `runtime-break` or possible unclean close and show local capture time. |

The canonical `.sav` remains a distinct fourth artifact, not a runtime snapshot. Pokémon Hub placement snapshots also remain unrelated.

### Shared candidate contract

The iframe owns state bytes; the parent modal receives metadata only. Add a shared summary contract in `apps/packages/`:

```ts
type RestoreCandidateKind = 'user-state' | 'cloud-recovery' | 'local-recovery'
type CaptureClock = 'server' | 'browser'
type GameTimeKind = 'wall-clock' | 'playtime-counter' | 'save-sequence'

type RestoreCandidateSummary = {
  candidateId: string
  kind: RestoreCandidateKind
  reasonCode: string
  capturedAt: string                 // ISO-8601 instant
  captureClock: CaptureClock
  origin: 'this-installation' | 'other-installation' | 'unknown'
  saveRevision?: number
  currentSaveRevision?: number
  gameTime?: { value: string | number; kind: GameTimeKind; adapterId: string }
}
```

`capturedAt` is required for every candidate. Remote types use backend-generated UTC time; local recovery uses the time recorded by the browser and labels it as local-clock time. `gameTime` is optional and must preserve the underlying meaning. Only a verified absolute in-game wall-clock save timestamp may be shown as a date/time or compared as one. A playtime counter or rotating-save sequence is shown with that label and is never converted to a calendar time. The current Gen III adapter exposes `saveIndex`, a sequence used to choose the newest valid save copy; it does not currently expose a wall-clock last-save time.

For snapshot-vs-save freshness, compare the snapshot's `saveRevision` with the current canonical save revision. If the canonical revision advanced after the snapshot, show “O save do jogo foi atualizado depois deste estado.” Do not call that revision a timestamp. Sort remote candidates by server `capturedAt`. Show local capture time with its browser-clock source; do not assert cross-device ordering between server and browser clocks. Display a verified internal game time separately; it does not replace capture time or revision checks.

Use an opaque per-installation UUID stored with browser metadata to label a remote candidate as this or another installation. It is presentation provenance, not authentication or a device name. If unavailable after storage reset, show “origem desconhecida.” Do not expose state bytes or the raw UUID in the parent UI.

### Capture, retention, and restore behavior

- Manual **Salvar estado** writes only the `user-state` slot with reason `user-request`. Periodic capture cannot overwrite it.
- The 15-second timer writes only the `cloud-recovery` slot with reason `periodic-recovery`. A useful close capture uses `session-close`.
- The confirmed-save/no-play policy applies only to `cloud-recovery`. When it qualifies, delete that candidate; never delete `user-state` or `local-recovery` through this path.
- Local recovery continues every 2.5 seconds. Lease loss persists `runtime-break`; a surviving `active` record after an unclean page exit is presented as `possible-recovery`. Normal close and explicit dismissal clear it.
- The parent combines available summaries into one chooser per player session. For several candidates, show a selectable card for each with type, reason, origin, capture time, and save-revision relationship. The user restores the selected candidate or continues from the canonical `.sav`. This replaces today's sequential local then remote prompts.
- The iframe retains candidate state bytes and resolves the opaque `candidateId` only within that iframe. The parent sends the selected ID or `continue` to the requesting session. Recheck compatibility immediately before `loadState()`.
- The user may delete an individual candidate from the chooser before restoring or continuing. Deletion is candidate-scoped, requires an explicit confirmation, and never deletes the canonical `.sav` or a sibling candidate. For a remote candidate, delete only its typed slot and require the candidate revision/ETag plus the current lease fence; for local recovery, delete only that IndexedDB record after rechecking its candidate ID and generation. A stale/replaced candidate must not cause its replacement to be deleted.
- Remove a candidate from the chooser and refresh **Carregar estado** availability only after storage confirms deletion. On failure or revision conflict, keep the candidate visible, refresh its metadata if possible, and explain that it could not be deleted. Bind the delete command and result to session, game, profile, candidate ID, revision/generation and request ID.
- **Carregar estado** loads only `user-state`; it does not silently load the latest automatic recovery. Disable the action when no compatible user-state candidate exists. Startup recovery remains in the chooser.

### Persistence and migration

Extend remote slot identity from `(profileId, gameId)` to `(profileId, gameId, kind)`, with remote kinds `user-state` and `cloud-recovery`. Keep ETags, revisions, save revisions, and lease fences independent per kind. Add a kind-specific snapshot URL or query parameter and reject unknown kinds. Preserve a legacy route during migration, mapping the existing untyped slot to `cloud-recovery`: old periodic, close, and manual captures share the slot and cannot be reliably separated. Preserve existing bytes, revision, server creation time, save revision, and compatibility metadata. Do not infer that an old snapshot was user-requested.

Add `reasonCode`, `originInstallationId`, and authoritative `capturedAt` to new remote metadata. Stamp capture time on the backend when state is accepted, not from an untrusted client clock. Persist and verify `patchSha256` so compatibility remains complete. Add capture time and reason to local records; present legacy `active` records as `possible-recovery` without rewriting their capture history.

### Internal save-time extraction

Add an optional save-adapter capability such as `readSaveMetadata(bytes, layout)`. It returns verified semantic metadata and returns no internal time when unsupported. The frontend and backend use the same package contract. The first slice must verify the actual timestamp semantics of one supported format using an authoritative format description or fixture before displaying an in-game wall-clock value. If no supported format embeds an absolute last-save time, ship capture-time and revision comparison only. A parse failure never rejects, modifies, or blocks canonical `.sav` validation or upload.

### Restore chooser contents

For every candidate, show its type, why it exists, origin, capture time with timezone and clock source, and whether its associated canonical save revision is older/newer/equal. Show an internal game save time only when an adapter verifies its semantics, with a distinct “hora interna do jogo” label. Keep the same card when only one candidate exists. Offer **Restaurar este estado** and **Excluir estado** per candidate, plus **Continuar pelo save do jogo**. Deletion asks for confirmation naming the candidate type; successful deletion removes only that card. On deletion failure/conflict, keep the card and report the outcome rather than silently treating it as gone. Show no modal when there are no candidates. Bind restore, delete and their answers to session, game, profile and request ID. In multi-instance view, restoration, deletion and manual load remain scoped to the selected iframe.

### Implementation plan

#### Task 1: Shared candidate contract and save metadata adapter

**Files:** Create `apps/packages/restore-candidate.mjs`; extend `apps/packages/pokemon-gen3-adapter.mjs` only after timestamp semantics are verified; add package tests beside these modules.

- [ ] Define and validate candidate kinds, reason codes, capture-time source, origin values, and game-time semantic kinds.
- [ ] Add optional `readSaveMetadata(saveBytes, layout)` to the adapter contract. Unsupported formats return no internal time. Preserve Gen III `saveIndex` as a sequence and reject it as a wall-clock timestamp.
- [ ] Verify one supported format's last-save timestamp using an authoritative format description or deterministic fixture; if it has no absolute timestamp, document that the modal uses capture time and save revision for that format.
- [ ] Test malformed values, unknown adapters, no-time fallback and byte immutability during inspection.

#### Task 2: Separate remote slots and migrate existing data

**Files:** Modify `apps/packages/snapshot-store.mjs`, `apps/packages/hub-client.js`, `apps/backend/server.mjs`, backend/store tests, and launch descriptor generation where necessary.

- [ ] Add remote kind to store keys, metadata validation, GET/PUT/DELETE and ETags. Keep `user-state` and `cloud-recovery` revisions and fences independent.
- [ ] On first typed access, migrate an old untyped slot atomically to `cloud-recovery`, preserving its bytes, revision, creation time and save revision. Never infer `user-state` from legacy data.
- [ ] Stamp remote capture time on the backend; persist reason, origin installation ID, save revision and patch identity. Require the active lease and generation for writes and deletes.
- [ ] Test legacy migration, isolated replacement/deletion, stale ETag, lease/fence rejection, and unchanged canonical `.sav` bytes.

#### Task 3: Local recovery metadata and candidate collection

**Files:** Modify `apps/packages/local-runtime-recovery-store.mjs`, `apps/frontend/src/player.js`, `apps/packages/snapshot-restore-routing.mjs`, and related tests.

- [ ] Store local `capturedAt` and stable reason metadata on each recovery write. Persist `runtime-break` on lease loss; map a surviving `active` record to `possible-recovery` for display.
- [ ] Give each browser installation an opaque stable ID in browser metadata; compare it with remote `originInstallationId` only to produce this/other/unknown labels.
- [ ] In the iframe, collect compatible user-state, cloud-recovery and local-recovery summaries. Keep all bytes in the iframe and post only metadata summaries to the parent.
- [ ] Test clock source labels, missing installation IDs, local reason mapping, incompatible candidates and absence of state bytes in messages.

#### Task 4: Selection protocol and typed player actions

**Files:** Modify `apps/frontend/src/player.js`, `apps/packages/hub-client.js`, `apps/packages/snapshot-restore-routing.mjs`, and player protocol tests.

- [ ] Route explicit **Salvar estado** only to `user-state`; route 15-second and useful close captures only to `cloud-recovery`.
- [ ] Apply the existing save-then-close redundant-state deletion only to `cloud-recovery`; prove `user-state` and local recovery remain untouched.
- [ ] Replace boolean restore answers with `{ candidateId }` or `continue`, scoped to the requesting session/game/profile. Revalidate the candidate ID and compatibility before `loadState()`.
- [ ] Add a candidate-scoped delete command and response. Remote deletion must target the typed slot and require the displayed revision/ETag plus active lease fence; local deletion must revalidate candidate ID/generation and remove only its IndexedDB record. Clear in-memory candidate bytes only after the backing store confirms deletion.
- [ ] Make **Carregar estado** select only the compatible `user-state` candidate and report its availability to the parent. Target one iframe rather than broadcasting to automatic recoveries.
- [ ] Test coexistence of both remote types, candidate replacement during restore/delete, invalid/stale IDs, two simultaneous sessions and manual save/load isolation. Verify deleting either local or remote candidates leaves sibling candidates and `.sav` untouched.

#### Task 5: Informative single restore chooser

**Files:** Modify `SnapshotRestorePrompt` and player header controls in `apps/frontend/src/main.jsx`; update existing frontend UI tests and only the styles needed by this chooser.

- [ ] Render one chooser per player with candidate cards for type, reason, origin, capture time/timezone, verified internal game time and save-revision relationship.
- [ ] Sort remote candidates by server capture time; label browser-clock local time and avoid claiming cross-clock order when synchronization is unknown.
- [ ] Offer restore per candidate and **Continuar pelo save do jogo**. Keep identical metadata layout when there is a single candidate.
- [ ] Offer **Excluir estado** per candidate with explicit confirmation. On success remove only that candidate and recompute manual **Carregar estado** availability; on failure/conflict keep it visible and report the failure.
- [ ] Verify local and remote candidates no longer produce sequential prompts; metadata crosses to the parent but state bytes and installation UUID do not.

#### Task 6: Migration and end-to-end verification

**Files:** Update this spec with verified per-format time capabilities and migration outcome.

- [ ] Verify legacy remote data migrates as cloud recovery, legacy local records are explained conservatively, and candidate inspection leaves `.sav` bytes/revision unchanged.
- [ ] Verify manual user-state survives periodic recovery writes and the save-then-close discard rule.
- [ ] Verify recovery from another installation shows its source and server capture time; show a newer canonical save through revision comparison.
- [ ] Verify redundant cloud recovery is deleted without deleting user-state or local recovery.
- [ ] Verify user deletion works for local and remote candidates, is isolated to the selected candidate, and cannot delete a replacement after candidate revision/generation changes.
- [ ] Run package, backend, and frontend tests and exercise manual save/load, local interruption recovery, other-installation recovery and save-then-close in a browser. Do not run project builds unless explicitly requested.

### Review focus

1. A manual user-state and cloud recovery coexist; automatic capture and redundant deletion touch only cloud recovery.
2. Browser time is ahead/behind backend UTC; the chooser labels clock source and avoids false cross-installation ordering.
3. A save contains elapsed playtime or a rotating sequence but no last-save wall clock; metadata preserves its kind and never presents it as a calendar date.
4. A candidate is replaced while the chooser is open; revision and candidate ID checks prevent restoring or deleting the replacement accidentally.
5. Local and remote candidates coexist; one scoped chooser replaces the double-prompt flow and state bytes remain inside the iframe.
6. Deleting a candidate updates the chooser and manual-load availability only after persistence succeeds; sibling candidates and canonical `.sav` remain intact.
