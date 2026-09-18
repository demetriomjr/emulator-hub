---
title: Pokemon Hub Canonical Session Snapshot
date: 2026-09-18
tags: [spec, pokemon, hub, sessions, snapshots, saves]
status: proposed
supersedes: [027-pokemon-hub-compact-snapshot-protocol.md, 028-pokemon-hub-session-contract-repair.md]
---

# Spec 029 — Pokemon Hub canonical session snapshot

## Goal

Make one readable, canonical snapshot the authority for a Pokemon Hub
workspace session. The snapshot declares which of the three workspace panes are
open and where each Pokemon is located. A client submits that full snapshot
after a change. The backend either accepts it silently or returns the exact
last accepted snapshot as the correction.

This spec changes only the snapshot/session contract and its heartbeat
interaction. It does not add a new transfer feature or change Generation III
materialization rules.

## Terminology

- **Pane** is one of the one-to-three visible workspace containers. It is not
  a Generation III PC Box.
- **Open pane** has a Hub profile or a save source selected.
- **Closed pane** is `null` in the `panes` array.
- **Source** is the persistent data behind an open pane.
- **Snapshot** is the complete desired workspace state, including open panes
  and sparse Pokemon occupancy.

The session ID identifies the server session and remains only in the URL. It
is not duplicated in the snapshot body.

## Canonical snapshot format

`POST /api/profiles/{profileId}/pokemon-hub/sessions/{sessionId}/snapshots`

```json
{
  "revision": 14,
  "panes": [
    {
      "pane": 0,
      "profile": { "type": "hub-profile", "hubProfileId": "hub-may" },
      "hub": [
        { "pokemonInstanceId": "pokemon-a", "slot": 0 },
        { "pokemonInstanceId": "pokemon-b", "slot": 31 }
      ]
    },
    {
      "pane": 1,
      "profile": { "type": "save", "gameId": "pokemon-emerald" },
      "party": [
        { "pokemonInstanceId": "pokemon-c", "slot": 0 }
      ],
      "boxes": [
        { "pokemonInstanceId": "pokemon-d", "slot": 0 }
      ]
    },
    null
  ]
}
```

### Fields

- `revision` is the revision of the last accepted snapshot known to the
  client. It is named deliberately; it replaces one-letter protocol fields.
- `panes` has one to three entries in visual pane order. Each entry is a
  self-contained open pane object or `null` for a closed pane.
- `pane` is the zero-based visual position and identifies the object itself.
- `profile` identifies the source selected in that pane. A `hub-profile`
  profile names its `hubProfileId`; a `save` profile names its `gameId`. The
  backend profile comes from the route, so it is not repeated in the body.
- A Hub-profile pane has one sparse `hub` list. A game-save pane has two
  separate sparse lists: `party` and `boxes`.
- Every occupied entry in those lists is only
  `{ pokemonInstanceId, slot }`; omitted slots are empty.
- `pokemonInstanceId` remains an opaque backend identity.
- A game-save `party` slot is `0` through `5`.
- A game-save `boxes` slot is `0` through `419` for the fourteen 30-slot
  Generation III boxes. It never has a Party offset.
- A Hub `hub` slot is its absolute grid slot.

The snapshot never contains source keys, lease tokens, session-local opaque
source IDs, box numbers, UI display data, native Pokemon records,
representation bytes, or save bytes.

Separating `party` from `boxes` is deliberate. A Box entry with `slot: 0` is
the first PC-storage slot; it is never confused with Party `slot: 0`.

## Submission and response contract

The submitted body is the candidate canonical snapshot.

### Valid snapshot

The backend persists the candidate as the next authoritative snapshot and
responds with `200 OK` and no response body. The client retains its local
snapshot and advances its local revision by one.

There is no acknowledgement object, boolean, status field, error code, or
server-generated snapshot on this success path.

### Invalid snapshot

If the candidate cannot be accepted, the backend responds with a non-success
HTTP status and a JSON body that is exactly the complete last accepted
canonical snapshot. It must not wrap that snapshot in `accepted`, `ok`,
`code`, `error`, `snapshot`, or any other envelope.

