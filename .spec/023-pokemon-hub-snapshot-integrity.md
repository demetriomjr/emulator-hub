---
title: Pokemon Hub Snapshot Integrity and Exclusive Sessions
date: 2026-09-17
tags: [spec, pokemon, hub, snapshots, integrity, sessions, synchronization]
status: proposed
---

# Spec 023 — Pokemon Hub Snapshot Integrity and Exclusive Sessions

## Goal

Make every open Pokémon Hub source a server-reserved, versioned snapshot. The frontend may offer immediate local movement, but the backend remains the authority that accepts, corrects, or rejects each synchronized snapshot. No explicit save button exists.

This spec starts with a frontend-only snapshot state machine and exhaustive deterministic tests. Backend session, lock, and persistence implementation is a later phase that must conform to this contract.

## Current boundary

The existing frontend drag interaction is local-only. Current session leases and snapshot bindings are early backend coordination utilities, but they do not yet grant exclusive source ownership, bind an open workspace to a durable snapshot, or reconcile frontend movements. They are not sufficient for this spec on their own.

No implementation work is authorized by this document beyond the frontend test phase defined below. In particular, it does not authorize changing save bytes, calling transfer routes, or enabling persistence from the drag handler.

## Terms

| Term | Meaning |
| --- | --- |
| Source | One independently reservable dataset: `save:{profileId}:{gameId}` or `hub:{hubProfileId}`. A source covers every Party and Box slot in that save, or every slot in that Hub profile grid. |
| Workspace session | One browser workspace identity that owns one or more source leases and their snapshots. |
| Lease | An exclusive, expiring server reservation for one source. It has an opaque token known only to its owning workspace session. |
| Snapshot | The complete rendered state of all sources reserved by one workspace session, including slots, opaque Pokémon identifiers, source revisions, and the last server-accepted sequence. |
| Pokémon instance identifier | An opaque, immutable `pokemonInstanceId` that identifies one physical record across slots and sources. It never encodes its current slot. |
| Placement | One occurrence of an instance identifier at a specific source and slot in a snapshot. |
| Server sequence | A monotonically increasing order assigned by the backend when it accepts a synchronization. Browser wall-clock time is never used for conflict ordering. |

## Identity contract

1. Every occupied displayed slot has exactly one `pokemonInstanceId`; every empty slot has none.
2. A Hub Pokémon uses its existing backend-owned Pokémon identifier as its instance identifier.
3. A save Pokémon receives or reconciles an opaque coordinator-owned identifier during save import, before an editable source snapshot is acquired. Acquisition returns that identifier; it does not mint one. The backend binds it to a versioned native-record fingerprint, not to Party position, Box position, or display species.
4. The browser receives only the opaque identifier and the safe display projection. It never receives raw save bytes, native fingerprints, hash material, lease secrets for unrelated sources, or reconciliation internals.
5. An accepted snapshot has at most one placement for each identifier across every source in that workspace. The eventual backend phase extends that uniqueness check to its authoritative placement index.
6. Movement preserves the identifier. Clearing a slot removes its placement; it does not create a new identifier.

### Source lineage and import reconciliation

Each persisted save has a backend-owned `saveLineageId` that survives its normal revisions. Re-inspecting a known lineage reconciles records in this order:

1. A unique, unmatched exact native-record fingerprint reuses its prior `pokemonInstanceId`, even if it moved to a different slot outside the Hub.
2. If the adapter exposes a continuity key, a unique, unmatched prior record with that key may be reconciled after the adapter verifies the changed fields are valid for that title. For Generation III this key includes PID and original trainer ID, but is only a within-lineage candidate, never a global identifier.
3. A record with no candidate is adopted as newly observed and receives a new server identifier.
4. Two or more viable candidates are ambiguous. The backend preserves the submitted save and prior records, marks the source non-editable, and requires a later explicit reconciliation rule. It must not choose a candidate by slot, browser timestamp, or guesswork.

Every accepted Hub-origin transfer records the source and destination lineage links in the same authoritative transaction. This gives later inspections a deterministic continuity path without treating a native identifier as globally unique.

## Exclusive source acquisition

Opening a source must call a future acquire operation before its contents become editable:

```text
acquire(sourceKey, workspaceId) -> { sourceSessionId, leaseToken, expiresAt, sourceRevision, snapshot }
```

