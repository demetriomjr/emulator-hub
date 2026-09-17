---
title: Pokemon Hub Save Box Layout
date: 2026-09-17
tags: [spec, pokemon, hub, save, gba, party, boxes, layout]
status: active
---

# Spec 018 — Pokemon Hub Save Box Layout

## Goal

Render the native storage view for a selected save profile in a Pokemon Hub pane. The first supported title family is the five Generation III Game Boy Advance titles: Pokemon Ruby, Sapphire, Emerald, FireRed, and LeafGreen.

Each selected save source shows its active Party first, then its PC Boxes. The visual components, cards, selection treatment, and dark-green workspace language remain consistent with the existing Hub-profile grid. This feature is read-only: it reveals a safe projection of the selected save and does not transfer, alter, upload, download, launch, or otherwise mutate it.

## Confirmed Generation III layout

Generation III has:

- one Party with six fixed positions;
- fourteen PC Boxes;
- thirty positions per Box;
- a six-column by five-row Box grid; and
- 420 PC positions in total.

The five named GBA titles share this visual geometry. Their save-data offsets are title-family metadata, not a frontend assumption. The layout profile owns that distinction even when the rendered geometry is currently identical.

## Layout profiles

`apps/packages/pokemon-save-layouts.json` is the declarative catalog of save-layout profiles. A profile is selected by the trusted catalog entry's explicit `pokemonSave.layoutProfile` value; the backend rejects a profile that is absent or incompatible with the entry's registered save adapter.

For the initial family, the JSON contains one profile for each title:

| Profile ID | Title | Party geometry | Box geometry |
| --- | --- | --- | --- |
| `pokemon-ruby-gba` | Pokemon Ruby | 6 slots | 14 × 30, 6 × 5 |
| `pokemon-sapphire-gba` | Pokemon Sapphire | 6 slots | 14 × 30, 6 × 5 |
| `pokemon-emerald-gba` | Pokemon Emerald | 6 slots | 14 × 30, 6 × 5 |
| `pokemon-firered-gba` | Pokemon FireRed | 6 slots | 14 × 30, 6 × 5 |
| `pokemon-leafgreen-gba` | Pokemon LeafGreen | 6 slots | 14 × 30, 6 × 5 |

The profile also declares the Generation III Party location necessary for server-side decoding. Nothing in React derives an offset from a game ID, title, region, or adapter name.

## Backend contract

After the existing two-stage selector resolves an exact `{ gameId, profileId }`, the frontend may request:

`GET /api/pokemon-hub/save-profiles/:gameId/:profileId/layout`

The backend must:

1. locate the trusted catalog entry and the generic profile scoped to that exact game;
2. require a supported configured save adapter and a compatible layout profile;
3. read the backend-owned stored save for that exact game/profile pair;
4. decode only safe slot projections, never raw bytes, checksums, file paths, hashes, or save revisions; and
5. respond with the layout geometry plus the six Party projections and fourteen Box projections.

Each slot projection is either `{ occupied: false }` or a safe display object such as `{ occupied: true, species, shiny }`. The response never contains a representation that can be written back to a save. A missing save, unknown profile, unsupported layout, or unreadable save returns a safe error and leaves other panes unaffected.

A missing save has the explicit `404` response code `SAVE_MISSING`. It is
checked before layout support so a newly created profile for a title that has
not yet been played is never presented as an unsupported layout.

## Frontend behavior

- The exact selected pair keys its independent content cache and selected Box index. Different profiles of the same ROM cannot share navigation state.
- While the content projection is loading, the pane retains its selected ROM/profile identity and shows a compact loading state.
- For `SAVE_MISSING`, the pane shows a centered card explaining that the profile
  does not yet have a save and must first be played and saved. It is not an
  error alert and does not render Party or Boxes.
- The Party is a centered six-card row. Each Party slot has a compact green
  `Party` strip along its bottom edge, visually separate from its upper-left
  position number.
- A divider separates Party from PC storage.
- The active Box is labeled `Box N de 14` and rendered as 30 cards in a fixed 6 × 5 grid.
- The Box control is an outlined header with the same width as the six-card
  row. Its previous/next buttons use directional icons and cycle continuously:
  previous from Box 1 opens Box 14, and next from Box 14 opens Box 1. They
  change only the current pane's local selected Box index.
- Save and Hub slots use the shared fixed slot dimension. Save Box rows remain
  six columns wide and centered; they do not stretch to consume spare pane
  width. The grid uses the existing occupied/empty/selected card treatment and
  accessible per-position labels. Selecting slots, transfer actions, and save
  writes remain deferred.
- Hub-profile rendering remains unchanged.

## Explicit deferrals

- Slot selection, transfers, drag-and-drop, edits, releases, reordering, and save writes.
- Pokemon sprites, names, moves, stats, summaries, box names, wallpapers, and party ordering writes.
- Layout profiles for titles outside the five Generation III GBA titles.
- Browser access to raw save bytes and any persistence of the selected Box or pane layout.

## Acceptance criteria

1. A selected supported Generation III save profile renders six Party positions above a divider and PC storage below it.
2. The PC view renders exactly 30 positions per active Box in six columns and five rows, with navigation over exactly fourteen Boxes.
3. Ruby, Sapphire, Emerald, FireRed, and LeafGreen resolve through distinct JSON profile IDs while rendering the same current geometry.
4. Each pane preserves its own active Box when another pane changes its Box, including when two panes use different profiles of the same ROM.
5. The route only returns safe display projections and no client code reads a `.sav` file or raw save bytes.
6. An unavailable/missing/unsupported saved layout reports an error in that pane without disturbing another selected source.
7. Automated tests cover layout-profile validation, Gen III Party/Box projection dimensions, endpoint scoping and safe response shape, and independent per-pane Box navigation. No project build is run.