The client treats the presence of this snapshot response as a correction and
replaces its complete local snapshot. It does not need or receive the reason
for rejection.

Operational failures that are not snapshot validation failures remain normal
transport/server failures. They never masquerade as a snapshot correction.

## Session ownership and pane lifecycle

The durable server session stores the canonical snapshot, including `panes`;
the backend no longer keeps pane membership only in hidden session-source
records.

On each accepted candidate, the backend compares the submitted pane `profile`
descriptors with the previous authoritative snapshot:

1. A new open pane is resolved to its backend source, acquired for this
   session, and included in the durable session membership.
2. A pane retained with the same descriptor keeps its source lease and has its
   sparse occupancy validated.
3. A descriptor removed from a pane, or a pane made `null`, closes its prior
   source for this session.
4. The backend validates that every open pane has exactly one occupancy source,
   each occupancy source points at an open pane, slots are valid, identities
   are unique across all sources, and every placement can be materialized.

Changing a pane descriptor is equivalent to closing the old source and opening
the new one in that pane. The server owns source-key derivation and lease
credentials; neither belongs in browser snapshot data.

## Save close behavior

Closing a save pane is declared by removing its pane object or replacing it
with `null` in the next accepted snapshot.
The backend detects that transition from the snapshot diff.

Before releasing a removed save source, the backend materializes and writes
the authoritative accepted placement state, then releases its lease. It must
never release the source before that save write succeeds.

If the user drags a Pokemon and immediately closes that pane, the browser
serializes two submissions:

1. submit and receive `200 OK` for the final placement snapshot while the
   source remains open;
2. submit the next snapshot with that pane closed.

The second submission causes the backend to flush the authoritative state and
release the source. This keeps the closing snapshot simple and prevents a
single request from mixing an unsaved placement mutation with source release.

## Pane open, close, and replacement transitions

The browser sends a snapshot only for a user-visible workspace mutation: a
Pokemon placement change, opening a pane profile, closing a pane profile, or
replacing one pane profile with another. It does not continuously submit
snapshots to poll or restate an unchanged session.

For every candidate snapshot, the backend compares `panes` with the last
accepted snapshot and classifies sources as:

- **retained**: present in both snapshots with the same descriptor;
- **outgoing**: present in the accepted snapshot and absent or replaced in the
  candidate;
- **incoming**: absent from the accepted snapshot and present in the
  candidate.

For example, replacing `pokemon-emerald` with `pokemon-ruby` in pane 1 is one
candidate snapshot. Emerald is outgoing and Ruby is incoming. The frontend
does not receive a persistence-specific result or decide whether Emerald needs
a save write.

### Backend transition sequence

The backend performs an open/close/replacement transition inside the active
snapshot-operation reservation and treats it as compensatable until the new
canonical snapshot is committed:

1. Validate the complete candidate snapshot, source ownership, pane mapping,
   sparse occupancy, and materialization policy without mutating the accepted
   snapshot.
2. Resolve and stage each incoming source and its lease. A staged source is
   not yet visible in durable pane membership. If the transition fails, its
   lease is released as compensation.
3. For every outgoing save source, flush the state from the last accepted
   snapshot. This write is based exclusively on backend-owned records and
   placements; it never uses browser bytes.
4. Only after every required outgoing save flush succeeds, commit the new
   canonical snapshot and durable session membership together.
5. Release outgoing leases and finalize incoming leases as active session
   sources. Any post-commit release recovery remains backend-internal and is
   tracked until complete; it does not expose a persistence workflow to the
   browser.

A Hub-profile source has no `.sav` flush step, but it follows the same staged
membership and lease transition rules.

### Failure and rollback

If resolving an incoming source, validating the candidate, or flushing an
outgoing save fails before the new canonical snapshot is committed:

1. discard the candidate transition and release every staged incoming lease;
2. preserve the last accepted snapshot, its pane membership, and its retained
   source leases;
3. return only a literal copy of that accepted snapshot to the frontend.

