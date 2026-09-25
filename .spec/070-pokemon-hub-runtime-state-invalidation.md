---
title: Invalidate runtime states after a Pokemon Hub save
date: 2026-09-25
tags: [spec, pokemon-hub, saves, snapshots]
---

# Spec 070 — Runtime state invalidation after a Pokémon Hub save

When the Hub materializes a changed canonical `.sav`, the save store records its new revision as `runtimeStateInvalidatedAtRevision` in the same metadata write. The marker survives later player saves and fence updates. A failed materialization or save write leaves the marker and states untouched.

Before acknowledging the Hub source flush, the backend deletes both available runtime state slots (`cloud-recovery` and `user-state`) for the actual source profile and game. A failed deletion makes the flush fail and remain retryable; retry also deletes stale states when materialization is now byte-identical. The canonical save and Pokémon Hub placement records are never deleted by this operation.

Player lease launch responses include the persisted marker. A browser recovery record captures that marker. At launch, the Hub and player discard a local recovery record with an older or missing marker before offering a restore. The backend does not serve a runtime snapshot whose save revision predates the marker, including after a process crash between save write and snapshot deletion.

Scope: future Hub flushes only. This change does not alter existing production data or require a rollback.
