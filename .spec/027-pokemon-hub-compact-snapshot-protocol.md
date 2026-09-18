# Spec 027 — Compact session snapshot protocol

## Goal

The browser and backend share a complete workspace snapshot. A drag never
sends an individual movement command. It changes the browser projection, then
marks the complete compact snapshot dirty for one batched submission.

The snapshot carries only opaque source IDs, absolute slot numbers, and opaque
Pokémon instance IDs. It never carries source keys, game metadata, display
properties, native records, representation bytes, or save bytes.

## Session model

1. Opening the workspace creates one server-issued `sessionId`.
2. One session owns every source opened in that workspace; a source is not its
   own session.
3. The backend maps each session-local opaque `sourceId` to its actual save or
   grid source.
4. The session owns the expiry timestamp. Heartbeats renew leases and return
   only an acknowledgement.
5. Closing a source, closing the workspace, or expiry flushes and releases the
   relevant active source set through the existing save-flush rules.

## Compact workspace snapshot

`POST /api/profiles/{profileId}/pokemon-hub/sessions/{sessionId}/snapshots`

```js
{
  n: sequence,                 // client snapshot sequence / retry identity
  v: baseVersion,              // last accepted session snapshot version
  s: [
    [sourceId, [[slot, pokemonInstanceId], ...]],
  ]
}
```

- `sessionId` is part of the route and is never duplicated in the body.
- `s` contains every source in the active session.
- Every occupied slot appears as `[slot, pokemonInstanceId]`; omitted slots
  are empty.
- `slot` is the absolute source slot. The UI converts a visual box position to
  this number locally.
- `pokemonInstanceId` is the existing opaque backend identity.

This is the complete shared snapshot, expressed sparsely. It is not a move
event. The backend rehydrates its full source placement lists internally
before using the existing validation, event, and save materialization paths.

## Browser submission behavior

1. A drag updates local occupancy immediately.
2. It marks the session snapshot dirty but sends no request for that drag.
3. A 500 ms debounce after the most recent drag submits the complete compact
   snapshot.
4. At most one snapshot submission can be in flight per session. Further
   drags stay local and schedule the next snapshot after the ACK.
5. A successful response contains only `{ ok, sequence, version }`.
6. A rejected response contains the compact authoritative snapshot; the
   browser replaces its local occupancy with that correction.

## Backend validation

For a submitted snapshot, the backend atomically:

1. Verifies the live `sessionId` and requested backend profile.
2. Replays the stored result for a repeated `sequence`.
3. Verifies `v` against the authoritative session version.
4. Resolves the session-local source IDs and requires their set to match the
   active session exactly.
5. Rehydrates all known source slots, treating omitted slots as empty.
6. Rejects duplicate opaque identities and validates each changed placement
   through the materialization policy.
7. Persists placements, appends immutable placement events, increments the
   session version, and marks only changed save sources for deferred flush.

Accepted response:

```js
{ ok: true, sequence, version }
```

Rejected response:

```js
{
  ok: false,
  code: 'SNAPSHOT_STALE' | 'SNAPSHOT_INVALID' | 'SESSION_INVALID',
  sequence,
  snapshot,
  pokemonDisplay
}
```

The backend returns no snapshot for heartbeat or accepted snapshot submission.

## Heartbeat

`POST /api/profiles/{profileId}/pokemon-hub/sessions/{sessionId}/heartbeat`

Request: `{ sequence }`

Successful response: `{ ok: true, expiresAt }`

It never carries or returns placement state.

## Required tests

1. A snapshot submission contains only `n`, `v`, source IDs, absolute slots,
   and opaque Pokémon IDs.
2. Two fast drags produce one debounced submission containing both changes.
3. A stale version, invalid source set, duplicate identity, or invalid policy
   returns the compact authoritative correction and changes no backend state.
4. Replaying a sequence returns the original result and appends no duplicate
   event.
5. A heartbeat returns only `{ ok, expiresAt }` and cannot overwrite state.
6. Session expiry flushes every dirty save source before releasing its leases.
