---
title: Pokémon Hub Workspace Frontend
date: 2026-09-17
tags: [spec, pokemon, hub, frontend, react]
status: superseded
---

# Spec 012 — Pokémon Hub Workspace Frontend

> Superseded by [Spec 013](013-pokemon-hub-profile-creation-plan.md). Hub profiles now persist only sparse occupied slot entries: row count, column count, capacity, and empty slots are visual state derived from the current partition.

## Goal

Make Pokémon Hub a first-class application in Emulator Hub rather than a sidebar modal. It appears beside ROMs as a compact application card; artwork is deliberately deferred. Opening the card presents a full Pokémon-management workspace with one empty partition. The player first creates and selects Pokémon Hub profiles; game-save loading and transfers follow in later slices. The backend remains the sole authority for persisted profile documents, revisions, save bytes, and transfer integrity.

This spec supersedes only the modal/sidebar parts of Spec 011. Its binary-adapter, profile-scope, anti-duplication, session, save-state, and licensing constraints remain mandatory.

## Terminology and ownership

- **Emulator Hub profile**: the existing backend-owned player profile. It continues to own a game save when a game source is loaded in a later slice.
- **Pokémon Hub profile**: a named, user-created organization record stored in the Pokémon Hub NoSQL collection. It is selected directly inside the Pokémon Hub workspace; it is not the generic Emulator Hub profile shown when launching a game.
- **Hub grid**: the initial empty container created with a Pokémon Hub profile. Its fixed-size cards are laid out from the live partition width, never by persisted dimensions. It contains sparse occupied slot references and is not a game PC box.
- **Game box**: a native adapter-defined PC box. For Gen III, it is exactly one of 14 boxes with exactly 30 slots. Its dimensions and capacity are fixed by the save format and never configurable in the UI.
- **Partition source**: the currently selected game save or Pokémon Hub profile shown in one workspace partition.

The generic Emulator Hub profile list is never an entry gate for Pokémon Hub and is never rendered as a Pokémon Hub profile selector. The ownership contract for loading a game save into a partition will be specified before that source type is enabled.

## Entry and navigation

- The main application grid renders a Pokémon Hub card alongside game cards. The card opens directly, without a generic Emulator Hub profile picker. It has a neutral application placeholder until product artwork is designed.
- Opening it replaces the hub grid with a dedicated, closable Pokémon Hub workspace. It does not create an EmulatorJS iframe and it does not need a ROM launch descriptor.
- Closing returns to the normal card grid. Opening Hub never changes the current profile.
- The former sidebar Pokémon Hub action and its modal are removed once this workspace ships; there must be one entry point and one transfer UI.

## Workspace partitions

The workspace opens with exactly one empty partition. It must not render a second or third partition merely because the workspace supports them conceptually. A future explicit partition action may add one and then cause the content area to divide into two or three equal panes; that action is not part of the current slice.

The initial partition has a source selector with these choices:

1. **Game save** — deferred: no selector data is loaded in this slice.
2. **Pokémon Hub profile** — a profile from the Pokémon Hub NoSQL collection.

### Source-selection contract

Clicking the Pokémon Hub card opens the workspace directly. It must not show the generic Emulator Hub profile picker before rendering the workspace.

The workspace has two stacked headers. The first contains only the close action. The second contains the partition's `profile type` selector and matching `choose profile` selector. When the selected type is `Pokémon Hub profile`, the selector has a `+` action immediately beside it. This `+` creates a Pokémon Hub profile; it does not create another partition.

| Selected type | `choose profile` data source | Selected identifier |
| --- | --- | --- |
| Game save | Deferred until its owner-selection and save-loading flow is specified | `gameId` |
| Pokémon Hub profile | `GET /api/pokemon-hub/profiles`, backed by the Pokémon Hub NoSQL collection | `hubProfileId` |

With no stored Hub profiles, the selector remains empty and the `+` action remains available. Pressing it opens a modal with the creation controls: a required profile name, columns, and rows. Columns and rows are integers from 1 through 30. Submitting creates one persisted Hub profile with one empty grid, refreshes the selector, selects the new profile, and renders its grid in the sole partition.

The generic Emulator Hub profile list from `GET /api/profiles` must never be rendered before entering the workspace or as the per-partition `choose profile` list.

“Load a specific save” means selecting a specific game already configured in the profile. There is no file picker, upload, drag-and-drop save import, arbitrary filesystem path, download, or browser-provided binary write.

Each game source shows its title, save status, current save revision, and a native-box chooser. Gen III offers exactly boxes 1–14. Selecting a box shows its 30 slots in the adapter-provided order. The UI may use a 6 × 5 visual layout but must map each displayed cell one-to-one to `{ kind: "game", gameId, box: 0..13, slot: 0..29 }`; it must not add, resize, paginate as another native box, or otherwise imply capacity the save cannot store.

Each Hub profile source shows:

- a profile selector and an action to create a profile;
- the selected profile's player-defined empty grid; and
- the empty state and capacity.

