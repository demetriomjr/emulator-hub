---
title: Pokemon Hub Save Profile Selection
date: 2026-09-17
tags: [spec, pokemon, hub, save, profile, navigation]
status: active
---

# Spec 017 - Pokemon Hub Save Profile Selection

## Goal

Enable the `Perfil de Save` source in each Pokemon Hub workspace pane through
two explicit selections: first a ROM that has one or more persisted Emulator
Hub profiles, then one of that ROM's profiles. Selecting the profile loads that
identified save source into the pane. The native PC-box layout and Pokemon
records inside the pane are deliberately out of scope for this slice.

## Scope and terminology

- A **save profile** is the existing Emulator Hub profile stored for one game.
  It is not a new document and it is not a Pokemon Hub profile.
- Its complete, durable identity is `{ kind: 'game', gameId, profileId }`.
  `gameId` is the trusted ROM/catalog identity and `profileId` belongs only to
  that game collection.
- A **eligible ROM** is a catalog entry whose current ROM status is `ready` and
  for which the generic profile store currently returns at least one profile.
  A ROM without a persisted profile is not displayed in the first selector.
- A **partially selected game source** is `{ kind: 'game', gameId }`. It is an
  in-memory navigation state only and is not a loadable or duplicate source.
- A **loaded save source** is a complete game source after its profile has been
  selected. The browser retains only its identifiers and safe display
  projections; it never receives raw save bytes.

This navigation applies to the existing Pokemon Hub workspace panes from Spec
014. It neither changes game launching nor creates, renames, deletes, uploads,
downloads, or synchronizes a save profile.

## Frontend preload behavior

At application startup, `GET /api/games` fetches one shared, light catalog. Every
ROM entry includes its safe generic-profile projection, including an empty list
for a ready ROM with no profile. The ROM cards, their profile picker, and the
Pokemon Hub all consume that same React catalog state; opening the Hub never
clears or refetches it. The Hub calculates eligible ROMs and loaded-pair
exclusion locally from that cached catalog.

Opening the workspace may independently fetch Hub profiles, because they are
not represented in the ROM catalog. It does not fetch generic ROM profiles,
Party, Box, or Pokemon-slot projections. The latter projections are requested
only after a complete `{ gameId, profileId }` source is selected.

## Existing contracts to preserve

`apps/packages/profile-store.mjs` persists generic profiles in Redis under a
separate key for each `gameId`. `GET /api/games` returns its safe profile list
alongside every verified ROM, while `GET /api/games/:gameId/profiles` remains
available for direct collection operations. React does not use the latter to
populate ordinary selectors after startup.

The ROM catalog remains backend-owned. Only a currently verified `ready` ROM is
eligible. Rejected, missing, changed, unavailable, or manually invented ROM
identities must never be returned as a save-profile choice. This preserves the
trusted catalog boundary established by Spec 015.

The workspace helper's duplicate rule remains authoritative: the same complete
pair `{ gameId, profileId }` can appear in at most one pane, while the same ROM
may appear in multiple panes when each pane chooses a different profile for it.
Hub profile uniqueness remains unchanged.

## Backend contract

`GET /api/games` is the shared selector contract:

```text
GET /api/games
  -> {
       games: Array<{
         id: string,
         title: string,
         system: string,
         status: 'ready' | 'unavailable',
         region?: string,
         coverUrl?: string,
         profiles: Array<{ id: string, name: string, createdAt: string }>
       }>
     }
```

The backend continues to own catalog verification and queries each verified
ROM's generic profile collection once while constructing this response. An
unavailable ROM has `profiles: []`; it never exposes a profile from an
unverified ROM. This projection contains profile identity and display metadata
only: it never exposes save bytes, hashes, filesystem paths, registry payloads,
or adapter internals.

`GET /api/pokemon-hub/save-profile-games` remains a backward-compatible route,
but new frontend flows do not call it. `GET /api/games/:gameId/profiles` keeps
its direct collection contract for profile operations and catalog validation.

## Workspace interaction

1. Opening Pokemon Hub opens an empty workspace and may load Hub profiles
   independently. It reuses the application catalog without clearing or
   refetching generic ROM profiles or saves.
2. Each pane presents two icon toggles instead of a profile-type selector: a
   box for a Hub profile and a game controller for a Save profile. Choosing a
   toggle selects the first locally available source of that kind; choosing the
   Save toggle selects both its first eligible ROM and its first available
   profile, with no selector request.
