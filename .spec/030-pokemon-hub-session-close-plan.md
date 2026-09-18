# Pokemon Hub source and session close implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make source close and whole-session close distinct while allowing the workspace X to send a final full snapshot immediately.

**Architecture:** Keep source removal in the canonical snapshot transition. Add one queued whole-session operation that validates a rebased final snapshot, then flushes/releases every remaining source and closes the live session. Remove the session-aggregate close state machine.

**Tech Stack:** Node.js ES modules, React, `node:test`, Redis persistence abstraction.

**Spec:** `.spec/030-pokemon-hub-session-close.md`

## Global Constraints

- Do not run a project build.
- Preserve unrelated dirty-worktree changes.
- Keep accepted movement Redis-only.
- Do not add a background writer, worker lease, generation takeover or general close journal.

---

### Task 1: Lock the two close contracts with tests

**Files:**
- Modify: `apps/packages/hub-client.test.mjs`
- Modify: `apps/packages/pokemon-hub-session-service.test.mjs`
- Modify: `apps/backend/test/server.test.mjs`
- Modify: `apps/frontend/src/pokemon-slot-sprite-rendering.test.mjs`

**Interfaces:**
- Produces: `closePokemonHubSession(profileId, sessionId, snapshot, idempotencyKey)`.
- Produces: `closeCanonicalSession({ profileId, sessionId, snapshot, idempotencyKey, acquireSource, flushOutgoingSource, releaseSource })`.

- [ ] Add a client test asserting the close request body is the complete snapshot.
- [ ] Add service tests proving source removal keeps the session open and whole close validates final intent before flushing all sources.
- [ ] Add ordering tests for snapshot-first and close-first schedules.
- [ ] Add a frontend source test proving `closePokemonHub()` captures a snapshot and does not call `beginClose()`.
- [ ] Run the focused tests and confirm they fail for the missing contract.

### Task 2: Implement the queued backend close

**Files:**
- Modify: `apps/packages/pokemon-hub-session-service.mjs`
- Modify: `apps/backend/server.mjs`
- Delete: `apps/packages/pokemon-hub-session-aggregate.mjs`
- Delete: `apps/packages/pokemon-hub-session-aggregate.test.mjs`

**Interfaces:**
- Consumes: the existing per-session `enqueue(sessionId, operation)` and canonical validator/coordinator.
- Produces: one accepted/corrected close result with bounded terminal replay.

- [ ] Extract the canonical apply operation so snapshot sync and close reuse the same validation path without nested queueing.
- [ ] Rebase only the final close candidate revision after earlier queued work.
- [ ] Flush and release the accepted session sources, then delete the session.
- [ ] Keep the session live on validation or save failure.
- [ ] Remove aggregate imports and orchestration.
- [ ] Run service and backend tests until green.

### Task 3: Send final intent immediately from the browser

**Files:**
- Modify: `apps/packages/hub-client.js`
- Modify: `apps/frontend/src/main.jsx`
- Modify: `apps/packages/pokemon-hub-snapshot-flight.mjs`
- Modify: `apps/packages/pokemon-hub-snapshot-flight.test.mjs`

**Interfaces:**
- Consumes: the latest visible canonical snapshot captured by the flight.
- Produces: an immediate close request independent of the current flight promise.

- [ ] Change the client close body from `{ revision }` to the complete snapshot.
- [ ] Cancel only the unsent debounce timer and capture the current visible snapshot.
- [ ] Send close immediately without `beginClose()` or cancellation of a dispatched flight.
- [ ] Remove close-barrier state that no longer has a caller.
- [ ] Run client, flight and frontend tests until green.

### Task 4: Reconcile the active spec and verify

**Files:**
- Modify: `.spec/029-pokemon-hub-canonical-session-snapshot.md`
- Modify: `.spec/030-pokemon-hub-session-close.md`

**Interfaces:**
- Consumes: the implemented behavior.
- Produces: one non-contradictory active architecture.

- [ ] Remove the old drain-before-close and aggregate/journal requirements from Spec 029.
- [ ] Run the focused package and backend tests without building.
- [ ] Run `rtk git diff --check`.
- [ ] Check the original move-then-X and individual-pane-close acceptance flows against the test evidence.