The current slice creates exactly one grid with the profile. It does not create another grid merely because it becomes full. Grid dimensions are positive bounded integers validated by the backend; the first UI uses columns 1–30 and rows 1–30, therefore a grid can represent 1–900 slots. Managing additional grids, renaming, reordering, and deletion are deferred.

When a configured Hub grid exceeds the available pane, its cells live in a two-dimensional scrolling viewport: vertical scrolling reaches additional rows and horizontal scrolling reaches additional columns. The box header and selection state stay visible while the grid scrolls. The implementation virtualizes cells before accepting dimensions beyond the initial 30 × 30 bound in a future spec.

## Deferred interaction and transfer flow

This section describes a later transfer slice only. It does not authorize a second partition, game-source loading, selection, or transfer UI in the current profile-creation slice.

- A player selects an occupied slot as the source, then an empty slot in the other pane as destination. The active source/destination border and textual summary make direction explicit.
- A selection can start from either pane. Selecting a second occupied slot replaces the source; selecting an empty slot in the same pane does not create a transfer.
- Before mutation, the UI presents a compact confirmation identifying the Pokémon projection, source, destination, game/Hub profile name, native game box/slot where relevant, and a warning that active games are unavailable.
- Confirmation sends stable backend locations plus expected game revisions and the current Hub epoch. The browser never computes save offsets or writes a representation.
- Success refreshes both pane sources, retains their chosen box/profile/box selection where it still exists, clears transfer selection, and announces the result. Failure refreshes authoritative projections for revision conflicts and leaves local selection only when still valid.
- Active, missing, malformed, uninitialized, unsupported, stale, source-empty, destination-full, integrity-conflict, and cross-adapter errors display actionable status in the owning pane. No visual action suggests that an invalid move succeeded.

## Hub organizational persistence

Pokémon Hub profiles are stored as independent documents in the Hub's local NoSQL collection. A profile is created with one empty grid and stores its generated `hubProfileId`, name, timestamp, grid dimensions, and slot array. Its grid has exactly `columns * rows` slots. Profile names are trimmed, non-empty, case-insensitively unique, and length-limited by the backend.

The profile-creation slice does not migrate, read, or mutate the fixed 30-slot transfer inventory from Spec 011. That existing inventory and its Pokémon documents remain unchanged until a later transfer-integration spec defines the migration and ownership bridge.

## API and package boundary changes

Reusable validation and NoSQL storage contracts remain in `apps/packages/`; React renders projections and calls `hub-client`.

The current API is deliberately limited to the Hub profile collection:

```text
GET  /api/pokemon-hub/profiles -> { profiles }
POST /api/pokemon-hub/profiles <- { name, columns, rows } -> profile
```

The backend validates the body and persists the profile before responding. Game loading, profile/box mutation beyond creation, workspace-selection validation, and transfers are deferred.

## Frontend components and state

The React implementation splits the former `main.jsx` Hub modal behavior into focused components:

- `PokemonHubApp`: direct entry, workspace lifecycle, and loading/error boundary.
- `PokemonHubWorkspace`: owns one partition descriptor and the Hub-profile list.
- `PokemonHubPaneControls`: chooses the source type, selects a Hub profile, and opens the profile-creation controls.
- `PokemonHubProfileCreator`: submits a profile name and grid dimensions.
- `PokemonHubPane`: renders the selected Hub profile's empty grid.

React state retains identifiers, display projections, selection, loading, and error state only. It does not cache raw save bytes or raw Pokémon records. URL state is not required in the first slice.

## Accessibility and visual constraints

- Every grid cell is a keyboard-focusable button with an accessible label containing its position and empty state.
- The one partition retains the existing dark-green visual language. Scrollable grids remain operable by keyboard and pointer.
- Empty, loading, creation-error, and creation-pending states are visible and announced through a polite status region.
- No sprite source is selected by this spec. The first workspace uses species number/name projection and a neutral occupied marker until a separately licensed asset decision is made.

## Acceptance criteria

1. Pokémon Hub opens directly into a dedicated, closable workspace with one empty partition.
2. Selecting `Perfil do Hub` shows only NoSQL Hub profiles and never generic Emulator Hub profiles.
3. An empty Hub profile collection shows an empty selector and the adjacent profile-create `+` action.
4. A player can create a uniquely named Hub profile with dimensions from 1 × 1 through 30 × 30.
5. Creating a profile persists it, selects it, and renders exactly its empty grid without adding a second partition.
6. The browser never accepts an arbitrary save file or receives writable raw save/Pokémon binary data.

## Explicit deferrals

- Hub card artwork and licensed Pokémon sprites.
- Game-save source ownership and loading.
- Creating additional workspace partitions, transfers, drag-and-drop, bulk selection, sorting, filtering, search, tags, or automatic grid creation.
- Renaming, deleting, reordering, or adding grids to a Hub profile.
- Virtualized grids larger than 30 × 30, cross-generation conversion, and direct user editing of Pokémon fields.