- Acquisition is atomic and exclusive per source key. `workspaceId` is a browser-session UUID generated on every workspace opening; it is never reused by a later opening. A source already leased by another workspace session is rejected with `SOURCE_RESERVED` and is not rendered as editable.
- The same UI cannot open the same source twice; the existing pane-selection rule remains a client-side convenience, not the integrity mechanism.
- A workspace may acquire several distinct sources, allowing movement between them only when every participating source is leased by that workspace.
- `sourceSessionId` and `leaseToken` are issued by the server for each source inside that browser session. The server renews a live lease only when both values match.
- The frontend sends a handshake every 3 seconds. Missing three consecutive handshake windows expires that browser session's source lease. The backend then performs the final save flush and releases the source; it does not rely on a UI close event.
- A normal close still performs a final successful synchronization before releasing each source lease. If a new browser session reaches an already-expired lease while finalization is queued, acquisition drives that finalization and retries once. A flush failure leaves the source unavailable rather than risking an incomplete write.
- The backend runs the expired-session observer once during startup and then every second. It uses the durable persistence key scan, prevents overlapping observer executions, and logs any observer failure; it must never silently discard an observer error.
- The frontend disables further movement in a source after lease loss, surfaces the returned authority state, and writes an explicit `console.error` for unexpected synchronization failures.

## Snapshot shape

The exact record boundary and transport shape are defined by [Spec 024](024-pokemon-hub-record-model-and-snapshot-transport.md). This spec requires opaque IDs and source-local revisions; outbound snapshots contain placements only, while safe display data flows from backend to browser in acquisition and reconciliation responses.

```js
{
  workspaceId,
  clientSequence,
  sources: [{
    sourceKey,
    sourceSessionId,
    leaseToken,
    baseRevision,
    placements: [{ location, pokemonInstanceId } | { location, pokemonInstanceId: null }],
  }],
}
```

`location` is the existing Hub, Party, or Box location identity. The client sends the complete snapshot for each leased source, not a best-effort imperative drag command. A client sequence is monotonic within one workspace session and pairs with an idempotency key so retrying the same synchronization cannot apply it twice.

### Atomic workspace movement and acknowledgement

A movement between sources changes both source placement maps and is one workspace operation. The frontend may optimistically apply it only when the source and destination are `ready`, leased by the same workspace, and the destination's server-provided receive policy allows that adapter pair. An occupied-target swap remains limited to the local rules in Spec 022; cross-source occupied targets are not swapped.

Every request contains all currently leased sources, sorted by canonical `sourceKey`, and every source lists each valid location exactly once in canonical Party/Box/Grid order. A cross-source movement therefore always includes both changed sources in the same request. Serialization is deterministic so an idempotency retry is byte-for-byte the same logical payload.

The frontend assigns `clientSequence` and `idempotencyKey` when dispatching an immutable request, not when the user drops a sprite. An acknowledgement echoes both values and the server sequence. A retry keeps them unchanged. After an accepted acknowledgement, a queued newer snapshot is rebuilt from the newly confirmed source revisions before dispatch; it must not reuse obsolete `baseRevision` values. A response is ignored unless it matches the active request or is a recognized retry result, even if its server sequence appears newer.

## Frontend synchronization state machine

1. `unopened`: no source reservation or source data exists.
2. `acquiring`: the source cannot receive drag input.
3. `ready`: a server-confirmed snapshot and active lease exist; local movement is allowed.
4. `pending-sync`: one or more local movements differ from the confirmed snapshot. The UI can optimistically render the local snapshot while one serialized synchronization is in flight.
5. `reconciling`: the frontend replaces its local source data with a server-returned corrected snapshot, then returns to `ready`.
6. `lease-lost`: the source is read-only until reacquired. Pending local state is discarded in favor of server authority.
7. `closing`: the final queued snapshot is synchronized before release. A failed final sync leaves the backend lease to expire; the client must not claim success.

The frontend serializes synchronizations per workspace. A response whose server sequence is older than the current confirmed sequence is ignored. Local actions never call legacy transfer endpoints, write save bytes, or bypass an active lease.

## Backend validation and reconciliation contract

For a future synchronization request, the backend atomically validates all participating sources before accepting any snapshot content:

1. Every source session exists, is unexpired, belongs to the workspace, and presents its matching lease token.
2. The client source set exactly matches the required leased sources for every changed placement.
3. Every submitted source revision matches the current authoritative revision or is rejected as stale.
4. Every location is valid for its source and title-specific layout.
5. Every occupied placement contains one known instance identifier; the backend derives its display and gameplay data from the authoritative record.
6. No identifier is placed more than once in the submitted snapshot or the backend's authoritative placement index.
7. The client sequence/idempotency key is either the next acceptable sequence or a previously accepted retry with the same payload.

