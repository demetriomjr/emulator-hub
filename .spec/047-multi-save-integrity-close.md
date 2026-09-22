# Spec 047 — Multi-player save integrity and close barrier

## Context and current behavior

The six-player surface starts one iframe/session per selected game. On close,
`main.jsx` maps every active session to a `flushPlayerSave(frame)` promise and
passes the promises to `closePlayerAfterSaveAttempts`. The promises are
started together and `Promise.allSettled` waits for them, but the result has no
per-game state, no upload retry, and the shell is closed even when one promise
rejects. The only feedback is the post-close message that some saves failed.

Inside each player, `closeEmulator` captures the final battery bytes and waits
for that player's pending cloud sync. `createCloudSaveSynchronizer` deduplicates
bytes and advances an optimistic revision, while `queueCloudSave` serializes
successive writes for one iframe. This ordering is required for one save
stream. It must not serialize unrelated games.

The backend save endpoint already validates the player lease and revision. The
save store serializes `(profileId, gameId)` writes and uses an on-disk lock plus
atomic bytes/metadata replacement. Different save keys can therefore run in
parallel; writes for one key must remain ordered and fenced by the lease
generation.

## Problem

A close can release leases and remove the player shell while an upload has
failed. The caller cannot tell which game failed or whether a retry is active.
Concurrent saves from different players also need an explicit contract so a
future refactor does not introduce a global queue or allow two revisions of the
same game to race.

## Scope

1. Add a reusable close coordinator that accepts one save task per active
   session, starts all distinct sessions concurrently, retries transient save
   failures, and reports deterministic per-session states.
2. Preserve FIFO ordering for a single session/save key. Never run two writes
   concurrently for the same `(profileId, gameId)` or iframe.
3. Keep independent sessions and backend save keys asynchronous and parallel.
4. Do not release a player's lease until its final save succeeds. A terminal
   failure keeps that row and its lease recoverable.
5. Add a full-screen, opaque black save barrier in the frontend. It must cover
   the player and hub, center one readable status container, and list each game
   as pending, processing, saved, retrying, or failed. The overlay blocks
   underlying input while close is in progress.
6. Retry transient transport, timeout, and server failures with bounded
   backoff. Do not blindly retry invalid payloads, a lost lease, or a revision
   conflict; those require the existing per-player fencing/reconciliation path.
   A failed row remains visible and can be retried from the barrier without
   closing the shell.

Out of scope: changing save bytes, revision semantics, snapshot format,
profile preferences, deployment, or adding a bulk save API.

## Contracts

### Frontend close coordinator

`createMultiSaveCloseCoordinator({ tasks, retry, onUpdate })` receives one task
per active session. A task has a stable `id`, `label`, and `run()` function.
The coordinator emits immutable rows with `status` in:

- `pending`: task has not started;
- `processing`: one attempt is running;
- `retrying`: an attempt failed transiently and the next attempt is scheduled;
- `saved`: the task completed and its lease may be released;
- `failed`: the retry budget is exhausted or the error is non-transient.

All tasks start without waiting for another task. Each task's attempts are
strictly sequential. Completion resolves with all rows only when every task is
terminal. A manual retry may re-run failed rows while successful rows remain
untouched.

### Retry policy

The default policy allows three total attempts (initial plus two retries) with
250 ms and 750 ms delays. Network errors, abort/timeout errors, and HTTP 5xx
are transient. Lease invalidation, save fence conflict, revision conflict,
validation, and malformed requests are terminal for that close operation.
The policy is injectable so tests can use zero delay and deterministic failures.

### Player and lease lifecycle

`flushPlayerSave` remains one request stream per iframe and keeps its existing
request id/origin checks. The close coordinator updates the row around that
operation. `releasePlayerLease` runs only after the row becomes `saved`; failed
rows do not silently release ownership. The player shell is removed only when
all rows are `saved`, or after the user explicitly chooses to abandon a
terminally failed close.

### Backend concurrency

The existing binary save endpoint remains the unit of work. It must continue to
call the lease validator and `saveStore.put` for each request. The store's
per-key serializer and file lock are the invariant for same-game ordering;
there is no process-wide save mutex. Independent requests may execute in
parallel. Retries from the frontend reuse the same payload and current
revision, and must pass the current lease generation on every attempt.

## Frontend UI

During close, render a fixed overlay with `background: #000` and full viewport
coverage, above the player shell and dialogs. The centered container exposes an
accessible live status and one row per game, using the game title and profile
label. It shows the current state and attempt number. While rows are pending,
processing, or retrying, no close action is offered. If a row is failed, the
container explains that it is awaiting resend and offers retry for failed rows;
successful rows remain marked saved. The normal close callback runs only after
all rows are saved.

## Safe implementation sequence

1. Add coordinator and retry tests with deferred promises proving parallel
   starts, per-task ordering, retry state, and failed-row retry.
2. Replace the current `Promise.allSettled` close helper with the coordinator;
   keep the existing origin/request-id save handshake.
3. Add overlay state/rendering and wire row updates to the coordinator.
4. Add integration coverage for six sessions, including one transient failure,
   one terminal failure, lease-release ordering, and no premature shell close.
5. Add backend tests that issue independent save PUTs concurrently and verify
   different keys overlap while same-key revisions remain serialized and
   fenced. Preserve existing save-store and server tests.
6. Run focused tests, the complete test command, and frontend/backend builds.
   Do not deploy as part of this spec.

## Acceptance criteria

- Closing six players starts six independent save tasks concurrently.
- A transient failure is shown as retrying and is retried automatically without
  blocking other games.
- Every successful game is shown as saved before its lease is released.
- A terminal failure remains visible as failed/awaiting resend and prevents a
  false success message or silent data loss.
- The shell cannot disappear while a save is pending, processing, or retrying.
- Same-game writes cannot overlap; different-game writes can overlap.
- Existing save validation, revisions, lease generation checks, and snapshot
  behavior continue to pass.
- Tests cover all state transitions and builds pass; no production deployment
  occurs.
