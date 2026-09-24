# Spec 060 — Global player mute preference

## Goal

Add one mute toggle before Fast Forward in the player header. Its displayed state is the authoritative audio mute state for every emulator in the open player, and it persists in the existing global user preferences for the next visit.

## Current flow

- `apps/frontend/src/main.jsx` reads `/api/user-preferences`, holds Fast Forward state, sends commands to every `.player-grid iframe`, and passes initial settings in `playerFrameUrl()`.
- `apps/packages/user-preferences-store.mjs` validates and atomically patches one Redis document, currently version 1, containing Fast Forward and trigger preferences. Existing documents may lack new optional fields.
- `apps/frontend/src/player.js` reads launch parameters before loading EmulatorJS 4.2.3, receives same-origin parent messages, and configures the runtime at `EJS_ready` and `EJS_onGameStart`.
- [EmulatorJS documents `EJS_volume`](https://emulatorjs.org/docs/options/) (0–1, default 0.5). The pinned [4.2.3 implementation](https://cdn.emulatorjs.org/4.2.3/data/src/emulator.js) exposes `EJS_emulator.setVolume(volume)`, keeps the previous nonzero level in `EJS_emulator.volume` when called with zero, and allows native volume UI to call `setVolume()` independently. This runtime method is an internal API tied to the pinned version.

## Requirements

1. Add `muted: boolean` to the global preference document with default `false`. Normalize old documents without that field to false. Reject non-boolean PATCH values without changing stored preferences. Preserve all other preference fields. A first mute PATCH creates the document so the choice survives reopening even on a new installation.
2. Show a toggle immediately before the Fast Forward button within the existing control group. The icon, `aria-pressed`, and accessible label reflect mute state. No additional volume control is added.
3. Load the persisted state at hub startup, include it in the last-confirmed rollback state, and PATCH each user toggle. A stale read or write response must not undo a newer mute click. A failed preference read does not block game launch; a failed write restores the last confirmed value and uses the existing error display.
4. Pass mute state to a new iframe in its launch URL; send every state change to all active iframes using a same-origin `emulator-hub:mute` message. A newly loaded iframe receives the current value again, including when another emulator was added while muted.
5. The iframe accepts only boolean mute messages from its parent. It applies the initial value at EmulatorJS readiness and again at game start so startup cannot revert it. Muting uses `setVolume(0)` without overwriting the prior volume; unmuting restores the last nonzero per-emulator volume, or 0.5 when none exists.
6. The header state remains authoritative if EmulatorJS's built-in volume or mute UI changes its volume later. The player enforces mute on subsequent `setVolume` calls while the global toggle is on, preserving the user's intended nonzero volume for the next unmute.
7. Muting changes audio output only. It never touches emulator save files, snapshots, game speed, or other preferences.

## Implementation and verification

- Extend the shared preference contract, Redis transition, package tests, and backend preference-route expectations.
- Add a small shared audio-mute controller with unit tests for initial mute, restoration of volume, native UI attempts while muted, and repeated commands.
- Wire the hub state, URL, broadcast, iframe message handler and ready callbacks; cover the cross-frame contract in focused frontend tests.
- Update existing header styles for the new button and verify frontend lint and targeted unit/integration tests. Do not run a project build or commit unless requested in that task.

## Acceptance

- With two running emulators, a click mutes or unmutes both; a third added emulator starts with the same state.
- Closing and reopening the player, including after a page reload, restores the persisted button state and applies it at startup.
- Legacy preferences load as unmuted; invalid input is rejected; preference errors follow the existing fallback and error behavior.

## Implementation record

The implementation followed unit tests first for the preference contract and audio controller, then frontend tests for URL delivery, iframe broadcast, header placement, and stale preference responses. The relevant changes are in `apps/packages/user-preferences-store.mjs`, `apps/packages/emulator-audio-mute.mjs`, `apps/frontend/src/main.jsx`, `apps/frontend/src/player.js`, and their focused tests. Existing `.fast-forward-button` styles cover the new button without duplicate CSS. Verification at implementation time: 125 frontend tests, 12 focused package tests, two backend HTTP preference tests, frontend lint, and `git diff --check` passed. No build or commit was run.
