---
title: Invalidate runtime states after a Pokemon Hub save
date: 2026-09-25
tags: [spec, pokemon-hub, saves, snapshots]
---

# Spec 070 — Runtime state invalidation after a Pokémon Hub save

When the Hub materializes a changed canonical `.sav`, the save store records its new revision as `runtimeStateInvalidatedAtRevision` in the same metadata write. The marker survives later player saves and fence updates. A failed materialization or save write leaves the marker and states untouched.

Before acknowledging the Hub source flush, the backend deletes the automatic `cloud-recovery` slot for the actual source profile and game. A failed deletion makes the flush fail and remain retryable; retry also deletes stale automatic recovery when materialization is now byte-identical. The user-saved `user-state`, canonical save and Pokémon Hub placement records are never deleted by this operation.

Player lease launch responses include the persisted marker. A browser recovery record captures that marker. At launch, the Hub and player discard a local recovery record with an older or missing marker before offering a restore. The backend does not serve an automatic `cloud-recovery` snapshot whose save revision predates the marker, including after a process crash between save write and snapshot deletion. A `user-state` remains available independently of this marker.

Scope: future Hub flushes only. This change does not alter existing production data or require a rollback.

## Manual state ownership correction (2026-09-28)

The player captures a user state into its own memory immediately. Manual Load in that live iframe reads this local copy. Backend upload is a separate durability operation; its delay or failure cannot clear the live local copy or disable Load. A later successful backend read restores the copy after reopening.

Pokémon Hub save flushes and Gen III event delivery invalidate automatic recovery only. They do not delete or hide a `user-state` that the user saved. The read-time `runtimeStateInvalidatedAtRevision` guard applies to `cloud-recovery`, not `user-state`. Explicit candidate deletion and a shiny-hunt replacement of the user state remain allowed. The canonical `.sav` still uses its separate validation and sync path.