The frontend applies that snapshot wholesale. Consequently, a failed write
for one outgoing save rolls back the entire optimistic workspace transition:
the newly opened source disappears and every other pane returns to the last
accepted state. The response contains no save-write status, error code, or
special rollback instruction.

An outgoing save may already be written with its last accepted state before a
later transition step fails. That is safe: the accepted snapshot still names
the same state, and no browser-originated state was written.

### Read-only source preparation

Before the user can form a candidate that opens a source, the frontend may
load that source's display projection and opaque Pokemon IDs through a
read-only backend read model. This preparation does not acquire a workspace
lease, mutate session membership, write a save, or count as a snapshot event.
It gives the frontend enough data to construct the candidate snapshot. The
state-changing open itself occurs only when that snapshot is submitted and
accepted.

### Structural-transition UI lock

Opening, closing, or replacing a Hub profile or save source is a structural
workspace transition. Unlike a Pokemon move, the frontend holds that
transition pending until its snapshot request returns.

When it submits a structural-transition snapshot, the frontend shows one
workspace-wide blocking spinner above every pane and box. The overlay prevents
all pane, box, slot, drag, and source-selection interaction until the request
settles. The previous accepted workspace remains the visible state behind the
overlay; the candidate transition is not made interactable before validation.

Closing a save pane stays in this stale, blocked state while the backend
processes and writes that source's `.sav` file. The frontend does not expose
the save-write step separately; it waits only for the structural snapshot to
settle.

- On empty `200 OK`, the frontend promotes its pending candidate to the local
  canonical snapshot and removes the overlay.
- On a snapshot correction response, the frontend replaces local state with
  that literal returned snapshot and removes the overlay.
- On a terminal transport/session failure, the existing session-failure path
  ends the pending transition; it must not leave an interactive workspace with
  an unknown structural state.

Pokemon placement moves between already open sources do not show this global
overlay. They remain locally optimistic and debounced; their normal snapshot
correction behavior is unchanged. The overlay is exclusively for opening,
closing, and replacing pane sources, where a backend save flush or source lease
transition may be required.

### Pokemon-move optimistic rendering

A Pokemon move between slots in already open sources updates the visible local
candidate snapshot immediately. As soon as the drag completes, the Pokemon
stays rendered in its destination slot; it must not return to its origin while
the browser waits for the backend snapshot response.

The frontend retains that destination placement through debounce, submission,
and an empty `200 OK`. It changes the rendered placement only when the backend
returns a literal canonical snapshot correction. Applying that correction
wholesale may move the Pokemon back to its prior authoritative slot, because
the candidate was not accepted.

This is not a visual confirmation protocol: an empty successful response does
not cause a second move or replace the local candidate with a stale confirmed
projection. The local candidate is the rendered state until a correction says
otherwise. Terminal transport/session failures continue through the session
failure path and are not represented as an ordinary placement rollback.

### Occupied destination rule

Before creating a placement snapshot, the frontend checks whether the target
slot is occupied:

- When source and target belong to the same game save, it swaps their Pokemon
  locally and submits that resulting snapshot.
- When source and target belong to different pane sources, an occupied target
  is locked. The frontend changes neither placement and sends no snapshot.

This rule applies immediately at drag completion, so the user cannot overwrite
a Pokemon in another source while waiting for backend validation. A later
backend rule still validates the accepted resulting placement state.

### Game Party invariants

Every game-save source has a separate Party list. Its occupied slots must form
one non-empty contiguous prefix:

```text
occupied: 0, 1, ..., n - 1
empty:    n, ..., 5
where 1 <= n <= 6
```

The Party can never be empty, and it can never have an empty slot before an
occupied slot. Moving a Pokemon out of Party removes it from that ordered list
and shifts every following Pokemon one slot toward `0`.

The frontend applies this deterministic compaction immediately when it removes
a Pokemon from Party. The backend independently validates the same non-empty
contiguous-prefix invariant after candidate membership is checked. A Party with
a hole or zero Pokemon invalidates the complete snapshot and returns the last
accepted canonical snapshot.

