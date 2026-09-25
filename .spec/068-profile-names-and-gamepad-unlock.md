# Spec 068 — Repeated profile names and reliable controller unlock

## Corrected profile contract

- Save profiles are identified by their stable `id` inside a game, not by `name`. The name is editable display metadata and may repeat within the same game. This supersedes the uniqueness rule in specs 005, 066 and 067.
- Both filesystem and Redis profile stores currently reject same-name creates and renames with `PROFILE_NAME_DUPLICATE`; the API translates that error to 409. Remove this constraint for both paths. Retain printable 1–32-character validation and game/profile ID scoping.
- `list(gameId)` must return creation chronology, oldest first, including legacy records stored out of order. Renaming preserves `id`, `createdAt`, save identity and list position. Equal timestamps retain persisted order. Picker, catalog and global editor consume this list without sorting by name.
- Renames from the launch picker, running player header and global editor all use the same PATCH behavior. Two profiles with an identical name remain independently selectable by ID. No rename waits for game close or changes save/lease payloads.

## Controller investigation

- The Hub polls `navigator.getGamepads()` and sends bindings to each player iframe. Closing/chooser and running-profile editor suppress input, while `player-interaction-lock` pauses the affected emulator and releases simulated buttons.
- Current `awaitGamepadNeutralRef` and `profileInfoNeutralSessionIdRef` require **every** reported binding to disappear before forwarding any input after unlock. A continuously reported axis/button keeps all new input blocked. Unplugging the controller produces an empty snapshot and clears the wait, matching the reported recovery method.
- The snapshot reader currently accepts a non-null browser gamepad even when `connected === false`, so stale disconnected slots can contaminate the held-input set. Ignore disconnected slots.
- The iframe interaction-lock request has acknowledgement but only logs a timeout; a missed unlock may leave that iframe paused. A retry must resend the latest desired lock state, never revive a superseded state or a removed iframe.
- Switching the running-profile editor directly to another active player currently leaves the prior player's input gate locked; opening the new editor must unlock the previous player before locking the new one.

## Required behavior

1. During a global or session-scoped lock, release active simulated buttons and suppress input. On unlock, suppress only bindings held at that moment until each is individually released. A newly pressed different binding reaches the game even while another input remains held. Re-pressing a released binding works normally. Closing the last player resets all global suppression before the next launch.
2. The running-profile modal remains scoped to its player; other players receive controller input. Global close/save lock retains precedence. Controller trigger actions follow the same filtered bindings.
3. The player iframe acknowledges lock revisions. On an unconfirmed message, retry the **current** lock state for that same live frame/session, boundedly. Old acknowledgements or requests must never undo a newer lock state. Preserve keyboard blocking and pause/resume ownership.
4. Keep source-of-truth input and lock logic in `apps/packages/`. No new UI or save changes. Keep optional physical-controller verification distinct from automated proof.

## Verification

- Failing-first tests for repeated creation/rename, persisted order and identical-name ID isolation in both stores and API.
- Failing-first gate tests for held-axis/new-button behavior, release/re-press, per-session scope and full-close reset; parent/iframe acknowledgement retry tests.
- Run package/backend/frontend tests and lint. Do not build, commit, push or deploy in this task.
