---
title: Pokémon Hub Workspace Frontend
date: 2026-09-17
tags: [spec, pokemon, hub, frontend, react]
status: draft
---

# Spec 012 — Pokémon Hub Workspace Frontend

## Goal

Make Pokémon Hub a first-class application in Emulator Hub rather than a sidebar modal. It appears beside ROMs as a compact application card; artwork is deliberately deferred. Opening the card presents a full Pokémon-management workspace with two equal panes. Each pane independently loads either one compatible game save belonging to the selected Emulator Hub profile or one Pokémon Hub organization profile. The player uses the two panes to inspect and move Pokémon; the backend remains the sole authority for records, revisions, save bytes, and transfer integrity.

This spec supersedes only the modal/sidebar parts of Spec 011. Its binary-adapter, profile-scope, anti-duplication, session, save-state, and licensing constraints remain mandatory.

## Terminology and ownership

- **Emulator Hub profile**: the existing backend-owned player profile. It remains the security and storage boundary for saves and every Pokémon Hub document.
- **Pokémon Hub profile**: a user-created organizational collection inside exactly one Emulator Hub profile. It is not a login, a second backend profile, or a different owner. It lets a player separate collections such as shiny Pokémon, high-IV Pokémon, or playthrough-specific Pokémon without inventing a box per category.
- **Hub box**: a named, ordered container within a Pokémon Hub profile. A box has a player-chosen grid width and height and contains slot references. A box is not a game PC box.
- **Game box**: a native adapter-defined PC box. For Gen III, it is exactly one of 14 boxes with exactly 30 slots. Its dimensions and capacity are fixed by the save format and never configurable in the UI.
- **Pane source**: the currently selected game save or Pokémon Hub profile shown in one of the two workspace panes.

All organizational profiles and boxes are descendants of the selected Emulator Hub profile. A Pokémon cannot be shown, moved, or referenced across Emulator Hub profiles.

## Entry and navigation

- The main application grid renders a Pokémon Hub card alongside game cards. The card is selectable only after the user selects an Emulator Hub profile, just like a game launch. It has a neutral application placeholder until product artwork is designed.
- Opening it replaces the hub grid with a dedicated, closable Pokémon Hub workspace. It does not create an EmulatorJS iframe and it does not need a ROM launch descriptor.
- Closing returns to the normal card grid. Opening Hub never changes the current profile.
- The former sidebar Pokémon Hub action and its modal are removed once this workspace ships; there must be one entry point and one transfer UI.

## Two-pane workspace

The content area has two equal-width panes on desktop and becomes vertically stacked on narrow screens. Neither side is semantically primary: a player can choose the source and destination direction by selecting slots.

Each pane has a source selector with these choices:

1. **Game save** — one supported, inactive, already-managed save from the selected Emulator Hub profile.
2. **Pokémon Hub profile** — one organizational profile from that same Emulator Hub profile.

The workspace permits two different game saves, or one game save plus one Hub profile. It rejects selecting a Hub profile on both panes at the same time. Selecting the same game save on both panes is also rejected because it cannot be a useful transfer endpoint. Changing a source clears the current slot selection and reloads only the affected projection.

“Load a specific save” means selecting a specific game already configured in the profile. There is no file picker, upload, drag-and-drop save import, arbitrary filesystem path, download, or browser-provided binary write.

Each game source shows its title, save status, current save revision, and a native-box chooser. Gen III offers exactly boxes 1–14. Selecting a box shows its 30 slots in the adapter-provided order. The UI may use a 6 × 5 visual layout but must map each displayed cell one-to-one to `{ kind: "game", gameId, box: 0..13, slot: 0..29 }`; it must not add, resize, paginate as another native box, or otherwise imply capacity the save cannot store.

Each Hub profile source shows:

- a profile selector and an action to create a profile;
- the profile's ordered box list, with create, rename, reorder, and delete actions;
- the selected box's player-defined grid; and
- the selected Pokémon projection, empty state, and capacity/scroll position.

The workspace creates a box explicitly. It does not make a new box merely because a grid becomes full. A new box starts with a user-selected name, column count, and row count. Grid dimensions are positive bounded integers validated by the backend; the first UI uses columns 1–30 and rows 1–30, therefore a box can represent 1–900 slots. This is a UI and request-safety limit, not a product capacity limit. A Hub profile may have any number of persisted boxes, subject only to local storage limits.

When a configured Hub grid exceeds the available pane, its cells live in a two-dimensional scrolling viewport: vertical scrolling reaches additional rows and horizontal scrolling reaches additional columns. The box header and selection state stay visible while the grid scrolls. The implementation virtualizes cells before accepting dimensions beyond the initial 30 × 30 bound in a future spec.

## Interaction and transfer flow

- A player selects an occupied slot as the source, then an empty slot in the other pane as destination. The active source/destination border and textual summary make direction explicit.
- A selection can start from either pane. Selecting a second occupied slot replaces the source; selecting an empty slot in the same pane does not create a transfer.
- Before mutation, the UI presents a compact confirmation identifying the Pokémon projection, source, destination, game/Hub profile name, native game box/slot where relevant, and a warning that active games are unavailable.
- Confirmation sends stable backend locations plus expected game revisions and the current Hub epoch. The browser never computes save offsets or writes a representation.
- Success refreshes both pane sources, retains their chosen box/profile/box selection where it still exists, clears transfer selection, and announces the result. Failure refreshes authoritative projections for revision conflicts and leaves local selection only when still valid.
- Active, missing, malformed, uninitialized, unsupported, stale, source-empty, destination-full, integrity-conflict, and cross-adapter errors display actionable status in the owning pane. No visual action suggests that an invalid move succeeded.