## Client behavior

1. The browser holds one local canonical snapshot for the active session.
2. A drag changes only the relevant sparse occupancy locally, then marks the
   snapshot dirty.
3. A debounced submission sends the complete canonical snapshot.
4. At most one submission is in flight. Further mutations remain local until
   the prior submission returns.
5. An empty `200 OK` retains local state and advances local `revision`.
6. A snapshot response replaces local state wholesale, including pane layout
   and source occupancy.
7. A close waits for any pending placement submission, then submits the pane
   removal snapshot. It no longer calls a separate browser-facing detach route.

The currently selected visual Generation III PC Box remains frontend display
state. It is intentionally absent: occupancy is expressed with absolute slots.

## Heartbeat and snapshot concurrency

A heartbeat means only: "the session is unchanged and this client is still
present." It is not a second channel for keeping a session alive while a
snapshot is being submitted.

### Browser rule

The browser sends a heartbeat only when all of these conditions hold:

1. the session has no local snapshot changes waiting for its debounce;
2. no snapshot request is in flight, including the time after the backend has
   started processing and before its HTTP response reaches the browser;
3. no close, open, or pane-change snapshot is waiting to be submitted.

A pending or in-flight snapshot suppresses heartbeat scheduling. The snapshot
request itself is the proof that the client remains present. Once its response
has been handled, a later idle interval may send a heartbeat if the session is
still unchanged.

The browser must not create a heartbeat request that waits behind a snapshot
request. If a snapshot request times out or has a transport failure, that is a
snapshot/session failure path; it is not converted into heartbeat retries.

### Liveness-operation tracking

Both sides track why a heartbeat is absent. They do not infer a dead session
solely from the absence of a heartbeat while a snapshot operation exists.

The browser keeps one explicit session-liveness operation state:

1. `idle`: no snapshot is dirty or in flight; heartbeat may be scheduled.
2. `snapshot-pending`: a local change exists, including its debounce window;
   heartbeat is suppressed.
3. `snapshot-in-flight`: the request was sent and its response has not yet
   been handled; heartbeat is suppressed.
4. `snapshot-settled`: the response was handled; the browser returns to
   `idle` only when there is no newer local change.
5. `snapshot-failed`: a request timed out or had a terminal transport failure;
   the browser stops heartbeat attempts and follows its session-failure path.

The heartbeat monitor records a failed heartbeat only after it actually sent a
heartbeat request and that request failed. Time spent in either snapshot state
does not increment heartbeat failures, reset the session, or count as a missed
heartbeat.

The backend persists one bounded active-operation record with the live session.
At minimum it records the operation type (`snapshot`), a unique operation ID,
the start time, and its expiry deadline. Its lifecycle is:

1. `snapshot-received`: create the active-operation record before any slow
   session work begins.
2. `snapshot-processing`: validate, persist, materialize, or flush while the
   active-operation record protects the session from idle expiry.
3. `snapshot-settled`: durably record the outcome needed for recovery, clear
   the active-operation record, and send either the empty success response or
   the canonical correction.
4. `snapshot-expired`: if processing cannot settle before its bounded deadline,
   recover or release through the ordinary safe expiry path; it must not leave
   an untracked lease indefinitely.

The browser does not need the server operation ID in its snapshot format. The
record exists for backend liveness, recovery, observability, and expiry
decisions, not as browser-controlled data.

### Backend rule

At receipt of a snapshot request, the backend creates a bounded active
snapshot-operation reservation for that session before it starts slow snapshot
validation, placement persistence, materialization, or save flushing.

While that reservation is active:

- the session expiry observer does not expect a heartbeat and must not expire
  or release the session only because its previous idle heartbeat deadline
  passed;
- the snapshot operation is the sole session-liveness operation;
- an arriving heartbeat is unnecessary and must not be queued behind the
  snapshot operation.

If a heartbeat was already in transit when the snapshot began, it is treated
as stale liveness traffic: it must not block the snapshot, create a second
pending operation, or change the active-operation lifecycle.

