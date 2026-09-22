# Spec 046 — Global player-header preferences and L2/R2 Fast Forward

## Goal

Add a Fast Forward action to both L2 and R2, and persist the related player-header preferences in the backend as one hub-wide preference set shared across browsers and devices.

## Preference model

The backend owns one global preference document, independent of game, profile, browser, and player session:

```json
{
  "version": 1,
  "fastForwardSpeed": 1.5,
  "triggerActions": {
    "l2": "none",
    "r2": "none"
  }
}
```

- `fastForwardSpeed` accepts the existing supported values: `1.5`, `2`, `2.5`, `3`, `3.5`, `4`, `4.5`, or `5`.
- Each trigger action accepts `none`, `reset`, `save-state`, `load-state`, or `fast-forward`.
- Missing preferences return defaults: speed `1.5`; L2 and R2 set to `none`.
- Fast Forward enabled/disabled state is runtime state and is not persisted. Only its selected speed is a preference.
- The global document is shared by all clients of this backend. There is no per-account or per-device preference record.

## Backend and client contract

- Add `GET /api/user-preferences` to return `{ preferences, initialized }`, where `preferences` is the complete global document. An uninitialized store returns the defaults with `initialized: false`; a stored document returns `initialized: true`. Responses use `Cache-Control: no-store`.
- Add `PATCH /api/user-preferences`. Its JSON body contains only fields being changed: `fastForwardSpeed`, a partial `triggerActions` object, or both. The migration-only `initializeIfAbsent: true` flag is also accepted. The response uses the same `{ preferences, initialized }` envelope.
- Validate the complete resulting document, then atomically merge partial fields with the stored values. Store updates must not lose concurrent changes to different fields, including requests handled by different backend processes. Use the existing persistence atomic-transition contract (`persistence.eval`, with Lua and in-memory handlers), storing the complete document under a dedicated `user-preferences` key. `initializeIfAbsent: true` creates the initial document only when no record exists; otherwise it returns the existing values unchanged.
- Reject malformed documents, unsupported speeds/actions, and unknown fields with the existing API validation error format. A rejected write leaves the previous document unchanged.
- Implement the preference contract and durable store in `apps/packages/`; expose GET/PATCH through the existing backend API and request helpers through `apps/packages/hub-client.js`. Preference failures return normal API errors and never partially update the stored document.
- Backend persistence failure must not block launching games, acquiring player leases, or loading and saving emulator data. The frontend keeps usable defaults/current confirmed values, reports the preference error through the existing error UI, and must not present an unconfirmed value as saved.
- The main page requests the global preferences once during startup and stores them in shared in-memory frontend application state. Opening the player reads this cache synchronously; it does not request or wait for preferences. If the player opens before startup loading completes, it uses the current default/confirmed cache and applies loaded values to the open player when the request finishes. Preference loading never blocks game launch.
- Preference edits made while startup loading is in flight must be queued behind that initial load and then applied as partial updates, so a late GET response cannot overwrite a newer user choice. Serialize frontend preference writes; apply returned canonical values to the shared cache and current player. Other clients receive changes on their next hub startup; live push synchronization to already-open clients is not required.

## Migration from the current speed cookie

- The current `emulator_hub_fast_forward_speed` cookie is a browser-local speed preference. It is no longer the source of truth once a backend preference document exists.
- If the backend reports `initialized: false`, the frontend may migrate a valid speed from the existing cookie by patching only `fastForwardSpeed`; L2/R2 keep their defaults. An invalid or absent cookie leaves the default speed unchanged.
- Remove the legacy cookie only after the backend confirms the migration write. If that write fails, retain the cookie so a later startup can retry. Once initialized, ignore and remove any remaining legacy cookie without overwriting the backend values.
- Migration uses `PATCH` with `initializeIfAbsent: true`; if another client initializes preferences first, its complete values win and the cookie value is not applied.

## L2/R2 Fast Forward behavior

- Add `Fast Forward` to both L2 and R2 action selectors. Their selected actions load from and save to the global backend preferences instead of resetting to `Do nothing` each time a player session opens.
- Trigger actions retain the existing press-edge rule: an action fires once when its configured trigger changes from released to pressed, not on every poll while held. Releasing and pressing again fires another action. If both selectors use Fast Forward, each trigger's separate press edge performs one toggle.
- When a Fast Forward action fires, read the current enabled state from the first active emulator iframe in player/session order. This first iframe is the sole reference; ignore other instances when selecting the next state.
- Query the first iframe with `{ type: 'emulator-hub:get-fast-forward-state', requestId }`. The player responds with `{ type: 'emulator-hub:fast-forward-state', requestId, enabled }`, where `enabled` is the player's current accepted Fast Forward request state. Accept a response only from the same-origin `contentWindow` queried and only when its request ID matches and `enabled` is boolean. The query has a one-second timeout.
- Invert the first iframe's enabled state, update the hub's runtime state, and broadcast the resulting enabled state and current selected speed to every active iframe. This explicit broadcast must happen even when the result equals the hub's prior state, so divergent instances are still synchronized. Newly added instances receive the hub's synchronized state through the existing initialization path.
- Serialize overlapping Fast Forward trigger toggles in trigger-edge order. When a response arrives, abort if its source iframe is no longer the first active iframe. If the first active iframe cannot provide a valid state before timeout, do not toggle or broadcast a new state. Leave the speed and all current emulator states unchanged.
- The standalone Fast Forward header button continues to toggle the hub runtime state and synchronize every active iframe. The speed selector continues to set the session speed, and each speed change is persisted to the backend global preferences.

