---
title: Profile-scoped Pokémon Hub
date: 2026-09-17
tags: [spec, pokemon, saves, backend, binary-data]
status: draft
---

# Spec 011 — Profile-scoped Pokémon Hub

> **Current scope:** Spec 012 and [Spec 013 — Pokémon Hub Profile Creation](013-pokemon-hub-profile-creation-plan.md) supersede this document for Pokémon Hub entry, workspace layout, Hub-profile selection, and Hub-profile persistence. This specification remains authoritative only for the existing profile-scoped game-save transfer engine until a later integration spec connects that engine to the new Hub-profile collection. Its former modal and generic-profile-picker UX must not be reintroduced.

## Goal

Provide a deliberately small, Pokémon HOME-like **Pokémon Hub** inside Emulator Hub. Pokémon Hub is the product name; it is not Pokémon Bank or Pokémon HOME. It uses only the selected backend-owned profile and the profile's already-managed in-game save bytes: no save-file picker, import, export, or arbitrary path is ever exposed to the player. A player can move a Pokémon from a supported game's PC boxes into Pokémon Hub, from Pokémon Hub back into a game's PC boxes, or directly from one supported game to another through the Hub transaction model.

This replaces the unavailable live link-cable interaction between concurrent EmulatorJS games. It does not emulate a link cable, trade animation, battle, Pokédex, gifts, or cloud-service protocol.

## Product boundary and first slice

The first runnable implementation supports only the exact Generation III GBA save family already represented by the verified Pokémon Emerald catalog entry: Ruby, Sapphire, Emerald, FireRed, and LeafGreen. A same-family transfer retains a Pokémon's native encrypted 80-byte PC record. Pokémon Hub is deliberately a profile-level holding area rather than a second generic Pokémon editor.

Later save families are added one at a time through a parser/writer adapter and fixture suite. Cross-generation conversion, arbitrary ROM hacks, party slots, held-item conversion, ribbon conversion, legality analysis, and editing Pokémon fields are explicitly out of scope for this spec. A later spec must decide the conversion policy before a source and destination adapter from different generations can transact.

## User experience

- The existing hub sidebar gains one compact Pokémon Hub action. It opens a modal over the hub; it must not open or require an active EmulatorJS iframe.
- The Pokémon Hub modal begins with the profile selector already used by the hub. It lists only that profile's eligible configured games with a readable trainer/game summary and its PC boxes, plus the profile's Hub storage. It never lets a user choose a file.
- A transfer is a two-step selection: select exactly one occupied source slot, then select an empty destination slot. The destination may be a Hub slot or an eligible game's PC slot. The UI presents a clear source/destination confirmation before changing bytes.
- Hub slots show a small species sprite, species name/number where available, and a simple empty state. The first slice shows no stats editor or metadata screen.
- If the source or target game is currently active in an EmulatorJS session, Pokémon Hub disables that game and explains that the game must be closed first. This prevents the iframe's next save sync from overwriting an edited server-side save.
- On success, the modal refreshes both source and destination. On stale-save conflict, invalid save, unavailable game, full destination, or backend error, it changes neither side and provides an actionable message.

## Ownership and data model

All binary bytes remain backend-owned under the existing profile namespace. The browser receives a projected inventory for display and submits only stable slot references and expected revisions; it neither receives a writable full save nor calculates offsets/checksums. The frontend is a React projection client: it renders the Hub inventory, game inventories, transfer confirmation, status, and errors. It never owns a mutable Pokémon document or conversion policy.

Pokémon Hub is keyed by `profileId` and has a fixed, product-defined capacity in the first slice (one box of 30 slots). Its local NoSQL document store is the authority for Hub entries, Pokémon history, raw adapter payloads, and future-generation fields. It is independent from the per-game `.sav` store and uses a documented store interface so the first local implementation can be replaced without changing the HTTP or frontend contract.

Each Hub Pokémon is a versioned document, keyed by an opaque `hubPokemonId`; JSON fields are intentionally extensible. The initial shape is:

