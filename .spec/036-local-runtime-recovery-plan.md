# Local Runtime Recovery Implementation Plan

> The save-pairing portions are superseded by `.spec/044-save-and-snapshot-revisions.md`.

**Goal:** Preserve a 2.5-second local EmulatorJS recovery candidate and offer it only to the matching profile after interruption.

**Architecture:** A reusable IndexedDB-backed package owns validated local bundle records. The iframe periodically flushes/captures and marks interruption; the React hub checks the candidate before obtaining a new lease and explicitly passes an approved bundle to the new iframe.

**Spec:** `.spec/036-local-runtime-recovery.md`

## Tasks

1. Add failing package tests for copied, profile/game-scoped bundle replacement, break marking, and deletion; implement `apps/packages/local-runtime-recovery-store.mjs` with a testable storage adapter and browser IndexedDB adapter.
2. Add failing player source-contract tests for 2,500 ms flush/capture, normal server-sync flushing, break preservation, best-effort pagehide deletion, and explicit local restore validation; implement the iframe lifecycle in `apps/frontend/src/player.js`.
3. Add failing hub source-contract tests for profile-scoped candidate lookup, Restore/Discard controls, and lease-before-restore ordering; implement the minimal modal and session handoff in `apps/frontend/src/main.jsx`.
4. Run the focused package/frontend Node tests and `git diff --check`; do not run a project build.
