# Pokemon Hub Read-Only Drag and Drop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add local moves into empty slots and scoped swaps over occupied slots without calling a backend write API.

**Architecture:** Small shared packages derive stable participant identities and apply validated, immutable local slot updates. One React DnD provider wraps the workspace; reusable slot adapters mark occupied slots draggable and all slots droppable. The end-of-drag handler applies only an accepted local update, then clears the decorative overlay.

**Tech Stack:** React 19, `@dnd-kit/react` 0.5.0, Vite, Node ESM, Node test runner, CSS.

**Spec:** [.spec/022-pokemon-hub-read-only-drag-and-drop.md](022-pokemon-hub-read-only-drag-and-drop.md)

## Global Constraints

- Do not run a project build.
- Install only `@dnd-kit/react` 0.5.0 in `apps/frontend`.
- Keep every DnD drop local-only: no API write and no transfer confirmation control.
- Start drag only after 6 pixels of pointer motion.
- Make every rendered slot droppable and only occupied slots draggable.
- Keep the drag overlay decorative and pointer-transparent.
- Preserve existing normal/shiny local sprite rendering, Party offset, and no-text-selection behavior.

---

### Task 1: Define stable read-only participant identities

**Files:**
- Create: `apps/packages/pokemon-hub-drag-identity.mjs`
- Create: `apps/packages/pokemon-hub-drag-identity.test.mjs`

**Interfaces:**
- Produces `pokemonHubDragId(location) -> string` for Hub, Party, and Box locations.
- Produces `isPokemonHubDraggable(slot) -> boolean` from the current `occupied` field.

- [x] **Step 1: Write the failing tests**

```js
assert.equal(pokemonHubDragId({ kind: 'hub', hubProfileId: 'bank-a', slot: 4 }), 'hub:bank-a:4')
assert.equal(pokemonHubDragId({ kind: 'game', gameId: 'emerald', profileId: 'leaf', area: 'party', slot: 2 }), 'game:emerald:leaf:party:2')
assert.equal(pokemonHubDragId({ kind: 'game', gameId: 'emerald', profileId: 'leaf', area: 'box', box: 5, slot: 12 }), 'game:emerald:leaf:box:5:12')
assert.equal(isPokemonHubDraggable({ occupied: false }), false)
```

- [x] **Step 2: Run the test and verify it fails because the module is missing**

Run: `node --test apps/packages/pokemon-hub-drag-identity.test.mjs`

Expected: FAIL with a missing-module error.

- [x] **Step 3: Implement the minimal pure identity module**

```js
export function pokemonHubDragId(location) {
  if (location.kind === 'hub') return `hub:${location.hubProfileId}:${location.slot}`
  if (location.area === 'party') return `game:${location.gameId}:${location.profileId}:party:${location.slot}`
  return `game:${location.gameId}:${location.profileId}:box:${location.box}:${location.slot}`
}
export function isPokemonHubDraggable(slot) { return slot?.occupied === true }
```

- [x] **Step 4: Run the identity test and verify it passes**

Run: `node --test apps/packages/pokemon-hub-drag-identity.test.mjs`

Expected: PASS.

### Task 2: Add the frontend dependency and DnD component boundary

**Files:**
- Modify: `apps/frontend/package.json`
- Modify: `apps/frontend/package-lock.json`
- Modify: `apps/frontend/src/main.jsx`
- Modify: `apps/frontend/src/pokemon-slot-sprite-rendering.test.mjs`

**Interfaces:**
- `PokemonHubDragSlot({ location, slot, children })` composes draggable and droppable bindings without altering `slot`.
- `PokemonHubDragOverlay({ slot })` displays only while an active slot exists.
- One provider owns `activeDrag` and clears it on completion or cancellation.

- [x] **Step 1: Write failing source contracts**

```js
assert.match(source, /from '@dnd-kit\/react'/)
assert.match(source, /activationConstraints:\s*\{[^}]*distance:\s*6/)
assert.match(source, /function PokemonHubDragSlot/)
assert.match(source, /function PokemonHubDragOverlay/)
assert.doesNotMatch(source, /transferPokemonHub/)
```

- [x] **Step 2: Run the frontend contract test and verify it fails**

Run: `node --test apps/frontend/src/pokemon-slot-sprite-rendering.test.mjs`

Expected: FAIL because the DnD import, wrappers, and read-only boundary do not exist.

- [x] **Step 3: Install the documented dependency**

Run: `npm install @dnd-kit/react@0.5.0`

Expected: frontend package manifest and lockfile record version 0.5.0.

- [x] **Step 4: Wrap the workspace and slots with the minimal provider adapters**

```jsx
<DragDropProvider onDragStart={startDrag} onDragEnd={endDrag} onDragCancel={endDrag}>
  <PokemonHubDragSlot location={location} slot={slot}>...</PokemonHubDragSlot>
  <PokemonHubDragOverlay slot={activeDrag?.slot} />
</DragDropProvider>
```

The drop callback clears active state only. Remove the transfer client import, handler, and confirmation control.

