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

This spec changes the snapshot/session contract, its heartbeat interaction, and
the Generation III materialization needed to persist the final accepted state
of every save source when that source leaves a session, including Party. While
a source remains open, accepted moves persist only canonical Redis state and do
not rewrite its native `.sav`. It does not add browser-visible transfer routes
beyond the routes validated by this contract.

## Terminology

- **Pane** is one of the three visible workspace containers. It is not
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
  client. It is the candidate's required base revision, not a revision chosen
  by the browser. The backend accepts it only when it equals the current
  canonical revision, then persists the accepted state at `revision + 1`.
  It is named deliberately; it replaces one-letter protocol fields.
- `panes` has exactly three entries in visual pane order. Each entry is a
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

The schema is closed: an open pane may contain only the fields defined for its
profile type, and a `null` pane contains nothing. Every non-null pane's `pane`
value must equal its array index. A profile descriptor may occur in at most one
open pane. These rules make a malformed or ambiguous snapshot correctable
without guessing browser intent.

### Session creation

`POST /api/profiles/{profileId}/pokemon-hub/sessions` creates an empty live
session and returns `201 Created` with this explicit bootstrap envelope:

```json
{
  "sessionId": "server-generated-session-id",
  "serverNow": 0,
  "expiresAt": 0,
  "snapshot": { "revision": 0, "panes": [null, null, null] }
}
```

`serverNow` and `expiresAt` are backend-clock epoch milliseconds captured in
the same response. The client uses their difference, never a comparison between
its wall clock and `expiresAt`, for heartbeat and snapshot-dispatch scheduling.
The initial snapshot is persisted before the response is sent and initializes
the client's accepted and visible snapshots. It is also the exact correction
body for that session's first invalid submission. This opening envelope is not
a snapshot-submission response and does not alter the empty-`200` success rule.

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

Every deterministic rejection and every pre-commit structural failure that has
been durably rolled back returns `409 Conflict` with only the current raw
canonical snapshot. That includes invalid format, unavailable incoming source,
lease conflict, and a save flush that failed before canonical commit. The
browser can therefore always restore the last accepted state after a rejected
candidate.

An ordinary server failure is allowed only when the backend cannot determine or
durably record the terminal outcome: for example it cannot read the owned
session/canonical snapshot, cannot establish the operation claim, or receives
an ambiguous failure after an external write. It returns its normal error
status, never a guessed snapshot. If canonical commit already happened, a retry
must reproduce its recorded empty success rather than report an operational
failure.

### Revision and retry identity

The client sends an immutable candidate with an HTTP `Idempotency-Key` header.
That header is a random opaque request identity and is deliberately outside the
snapshot JSON. Retrying the *same* candidate after a lost HTTP response reuses
the same header value; creating a later candidate uses a new value.

The backend durably indexes an operation by session, idempotency key, base
revision, and a canonical fingerprint of a valid submitted body. If JSON or
schema parsing cannot produce that body, it instead indexes a SHA-256 fingerprint
of the exact request bytes. Thus a malformed request remains retry-safe without
pretending it has a canonical snapshot representation. It has exactly these
externally observable outcomes:

- the same identity and fingerprint returns the terminal outcome already
  recorded: empty `200 OK` after acceptance, or the same raw correction body
  after rejection;
- a reused identity with a different fingerprint is a protocol conflict and
  returns the current raw canonical snapshot;
- a request based on an older or newer `revision` returns the current raw
  canonical snapshot; and
- only a session that cannot be found or owned can return an ordinary session
  failure, because it has no canonical snapshot to copy.

For a session that exists, malformed JSON, an invalid schema, a stale revision,
or a rule rejection is a correction response (`409 Conflict`) whose body is
only the current canonical snapshot. The response body has the same closed
schema and normalized ordering as a snapshot accepted by the backend.

## Session ownership and pane lifecycle

The durable server session stores the canonical snapshot, including `panes`;
the backend no longer keeps pane membership only in hidden session-source
records.

