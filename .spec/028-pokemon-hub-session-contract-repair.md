---
title: Pokemon Hub Session Contract Repair
date: 2026-09-17
tags: [spec, pokemon, hub, sessions, snapshots, leases, synchronization]
status: accepted
supersedes: [026-pokemon-hub-persistent-grid-transfers.md]
amends: [027-pokemon-hub-compact-snapshot-protocol.md]
---

# Spec 028 — Pokemon Hub session contract repair

## Goal

Restore one authoritative end-to-end workspace contract: every live lease is
owned by exactly one stored session source; every compact snapshot names that
complete set; all recoverable rejections return an authoritative compact
correction; and the browser never retries a terminal session failure.

Spec 027 is the active browser protocol. The legacy `/transfers` route remains
available only for compatibility tests and is not called by workspace drags.
This supersedes Spec 026's browser transport and non-optimistic-drag rules.

## Invariants

1. A source acquisition for a session is performed inside that session's
   serialized attach operation. An attach failure releases an acquisition that
   did not become part of the session.
2. Closing or expiring a session cannot race an attach into creating an orphan
   lease. A close queued after attach releases the attached source; a close
   queued before attach causes attach to fail before acquisition.
3. Before acknowledging even an unchanged compact snapshot, the server
   verifies that the session source credentials and the coordinator's active
   workspace lease set are identical. Workspace lease membership is maintained
   as an atomic Redis set, so this verification never scans the keyspace.
4. A pre-existing indexed lease absent from the durable session is an orphan.
   The session service removes only such leases for its own `sessionId` before
   accepting or correcting a snapshot. Its source was never attached, so this
   cleanup does not materialize or flush save bytes. Legacy leases are indexed
   on first touch and otherwise expire through the ordinary expiry observer.
5. Expiry observation reads only a Redis sorted-set range by expiry score for
   both sessions and source leases. It must never perform a recurring keyspace
   scan or contend with snapshot and heartbeat commands.
6. Every compact snapshot route accepts up to 128 KiB, matching the maximum
   supported sparse occupancy payload.
7. A repeated snapshot sequence is a retry only when its normalized compact
   request is identical. Reusing the sequence with another payload returns a
   compact `SNAPSHOT_INVALID` correction and never acknowledges that payload.
8. A stale version, invalid source set, invalid lease, duplicate identity, or
   rejected materialization policy returns `{ ok: false, code, sequence,
   snapshot, pokemonDisplay }`. It does not leave optimistic browser state
   pending.
9. The browser applies a correction when present. A terminal transport or
   session error clears the pending snapshot, stops scheduling retries, ends
   the local workspace session, and keeps the backend error visible.
10. A coordinator acceptance changes and marks dirty only sources whose
   placements changed. It must not advance unchanged source revisions.

## Transport

The route and payload remain exactly as Spec 027:

```js
POST /api/profiles/{profileId}/pokemon-hub/sessions/{sessionId}/snapshots
{ n, v, s: [[sourceId, [[slot, pokemonInstanceId]]]] }
```

The compact snapshot contains every attached source, sorted by its opaque
`sourceId`. Sparse occupancy remains the only browser-to-server placement
representation.

## Server responsibilities

`createPokemonHubSessionService` owns serialized attach, source-set
verification, orphan reconciliation, compact request fingerprints, and compact
corrections. The HTTP handler supplies the backend-specific source adoption
callback, but never acquires a session source before the service has verified
the session is live.

`createPokemonHubSnapshotCoordinator` exposes lease-set verification and
orphan-lease cleanup only for a caller presenting the workspace's durable
attached source keys. It maintains atomic workspace membership and global
expiry indexes, so neither request processing nor the recurring observer needs
to scan Redis. It continues to own source leases, placement validation, events,
and save-flush state. It reports recoverable validation failures using its
existing stable error codes.

## Browser responsibilities

The browser continues to make one optimistic, debounced compact submission.
It serializes sources deterministically. A correction replaces local
occupancy. A response without a correction is terminal: the browser cancels
the debounce, clears the queued request, ends its local session, and never
auto-retries the same failed payload.

## Test matrix

1. An attach/close race neither persists an orphan lease nor later produces
   `SOURCE_SET_INCOMPLETE`.
2. A deliberately orphaned lease is cleaned before a moved snapshot and the
   moved compact snapshot is accepted.
3. An unchanged compact snapshot detects a missing/extra lease rather than
   acknowledging a divergent workspace.
4. A compact snapshot larger than 4 KiB reaches the session service.
5. Same-sequence identical retries replay the original result; same-sequence
   different payloads receive `SNAPSHOT_INVALID` plus authority state.
6. Invalid source-set, lease, duplicate, and materialization-policy failures
   return compact corrections without mutations.
7. The browser test asserts deterministic compact ordering and no retry loop
   after an uncorrectable session request failure.
8. Workspace validation and both expiry observers reject any implementation
   that calls persistence `keys`; concurrent source acquisitions retain every
   workspace member in the atomic index.
8. The current frontend contract tests describe the session protocol; no test
   requires the deprecated browser `/transfers` flow.

## Implementation plan

1. Add failing coordinator and session-service tests for lease reconciliation,
   no-op validation, idempotency fingerprints, corrections, and changed-source
   revisions.
2. Make the coordinator expose the narrow lease-set verification and orphan
   cleanup operations; use them from the serialized session service.
3. Move acquisition into serialized session attach with compensation on any
   unsuccessful attach.
4. Normalize and fingerprint compact snapshots, persist the fingerprint with
   each session operation result, and reject conflicting replays.
5. Raise the session snapshot body limit; convert recoverable coordinator
   failures into compact session corrections.
6. Make frontend compact ordering deterministic and stop terminal-error retry
   loops while retaining correction reconciliation.
7. Replace obsolete Spec 026 frontend assertions with session-protocol
   assertions, update the specification index, and run the focused Node suite.