- [x] **Step 5: Re-run the frontend contract test and verify it passes**

Run: `node --test apps/frontend/src/pokemon-slot-sprite-rendering.test.mjs`

Expected: PASS.

### Task 3: Add visual drag state and verify the read-only boundary

**Files:**
- Modify: `apps/frontend/src/styles.css`
- Modify: `apps/frontend/src/pokemon-slot-sprite-rendering.test.mjs`
- Modify: `.spec/022-pokemon-hub-read-only-drag-and-drop.md`
- Modify: `.spec/022-pokemon-hub-read-only-drag-and-drop-plan.md`

**Interfaces:**
- `.pokemon-hub-slot.drag-over` visually identifies a current valid target.
- `.pokemon-hub-drag-overlay` is fixed above the workspace and pointer-transparent.

- [x] **Step 1: Write failing CSS contracts**

```js
assert.match(css, /\.pokemon-hub-slot\.drag-over\s*\{[^}]*outline:/)
assert.match(css, /\.pokemon-hub-drag-overlay\s*\{[^}]*position:\s*fixed;/)
assert.match(css, /\.pokemon-hub-drag-overlay\s*\{[^}]*pointer-events:\s*none;/)
```

- [x] **Step 2: Run the frontend contract test and verify it fails**

Run: `node --test apps/frontend/src/pokemon-slot-sprite-rendering.test.mjs`

Expected: FAIL because drag-state styles are absent.

- [x] **Step 3: Add minimal visual-only styles and complete the spec record**

```css
.pokemon-hub-slot.drag-over { outline: 2px solid #8dffd0; }
.pokemon-hub-drag-overlay { position: fixed; pointer-events: none; }
```

- [x] **Step 4: Run the focused DnD, sprite, and identity tests**

Run: `node --test apps/packages/pokemon-hub-drag-identity.test.mjs apps/packages/pokemon-slot-sprite.test.mjs apps/frontend/src/pokemon-slot-sprite-rendering.test.mjs`

Expected: PASS with no failures.

- [x] **Step 5: Check the diff without running a project build**

## Verification record

- 2026-09-17: `npm install @dnd-kit/react@0.5.0` completed in `apps/frontend` with 0 reported vulnerabilities. `@dnd-kit/react` imported successfully under the frontend's React 19 dependency set.
- 2026-09-17: JSX transformation of `apps/frontend/src/main.jsx` completed through Vite's OXC transformer after correcting the Box-navigation expression. No project build or frontend server start was run.
- 2026-09-17: Focused identity, sprite, and rendering contract tests passed: 12 tests, 0 failures. `git diff --check` completed without whitespace errors.

Run: `git diff --check`

Expected: exit code 0.

### Task 4: Apply accepted drops to local workspace state

**Files:**
- Create: `apps/packages/pokemon-hub-local-drag.mjs`
- Create: `apps/packages/pokemon-hub-local-drag.test.mjs`
- Modify: `apps/frontend/src/main.jsx`
- Modify: `apps/frontend/src/pokemon-slot-sprite-rendering.test.mjs`

**Interfaces:**
- `applyPokemonHubLocalDrop(state, sourceLocation, targetLocation)` returns `{ action, hubProfiles, saveLayoutsBySource }`.
- `action` is `move`, `swap`, or `none`.

- [ ] **Step 1: Write failing pure-operation tests**

```js
assert.equal(applyPokemonHubLocalDrop(state, partySlot(0), partySlot(1)).action, 'swap')
assert.equal(applyPokemonHubLocalDrop(state, partySlot(0), boxSlot(0, 1)).action, 'none')
assert.equal(applyPokemonHubLocalDrop(state, partySlot(0), emptyHubSlot(4)).action, 'move')
```

- [ ] **Step 2: Run the test and verify it fails because the operation module is missing**

Run: `node --test apps/packages/pokemon-hub-local-drag.test.mjs`

Expected: FAIL with a missing-module error.

- [ ] **Step 3: Implement immutable local movement and scoped swaps**

Use the exact source and target locations to read and update Hub entries, Party slots, and Box slots. Move to any empty target. Swap only when both locations are in the same Party, same Box, or same Hub profile. Return the original state references for no-op drops.

- [ ] **Step 4: Connect the end-of-drag handler**

```jsx
onDragEnd={event => {
  const result = applyPokemonHubLocalDrop(currentState, source.location, target.location)
  setPokemonHubProfiles(result.hubProfiles)
  setSaveLayoutsBySource(result.saveLayoutsBySource)
  setPokemonHubActiveDrag(null)
}}
```

No accepted or rejected drop may call a backend client.

- [ ] **Step 5: Run focused tests and inspect the diff**

Run: `node --test apps/packages/pokemon-hub-local-drag.test.mjs apps/packages/pokemon-hub-drag-identity.test.mjs apps/frontend/src/pokemon-slot-sprite-rendering.test.mjs`

Expected: PASS with no failures. Then run `git diff --check`. Do not run a project build.