```json
{
  "schemaVersion": 1,
  "hubPokemonId": "uuid",
  "profileId": "uuid",
  "state": "stored",
  "location": { "kind": "hub", "slot": 0 },
  "identity": { "species": 25, "form": 0, "shiny": false, "nativeIdentity": {} },
  "canonical": {
    "trainer": {}, "moves": [], "stats": {}, "met": {}, "ribbons": [],
    "attributes": {}, "gameData": {}, "unknownFields": {}
  },
  "representations": [
    { "adapter": "gen3-gba-v1", "kind": "pc-record", "bytesBase64": "...", "sha256": "..." }
  ],
  "provenance": { "firstSeenAt": "ISO-8601", "sourceGameId": "pokemon-emerald" },
  "history": []
}
```

`canonical` stores every field the responsible adapter can decode, including values that a future destination cannot encode. `representations` preserves the original binary record for each adapter; adapter-specific values that are not yet understood remain preserved in its byte payload and documented extension fields. `history` records deposit, withdrawal, direct transfer, adapter conversion, and conflict/recovery outcomes with timestamps and source/destination references. The document has no OpenHome-specific container format or public dependency.

When Pokémon Hub materializes a Pokémon into an older game, the destination adapter writes only the fields it explicitly supports. It does not delete, zero, or replace unsupported canonical fields. On a later deposit from that older game, the adapter updates only fields that it owns; the retained newer-generation canonical fields and representations stay intact. A future adapter must declare its read/write field ownership and its conversion loss report before cross-generation transfers are enabled.

## Identity, ownership, and save-state integrity constraint

`hubPokemonId` is the only product-wide, immutable Pokémon identity. It is created by the backend the first time Pokémon Hub accepts a Pokémon and never derives from a game save. A game-specific serial, personality value, encryption constant, checksum, trainer pair, slot position, or raw-record hash is an adapter observation, not a global ID: it may be absent, change during conversion, or legitimately differ in another generation. Each representation therefore records `{ adapter, gameId, nativeIdentity, recordSha256, firstSeenAt, lastSeenAt }`, and the history records which native observations were produced by each Hub transfer.

Pokémon Hub enforces one authoritative location per `hubPokemonId`. A committed transfer records a monotonic per-profile `hubEpoch`, removes the source representation and writes the destination representation in the same recoverable transaction. It may not create a second Hub document for a record that matches a known current representation. When evidence is ambiguous or an already-owned native identity is found in another eligible save, the service treats it as an integrity conflict: it changes no bytes, records an audit event, and requires an explicit future recovery workflow. It must never silently merge, overwrite, or accept a suspected duplicate.

Save states are a separate future feature, but they must obey this contract from their first spec and implementation:

- A state snapshot is bound to `{ profileId, gameId, saveRevision, saveSha256, hubEpoch }` when it is created. It is not a portable Pokémon-transfer artifact.
- Before restoring a snapshot, the player/backend integration verifies that the current backend save revision/hash and profile Hub epoch exactly match the snapshot binding. A mismatch invalidates the snapshot and requires a fresh launch; it must not restore stale game memory and later synchronize it as a new `.sav` revision.
- A successful Pokémon Hub transaction invalidates every snapshot for its source and destination game/profile and advances `hubEpoch`. A future direct game-to-game transfer invalidates snapshots for both games.
- State saving/restoration must remain disabled while a Pokémon Hub transfer is pending, and Pokémon Hub remains unavailable while a matching game session is active.
- Snapshot metadata and invalidation records are backend-owned and durable. The React renderer may display availability/status but cannot forge an accepted binding.

This prevents product-managed save states from reintroducing a pre-transfer source record after a withdrawal or direct move. It does not claim to detect every manually modified save supplied outside the product; adapters must validate known fingerprints and surface conflicts rather than make a false anti-cheat guarantee.

The game catalog gains explicit Pokémon-save metadata rather than guessing from title, emulator core, filename, or ROM bytes:

```json
{
  "pokemonSave": {
    "adapter": "gen3-gba-v1",
    "saveKind": "battery",
    "supported": true
  }
}
```

Only entries with a supported adapter appear as selectable games. A missing, malformed, unrecognized, or newly initialized save is not silently treated as an empty save: the UI reports that it cannot be opened yet. The standard save identity and revision remain the existing `(profileId, gameId)` save resource.

## Binary adapter contract