## Hub organizational persistence

The profile-level fixed 30-slot `inventory.json` from Spec 011 is migrated to a document-oriented hierarchy:

```json
{
  "schemaVersion": 2,
  "profileId": "emulator-hub-profile-uuid",
  "hubEpoch": 0,
  "revision": 1,
  "hubProfiles": [
    { "hubProfileId": "uuid", "name": "Shiny collection", "boxOrder": ["uuid"] }
  ]
}
```

Each Hub box is independently versioned and stores `{ hubBoxId, hubProfileId, name, columns, rows, slots }`, where `slots.length === columns * rows` and each value is `null` or an immutable `hubPokemonId`. This keeps large boxes isolated from profile metadata and makes box-level expected revisions possible later. A Pokémon document location becomes `{ kind: "hub", hubProfileId, hubBoxId, slot }`.

Migration is deterministic and idempotent. On the first read of a schema-version-1 inventory, the backend creates one Hub profile named `Pokémon Hub`, one box named `Box 1` with `columns: 6`, `rows: 5`, and copies the 30 existing slot references in order. Existing Pokémon documents change only their Hub location fields to point at that generated profile/box. The original inventory remains recoverable until the migration transaction commits. A failed or interrupted migration must retry safely and never duplicate a Pokémon reference.

Hub profile and box names are trimmed, non-empty, case-insensitively unique within their respective parent collection, and length-limited by the backend. Deleting a non-empty box or Hub profile is refused in this slice; moving its Pokémon elsewhere is required first. This avoids hidden deletion or accidental data loss.

## API and package boundary changes

Reusable models, migration, validation, and storage contracts remain in `apps/packages/`; React only renders projections and uses `hub-client`.

The inventory route evolves to return a workspace projection rather than a flat 30-slot array:

```text
GET /api/profiles/{profileId}/pokemon-hub
  -> { hubEpoch, revision, hubProfiles, games }
```

`hubProfiles` contains profile metadata and box summaries; a selected box projection is fetched lazily:

```text
GET /api/profiles/{profileId}/pokemon-hub/profiles/{hubProfileId}/boxes/{hubBoxId}
  -> { hubProfile, box: { id, name, columns, rows, revision, slots } }
```

The backend exposes profile/box create, rename, reorder, and empty-only delete routes. Every mutation uses optimistic revision preconditions. Transfers accept the extended Hub location and return enough refreshed source/destination projection metadata for the client to reload exactly the changed panes. Existing game locations and Gen III bounds are unchanged.

The backend performs the two-Hub-pane source constraint as part of a workspace-selection validation endpoint only if selection state becomes server-managed; otherwise React enforces it as a UI rule. Transfer validation remains backend-enforced and is independent of the current visual layout.

## Frontend components and state

The React implementation splits the former `main.jsx` Hub modal behavior into focused components:

- `PokemonHubApp`: profile-gated app entry, workspace lifecycle, loading/error boundary.
- `PokemonHubWorkspace`: owns two pane source descriptors and shared transfer selection/confirmation.
- `PokemonHubPane`: source selector, game box chooser or Hub profile/box navigator, status, and slot grid.
- `PokemonHubGameGrid`: renders exactly adapter-projected native slots.
- `PokemonHubBoxGrid`: renders a configurable Hub box in an overflow viewport.
- `PokemonHubProfileManager`: creates and manages organizational profiles and boxes.
- `PokemonHubTransferConfirm`: contains the final transfer summary and invokes the existing transfer client contract extended for Hub box locations.

React state retains identifiers, display projections, selection, loading, and error state only. It does not cache raw save bytes or raw Pokémon records. URL state is not required in the first slice.

## Accessibility and visual constraints

- Every grid cell is a keyboard-focusable button with an accessible label containing its side, box, position, and occupied/empty state. Direction and confirmation are not color-only.
- The two panes retain the existing dark-green visual language and have clear headings. Scrollable grids remain operable by keyboard and pointer.
- Empty, loading, disabled-active-game, and transfer-pending states are visible and announced through a polite status region.
- No sprite source is selected by this spec. The first workspace uses species number/name projection and a neutral occupied marker until a separately licensed asset decision is made.

## Acceptance criteria

1. Pokémon Hub appears as a profile-gated application card and opens a dedicated closable workspace, not a sidebar modal.
2. The workspace has two equal pane sources. Each can load a supported inactive profile save or a Pokémon Hub profile; two Hub-profile sources and duplicate game sources are prevented.
3. A Gen III pane always exposes exactly 14 native boxes of 30 slots and never permits UI configuration that could address memory outside those bounds.
4. A player can create multiple named Hub profiles and multiple named boxes within each profile; boxes persist player-selected dimensions from 1 × 1 through 30 × 30 and scroll on both axes when necessary.
5. A Hub profile can contain more boxes than fit in the UI; creating a box is explicit, and deleting a non-empty box/profile is refused.
6. A transfer between selected panes submits only validated identifiers, locations, revisions, and epoch; it preserves all existing backend integrity, active-session, and anti-duplication behavior.
7. Existing schema-version-1 30-slot Hub data migrates once into a default profile and 6 × 5 box without lost or duplicated references.
8. The browser never accepts an arbitrary save file or receives writable raw save/Pokémon binary data.

## Explicit deferrals

- Hub card artwork and licensed Pokémon sprites.
- Virtualized grids larger than 30 × 30.
- Drag-and-drop transfers, bulk selection, sorting, filtering, search, tags, or automatic box creation.
- Deleting non-empty organizational collections, cross-profile sharing, or a second account.
- Cross-generation conversion and direct user editing of Pokémon fields.

