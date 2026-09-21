# Battery saves and independent snapshots implementation plan

**Goal:** Make `.sav` writes event-driven and keep recovery snapshots independent, revision-aware, and user-restored.

**Architecture:** EmulatorJS `saveSaveFiles` events trigger serialized hash-deduplicated battery uploads. State-only snapshots record the last acknowledged save revision. Player close drains writes and asks the backend, under the current lease, to discard only an older snapshot. Startup asks before restoring a retained snapshot.

**Spec:** `.spec/044-save-and-snapshot-revisions.md`

## Steps

1. Replace snapshot envelope/store's required bundled save with state-only bytes and `saveRevision` metadata; retain safe read/cleanup support for old snapshot files.
2. Add backend lease-protected close reconciliation; remove eager snapshot invalidation on every `.sav` write.
3. Make player battery-save uploads event-driven, serialized, and hash-deduplicated; remove autosave's `.sav` side effect.
4. Make manual/periodic snapshots state-only and record the last acknowledged save revision.
5. Prompt on startup before loading snapshot state; do not mutate the canonical save when accepted or declined.
6. On close, stop capture, drain save/snapshot work, reconcile snapshot, and only then release the lease.
7. Inspect the complete diff and perform static consistency checks only; do not build or run tests.