Reusable binary functionality belongs in `apps/packages/`; UI-specific rendering and HTTP routing do not. The first adapter exposes a narrow contract:

```text
inspect(saveBytes) -> { trainer, game, boxes, slots, saveRevisionFacts }
readSlot(saveBytes, boxIndex, slotIndex) -> Empty | PokemonRecord
writeSlot(saveBytes, boxIndex, slotIndex, Empty | PokemonRecord) -> rewrittenSaveBytes
describe(PokemonRecord) -> safe display projection
spriteKey(PokemonRecord) -> { nationalDex, form?, shiny? }
```

The Gen III adapter validates the 128 KiB double-save layout before use, selects the newest valid sector set, follows its section IDs rather than assuming their physical order, reads the 14 PC boxes of 30 records, preserves native encrypted PC records, and rewrites sector checksums after a changed box record. It must preserve all unrelated save bytes exactly. Each write is tested as a byte-level round trip against real, legally obtained fixture saves: only the intended 80-byte slot data plus required checksum/sector-write changes may differ.

`PokemonRecord` is an opaque adapter-owned value to the service layer. The Pokémon Hub service may move it only when source and destination adapter IDs are identical. This makes a direct game-to-game transfer an atomic move through the same internal operation, not an attempted EmulatorJS link. The adapter additionally maps its decoded data into the versioned canonical document without treating that projection as a substitute for preserved native bytes.

## Local NoSQL persistence

The first backend implementation uses a local, Git-ignored, document-oriented data directory under the backend data root. It stores one JSON document per Hub Pokémon plus a small per-profile inventory document and append-only transaction journals. This is intentionally NoSQL: documents may gain fields as newer game adapters decode them, and an unknown field must survive a read/write cycle. A repository-wide relational schema or a separate database service is not introduced for this slice.

The package boundary is `apps/packages/pokemon-hub-store.*`. It exposes document CRUD only to the transfer service, performs schema-version validation, atomically writes a document revision, and retains the prior document revision for recovery. It does not parse saves or know React/HTTP. `apps/packages/pokemon-hub-service.*` coordinates that store with `save-store`, adapter registry, active-session guard, and transaction journal. The backend supplies authenticated/profile-scoped routes; React consumes typed projections through `hub-client`.

## Transfer transaction and API

The backend owns one transfer operation. It loads the profile, source and target state, validates expected revisions and the current `hubEpoch`, verifies source occupancy and target vacancy, applies mutations in memory, updates/creates the canonical Pokémon Hub document and history, invalidates affected save states, validates rewritten saves, then durably commits every affected save and/or Hub document as one recoverable transaction. It must never commit the removal first and then fail before writing the destination.

The package-level store needs a journaled multi-record commit/recovery mechanism; the current per-file `save-store` atomic rename is insufficient for transfers that modify two games or a game plus Pokémon Hub documents. A durable operation record contains the before/after save hashes, document revisions, Hub IDs, native-identity observations, the old/new `hubEpoch`, and invalidated state IDs; it can finish or roll back after a process interruption and is not exposed as player-editable data.

Read endpoints return projections only:

- `GET /api/profiles/{profileId}/pokemon-hub` returns the Hub capacity, occupied slots, supported inactive games with projected box/slot inventories, current save revisions, and non-sensitive Pokémon projections.
- `POST /api/profiles/{profileId}/pokemon-hub/transfers` accepts `{ source, destination, expectedRevisions }`, where a location is either `{ kind: "hub", slot }` or `{ kind: "game", gameId, box, slot }`. It returns the refreshed source and destination projections, document revisions, and transfer ID.

The server rejects unknown profiles/games, a game that is not catalog-supported, invalid index bounds, an active game, absent/unparseable/unsupported saves, occupied destinations, empty sources, duplicate locations, stale revisions, records unsupported by the destination adapter, and malformed request bodies. A revision conflict returns `412`; no automatic merge or retry occurs.

## Sprite source and licensing

OpenHome's current UI uses a local `BoxIcons.webp` sprite sheet with metadata-driven coordinates, then switches to individual local images for forms that need them. That is a useful rendering pattern, but neither its sprite assets nor its code are assumed reusable. The product must choose and document an independently licensed sprite source before implementation, keep the asset provenance/license beside the asset, and use a deterministic local mapping from the canonical projection to that source.

