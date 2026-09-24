# Specifications

- [Spec 061 — Selective closing of multiple emulators](061-selective-multi-emulator-close.md): choose which ROM/profile sessions to close, lock all emulator input and pause while close overlays are open, then reflow surviving instances without restarting them.

- [Spec 060 — Global player mute preference](060-global-player-mute.md): persist one header mute toggle and apply it to all EmulatorJS instances, including new players.

- [Spec 058 — Current snapshot system audit and save-then-close plan](058-current-snapshot-system-audit.md): current frontend/backend restore decisions, condition matrix, observed gaps, and the technical plan for suppressing unnecessary restore prompts after a confirmed save.

- [Spec 057 — Player picker and runtime preferences](057-player-picker-and-runtime-preferences.md): show ordered ROM cover tiles and profiles when adding an emulator, persist Fast Forward enabled state, reorder L2/R2 actions, and reset the odds manipulator when the player wrapper first opens.

- [Spec 050 — Authentic GBA RTC clock provider](050-authentic-gba-rtc-clock.md): make the host-clock RTC path explicit, testable, and extensible without changing game RNG semantics.

- [Spec 055 — Reset advances the emulator clock](055-reset-advances-emulator-clock.md): optionally configure a virtual clock for reset-based shiny hunting, advancing it on soft and hard resets.

- [Spec 049 — Per-emulator snapshot and local recovery prompt](049-snapshot-restore-prompt.md): one styled, scoped restore decision component for backend snapshots and local runtime recovery in multi-player sessions.

- [Spec 048 — Backend state backup endpoint and startup barrier](048-backend-state-backup.md): authenticated full-state archives for profiles, saves, Pokémon Hub state, and a pre-listen production backup.

- [Spec 047 — Multi-player save integrity and close barrier](047-multi-save-integrity-close.md): parallel per-game save close, bounded retries, lease-safe completion, and an opaque status barrier.

- [Spec 046 — Global player-header preferences and L2/R2 Fast Forward](046-trigger-fast-forward-toggle.md): persist Fast Forward speed and L2/R2 actions in one backend-global preference document, and toggle session Fast Forward using the first active emulator as the state reference.

- [Spec 045 — Six-instance player surface](045-six-instance-player.md): increase the session cap to six while preserving all existing global player controls and per-instance isolation.

- [Spec 043 — Generic IPS patch discovery](043-ips-patch-discovery.md): ROM-hash registry, IPS validation, optional patch application, and game-agnostic launch behavior.

- [Spec 044 — Battery saves and independent emulator snapshots](044-save-and-snapshot-revisions.md): event-driven canonical `.sav` uploads, state-only snapshots, explicit restore choice, and close-time revision reconciliation.

- [Spec 035 — Generation III regional transfer gates](035-generation-iii-regional-transfer-gates.md): save-level National Dex, regional-membership, and FireRed/LeafGreen Network Machine gates for Ruby, Sapphire, Emerald, FireRed, and LeafGreen Hub transfers.

- [Spec 034 — Global emulator snapshots](034-global-emulator-snapshots.md): one authoritative cross-device EmulatorJS state per profile/game, atomic state-plus-save bundles, and preflight before engine startup.

- [Spec 034 implementation plan](034-global-emulator-snapshots-plan.md): test-first tasks for the snapshot envelope, backend resource, preflight, and player lifecycle.

- [Spec 032 — Mobile standalone player](032-mobile-standalone-player.md): installed-web-app metadata, mobile portrait guidance, and resilient player closing.

- [Spec 031 — Mobile client diagnostics](031-mobile-client-diagnostics.md): opt-in iPhone browser failure reporting, ephemeral backend backlog, and Caddy access-log correlation.

- [Spec 028 — Pokemon Hub session contract repair](028-pokemon-hub-session-contract-repair.md): active compact-session protocol, atomic attach ownership, lease reconciliation, compact corrections, and terminal browser recovery. Supersedes Spec 026's browser transfer flow and amends Spec 027.

- [Spec 026 — Persistent Hub grid transfers](026-pokemon-hub-persistent-grid-transfers.md): authoritative game Box and Hub grid placement transfers through the snapshot coordinator.

- [Spec 025 — Pokemon Hub deferred save flush](025-pokemon-hub-save-flush.md): deferred authoritative save writes, final flush after workspace release, and the initial safe Generation III materialization boundary.

- [Spec 024 — Pokemon Hub record model and snapshot transport](024-pokemon-hub-record-model-and-snapshot-transport.md): backend-owned complete Pokemon records, lossless Generation III representation, opaque instance identifiers, and small placement-only snapshot payloads.

- [Spec 023 — Pokemon Hub snapshot integrity and exclusive sessions](023-pokemon-hub-snapshot-integrity.md): planned opaque Pokémon identities, exclusive source leases, versioned snapshot synchronization, deterministic duplicate correction, and a frontend-only test phase.

- [Spec 022 — Pokemon Hub read-only drag and drop](022-pokemon-hub-read-only-drag-and-drop.md): frontend-only draggable occupied slots, droppable targets, and visual overlay without transfer writes.

- [Spec 021 — Pokemon Hub sprite rendering](021-pokemon-hub-sprite-rendering.md): responsive local sprite planes over occupied Hub, Party, and Box slots; drag-and-drop remains deferred.

- [Spec 020 — Local Pokemon sprite resources](020-local-pokemon-sprite-resources.md): local normal and shiny artwork for all base Pokémon and regional forms, synchronized before the frontend starts.

- [Spec 019 — Redis application persistence](019-redis-application-persistence.md): durable Redis-backed application data, SSH-tunnel deployment boundary, and one-time JSON import.

- [Spec 017 — Pokemon Hub save-profile selection](017-pokemon-hub-save-profile-selection.md): two-stage ROM/profile selection, with save content initially deferred.
- [Spec 018 — Pokemon Hub save Box layout](018-pokemon-hub-save-box-layout.md): read-only Generation III Party and PC Box rendering through title-specific JSON layout profiles.

This directory holds the project's specifications. Define the architecture, shared package contracts, application responsibilities, and feature acceptance criteria here before implementing them.

- [Spec 059 — Canonical game save and snapshot independence](059-canonical-save-and-snapshot-independence.md): permanent `.sav` versus runtime-snapshot invariant, load order, and player-visible failure boundary.

The initial direction is recorded in the root `AGENTS.md`.

- [Spec 001 — Pokémon Emulator Hub](001-hub.md): catalog, selection, embedded play, and Electron windows.
- [Spec 002 — Backend content and cloud saves](002-cloud-saves-and-content.md): hosted assets, save synchronization, and validation.
- [Spec 003 — First playable hub slice](003-first-playable-hub.md): immediate web implementation with manual ROM intake and hash verification.

- [Spec 015 — Automatic trusted ROM discovery](015-automatic-rom-discovery.md): hash-first No-Intro registration, metadata, and cover discovery for local ROM files.

Specs 001 and 002 cover the wider product and remain under review. Spec 003 defines the first playable web slice and defers cloud saves.

- [Spec 016 — Hub layout categories](016-hub-layout-categories.md): internal-app and console grouping with JSON-backed GBA ordering.
- [Spec 052 — Player header control rework](052-player-header-rework.md): reorder header controls, add help text, and update reset/save-state icons.
- [Spec 051 — GBA soft and hard reset controls](051-soft-and-hard-reset-controls.md): add console-compatible soft reset and explicit hard reset labels/actions.
