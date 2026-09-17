# Specifications

This directory holds the project's specifications. Define the architecture, shared package contracts, application responsibilities, and feature acceptance criteria here before implementing them.

The initial direction is recorded in the root `AGENTS.md`.

- [Spec 001 — Pokémon Emulator Hub](001-hub.md): catalog, selection, embedded play, and Electron windows.
- [Spec 002 — Backend content and cloud saves](002-cloud-saves-and-content.md): hosted assets, save synchronization, and validation.
- [Spec 003 — First playable hub slice](003-first-playable-hub.md): immediate web implementation with manual ROM intake and hash verification.

- [Spec 015 — Automatic trusted ROM discovery](015-automatic-rom-discovery.md): hash-first No-Intro registration, metadata, and cover discovery for local ROM files.

Specs 001 and 002 cover the wider product and remain under review. Spec 003 defines the first playable web slice and defers cloud saves.

- [Spec 016 — Hub layout categories](016-hub-layout-categories.md): internal-app and console grouping with JSON-backed GBA ordering.