The reservation ends when the server has completed the snapshot request with
an empty successful response, a canonical snapshot correction, or a terminal
server failure. It has a bounded server-side deadline so a stalled process
cannot retain a session indefinitely. After it ends, ordinary idle-heartbeat
expiry rules apply again.

This is separate from source lease ownership: the operation reservation keeps
the session alive while work is active; a normal heartbeat renews idle session
and source leases only when no state-changing snapshot is pending.

## Validation pipeline

Every candidate snapshot passes these universal validations in this order,
before placement rules, lease mutation, save flushing, event creation, or any
other state change.

### 1. Snapshot format

The backend first validates only the snapshot's structural format. This is a
fast schema check: named fields are present with the expected types,
`panes` has a valid shape, each non-null pane identifies itself and one
`profile`, each pane has the content lists allowed by its profile type, slots
are within the list's numeric range, and each Pokemon entry has an opaque ID
field in the expected primitive form.

This step does not ask whether a Pokemon ID exists, belongs to the session, or
is otherwise valid. It only establishes that the candidate can be safely read
as a snapshot.

### 2. Global Pokemon-ID uniqueness

After the format is valid, the backend builds one membership index keyed by
`pokemonInstanceId` while traversing every pane's Hub, Party, and Box list. An ID may
appear once in the complete candidate snapshot and never twice, whether the
two placements are in the same list or different panes.

This is a single linear pass using a backend ID-membership index such as a
`Set` or `Map`. On the first repeated ID, the candidate is invalid and the
backend returns the last accepted canonical snapshot without further work.

### 3. Existing-Pokemon membership

Only after duplicates are ruled out does the backend compare candidate Pokemon
IDs with its own prior authoritative IDs. A client may move an existing ID; it
may not introduce a new ID that the backend did not already authorize.

For a snapshot that retains its pane sources, the authorized ID set is the
last accepted canonical snapshot's Pokemon IDs. Every candidate ID must belong
to that set.

For a snapshot that opens or replaces a pane source, the backend resolves that
incoming source through its own read model and adds that source's authoritative
Pokemon IDs to the authorized set before comparing. This is necessary because
a real Pokemon already stored in a newly opened save or Hub profile was not in
the prior session snapshot. The browser never supplies that authorization.

The comparison is again a linear membership check: every candidate ID must be
in the backend-built authorized set. An unknown ID invalidates the complete
candidate and returns the literal last accepted canonical snapshot.

These three gates establish only snapshot integrity. Rules defined later may
still reject a legal existing Pokemon move because of its origin, destination,
adapter, save materialization, or another explicit transfer rule.

### 4. Game Party shape

For every game-save source, the backend verifies that `party` is non-empty and
its occupied slots are exactly a contiguous prefix beginning at `0`. This is a
general save invariant, independent of any later custom transfer rules.

## Backend responsibilities

1. Persist a self-contained canonical snapshot as the last accepted snapshot
   for every live session.
2. Validate candidate snapshots against that stored snapshot and session
   ownership, without trusting browser source identity or lease data.
3. Return an exact deep copy of the stored snapshot for every recoverable
   validation rejection.
4. Persist only an accepted snapshot; an invalid candidate must not partially
   mutate placements, pane membership, leases, events, or save dirty state.
5. For a pane closure, flush the removed save after its last accepted placement
   state and before lease release.
6. Keep native record bytes, save materialization, source revisions, leases,
   and event details private to backend components.

## Migration boundary

The browser workspace flow stops using compact one-letter fields and
session-local `sourceId` entries for snapshot submission. Its browser-facing
attach and detach operations are replaced by canonical snapshot pane changes.
Internal source identifiers or leases may remain in backend implementation,
but they are not part of the public snapshot contract.

The legacy transfer and earlier snapshot routes may remain only for isolated
compatibility tests until their callers are removed. They are not part of the
workspace drag or close flow after this change.

## Acceptance criteria

1. A client can read a submitted snapshot and identify every open and closed
   pane without interpreting positional shorthand or server-only identifiers.
