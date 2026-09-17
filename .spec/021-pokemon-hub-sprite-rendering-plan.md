# Pokemon Hub Sprite Rendering Implementation Plan

**Goal:** Render local normal and shiny Pokémon sprites over occupied Hub, Party, and Box slots while preserving responsive CSS alignment and numeric fallback.

**Architecture:** A small shared package function maps the current visual slot projection to a local sprite path or no image. One React sprite child is reused by each existing slot renderer; CSS creates its pointer-transparent local plane inside the square, so no global overlay or coordinate measurement is needed.

**Tech Stack:** React, Vite static public resources, Node ESM, Node test runner, CSS grid and absolute positioning.

**Spec:** [.spec/021-pokemon-hub-sprite-rendering.md](021-pokemon-hub-sprite-rendering.md)

## Global constraints

- Do not run a project build.
- Use only `/resources/pokemon/{species}.png` and `/resources/pokemon/{species}-shiny.png` paths.
- Preserve existing numeric content as image-load fallback.
- Do not add drag-and-drop, dependencies, API routes, save writes, or data-model changes.
- Keep sprite interaction pointer-transparent and native-image dragging disabled.

---

### Task 1: Define the current slot-to-local-sprite projection

**Files:**
- Create: `apps/packages/pokemon-slot-sprite.mjs`
- Create: `apps/packages/pokemon-slot-sprite.test.mjs`

**Interfaces:**
- Produces `getPokemonSlotSprite(slot) -> string | null`.
- Produces `hidePokemonSlotSprite(image) -> void` for the browser image-error fallback.

- [x] Write failing tests for empty slots, invalid current species values, normal paths, shiny paths, and hiding a failed image.
- [x] Run `node --test apps/packages/pokemon-slot-sprite.test.mjs` and confirm the tests fail because the module is absent.
- [x] Implement the smallest shared projection using the existing local resource filename contract.
- [x] Re-run `node --test apps/packages/pokemon-slot-sprite.test.mjs` and confirm it passes.

### Task 2: Render one shared local sprite plane in every occupied slot

**Files:**
- Modify: `apps/frontend/src/main.jsx`
- Modify: `apps/frontend/src/styles.css`
- Create: `apps/frontend/src/pokemon-slot-sprite-rendering.test.mjs`

**Interfaces:**
- `PokemonSlotSprite` receives the existing slot projection and emits a decorative local `<img>` only when `getPokemonSlotSprite` returns a path.
- Existing Hub grid, Party, and Box slot renderers use that same component.

- [x] Write failing source/CSS contract tests for the shared component, local image source, error fallback, no pointer events, disabled native image dragging, and absolute local plane.
- [x] Run the focused frontend contract test and confirm it fails before the component and CSS exist.
- [x] Add the shared component to all occupied-slot renderers without changing slot selection, labels, layout geometry, or data flow.
- [x] Add local-plane CSS that fills and contains within the existing square while keeping the index above it and fallback number below it.
- [x] Re-run the focused frontend contract test and confirm it passes.

### Task 3: Verify the responsive visual boundary

**Files:**
- Modify: `.spec/021-pokemon-hub-sprite-rendering.md`
- Modify: `.spec/021-pokemon-hub-sprite-rendering-plan.md`

- [x] Run the new package and frontend tests together with the existing resource tests.
- [x] Check the source and styles with the frontend rendering-contract test and `git diff --check`. JSX is not a valid `node --check` input.
- [ ] With the existing frontend server, manually resize the occupied Hub, Party, and Box views; verify each sprite follows its own square and no slot interaction is blocked. The currently running frontend has no occupied slots to inspect.
- [x] Record the manual and automated verification results. Do not run a project build.

### Task 4: Prevent text selection throughout the Hub

**Files:**
- Modify: `apps/frontend/src/main.jsx`
- Modify: `apps/frontend/src/styles.css`
- Modify: `apps/frontend/src/pokemon-slot-sprite-rendering.test.mjs`
- Modify: `.spec/021-pokemon-hub-sprite-rendering.md`

**Interfaces:**
- The Hub workspace, its descendants, profile modals, and Hub selector popups apply `user-select: none`.
- Selector popups receive a Hub-specific class because they are rendered outside the workspace DOM subtree.

- [x] Write the failing CSS/source contract test for the no-selection boundary.
- [x] Apply the CSS rule and popup class to every Hub selector.
- [x] Run the focused rendering contract test without running a project build.

### Task 5: Clear the Party status strip

**Files:**
- Modify: `apps/frontend/src/styles.css`
- Modify: `apps/frontend/src/pokemon-slot-sprite-rendering.test.mjs`
- Modify: `.spec/021-pokemon-hub-sprite-rendering.md`

**Interfaces:**
- Only Party sprites are translated 6 pixels upward.
- The shared sprite layout for Box and standard Hub slots is unchanged.

- [x] Write the failing Party-only offset assertion.
- [x] Add the Party-specific CSS offset.
- [x] Run the focused rendering contract test without running a project build.

## Verification record

- 2026-09-17: `node --test apps/frontend/src/pokemon-slot-sprite-rendering.test.mjs` passed: 3 tests. `git diff --check` completed without whitespace errors. No project build or frontend start was run.
- 2026-09-17: `node --test apps/frontend/src/pokemon-slot-sprite-rendering.test.mjs` passed: 4 tests after the Party-only 6px sprite offset. `git diff --check` completed without whitespace errors. No project build was run.
