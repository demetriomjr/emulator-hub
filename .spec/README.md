# Specifications

- [Spec 024 — Pokemon Hub record model and snapshot transport](024-pokemon-hub-record-model-and-snapshot-transport.md): backend-owned complete Pokemon records, lossless Generation III representation, opaque instance identifiers, and small placement-only snapshot payloads.

- [Spec 023 — Pokemon Hub snapshot integrity and exclusive sessions](023-pokemon-hub-snapshot-integrity.md): planned opaque Pokémon identities, exclusive source leases, versioned snapshot synchronization, deterministic duplicate correction, and a frontend-only test phase.

- [Spec 022 — Pokemon Hub read-only drag and drop](022-pokemon-hub-read-only-drag-and-drop.md): frontend-only draggable occupied slots, droppable targets, and visual overlay without transfer writes.

- [Spec 021 — Pokemon Hub sprite rendering](021-pokemon-hub-sprite-rendering.md): responsive local sprite planes over occupied Hub, Party, and Box slots; drag-and-drop remains deferred.

- [Spec 020 — Local Pokemon sprite resources](020-local-pokemon-sprite-resources.md): local normal and shiny artwork for all base Pokémon and regional forms, synchronized before the frontend starts.

- [Spec 019 — Redis application persistence](019-redis-application-persistence.md): durable Redis-backed application data, SSH-tunnel deployment boundary, and one-time JSON import.

- [Spec 017 — Pokemon Hub save-profile selection](017-pokemon-hub-save-profile-selection.md): two-stage ROM/profile selection, with save content initially deferred.
- [Spec 018 — Pokemon Hub save Box layout](018-pokemon-hub-save-box-layout.md): read-only Generation III Party and PC Box rendering through title-specific JSON layout profiles.

This directory holds the project's specifications. Define the architecture, shared package contracts, application responsibilities, and feature acceptance criteria here before implementing them.

The initial direction is recorded in the root `AGENTS.md`.

- [Spec 001 — Pokémon Emulator Hub](001-hub.md): catalog, selection, embedded play, and Electron windows.
- [Spec 002 — Backend content and cloud saves](002-cloud-saves-and-content.md): hosted assets, save synchronization, and validation.
- [Spec 003 — First playable hub slice](003-first-playable-hub.md): immediate web implementation with manual ROM intake and hash verification.

- [Spec 015 — Automatic trusted ROM discovery](015-automatic-rom-discovery.md): hash-first No-Intro registration, metadata, and cover discovery for local ROM files.

Specs 001 and 002 cover the wider product and remain under review. Spec 003 defines the first playable web slice and defers cloud saves.

- [Spec 016 — Hub layout categories](016-hub-layout-categories.md): internal-app and console grouping with JSON-backed GBA ordering.
