# Spec 049 — Per-emulator snapshot and local recovery prompt

## Context and current implementation

The player currently has two independent restore decisions:

1. `apps/frontend/src/player.js` calls the browser `window.confirm` when a compatible backend EmulatorJS snapshot exists. The browser dialog is outside the player surface and cannot identify which emulator requested it.
2. `apps/frontend/src/main.jsx` checks IndexedDB local runtime recovery before acquiring the lease and renders `recoveryCandidate` as a fixed `profile-overlay`. In multi-player mode this global modal blocks every emulator and makes the flow inconsistent with the backend snapshot prompt.

Profile deletion also uses a browser confirmation, but it is a profile-management action and is outside this restore decision. It must not be changed by this spec.

## Goal

Use one restore prompt component for every snapshot or local runtime recovery decision. The prompt must be rendered inside the corresponding emulator cell, remain scoped to that emulator, and never block unrelated emulators in a multi-player session. The prompt buttons must follow the existing dark green player design.

## Requirements

### Shared prompt contract

- Create one frontend `SnapshotRestorePrompt` component for both backend snapshot and local recovery decisions.
- The component must expose an accessible dialog with a title, explanatory message, restore action, and continue-without-restore action.
- The default Portuguese copy distinguishes a saved backend snapshot from an interrupted local recovery while keeping the same structure and controls.
- Restore and discard/continue buttons use the established player colors, borders, focus ring, disabled state, and typography. No browser `alert` or `confirm` is used for restore decisions.
- Only the prompt for the requesting emulator captures interaction. Other player cells remain visible and usable.

### Per-emulator placement and routing

- Each `.player-grid` item becomes a positioned emulator cell wrapper containing its iframe and any prompt overlay.
- Parent message handling identifies a player by the iframe `contentWindow` and the session ID, never by a global singleton or array position.
- A backend snapshot request from an iframe creates a prompt state keyed by that session. The response is sent only to that iframe and resolves the pending player request.
- A local recovery candidate is associated with the session being launched. The player is acquired and rendered first; its prompt appears in that session's cell. Choosing restore or continue sends a scoped decision to that iframe.
- A decision remains pending until the iframe receives it, so a startup race cannot silently discard a user choice.
- Removing a session removes its pending prompt state. Closing other emulators must not dismiss or alter a pending prompt.

### Player lifecycle

- Replace the backend snapshot `window.confirm` callback with a parent-message request/response handshake.
- The player waits for the restore decision before loading the saved snapshot or falling back to the cloud save restore path.
- The local recovery path waits for the parent decision, validates the stored recovery bundle against the launch descriptor, and loads it only when the user chooses restore. Continue clears that local candidate and proceeds with normal cloud snapshot/save initialization.
- Existing save, snapshot, lease, close, and recovery-clear behavior remains intact after the decision is resolved.
- Malformed, stale, missing, or timed-out requests fail closed: no state is restored, the player continues with its normal save path, and no global dialog is shown.

### Test and compatibility requirements

- Add tests covering the shared prompt contract and visual classes, scoped parent routing for two simultaneous emulators, one response per request, and local recovery plus backend snapshot decisions.
- Update existing local recovery and snapshot tests to assert that no restore flow uses `window.confirm`.
- Preserve the existing profile-picker browser confirmation because it is unrelated to snapshot restoration.
- Do not change the six-player layout, header controls, save-close barrier, backend APIs, or deployment behavior.

## Acceptance criteria

1. Opening a profile with a compatible backend snapshot displays the shared prompt inside that emulator's cell; selecting an action affects only that emulator.
2. Opening a profile with local recovery displays the same component inside the newly created emulator cell; no fixed global recovery modal appears.
3. In a multi-player session, prompts for different emulators can coexist and never interrupt or answer one another.
4. Browser restore dialogs and restore-related alerts are absent from frontend player code.
5. The prompt buttons visibly match the player header controls and meet keyboard focus/accessibility behavior.
6. Focused tests pass and the diff contains no unrelated layout, save, or deployment changes. Builds remain unexecuted unless explicitly requested.

## Implementation outline

1. Add the shared prompt and pure request routing helpers/tests.
2. Add per-session cell wrappers and parent request/response handling in `main.jsx`.
3. Move local recovery choice into the scoped session handshake.
4. Replace `window.confirm` in `player.js` with the asynchronous snapshot decision handshake.
5. Add styling and update focused tests.