3. The first game selector is labeled `ROM com perfil` and locally filters the
   shared catalog to ready ROMs with at least one profile still available in
   another pane. It shows the ROM title; cover art and box layout are not part
   of this selector. It is loading only while the initial application catalog is
   unresolved.
4. Selecting a ROM sets `{ kind: 'game', gameId }` and clears that pane's former
   save-profile choice and transient slot selection. It performs no request.
5. The second selector is labeled `Perfil de Save`. It lists that selected
   ROM's cached profile names and remains unavailable until a ROM is selected.
6. Selecting a profile attempts to set the complete source
   `{ kind: 'game', gameId, profileId }`. The existing uniqueness helper
   rejects only an exact pair already loaded in another pane. If rejected, the
   current pane keeps its preceding selection and shows the existing duplicate
   message.
7. A successful choice requests the Party/Box projection for that exact pair;
   this is the first Pokemon Hub request for a Save source. No save mutation is
   performed.
8. Clearing the profile keeps the selected ROM and returns to the second-step
   profile selector. Changing or clearing the ROM clears the dependent profile.
   Changing the pane type or closing the pane clears all of its transient
   selection state and immediately releases any complete source for other panes.

The generic `GET /api/profiles` collection is not introduced. There is no such
global collection because generic profiles are deliberately scoped by `gameId`.

## State and package boundaries

`apps/packages/hub-client.js` validates the expanded `GET /api/games` profile
projection before React consumes it. `getSaveProfileLayout` remains the only
Save-source fetch initiated by a completed Pokemon Hub selection.

`apps/packages/save-profile-catalog.mjs` derives the ready-ROM-with-profiles
projection and profiles-by-ROM map from the shared catalog. `apps/packages/
pokemon-hub-workspace.mjs` remains the pure source-identity and duplicate
boundary. It must continue to accept incomplete `{ kind: 'game' }` and
`{ kind: 'game', gameId }` states, and treat only a complete
`{ kind: 'game', gameId, profileId }` as reserving a source.

React owns the shared catalog state and the per-pane navigation state. Profile
create, rename, and delete operations update the same cached ROM entry so the
ROM cards, profile picker, and all Hub selectors stay coherent without another
catalog read. It must not use the single workspace-wide `pokemonHubProfile` /
`pokemonHubData` state as an implicit generic-profile selection, because
separate panes can load different save profiles.

The backend owns catalog verification and profile-store reads. No shared code is
added at the repository root; any reusable validation belongs under
`apps/packages/`.

## Error and empty states

- If there are no eligible ROMs in the shared catalog, display that no ROM with
  a saved profile is available and leave both selection values empty.
- A failed initial catalog request leaves the selectors disabled and exposes the
  safe catalog error without erasing an already selected source.
- If a profile changes after startup, a successful create, rename, or delete
  updates the cached catalog. A profile deleted by another client can no longer
  load a layout because the backend ownership check remains authoritative.

## Explicit deferrals

- The native Party/Box layout introduced by Spec 018 is limited to its current
  read-only rendering and navigation behavior; sprites, detailed Pokemon
  records, and save revisions remain outside this selector-cache change.
- Restricting this navigation to a particular Pokemon save adapter. Eligibility
  here is intentionally based only on a trusted ready ROM plus an existing
  generic profile; later box rendering may add adapter-specific support checks.
- Loading raw save bytes in the browser, profile creation from Pokemon Hub,
  transfer, active-session validation, optimistic save writes, or snapshot
  invalidation.
- Persisting a workspace layout or a selected pane source.

## Acceptance criteria

1. The initial `GET /api/games` response includes a safe profile list for every
   ROM. The ROM cards and profile picker use that same catalog without a
   per-ROM profile-list request.
2. Opening Pokemon Hub and choosing `Perfil de Save` makes no ROM/profile
   selector request. It shows only ready, trusted ROMs with one or more generic
   profiles still available; a ROM with no profile is absent.
3. Choosing a ROM lists only its cached profiles. Selecting one stores the
   exact `{ gameId, profileId }` pair and then requests only that pair's
   Party/Box projection.
4. The same ROM may be selected in multiple panes when the selected profile IDs
   differ; the same pair is unavailable in another pane. Clearing/changing a
   ROM clears its dependent profile.
5. Creating, renaming, or deleting a profile updates the shared catalog so all
   selectors remain coherent without refetching it.
6. No selector request uploads/downloads a save or exposes raw save bytes,
   hashes, filesystem paths, or adapter internals.
7. Automated tests cover the catalog profile contract, local ready/profile
   filtering, client response validation, and workspace duplicate behavior. No
   project build is run.