The same durable session document also keeps backend-private pane bindings:
the source key derived from each accepted descriptor, the lease credentials,
the accepted source revision, and the last persisted operation outcome. Those
details never enter the browser snapshot or a correction response. A session
whose three panes are `null` remains a live, empty session; closing its last
source does not silently close the session.

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

An explicit browser request to close the *session* is separate from closing a
pane. Its normative request ordering, final-snapshot validation, persistence and
lease-release contract is defined by Spec 030. In particular, the browser sends
the latest complete visible snapshot immediately and does not wait for or cancel
an already-dispatched snapshot request.

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

### Whole-session close command

The whole-session close command is defined by Spec 030. Its request body is the
latest complete canonical snapshot, not a revision-only command. It reuses the
ordinary canonical validator inside the session queue, then flushes and releases
all remaining sources before deleting the session. It has no close aggregate,
worker lease, generation takeover or multi-phase journal.

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
   snapshot. Read-only source preparation may be used here, but it cannot
   reserve a source.
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

The operation journal records each durable boundary: incoming leases staged,
each outgoing save flush fence claimed and completed, canonical membership
committed, and outgoing leases released. This makes an interrupted process
recoverable. A save write that completed before a later commit failure is safe:
it wrote only the previous accepted state. Recovery either completes the
already-journaled commit once or restores the prior membership and releases
only staged incoming leases; it never writes the browser candidate before its
canonical commit.

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

Before the user can form a candidate that opens a save source, the frontend
loads that source's display projection and opaque Pokemon IDs with
`GET /api/pokemon-hub/save-profiles/{gameId}/{profileId}/layout`. This
read-only endpoint is the only source of Party and Box rendering data; an
empty successful snapshot response is never interpreted as layout data. This
preparation does not acquire a workspace lease, mutate session membership,
write a save, or count as a snapshot event. It gives the frontend enough data
to construct the candidate snapshot. The state-changing open itself occurs
only when that snapshot is submitted and accepted.

The canonical transport snapshot is always padded to three positions, while
the visual workspace may currently show one or two panes. Applying a correction
must preserve the current visual pane count: trailing canonical `null` slots
are transport-only and must not create a new visible pane.

Selecting a source type, ROM, or save profile is frontend-only draft state until
the source descriptor is complete. If every compatible save is already open in
another pane, the Save selector remains selected with its dependent inputs
empty; it emits neither a snapshot nor an error. Only a complete descriptor can
start a structural transition.

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

An empty successful response does not cause a second move or replace the local
candidate with a stale confirmed projection. The local candidate is the
rendered state until a correction says otherwise. The frontend may show a
compact "Snapshot sincronizado." status after receiving that empty `200 OK`;
it confirms the completed HTTP response only and never changes placement.
Terminal transport/session failures continue through the session failure path
and are not represented as an ordinary placement rollback.

### Occupied destination rule

Before creating a placement snapshot, the frontend checks whether the target
slot is occupied:

- When source and target belong to the same pane source (the same game save or
  Hub profile), it swaps their Pokemon locally and submits that resulting
  snapshot.
- When source and target belong to different pane sources, an occupied target
  is locked. The frontend changes neither placement and sends no snapshot.

A vacant destination is always available to a Pokemon from any open pane
source, subject only to the Party's non-empty contiguous-prefix invariant.

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

The browser keeps three distinct values rather than overwriting one mutable
object while a request is in transit:

1. **accepted snapshot** is the last canonical snapshot known to be accepted;
2. **visible candidate** is the immediate optimistic workspace rendered to the
   user; and
3. **in-flight candidate** is an immutable deep copy paired with its
   `Idempotency-Key`.

A drag changes only the visible candidate and marks it dirty. The debouncer
copies it to the in-flight candidate only when no request is in flight. Further
placement mutations may continue changing the visible candidate while the
earlier copy is being processed; they never alter the bytes or retry identity
of that in-flight request. Multiple not-yet-submitted candidates are coalesced
into the latest complete visible candidate, so the browser stores at most one
in-flight request and one later dirty candidate.