On acceptance, the backend records the resulting authoritative snapshot version and returns it with its server sequence. A later persistence phase writes the corresponding Hub records and save-byte changes using this same accepted snapshot as its only input.

### Duplicate correction

Duplicate detection is deterministic and server-owned:

- The pre-existing authoritative placement wins over a later conflicting placement.
- If both duplicates originate in one submitted snapshot, the earlier server-established placement wins; ties use canonical source-key and slot ordering.
- The newer placement is cleared in the corrected snapshot.
- The backend returns the corrected full snapshot and a `DUPLICATE_INSTANCE_CORRECTED` result. The frontend replaces its optimistic state; it does not attempt to merge or retry the rejected placement automatically.
- Browser timestamps, drag timing, and arrival timing between tabs never decide which duplicate survives.

## Failure handling

| Condition | Backend result | Frontend result |
| --- | --- | --- |
| Another workspace already holds the source | `SOURCE_RESERVED` | Do not load it as editable; preserve any unrelated panes. |
| Lease expired or token mismatched | `LEASE_INVALID` | Stop editing that source, discard pending local state, and require reacquisition. |
| Source revision changed | `SNAPSHOT_STALE` | Replace with returned authoritative snapshot before any new movement. |
| Duplicate identifier | `DUPLICATE_INSTANCE_CORRECTED` | Apply the returned corrected snapshot; log unexpected reconciliation failures only. |
| Retry after uncertain network result | Same idempotency key returns the original accepted result | Do not duplicate an accepted movement. |
| Backend unavailable | No authority response | Keep the last confirmed snapshot visible, disable new movement for affected sources, and log the error. |

## Frontend-only test phase

The first implementation phase creates pure state and synchronization modules under `apps/packages/` and runs Node tests only. It uses a deterministic fake transport/server result; it does not start a browser manually, access the backend, or modify a real save.

Required test coverage:

1. A source snapshot assigns one opaque identifier to every occupied fixture slot and none to empty slots.
2. A local move to an empty slot preserves the identifier and leaves exactly one placement.
3. Allowed local swaps preserve both identifiers and uniqueness.
4. A rejected occupied cross-area or cross-save move leaves every placement unchanged.
5. A duplicate correction retains the older authoritative placement and clears the later one deterministically.
6. The invariant holds after every reducer transition: each identifier has zero or one placement, all locations belong to loaded sources, and source revisions are immutable until acknowledgement.
7. A retry with the same idempotency key produces no second application.
8. Out-of-order acknowledgements cannot replace a newer confirmed snapshot.
9. Lease expiry and stale-snapshot responses discard optimistic changes and make the source read-only.
10. A close operation queues the final synchronization before lease release; a failed close never reports a confirmed release.
11. Unexpected transport or reconciliation errors are emitted through `console.error` with the source/session context needed for local diagnosis, without logging raw save data or lease tokens.
12. A cross-source move changes both placement maps, dispatches both sources in one deterministically ordered request, and is blocked when either source is not ready or its receive policy disallows the pair.
13. A queued snapshot dispatched after an accepted acknowledgement uses the returned source revisions, while a retry retains the original sequence, idempotency key, and payload.

No browser-driven manual validation is required for this phase. Tests must be deterministic, fixture-driven, and runnable without network access. No project build is run.

## Deferred backend phase

The later backend implementation must add atomic source acquisition, Redis-backed lease coordination, authoritative snapshot storage, idempotency records, revision validation, duplicate reconciliation, and crash-safe persistence of accepted snapshots. It must preserve the existing local binary-save boundary and avoid exposing raw save data to the frontend.

Before that phase begins, this spec requires a dedicated implementation plan naming the new store contracts, routes, migration strategy, transactional/recovery behavior, and backend test matrix.

## Acceptance criteria for the frontend test phase

1. A pure snapshot workspace state machine represents all states and transitions defined above.
2. Every local test fixture contains opaque instance IDs and validates the uniqueness invariant after every transition.
3. Tests cover accepted moves, allowed swaps, rejected occupied-target moves, duplicate correction, idempotency, stale revisions, lease loss, close behavior, and acknowledgement ordering.
4. The frontend makes no new backend request and does not change save files during this phase.
5. Unexpected synchronization failures are logged safely to the browser console with no raw record bytes or lease secrets.
6. No project build or manual browser test is required.