## UI and update behavior

- Keep the existing L2/R2 selectors, Fast Forward button, and speed selector in their current header positions and preserve their labels and mobile visibility.
- Persist each preference change promptly. Keep the currently confirmed selection visible until the corresponding PATCH succeeds; then replace it with the canonical returned value. If a write fails, keep the last backend-confirmed value and show the existing error; do not silently imply that the value was remembered.
- Preferences survive player close, hub reload, backend restart, and opening the hub in another browser/device connected to the same backend.
- Reset, save-state, and load-state retain their current behavior and remain available in both selectors.

## Boundaries

This adds one global backend-owned preference document for Fast Forward speed and the L2/R2 action choices. It does not persist whether Fast Forward is currently enabled, add per-user or per-game overrides, add real-time synchronization between already-open clients, change controller bindings, or add header controls. Core game launch, player leases, save validation, and save persistence remain independent of preference availability.

## Acceptance

1. Both selectors offer `Fast Forward`; action values for L2 and R2 load from the global backend preference and remain selected after closing and reopening the player.
2. Fast Forward speed loads from the backend, changes the speed sent to all active iframes, and persists for later sessions and other clients. Its supported values and default remain unchanged.
3. L2 and R2 each toggle once per press edge. Holding does not repeat; release followed by another press toggles again. If both actions are Fast Forward, each trigger toggles once on its own press edge.
4. A trigger toggle reads the first active iframe's current enabled state, in player/session order, and inverts that state even when other active iframes disagree.
5. The resulting enabled state and current speed are sent to all active iframes, and the hub runtime state matches them. A new iframe receives the current state and speed.
6. If the first iframe has no valid state response, the action leaves the hub and all iframe states unchanged.
7. `GET /api/user-preferences` returns defaults for an uninitialized store and persisted values after a backend restart. Valid partial `PATCH` requests merge fields; malformed or unsupported values fail without changing saved values.
8. A valid legacy speed cookie migrates only when the backend preference document is uninitialized. Successful migration removes the cookie; failed migration retains it for retry. An initialized backend document always takes precedence.
9. Preference load/write failure does not block game launch, lease acquisition, or emulator save/load. The UI reports failed writes and does not show them as persisted.
10. Tests cover store defaults, validation and persistence; API GET/PATCH behavior; client loading and saves; cookie migration; L2/R2 press edges; first-iframe state selection; whole-session synchronization; and failed/unavailable state handling. Do not run a project build unless requested.

## Implementation map

1. Add the preference document normalizer and Redis-backed store in `apps/packages/user-preferences-store.mjs`, with unit tests for defaults, validation, copies, persistence, partial merges, initialization-only migration, persistence errors, and concurrent atomic updates.
2. Wire the store and GET/PATCH routes into `apps/backend/server.mjs`; test defaults, saved values, partial updates, invalid payloads, migration races, and persistence failures in backend route tests.
3. Add GET/PATCH helpers in `apps/packages/hub-client.js` and a focused client contract test.
4. Replace the cookie-owned speed and session-reset trigger-action state in `apps/frontend/src/main.jsx` with one startup-loaded in-memory preferences cache. Serialize PATCH writes, migrate a valid legacy cookie only for an uninitialized backend document, remove it after confirmation, and continue using defaults if backend preferences are unavailable.
5. Add `fast-forward` to `playerTriggerActions` and invoke an injected async session toggle once per L2/R2 press edge. Keep existing reset/save/load dispatch and controller bindings unchanged.
6. Add the request/reply Fast Forward state protocol in `apps/frontend/src/player.js` and the parent hub. Verify same-origin/source/request ID, timeout and first-frame replacement, then broadcast one resulting state and speed to every active iframe.
7. Add focused frontend tests for startup loading/cache (player opening makes no preference request), edits during loading, save rollback, cookie migration, new-player initialization, trigger-edge toggles, first-frame-only state choice, simultaneous triggers, divergent-frame synchronization, and unavailable/late state replies.
8. Run the focused package, backend, and frontend Node tests and `git diff --check`. Do not run a project build.

## Relationship to earlier specs

This spec extends [Spec 042](042-player-trigger-actions.md): its session-only trigger-action selections and per-open `Do nothing` defaults are replaced by global backend preferences with remembered selections. Existing trigger bindings and press-edge behavior remain. It uses the control-profile route/storage separation established by [Spec 008](008-global-gba-control-profile.md) without storing these preferences inside the GBA control profile.
