# Spec 026 — Persistent Hub grid transfers

## Goal

Make a drag between a supported game Box and a Hub profile grid a real, durable
placement change. The grid is a source in the same authoritative snapshot
coordinator as a save; it is never a frontend-only copy.

## Scope

- Supports an occupied game **Box** slot to an empty grid slot, and the reverse.
- Each grid binds permanently to the backend profile that first stores a record
  in it. A grid bound to one profile cannot receive a record from another.
- The workspace session acquires every source rendered in an open pane,
  including a grid source. The transfer request contains that complete source
  set. Grid leases are renewed with the same workspace heartbeat as save
  leases and are released only when their pane or the workspace closes; a drag
  never creates a temporary grid lease.
- A confirmed transfer marks changed save sources for the existing deferred
  disk flush. Grid sources never produce save-file writes.
- The profile collection stores only grid identity and owner binding. Occupied
  grid slots are projected from the snapshot source when profiles are read.

## Contract

`POST /api/profiles/{profileId}/pokemon-hub/transfers` accepts:

```js
{
  workspaceId,
  idempotencyKey,
  source: { kind: 'game', gameId, profileId, area: 'box', box, slot }
       | { kind: 'hub', hubProfileId, slot },
  target: { kind: 'hub', hubProfileId, slot }
       | { kind: 'game', gameId, profileId, area: 'box', box, slot },
  sources: [
    { sourceKey, sourceSessionId, leaseToken, baseRevision, placements }
  ]
}
```

The response is an accepted or corrected snapshot result plus the projected Hub
profile. The frontend replaces its local game layouts and Hub profile only from
that response; it does not optimistically move a cross-kind drag.

## Integrity rules

1. The game slot and grid slot must both be in the submitted authoritative
   workspace source set, with one occupied source and one empty destination.
2. A record must appear at most once across all leased sources.
3. The coordinator updates the record placement and appends one immutable
   `pokemon.placement-changed` event for an accepted move.
4. A rejected, stale, or failed request leaves frontend state unchanged and
   reports its backend error to the console and the workspace.
5. Party slots, occupied targets, cross-profile grids, and legacy grid entries
   without an opaque record identity are rejected before any save flush.

## Acceptance checks

- Package tests prove a Box-to-grid transfer has one record identity, one event,
  and a dirty save source.
- Package tests prove the reverse transfer restores the same opaque identity.
- Server tests prove the route delegates to the grid transfer service and marks
  only returned save snapshots dirty.
- Frontend tests prove cross-kind drag invokes the persistent transfer client
  and applies only its returned state.
- A grid lease is acquired once for an open grid pane, renewed with every
  other open source, and reused across successive transfers.