OpenHome itself is licensed under GPL-3.0. Therefore its TypeScript/Rust binary readers, writers, sprite code, tests, generated assets, and any substantial code excerpts must not be copied into Emulator Hub unless the project is intentionally relicensed and distributed in GPL-3.0 compliance, or the copyright holders grant a compatible exception. This spec permits studying its public design and independently implementing documented/verified save-format behavior; it does not authorize copying OpenHome source. The same license review applies separately to any dependency (including `pkm-rs`) and every sprite dataset.

## Research basis

The reviewed OpenHome repository has a mature save-type registry, per-generation save readers/writers, an opaque Pokémon representation/conversion layer, a local bank, and an image/spritesheet fallback. Its Gen III implementation models the two save copies, sorts sectors by section ID, extracts 14 × 30 PC slots, writes changed records back through the sector layout, and refreshes sector checksums. These are architecture and test-case inputs for an independent adapter, not code to transplant. The repository license is GPL-3.0.

The Emulator Hub already has the required profile-scoped binary save resource (`GET`/`PUT /api/profiles/{profileId}/games/{gameId}/save`) and cloud save synchronizer. Pokémon Hub must use the same backend store and preserve optimistic revisions, never browser-local save namespaces.

## Acceptance criteria

1. With a selected profile and a valid inactive Emerald-compatible save, the player can see the PC boxes and deposit one occupied Pokémon into an empty Pokémon Hub slot without touching unrelated save data.
2. The player can withdraw that Hub record into an empty slot of another inactive supported Gen III game on the same profile; it reappears after that game launches and reloads its saved bytes.
3. A direct transfer between two inactive supported games completes as one operation: either both source removal and destination insertion persist, or neither does.
4. A transfer never crosses profiles and cannot use arbitrary file paths, uploads, downloads, save-file export, or browser-provided binary bytes.
5. An active, missing, uninitialized, malformed, unsupported, or stale save cannot be changed. The prior Pokémon Hub/game data remains recoverable after a forced interruption during commit.
6. Every supported adapter has fixtures covering detection, reading, empty-slot handling, unchanged-save round trip, a one-slot rewrite/checksum update, and malformed input rejection. The transfer service has coverage for game-to-Hub, Hub-to-game, game-to-game, full/empty conditions, stale revisions, and recovery.
7. Depositing a Pokémon creates or updates a versioned canonical Hub document plus a preserved native representation. A future adapter that writes to an older game cannot erase fields it does not own from that document.
8. Each Hub Pokémon has one immutable `hubPokemonId`, while game-native IDs are retained as adapter observations. A suspected duplicate across owned representations is rejected without changing saves or documents.
9. After a Hub transfer, a state snapshot made before that transfer cannot be restored for either affected game: its save hash/revision or `hubEpoch` binding fails, it is invalidated, and a later sync cannot reintroduce the source record.
10. No OpenHome source or assets are copied; it remains technical reference material only.

## Decisions needed before implementation planning

1. Is Emulator Hub intended to be GPL-3.0-compatible? If not, the first Gen III adapter must be an independent implementation and OpenHome stays research-only.
2. Which independently licensed sprite dataset should Pokémon Hub use?
3. Is one 30-slot box the desired initial capacity, or should the MVP expose a different fixed number of slots?

## Implementation plan

The executable architecture, package boundaries, transaction protocol, routes, test sequence, and UI work are in [Pokémon Hub Implementation Plan](011-pokemon-hub-implementation-plan.md). It must be executed task-by-task; it does not authorize copying OpenHome source or running a project build.

## Superseding frontend workspace specification

[Spec 012 — Pokémon Hub Workspace Frontend](012-pokemon-hub-workspace-frontend.md) supersedes this document's fixed 30-slot Hub inventory, sidebar/modal UX, and associated frontend/API projection details. It preserves all ownership, binary-adapter, active-session, transaction, licensing, and anti-duplication constraints established here. Future implementation planning must read both specifications, using Spec 012 as the authority for Hub organization profiles, boxes, workspace layout, and migration from schema version 1.
