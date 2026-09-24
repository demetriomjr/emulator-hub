# Spec 061 — Selective closing of multiple emulators

## Goal and scope

When the player frame contains multiple running emulators, its header close button opens a centered chooser. The chooser lists every running **ROM | Perfil** with a checkbox. All rows start selected. The user can toggle individual rows or use a button at the top to select or deselect all, then confirm or cancel. Confirmation closes only the selected emulators. With one running emulator, the existing direct close flow remains.

This spec covers the requirement survey and implementation plan in this single file. No product behavior is changed by writing it.

## Current implementation

| Area | Current behavior | Consequence for this change |
| --- | --- | --- |
| Header | `apps/frontend/src/main.jsx` renders one `Fechar emulador` button that calls `closePlayer()` regardless of instance count. | The count check belongs at the close entry point. |
| Sessions | `activeSessions` is an ordered list of `{ gameId, profileId, sessionId, leaseGeneration, ... }`; it does not store the ROM title or profile name. The grid renders one keyed `.player-cell` per session. | Rows need display names associated with the session; selection must use `sessionId`, never the row index or visible text. |
| Current close | `closePlayer()` creates one task for every active session. Each task finds its iframe by the current array index, flushes odds count, asks that iframe to finish save synchronization, conditionally clears local recovery, releases its backend lease, then stops its odds sync object. | The same per-session close pipeline should serve a selected subset. Frame lookup must remain correct if the active list changes. |
| Failure UI | `createMultiSaveCloseCoordinator()` publishes per-task status and retries transient failures. `saveCloseRows` displays the existing “Salvando jogos” overlay and a retry button. `finishPlayerClose()` runs only when every task succeeds. | A partial close must remove the successfully selected sessions without closing unselected sessions. Failed selected sessions retain the existing retry path. |
| Iframe close | `apps/frontend/src/player.js` exposes `emulatorHubClose()` and handles `emulator-hub:close-player`. Before runtime readiness it preserves recovery. Once ready, it stops intervals, flushes `.sav`, waits for in-flight state work, and handles automatic recovery cleanup; it does not create a new snapshot simply because the frame was closed. | Selective close must call this existing path for each chosen iframe, preserving save and snapshot rules. |
| Focus and player state | `focusedSessionId` identifies the selected emulator; header actions fall back to the first active session. `finishPlayerClose()` empties all sessions, resets the odds manipulator and fullscreen state. | Closing some sessions must keep the wrapper, global mute/Fast Forward/odds state, and any surviving fullscreen session. Closing the last session may use full cleanup. |
| Keyboard | Outside other dialogs, Escape currently invokes `closePlayer()` when the wrapper is open and not in browser fullscreen. | The new chooser must handle Escape without accidentally starting the all-session close. |
| Gamepad | The hub polls `navigator.getGamepads()` every 16 ms even when the page is hidden, runs L2/R2 trigger actions, and broadcasts pressed bindings to every iframe. `createEmulatorGamepadInput()` terminates EmulatorJS's own polling after game start and forwards hub bindings to `gameManager.simulateInput()`. | A visual overlay does not stop controller input or trigger actions; both the parent producer and each iframe consumer need a lock. |
| Keyboard and pointer | EmulatorJS owns keyboard listeners inside each iframe. The player also records trusted keyboard/pointer input for focus and snapshot decisions. | Focus must move into the chooser, and iframe-level keyboard input must be blocked while locked. The overlays stop pointer access visually, but pointer and touch input must not reach the game behind them. |
| Pause | The player already calls `EJS_emulator.pause()` for a restore choice and `play()` afterwards. In the pinned [EmulatorJS 4.2.3 runtime](https://cdn.emulatorjs.org/4.2.3/data/src/emulator.js), these methods toggle `paused` and the game manager's main loop; neither disposes the instance. | The new lock must pause every instance, remember pre-existing pause state, and resume only instances it paused. A restore prompt's pause must remain in force. |
| Layout | `player-shell-${count}` and `player-panel-${count}` select geometry; the grid uses 1 column at count 1, 2 columns at counts 2–4, and 3 columns by 2 rows at counts 5–6. Fullscreen and narrow landscape have overrides. | After removal the count-driven classes must update without changing surviving iframe keys or `src`, so their EmulatorJS runtimes are not restarted. |
| Full-screen processing | The opaque `.save-close-overlay` is fixed, covers the viewport, and displays “Salvando jogos” plus per-task status. `renderLayer()` portals it into the fullscreen player shell when needed. | Keep this blocking overlay throughout save/retry; the game/input lock must remain active behind it. The chooser needs the same fullscreen layering treatment. |

## User-stated interaction requirements

1. Clicking the header close button with exactly one active emulator follows today's direct save-and-close flow; no chooser appears.
2. With two or more active emulators, clicking the same button opens a modal centered over the player. No emulator begins closing until confirmation.
3. One row appears per active emulator, in the same order as the player grid. Its visible label is `ROM | Perfil` (the separator is the vertical bar `|`), and its checkbox is associated with that label.
4. All rows are checked each time the modal opens. Checking or unchecking one row changes only that row.
5. A control at the top toggles the whole set: when all are selected it deselects all; otherwise it selects all. Its text describes the next action.
6. `Cancelar` dismisses the modal and leaves every emulator running. `Confirmar` starts closing only the checked sessions.

## Technical requirements inferred from the current flow

- Disable confirmation when no rows are checked, since the selected close set would be empty.
- Keep the chooser aligned with live sessions. If a session disappears while it is open, remove its row and selection; confirmation cannot act on an old session ID. A newly added session cannot be closed by a confirmation based on an older list.

## Close and lifecycle rules

- Freeze the confirmed set of `sessionId` values at confirmation, and build close tasks only for those live sessions. Keep unselected iframes mounted with their leases and per-session timers intact. They are paused and input-locked while either global close overlay is open, then become playable again after the lock ends.
- Each selected task must retain the existing odds flush, save synchronization, recovery handling, lease release, and retry behavior. The selection itself neither saves a state nor creates an automatic snapshot.
- A successful partial batch removes only the selected sessions and their session-scoped UI state: restore prompt, choice/delete timers and watchdog, action errors, user-state availability, odds references, and focus if it pointed to a removed session. If the focused session was closed, focus the first survivor.
- If a selected task fails, that session must remain available for the existing save-close retry flow; the opaque processing overlay and input lock remain until the batch reaches a terminal outcome. Previously successful tasks must not be retried. Unselected sessions must not enter the close coordinator.
- If no sessions remain after the selected batch, run full-wrapper cleanup: exit player fullscreen where possible, clear global odds manipulator state, clear the save-close overlay, and return to the hub. If one or more remain, preserve the wrapper and current global Fast Forward, mute, odds, and fullscreen state.
- Prevent duplicate confirmation or another close request while a batch is active. Escape while the chooser is open cancels that chooser; when no chooser is open, the existing Escape close intent follows the same one-versus-many decision as the header button.

## Required player lock

The lock covers **all** active emulators, including unchecked survivors, from the moment the selection modal opens until it is canceled or the selected close batch finishes. Confirmation changes the visual layer from chooser to the mandatory opaque “Salvando jogos” overlay without an unlocked frame between them. A failed save keeps both that overlay and the lock while retry remains available. Closing the last emulator ends the lock by unmounting the player. The lock is temporary runtime state, not a saved preference.

| Phase | Overlay and allowed UI | Emulator and input behavior |
| --- | --- | --- |
| Normal play | No close overlay | Existing pause states and keyboard/gamepad routing. |
| Choosing | Centered ROM/profile checkbox modal; only its select-all, row checkboxes, Confirmar, and Cancelar are interactive. | Every running emulator paused; gamepad bindings released; gamepad-trigger actions suppressed; keyboard and game input blocked. |
| Saving selected sessions | Existing opaque full-viewport save overlay with progress, and retry control only if it fails. | All sessions remain paused and input-blocked; selected sessions run the current save/lease close pipeline. No user control reaches the grid or header. |
| Canceled | Chooser removed. | Previous pause state restored per surviving session; input resumes only after the modal is gone. |
| Partial close complete | Save overlay removed; surviving grid reflows. | Surviving sessions resume only if they were running before the lock. Sessions already paused for restoration or another reason stay paused. |
| All close complete | Player unmounted; hub visible. | No player input target remains. |

### Why the overlay is insufficient today

- The parent gamepad poll deliberately runs when `document.hidden` is true, so a modal, fullscreen layer, or focus change does not stop it. While locked it must broadcast an empty binding set, release held gamepad inputs in every iframe, and **not** run L2/R2 actions such as save state, reset, or Fast Forward. A held button must not fire as a new press immediately after unlock; require a neutral/release edge before normal polling resumes.
- A focused iframe receives keyboard events in its own document. On lock, move focus into the chooser and have the player reject keyboard down/up while locked before EmulatorJS input handlers can consume them. Do not rely on the parent's `inert` attribute, CSS pointer blocking, or `document.hidden` to gate iframe input. Pointer/touch events are intercepted by the full overlay and must not update emulator focus or snapshot activity through the covered game area.
- The parent sends an explicit same-origin lock/unlock command to every iframe. The iframe stores a command received before runtime readiness, applies it at `EJS_ready` and `EJS_onGameStart`, and ignores normal gamepad messages while locked. Startup and restore-choice code must not call `play()` while the close lock is still active.
- Record each iframe's previous pause state when the lock first applies. Repeated lock messages must not replace that baseline. Unlock may call `play()` only for an iframe that the close lock itself paused and that has no other active pause reason. A failed close or still-open restore prompt cannot be resumed by the global unlock.
- If an iframe is added or replaced during a lock, it starts locked before gameplay input. If an iframe disappears because a lease is lost, remove its lock bookkeeping without resuming a dead session. Duplicate or delayed lock messages cannot reopen input while an overlay is still active.
- Keep keyboard navigation within the chooser working (Tab, Space, Enter and Escape). The lock blocks emulator input, not the modal's own controls. If the browser consumes Escape to exit fullscreen, the chooser and lock remain active until the user confirms or cancels.
- The player currently schedules periodic cloud recovery every 15 seconds and also maintains local recovery capture. Pause both **automatic snapshot capture paths** during the close lock; a paused selection screen must not generate a new recovery snapshot. Do not block in-flight `.sav` synchronization, lease heartbeat, or explicit close-time save flushing. On cancel or partial close, surviving sessions resume their ordinary cadence without a catch-up snapshot caused solely by unlock.

## Release and layout audit

1. `closePlayer()` currently addresses iframes by the `activeSessions` array index. The coordinator tasks run concurrently; indexes can cease to identify the intended iframe after selective removal or lease loss. The selected task must resolve its iframe by immutable `sessionId` at execution time and verify that the session is still live.
2. `flushPlayerSave()` first tries the same-origin `iframe.contentWindow.emulatorHubClose` function, then a `postMessage` request/reply with a 30-second timeout. The iframe close stops automatic capture/save timers, waits for pending save work, flushes the `.sav`, and handles recovery according to runtime readiness. This path precedes `releasePlayerLease()`. A timeout/retry must not unmount an iframe or release its lease before the result is known.
3. On successful lease release, remove only that selected session's React cell. React keys the cell by game/profile and does not intentionally remount surviving cells; preserve those keys and each iframe's `src`. Unmounting a selected iframe disposes its window. The current `closeEmulator()` does not explicitly stop every heartbeat, diagnostic observer, audio gesture listener, or gamepad bridge; selected-frame teardown must either stop them before removal or verify the iframe unload clears them. If a save fails, keep its iframe and heartbeat alive for retry.
4. Update the count-driven shell, panel, and grid classes from the **surviving** session count after close. Desktop transitions requiring layout checks: `6→5` remains 3×2; `5→4` becomes 2×2 and changes width/aspect ratio; `4→3` remains 2×2 with one unused cell; `3→2` becomes one 2-column row; `2→1` returns to a single cell. Repeat for fullscreen and narrow landscape, where the shell and panel have different overrides. No surviving game should reload or receive a new save/restore prompt during reflow.
5. If focus pointed to a removed session, choose a surviving session before header actions resume. Preserve current fullscreen mode for a partial close; exit it only when the wrapper becomes empty. Clear only removed sessions' restore prompts, timers, watchdog entries, action errors, and odds references. Preserve global mute, Fast Forward, trigger preferences, and odds manipulator state while survivors exist.

## Data and implementation map

1. At launch in `startPlayerWithProfile()`, retain the ROM title and profile name alongside the existing immutable session IDs. Use IDs for targeting and these names only for display. If a name is unavailable, display its corresponding ID rather than omitting a row.
2. Add chooser visibility and a selected-ID set in `apps/frontend/src/main.jsx`; derive its rows from `activeSessions`. Render the modal with the existing overlay/portal pattern and minimal matching styles in `apps/frontend/src/styles.css`.
3. Split the current `closePlayer()` entry from a `closeSessions(sessionIds)` operation. The first decides whether to show the chooser; the second builds selected tasks. Resolve each iframe by `data-session-id` when the task runs. Keep `createMultiSaveCloseCoordinator()` as the save/retry mechanism.
4. Replace the unconditional `finishPlayerClose()` after a successful batch with a selected-session completion path. It removes only completed target IDs and performs full-wrapper cleanup only when the resulting list is empty. Reconcile session-scoped maps and focus on removal.
5. Implement one lock coordinator for chooser and save overlay state in the hub, plus an iframe-side pause/input gate. Synchronize both layers before accepting chooser input, carry the lock across confirmation, preserve pre-existing pauses, and release held gamepad bindings and trigger edges.
6. Update the Escape handler and ensure the chooser stays above the player without allowing its controls to trigger emulator input. No backend contract change is expected; selected sessions still use the existing lease release endpoint.

## Verification plan

- Unit test the selection rules: initial all-selected state, individual toggle, select/deselect all, empty confirmation, cancel, and a live-session list change.
- Frontend integration tests cover one-session direct close, multiple-session modal, exact `ROM | Perfil` labels, selected-only task creation, saved/failed/retry outcomes, survivor focus, odds/fullscreen preservation, and final-wrapper cleanup.
- Test that task-to-iframe mapping uses `sessionId` after an earlier row disappears; test Escape cancellation and repeated confirmation protection.
- Test the lock across normal play → chooser → cancel, chooser → save → partial close, and save failure → retry. Include a frame already paused for snapshot restoration, an iframe still starting, a held gamepad button, and a keyboard event targeted inside a focused iframe. Assert no L2/R2 actions and no forwarded gamepad presses while locked.
- Verify that a saved `.sav` can still be read/flushed while the main loop is paused and that the lock does not create automatic local/cloud snapshots. Prove teardown of one selected iframe leaves all unchecked iframes and leases intact; assert no iframe `src` or key change for survivors.
- Check count transitions `6→5→4→3→2→1`, fullscreen, and narrow landscape for correct grid dimensions, unchanged surviving runtime identity, and chooser/save overlay z-order.
- Run the relevant frontend/package tests, frontend lint, and diff checks. The user performs end-to-end testing. No build or commit without an explicit request in that task.

## Acceptance examples

| Running | Selection on confirmation | Expected result |
| --- | --- | --- |
| `A | Perfil 1` | Single instance; no chooser | Existing direct close. |
| `A | Perfil 1`, `B | Perfil 2` | Both (default) | Both close; wrapper closes after save synchronization. |
| `A | Perfil 1`, `B | Perfil 2` | Only B | B closes; A and the wrapper continue running. |
| `A | Perfil 1`, `B | Perfil 2` | None | Confirm unavailable; Cancel changes nothing. |
| `A | Perfil 1`, `B | Perfil 2` | Only B, but B's save fails | B remains for retry; A is not selected for closing. |

## Implementation record

- The hub now opens a centered chooser for two or more live sessions, with checked `ROM | Perfil` rows, a select/deselect-all control, and Confirmar/Cancelar. A single session still takes the direct close path. The selected IDs are reconciled with the live session list while the chooser is open.
- The close coordinator receives only the confirmed sessions. Each task resolves its iframe through `data-session-id`, runs the existing save/recovery/lease close pipeline, and retains the existing failure and retry overlay. Successful completion removes only those sessions, clears their scoped state, and preserves the wrapper and global settings when survivors remain.
- A common lock covers the chooser and save overlay. The parent marks the header and grid inert, sends a lock to each iframe, clears and suppresses gamepad bindings and trigger actions, and waits for a neutral controller reading before forwarding held input again. The iframe pauses its EmulatorJS manager, rejects keyboard and gamepad input, and skips automatic local/cloud recovery capture while locked. An iframe that was already paused stays paused after unlock.
- L2/R2 are emulator action triggers, not ordinary game buttons. The parent feeds an empty binding set to `createPlayerTriggerActions()` for both lock phases, so Save state, Load state, reset, and Fast Forward assigned to those triggers cannot run. A focused test covers L2 Save state and R2 Fast Forward through modal, save overlay, and held-button unlock.
- Surviving `.player-cell` keys and iframe URLs remain unchanged as the count-driven grid classes update. The user will validate visual layout and physical controller behavior end to end; automated checks cover close targeting, lock transitions, save coordinator retry, relevant frontend/package regressions, and lint. No project build or commit was requested for this implementation.