An in-flight request is never cancelled merely because a newer move or close
intent exists. Cancelling the browser `fetch` cannot prove that the backend did
not claim or commit the request. Cancellation is allowed only before dispatch
(for example, cancelling a debounce timer) or after the session is already in a
terminal local failure path. A lost response is retried with the same immutable
body and `Idempotency-Key`.

On empty `200 OK`, the browser promotes the in-flight candidate to the accepted
snapshot with `revision + 1`, keeps any later visible mutations, and submits a
new candidate from that next base revision. On a raw correction response it
discards every local delta, replaces accepted and visible state wholesale with
the returned snapshot, and clears dirty/in-flight work. On terminal transport
failure it does not guess a rollback or emit a new candidate with a new key;
it enters the existing unknown-session recovery path. Retrying a known request
uses its original immutable body and `Idempotency-Key`.

A pane close waits for any pending placement submission, then submits the
pane-removal snapshot so the outgoing save contains the accepted placement.
A whole-session close follows Spec 030 instead: it immediately sends the latest
complete visible snapshot and is ordered against earlier work by the backend
session queue. The blocking overlay prevents a second structural transition
until the first has a terminal outcome.

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

`snapshot-pending` is not backend protection: the backend can protect a session
only after it receives and claims the request. The client therefore has a
configured `snapshotDispatchSafetyMs`, strictly less than the session lease.
For every open or successful heartbeat response, it captures local monotonic
send/receive times and calculates a conservative local deadline as:
`receivedMonotonic + (expiresAt - serverNow) - responseRoundTripMs`.
It schedules each dirty candidate for the earlier of its normal debounce and
that deadline minus `snapshotDispatchSafetyMs`. If the safe window has already
been reached, it bypasses debounce and dispatches immediately. The full observed
round trip conservatively covers response transit, and the safety margin covers
outbound transit plus client scheduling; neither relies on browser wall-clock
accuracy. Every successful heartbeat returns fresh `serverNow` and `expiresAt`
and recalculates this deadline. An empty snapshot success leaves the prior
conservative deadline in place, so the next idle heartbeat is sent immediately
when that deadline has passed. This is not a claim that an unsent request has
renewed a lease.

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
an immutable positive `generation`, the start time, and its expiry deadline.
Its lifecycle is:

1. `snapshot-received`: create the active-operation record before any slow
   session work begins.
2. `snapshot-processing`: validate, persist, materialize, or flush while the
   active-operation record protects the session from idle expiry.
3. `snapshot-settled`: durably record the outcome needed for recovery, clear
   the active-operation record, and send either the empty success response or
   the canonical correction.
4. `snapshot-expired`: if processing cannot settle before its bounded deadline,
   invoke durable recovery first. It must not leave an untracked lease
   indefinitely, and it must not release a session merely because that request
   was still pending.

The browser does not need the server operation ID in its snapshot format. The
record exists for backend liveness, recovery, observability, and expiry
decisions, not as browser-controlled data.

### Snapshot diagnostics

The backend emits structured diagnostics only for failure paths: aborted or
interrupted HTTP requests, malformed bodies, service/coordinator failures,
lease/save flush failures, and unexpected request failures. Every caught failure
includes its error code, message, and stack plus request/session/idempotency
correlation. Successful snapshot and heartbeat processing is silent. Logs never
emit save bytes, lease tokens, or raw Pokemon representations.

The console label and structured `requestType` distinguish a state-changing
snapshot command (`snapshot-command`) from a liveness heartbeat (`heartbeat`).
Successful snapshot commands and heartbeats are silent. Only snapshot or
heartbeat abort, transport, response-close, body, or service failures emit their
respective `*.http.*` diagnostics. This is observability only: it does not alter
heartbeat dispatching, snapshot serialization, queueing, or session-liveness
behavior.

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

### Atomicity, lease fence, and expiry recovery

