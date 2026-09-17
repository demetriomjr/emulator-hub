---
title: Pokémon Hub Profile Creation
date: 2026-09-17
tags: [spec, pokemon, hub, profile, nosql]
status: active
---

# Spec 013 — Pokémon Hub Profile Creation

## Scope

Implement direct Pokémon Hub entry, creation, selection, renaming, and deletion of a selectable Pokémon Hub profile. Do not load a game save, create an additional workspace partition, or implement a Pokémon transfer in this slice.

## Persisted NoSQL document

The Pokémon Hub profile store persists one JSON-document collection independently of generic Emulator Hub profiles and game `.sav` files. Each document has this public projection:

```json
{
  "schemaVersion": 5,
  "hubProfileId": "uuid",
  "name": "Shiny collection",
  "createdAt": "ISO-8601",
  "grid": {
    "entries": {}
  }
}
```

`name` is NFC-normalized, trimmed, 1–26 printable characters, and case-insensitively unique. `entries` is the only persisted grid state: it contains only occupied positions, keyed by their zero-based slot number, and the value is the stored Pokémon/card record for that position. Empty slots have no key and are never written. The key is the Pokémon's canonical placement in the Hub; relocating a Pokémon updates the source and destination keys atomically when transfers are introduced.

There is no persisted capacity, width, row count, column count, or visual layout. A new profile has `{ "entries": {} }`. The frontend derives slots from the current partition width: square cards share the available width proportionally and wrap into another row rather than creating a horizontal scroll area. An empty profile renders five rows at most. The final rendered row is always completely empty; moving a Pokémon into that final row therefore makes the frontend render one further empty row immediately. The backend generates the UUID and timestamp. Existing schema-version-1 through schema-version-4 documents are migrated on load to schema version 5: occupied values and their slot keys are preserved, null placeholders and former capacity/layout values are removed.

The creation modal contains only the full-width name field and a rounded, prominent creation button. It is a compact 400px dialog with a full-width visual title block (icon, title, and a short purpose line). The workspace uses Ant Design `Select`, `Button`, `Modal`, `Popconfirm`, and official icons for this profile-creation flow.

## Ownership boundary

- The **Hub profile store** owns the sparse `entries` placement map. It is the sole persistence authority for which Hub slot contains a Pokémon; it never writes an empty slot or a layout measurement.
- The **transfer service**, when the move flow is connected, owns a relocation transaction: it validates the game save and the selected Hub profile, clears the source placement, writes the destination placement, and preserves the card/Pokémon payload. A move must never infer a new position from a visual row or column.
- The **frontend** owns only presentation: it measures its current partition, calculates columns and trailing empty slots, and sends the selected zero-based slot key. Resizing must not cause a profile write.
- The **game-profile/save stores** continue to own save files. The legacy fixed, generic-profile Hub inventory is not the storage model for a selected Pokémon Hub profile and must not be used when this transfer flow is connected.

## HTTP contract

```text
GET  /api/pokemon-hub/profiles
  -> { profiles: HubProfile[] }

POST /api/pokemon-hub/profiles
  <- { name }
  -> HubProfile

PATCH /api/pokemon-hub/profiles/:hubProfileId
  <- { name }
  -> HubProfile

DELETE /api/pokemon-hub/profiles/:hubProfileId?discardOccupied=true|false
  -> { hubProfileId, discardedPokemonCount }
```

`POST` and `PATCH` return 400 for invalid names and 409 for a duplicate name. `DELETE` returns 409 when the profile has occupied slots unless `discardOccupied=true` is explicitly supplied. All routes use the Hub profile NoSQL collection, never `/api/profiles` or a game-save endpoint.

## Workspace behavior

1. Opening the Pokémon Hub card opens one empty partition directly.
2. Choosing `Perfil do Hub` requests and renders the Hub profile selector.
3. If the collection is empty, the selector contains only its placeholder and a `+` button next to it.
4. `+` opens a modal with only a profile-name input.
5. Submitting persists a profile with empty sparse entries, selects it, and renders at most five responsive rows in the existing partition.
6. Hub slots are responsive white squares so a Pokémon sprite fits without distortion. Every slot has a compact, black, white-numbered label flush to its upper-left corner, clipped to and respecting the parent card's rounded corner. The workspace area behind the white slots uses a medium gray-green surface around RGB 160. The profile header has the same width as the grid: the centered profile name, a prominent Pokémon count on the left, and rename/delete controls on the right. Dimensions are not displayed.
7. The grid derives its positions from sparse entries and the available partition width after workspace padding and margins. Its header and cards share the responsive partition width. Cards are square, divide the available width proportionally, and wrap to a new row when needed; the Hub grid never creates its own horizontal scroll area. An empty profile renders at most five rows. It always renders a full empty row after the highest occupied row, so adding to the prior final row immediately exposes another empty row. It stores no layout measurement or empty slot.
8. Renaming opens a modal and preserves the profile's occupied entries.
9. Deleting always asks for confirmation. When one or more slots are occupied, the confirmation states the exact number of Pokémon that will be lost and sends the explicit discard acknowledgement to the backend.
10. The layout remains one partition throughout this slice; the later divider behavior is defined by Spec 014.

## Tests

- Store: creates a profile with no empty-slot placeholders or layout values from a name, migrates legacy slot arrays and schema-4 capacity values to sparse entries, lists, renames, deletes, rejects duplicate normalized names, and blocks deletion of occupied slots until explicitly acknowledged.
- HTTP: an empty list is returned; POST persists a profile from its name; PATCH changes its name; DELETE removes it through the Hub profile collection.
- Workspace: the initial state contains one partition and no partition-add operation is rendered by the profile-creation controls.
- Grid: derives responsive columns without a persisted layout width, renders an empty profile in at most five rows, and preserves one complete empty final row after the highest occupied slot without persisting empty slots.
