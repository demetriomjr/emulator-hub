# Spec 057 Implementation Plan

> Implementation is being carried out inline on `master`, as requested. No project build is permitted.

## Task 1 — Preference contract and trigger order

- Add `fastForwardEnabled: false` to defaults and normalized preference documents.
- Validate and atomically patch the boolean in both Redis Lua and memory paths.
- Preserve defaults for legacy persisted documents that omit the field.
- Reorder the L2/R2 option metadata without changing action identifiers.
- Update backend/package expectations to the complete preference document shape.

## Task 2 — Add-emulator picker

- Derive the add-picker ROM order by flattening the existing home `gameSections` and filtering to ready games.
- Keep selected ROM state inside the add-instance dialog; selecting a ROM fetches profiles, and profile choices remain beneath the ROM strip.
- Render cover tiles from `coverUrl`, with a title fallback for missing artwork.
- Add horizontal strip styling, selected indication, bounded modal/profile scrolling, a width fitting the current catalog, and a responsive horizontal-scroll fallback.
- Preserve launch, edit, delete, profile error and busy states, and max-instance enforcement.

## Task 3 — Runtime preference and odds initialization

- Load Fast Forward enabled state from global preferences and include it in confirmed-preference rollback.
- Persist header and trigger-based toggles; preserve the selected speed and other fields.
- Apply the preference to all active and newly initialized player frames.
- When starting either the first or an additional emulator, clear the odds toggle and explicitly disable the odds clock in active iframes before initializing the new session.

## Change map

- `apps/packages/player-trigger-actions.mjs`
- `apps/packages/user-preferences-store.mjs`
- `apps/packages/user-preferences-store.test.mjs`
- `apps/backend/test/server.test.mjs`
- `apps/frontend/src/main.jsx`
- `apps/frontend/src/styles.css`
- Targeted frontend preference, picker, and odds tests if requested; no build.

## Review checklist

- Home-screen order is the source of truth for the add-picker row.
- A missing cover does not remove a selectable ROM.
- An add-picker profile request finishing late cannot replace profiles for a subsequently selected ROM.
- Legacy global preferences remain readable and default Fast Forward to disabled.
- A rejected Fast Forward write restores the confirmed enabled state.
- Disabling odds on an additional launch reaches already active iframes as well as the new session.