Correctness cannot depend on the current in-process `Map` queue: two backend
processes may receive requests for the same session. Creating, joining, and
settling a snapshot operation therefore uses a Redis atomic compare-and-set
primitive (a Lua script or `WATCH`/`MULTI`/`EXEC), keyed by the session's
canonical revision and operation identity. One atomic transition must either
claim the operation against the expected revision or read its already-recorded
terminal outcome. It must not partially update a session document, a pane
binding, or an expiry index.

The atomic canonical commit also records all derived work as one operation
journal/outbox: source-placement revisions, Pokemon placement-record changes,
save-dirty markers, and placement events. It is not acceptable to write one
source, then fail while writing another source or its Pokemon record. The
operation either becomes the next canonical revision with its complete durable
outbox, or remains at the prior revision. Event publication consumes that
outbox idempotently after commit; an event-store outage cannot make the client
see an accepted move whose durable placement record is incomplete.

The active-operation generation is a mandatory fencing token. Before every
mutable boundary — source-lease staging, save-flush claim and completion,
canonical/outbox commit, and lease release — the worker atomically verifies
that its operation ID and generation are still active. Recovery takes over by
incrementing the generation before it resumes or compensates. A worker paused
before takeover cannot perform any later mutable step, including an external
save write, after it resumes; the save-store write uses the same generation in
its flush fence.

The save store itself enforces that fence at its file-commit boundary. Each
save source has a durable monotonic `saveFenceGeneration` in its metadata.
Before recovery resumes or compensates, it atomically installs the newer
generation. A materializer supplies its claimed generation to a conditional
commit that, under an inter-process per-save lock, rechecks that generation and
the expected save revision immediately before replacing bytes and metadata.
The conditional commit rejects a stale generation without changing either the
`.sav` or its metadata. Preparing a temporary file may occur earlier, but it
does not make the file visible; replacement is permitted only by that fenced
commit. Crash recovery reconciles temporary data against the durable revision,
hash, and fence generation before another writer proceeds.

While an operation is active, the backend extends the session and every
retained or staged source lease through at least the operation deadline. The
expiry sweep re-reads the session, lease, and active operation after selecting
an expired sorted-set member; an old index score alone never authorizes a
release. A lease may be released only when it still belongs to the expected
session/binding and no active operation protects it.

Save materialization has a separate per-source close fence. A normal accepted
move marks the current accepted source revision dirty in Redis but never
schedules native-file materialization while that source remains open. A pane
close, replacement, explicit session close, or expired-session recovery claims
the outgoing source's exact latest accepted revision, writes with the save
store's revision/generation guard, and records that exact source revision as
flushed. If any newer accepted placement exists, the claim is stale and cannot
clear dirty state or release the source. There is no periodic or debounced
native `.sav` writer competing with the close operation.

If a process dies or an HTTP connection disappears, the durable operation
journal is recovered before ordinary lease expiry is considered. The recovery
worker either completes the recorded idempotent steps or rolls staged work back
to the prior accepted snapshot, records a terminal raw correction outcome, and
returns the session to idle liveness. An operation deadline is a recovery
trigger, not permission to close a session merely because a response was still
pending. Once recovered, the normal idle heartbeat deadline applies again.

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

### 4. Source-membership conservation

The candidate's aggregate ID set must equal the backend-built expected set: all
IDs from retained sources plus the complete authoritative IDs from incoming
sources, excluding only sources whose panes are closed or replaced. A client
may relocate an existing ID between those still-open sources through a later
validated placement transition, but it may not omit an ID to delete it. An
outgoing source's IDs may leave the session only because its pane is closed or
replaced. This comparison is linear set equality after the duplicate and
authorized-membership gates.

### 5. Game Party shape

For every game-save source, the backend verifies that `party` is non-empty and
its occupied slots are exactly a contiguous prefix beginning at `0`. This is a
general save invariant, independent of any later custom transfer rules.

### 6. Descriptor, placement, and materialization rules

After the universal gates, the backend derives the authoritative pane diff and
validates it against backend-private bindings. A retained descriptor must use
its existing binding; an incoming descriptor must resolve to an available
source owned by the route profile. The same descriptor cannot be opened twice,
and a source reserved by another live workspace invalidates this candidate.

The backend then computes each Pokemon's old and proposed placement and runs
the applicable transfer policy. The occupied-destination rule is enforced on
the server as well as the frontend: any occupied destination in the same source,
including a Hub profile, Party-to-Party, Box-to-Party, and Party-to-Box, is a
swap; an occupied target in a different pane source is rejected. A vacant
destination may receive a Pokemon from any open source. A vacant Party
destination may be only that save's first vacant Party slot. Every resulting
Party is compacted and must pass the Party-shape validation. Custom transfer
rules are evaluated only after these general invariants.

Every accepted Party change is part of the same authoritative save
materialization as a Box change. The native writer must be implemented in this
repository; it must not import, copy, or link OpenHome or PKHeX code, tests,
fixtures, or data tables. OpenHome remains a read-only architectural reference.
PKHeX revision `8ad201e80244f630ab5a46922ab72fb79c5ad4f4` is the pinned complete
behavioral and file-format reference for independent implementation and
differential verification of the whole `.sav` write path. A reference revision
change requires an explicit spec update and re-running the differential suite.

For a Gen III save, the writer applies the accepted ordered `party` list as one
atomic result:

- Retained Party members keep their complete 100-byte native Party record when
  they move within Party or shift due to compaction; their runtime data is not
  recomputed merely because their slot changed.
- A Party-to-Box move writes the 80-byte persistent Box core to the destination
  and removes that Party record from the ordered Party list.
- A Box-to-Party move starts from the 80-byte persistent Box core and creates
  the remaining Party runtime state entirely in our own code, following the
  verified Gen III semantics for conversion and stat calculation. Browser input
  never supplies runtime bytes.
- The configured Party count is written as the full little-endian count field;
  all unused Party record storage after that count is cleared; every affected
  Gen III sector checksum is recalculated before the save is persisted.

The implementation must model the required species, experience, level, nature,
IV, EV, stat, current-HP, status, and mail semantics explicitly rather than
writing a zero-filled Party suffix. It must preserve native Party-only state
when the Pokemon already belongs to that save and deterministically initialize
it when it enters Party from a Box. Supported games are the layouts already
declared by the repository; a layout without the required modeled data is not
silently accepted.

Materialization starts from the latest validated complete native `.sav`,
preserves every unrelated byte and sector, applies only the accepted
Pokemon-storage changes, then persists that complete resulting file through the
save store's revision fence. The writer must validate the result by re-reading
it with the independent adapter and by validating all affected checksums. Its
behavioral test suite uses locally authored fixture saves and independently
derived expected outcomes. The test verifier decodes and asserts all 20 Party
runtime bytes — status, level, mail, current/max HP, every battle stat, and
padding — in addition to its 80-byte Box core, Party count, placement, and
checksums. PKHeX at the pinned revision may be consulted as an oracle while
designing or manually comparing behavior, but its code and test assets never
enter this repository.

## Failure and recovery matrix

The implementation must have focused tests for each row. In every correction
row, the response body is only the raw current canonical snapshot.

| Situation | Required durable result | Browser result |
| --- | --- | --- |
| Candidate has a duplicate, invented ID, stale revision, invalid pane, or invalid Party shape | No source, lease, save, record, or event mutation | Replace visible state from correction |
| Same request is retried after its HTTP response was lost | One operation and one revision change at most | Reuse its key; receive the original empty success or correction |
| Two workers receive different candidates from the same revision | Exactly one operation can claim and commit that revision | Loser receives the current correction |
| Heartbeat races with a snapshot request | Snapshot operation remains sole liveness authority; heartbeat is ignored or answered without renewal | No heartbeat failure or second queued request |
| Save close takes longer than the idle lease interval | Operation and source lease remain protected until recovery/settlement | Workspace remains stale and blocked |
| Outgoing save flush fails | Previous snapshot/bindings remain canonical; staged incoming leases are compensated | Whole structural candidate rolls back from correction |
| Process stops after staging, after flush, after canonical commit, or after release | Operation journal deterministically resumes or compensates each exact boundary | Retry is idempotent; no manual browser repair |
| Expiry index contains an old score after a renewal | Re-read prevents release of a still-live session or lease | No visible rollback or session close |
| Cross-source occupied destination is attempted | No candidate is emitted; backend would reject one as well | Source and target remain unchanged |
| Party conversion cannot be materialized for the selected game layout | No source, save, record, or canonical mutation | Raw correction restores the accepted Party |

## Implementation boundaries

The implementation replaces the legacy compact workspace path as one coherent
vertical change. It must not adapt the old public `sourceId`/compact snapshot
format at the route boundary and keep it as a second browser protocol.

- **Frontend workspace state** builds, renders, rebases, and corrects the
  canonical snapshot; it owns the visible/in-flight/accepted state machine,
  optimistic moves, Party compaction, occupied-target lock, and structural
  overlay.
- **Frontend HTTP client** sends the raw snapshot with `Idempotency-Key`,
  treats only an empty `200` as success, and parses any correction directly as
  a snapshot rather than as a result envelope.
- **Session service and route** own canonical revision comparison, correction
  serialization, idle session lifetime, explicit empty-session close, and
  suppression of heartbeat while an operation is active.
- **Snapshot coordinator and persistence** own backend-private bindings,
  atomic operation claims/commits, descriptor-derived source authorization,
  lease fencing, and the durable recovery journal/outbox. Per-process queues
  may optimize local ordering but cannot be relied on for correctness.
- **Save-flush service and materializer** own revision-fenced close and recovery
  flushes, ETag conflict handling, and complete independent Box/Party native
  writes. They do not perform periodic or debounced native writes while a source
  remains in a live session. They never consume browser-native records or infer
  a candidate from a stale source projection.
- **Focused tests** cover protocol bytes and HTTP bodies, browser state-machine
  transitions, cross-process atomicity through the persistence abstraction,
  stale expiry indexes, every recovery-matrix row, and no partial save/event
  mutation on correction.

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
7. Persist a complete, checksum-valid `.sav` for every accepted dirty save
   source; Party and Box are equally authoritative parts of that file.

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
20. Dragging onto an occupied target in the same game save or Hub profile swaps
    the two Pokemon locally; dragging onto an occupied target in a different
    pane source changes nothing and sends no snapshot. Any vacant target accepts
    the move, subject only to Party invariants.
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
28. Snapshot format validation runs first and checks structure only; it does
    not look up or authorize Pokemon identities.
29. A single backend-wide ID-membership pass rejects a candidate if any opaque
    Pokemon ID appears more than once anywhere in that snapshot.
30. Every candidate Pokemon ID must exist in the backend-authorized ID set:
    the last accepted snapshot plus backend-resolved incoming-source IDs when
    a pane is opened or replaced. The browser cannot introduce an ID outside
    that set.
31. Failure of any validation gate returns only the literal last accepted
    canonical snapshot and performs no source, lease, placement, event, or
    save mutation.
32. Game-save Party uses its own `party` list with slots `0..5`; PC storage
    uses `boxes` with slots `0..419`, with no hidden offset between them.
33. Every submitted game Party has at least one Pokemon and no empty slot
    before an occupied slot. Moving a Pokemon out compacts later members toward
    slot `0` in both the local candidate and backend validation.
34. A request retried after a lost response uses the same idempotency identity
    and receives its original terminal empty success or raw correction; it
    cannot apply a candidate twice.
35. Two backend processes cannot accept different candidates from the same base
    revision, because session operation creation and canonical commit are
    atomic in durable persistence.
36. An expiry sweep never releases a session or source lease based only on a
    stale expiry-index entry while a live snapshot operation protects it.
37. A save source is released only after the flush fence records its latest
    accepted outgoing revision; a stale debounced worker cannot clear that
    requirement.
38. An empty session with all panes closed remains open and heartbeat-eligible;
    only an explicit idle session-close request may delete it.
39. Every accepted Party change is materialized in the `.sav`: the Party count
    and contiguous 100-byte Party records are correct, unused Party storage is
    cleared, cross-container conversion preserves the 80-byte Box core and
    creates required Party runtime data in independent code, and all affected
    sector checksums validate.
40. A materialized save preserves every native byte unrelated to the accepted
    Party/Box change, and an independent re-read reconstructs exactly the
    accepted Party and Box placements.
41. The implementation has locally authored Gen III save fixtures covering
    Party reorder, compaction, Party-to-Box, Box-to-Party, save close, and
    checksum validation for each supported layout; no reference-project code,
    fixtures, or data tables are imported.
42. Opening a session returns its server session ID, `serverNow`, expiry
    deadline, and the persisted `{ revision: 0, panes: [null, null, null] }`
    snapshot; the first invalid submission returns only that same snapshot as
    its correction body.
43. The client derives its safe dispatch deadline from server-provided remaining
    lease duration and local monotonic round-trip time, never from a browser
    wall-clock comparison. Controlled-clock coverage with positive and negative
    client/server skew plus delayed delivery proves a dirty snapshot dispatches
    before the backend claim deadline, or immediately when the safe window is
    exhausted, while heartbeat is suppressed.
44. Candidate membership equals the aggregate backend-authorized membership of
    retained and incoming sources. Omitting a Pokemon from that aggregate
    returns a correction without changing canonical state, dirty markers,
    events, leases, or save bytes; closing a pane may remove only that source's
    membership from the session aggregate.
45. A recovery takeover increments the active-operation generation. A worker
    paused before every mutable boundary cannot, after takeover, write a save,
    settle a flush fence, commit canonical state, or release a lease.
46. Contract tests distinguish deterministic rejection and rolled-back
    pre-commit structural failure (`409` plus only raw snapshot) from an
    indeterminate server failure (ordinary error with no guessed correction),
    including retries after commit.
47. A malformed body uses a fingerprint of its exact bytes for idempotent retry;
    it receives a raw correction when the owned session is readable and is never
    treated as a canonical JSON snapshot.
48. Party-to-Party, Box-to-Party, and Party-to-Box moves onto an occupied target
    in the same save are swaps; a vacant Party target must be the first vacant
    Party slot, and every resulting Party remains contiguous and non-empty.
49. The Party materialization suite asserts all 100 native Party bytes for local
    Box-to-Party and cross-source cases against the independently derived oracle
    for pinned PKHeX revision `8ad201e80244f630ab5a46922ab72fb79c5ad4f4`; a
    runtime-tail difference fails even when placement and sector checksums pass.
50. A save-store conditional commit enforces its durable source fence generation
    under an inter-process lock. If worker A pauses after its coordinator fence
    check, worker B takes over, and A resumes, A is rejected before visible file
    replacement and cannot change `.sav` bytes or metadata.
51. The browser has at most one immutable snapshot request in flight. A newer
    move replaces only the unsent dirty candidate; it never cancels or mutates
    the request that may already be claimed by the backend.
52. Clicking the global close while a move is in flight immediately sends one
    idempotent session-close command containing the latest complete visible
    snapshot. It neither waits for nor cancels the earlier request.
53. An accepted move marks the affected save source revision dirty only in
    Redis. No `.sav` write occurs until pane close, replacement, explicit session
    close, or expired-session recovery removes that source from the live session.
54. Whole-session close rebases only the final candidate revision after earlier
    queued work, validates the complete snapshot, writes all remaining saves,
    releases all remaining leases, and deletes the session.
55. Retrying the same completed whole-session close key and body replays empty
    success from a bounded terminal marker. Reusing the key with another body is
    rejected.
56. Snapshot transport retry uses the exact original body and idempotency key;
    raw `409` remains a correction, and empty `200` remains the only accepted
    snapshot response.
58. Candidate authorization rejects invented Pokemon IDs before record access;
    unchanged authorized placements require no Pokemon-record read, and a
    missing changed record returns a correction with zero durable mutations.
59. Every key passed to a Lua operation has the same Redis Cluster slot. A
    versioned startup migration preserves existing session, operation, source,
    record, lease, workspace-index, sync-operation, and expiry state or fails
    readiness before accepting a v2 mutation.
60. Pane close and replacement use the same durable structural journal as other
    canonical snapshot transitions. Two workers plus fault injection after
    outgoing flush, canonical commit, and lease release recover to exactly one
    canonical outcome without losing a pane, releasing an uncommitted source,
    or repeating a logical transition.
