# Spec 057 — Player picker and runtime preferences

## Goal

Improve the existing multi-emulator flow and make player runtime preferences consistent across reloads and sessions. Keep the changes inside the current hub, player iframe, and global user-preference mechanisms.

## Current system and findings

- The home screen groups catalog games through `groupGamesByLayout(games, hubLayout)`, which gives each game its displayed section and order.
- The add-instance flow currently opens a separate “Selecionar jogo” modal. It lists ready games as vertical text rows in catalog response order. Selecting a row closes that modal and opens a second profile modal.
- The profile modal already loads profiles from `getProfiles(game.id)` and can be positioned near the selected home-screen ROM. Its profile rows include launch, edit, and delete actions.
- ROM cover art is already available through `game.coverUrl` and rendered as a square home-screen cover.
- L2/R2 action options are defined in `apps/packages/player-trigger-actions.mjs`; the current order is Do nothing, Soft Reset, Hard Reset, Save state, Load state, Fast Forward. `apps/packages/user-preferences-store.mjs` already persists the action values and speed in the global preference document.
- The global preference document currently stores `fastForwardSpeed` but not whether Fast Forward is enabled. The hub initializes `fastForwardEnabled` to false on page load and does not persist later toggles.
- The odds manipulator is hub-wide runtime state. The player wrapper owns its enabled flag; adding an emulator must preserve that flag and apply it to the new iframe. Closing the entire wrapper resets it.

## Requirements

### L2/R2 action order

- Display these actions in both trigger selectors, in exactly this order: Do nothing, Fast Forward, Soft Reset, Hard Reset, Save state, Load state.
- Preserve the existing stored action values and dispatch behavior. This is a presentation-order change only.

### Add-emulator ROM and profile picker

- In the add-instance flow, use one modal that presents ready ROMs as square cover tiles in a horizontal row.
- Use each ROM's existing `coverUrl` and title. If a cover is missing, show a square fallback containing the title so the ROM remains selectable.
- Keep ROMs in the same order as their cards on the home screen: flatten `groupGamesByLayout(games, hubLayout)` by section and preserve each section's `games` order; then filter to ready games.
- Selecting a ROM marks its tile selected and loads that ROM's profiles directly below the ROM row. Do not require a second modal to reach those profiles.
- The modal height is bounded and accommodates the profile list below the ROM row. Profile overflow stays within the modal.
- On the current desktop catalog, size the modal wide enough to display all ready ROM tiles at once. At narrower viewports, keep tiles usable and let the horizontal ROM row scroll rather than clip or reorder them.
- Preserve profile launch/edit/delete behavior, profile loading/error behavior, active-profile disabling, and the six-instance limit.
- This redesign applies to adding an emulator from the player. The home-screen launch picker and its anchor placement remain unchanged.

### Fast Forward preference

- Add `fastForwardEnabled: boolean` to the existing backend-global user-preference document. Default it to `false` when no document exists and when reading an existing document written before this field existed.
- Validate partial updates and normalized stored preferences so malformed non-boolean values are rejected without changing the stored document.
- Persist every Fast Forward enabled-state change, whether caused by the header button or an L2/R2 Fast Forward action. Keep the existing speed preference and trigger action preferences intact.
- Load the preference during hub startup. Apply the confirmed value to the header state and every active or newly mounted emulator iframe.
- Preference storage or loading failures must not block launching or adding emulators. Retain the last confirmed enabled value on write failure and report the existing preference error.
- Preserve the current cookie migration for speed; do not migrate enabled state from cookies or local storage.

### Odds manipulator startup state

- Set the hub-wide odds-manipulator state to disabled only when the player wrapper opens its first emulator (the transition from zero active sessions to one).
- Adding another emulator to an open wrapper preserves the enabled state and the configuration of existing iframes. When enabled, configure the newly loaded iframe with its profile's reset count and virtual timestamp.
- Closing the entire wrapper resets the enabled state. A later first launch starts disabled, with the UI toggle and iframe clock in agreement.
- Do not persist the odds-manipulator enabled state. Preserve each profile's reset count and all existing behavior when the user enables the control after startup.

## Boundaries

- No changes to controller binding preferences, profile storage, emulator save state, ROM catalog ordering on the home screen, or the odds reset-count persistence model.
- Do not add a project build step. Targeted test files may be run when specifically requested; no build is part of this work.

## Acceptance criteria

1. L2 and R2 show the six actions in the exact required order, and each selection still dispatches its existing action.
2. The add-emulator picker presents one home-order horizontal row of square ROM tiles, with all current desktop ROMs visible and narrow viewports able to scroll horizontally.
3. Selecting a ROM in the add-emulator picker shows its profiles below the row without closing/reopening a separate modal; existing profile controls continue to work.
4. Fast Forward enabled state is read from and written to the backend-global preference document and survives reloads and newly launched player sessions.
5. Old stored preference documents without `fastForwardEnabled` resolve to `false`; invalid enabled-state values are rejected.
6. Preference read/write failures do not prevent game launch; failed writes do not replace the last confirmed state.
7. The first emulator in a newly opened wrapper starts with odds manipulation disabled. Adding another emulator preserves the current hub-wide toggle and configures the new iframe accordingly. Closing and reopening the wrapper starts disabled again.
8. No project build is run.

## Implementation map

- `apps/packages/player-trigger-actions.mjs`: reorder the existing action option list.
- `apps/packages/user-preferences-store.mjs` and its unit tests: add and normalize the boolean preference, including legacy stored documents and Redis transitions.
- `apps/backend/test/server.test.mjs`: update expected preference documents for the new field.
- `apps/frontend/src/main.jsx`: derive add-picker order from the home layout, maintain selected ROM and profiles in the add modal, load/persist enabled Fast Forward, reset odds state only on the first wrapper launch, and configure new iframes with the current wrapper odds state.
- `apps/frontend/src/styles.css`: horizontal ROM tiles, selected/fallback artwork, modal width/height, and responsive horizontal overflow.
- Relevant frontend and package tests: cover option order, ordered picker, preference persistence/fallback, first-launch odds reset, additional-launch preservation, and new-iframe configuration.
