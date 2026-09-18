# Spec 030 - Pokemon Hub source and session close

## Goal

Keep canonical full snapshots as the only placement authority while making both
close operations small, ordered and explicit. A browser close never waits for a
previous snapshot request. Native save performance is outside this spec.

## Invariants

- A submitted snapshot may only rearrange Pokemon already owned by the complete
  set of session sources. Duplicate or unknown Pokemon are rejected with the raw
  canonical snapshot so the browser can roll back.
- Accepted movement updates canonical Redis state only. It never writes a native
  `.sav` while the source remains in the session.
- Requests that mutate one session are serialized by that session. Correctness
  does not depend on browser request completion order.
- A dispatched snapshot is not cancelled when a close is requested.

## Close one source

Closing or replacing one pane is a canonical snapshot transition whose candidate
omits that source. The backend validates the complete candidate, writes the
outgoing native `.sav` when the source is a game save, releases only that source
lease, removes its binding from the session and keeps the session open. A Hub
profile has no native save write. Other pane bindings and leases remain intact.

If validation, the save write, or lease release fails, the candidate is not
accepted and the source remains in the session. The response is the current raw
canonical snapshot when a deterministic correction is available.

## Close the whole session

`POST /api/profiles/{profileId}/pokemon-hub/sessions/{sessionId}/close` receives
an immutable `Idempotency-Key` and the browser's latest complete canonical
snapshot as its JSON body.

The browser captures and sends that body immediately. It cancels only an unsent
debounce timer; it neither waits for nor cancels the current snapshot flight.
The close intent also ends the local workspace and stops its heartbeat before
waiting for the remote response. A lost, failed, or corrected close response
never resurrects that local session; backend heartbeat expiry finalizes the
last accepted canonical snapshot instead. A later opening always creates a new
session.

Inside the existing per-session queue, the backend treats this body as final
snapshot intent:

1. load the current authoritative session after earlier queued work;
2. rebase only the candidate revision to the current authoritative revision;
3. validate and commit the complete candidate through the ordinary canonical
   snapshot rules, keeping the shared session state `closing` so another backend
   instance cannot accept a snapshot during finalization;
4. write every remaining game save from the accepted canonical state;
5. release every remaining source lease; and
6. atomically record terminal replay and delete the live session, then remove
   its derived expiry-index membership.

If the close is processed before an older browser flight, the close succeeds and
the older request later fails because the session is closed. If the older flight
is processed first, the close is rebased and validated against that result.

Invalid final intent returns the raw current canonical snapshot and leaves the
backend session available only for expiry recovery. A save-write failure also
leaves it available for a later observer retry. The closed frontend does not
resume it. The same close identity can replay success from a small bounded
terminal record; no general close journal, worker lease, generation takeover or
multi-phase aggregate is part of this design.

## Acceptance criteria

1. Clicking the workspace X sends a close request without awaiting the current
   snapshot flight.
2. The close request contains the latest complete visible snapshot.
3. The workspace stops heartbeats and closes locally before the remote close
   response; failure cannot retain or restore that frontend session.
4. Move-then-X is correct whether the ordinary snapshot or close reaches the
   backend first.
5. Closing one pane never closes the session and releases only its source.
6. Closing a save pane writes that save; closing a Hub pane performs no `.sav`
   write.
7. Whole-session close writes all remaining save sources, releases all remaining
   leases and closes the session.
8. Accepted movement alone performs no native save write.
9. No project build is required for implementation or verification.