2. Each Pokemon placement supplied by the client contains only its opaque ID
   and a slot in its explicit Hub, Party, or Box list inside its self-contained
   pane object.
3. A valid submission returns exactly `200 OK` with an empty body.
4. A stale, malformed, duplicate, unauthorized, or unsupported-placement
   submission returns only the last accepted canonical snapshot as its JSON
   body, with no wrapper or rejection explanation.
5. Applying that response restores both pane layout and Pokemon occupancy.
6. Removing a save pane through a snapshot flushes its authoritative save
   state before the backend releases the source lease.
7. A drag immediately followed by a close persists the final placement before
   the close flush/release sequence.
8. No snapshot request or correction response contains source keys, lease
   tokens, display maps, native records, representation bytes, or save bytes.
9. Opening, closing, or replacing a pane source submits one complete snapshot
   for that user-visible mutation; unchanged sessions do not send snapshots.
10. Replacing a save pane stages the incoming source, flushes the outgoing
    save from backend-owned accepted state, and commits the new pane membership
    only after that flush succeeds.
11. If an outgoing save flush fails, the browser receives only the prior
    canonical snapshot and rolls back every optimistic pane change in that
    transition.
12. Read-only source preparation cannot acquire a lease, change session
    membership, persist a placement, or trigger a save write.
13. Opening, closing, or replacing a pane source blocks the entire workspace
    with one spinner until the structural-transition snapshot receives either
    empty `200 OK` or a literal snapshot correction.
14. A failed structural transition restores the complete returned canonical
    snapshot before the workspace becomes interactive again.
15. Pokemon moves between existing open sources never show the structural
    workspace spinner; they retain their optimistic debounced behavior.
16. Immediately after a Pokemon move, the destination remains rendered through
    debounce and the pending backend request; it never visually returns to the
    origin solely because a response has not arrived.
17. Only a literal canonical snapshot correction may replace that local move
    and return the Pokemon to its authoritative previous placement.
18. An empty `200 OK` for a Pokemon move preserves the local destination
    placement without a second visual transition.
19. Closing a save keeps the workspace stale and blocked until the backend has
    completed the save flush and the structural snapshot settles.
20. Dragging onto an occupied target in the same game save swaps the two
    Pokemon locally; dragging onto an occupied target in a different pane
    source changes nothing and sends no snapshot.
21. While a snapshot is dirty, debounced, in flight, or awaiting its HTTP
    response, the browser sends no heartbeat request.
22. A long-running snapshot does not cause the backend to expire or release
    its session solely because no heartbeat was received during that active
    snapshot operation.
23. A heartbeat is never queued behind an active snapshot operation; after a
    snapshot response, the next heartbeat is sent only after the workspace is
    idle again.
24. Snapshot-pending and snapshot-in-flight time never increments the
    frontend heartbeat-failure counter or triggers local session expiry.
25. The backend persists an active snapshot-operation record before slow work;
    its expiry observer skips ordinary idle expiry while that record is live.
26. A settled or expired snapshot operation clears its tracking record through
    a recoverable path, so no session or lease remains protected forever.
27. A heartbeat that arrives after a snapshot operation began cannot queue
    behind it or alter that operation's liveness state.
26. Snapshot format validation runs first and checks structure only; it does
    not look up or authorize Pokemon identities.
27. A single backend-wide ID-membership pass rejects a candidate if any opaque
    Pokemon ID appears more than once anywhere in that snapshot.
28. Every candidate Pokemon ID must exist in the backend-authorized ID set:
    the last accepted snapshot plus backend-resolved incoming-source IDs when
    a pane is opened or replaced. The browser cannot introduce an ID outside
    that set.
29. Failure of any validation gate returns only the literal last accepted
    canonical snapshot and performs no source, lease, placement, event, or
    save mutation.
30. Game-save Party uses its own `party` list with slots `0..5`; PC storage
    uses `boxes` with slots `0..419`, with no hidden offset between them.
31. Every submitted game Party has at least one Pokemon and no empty slot
    before an occupied slot. Moving a Pokemon out compacts later members toward
    slot `0` in both the local candidate and backend validation.
