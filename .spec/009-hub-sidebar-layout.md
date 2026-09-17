---
title: Hub sidebar and constrained ROM grid
date: 2026-09-16
tags: [spec, frontend, hub]
---

# Hub sidebar and constrained ROM grid

## Context

The hub is intentionally minimal. Its ROM cards should remain the primary content, while global controls need a persistent entry point outside the emulator surface.

## Requirements

- On desktop widths, the ROM-card wrapper uses 70% of the viewport width, up to a sensible maximum.
- Cards remain left-aligned within that wrapper; the wrapper is centered in the available hub area.
- The hub exposes a narrow left sidebar.
- The first sidebar action opens the global GBA control configuration dialog.
- The existing control action in the active emulator header remains available while the player overlay is open.
- On narrow screens, the sidebar becomes a compact top row and the ROM wrapper uses the full available width.

## Acceptance criteria

1. Opening the hub shows the configuration-control action in the sidebar.
2. The action opens the existing control-profile dialog without loading an emulator.
3. At desktop sizes, the card grid is constrained to 70vw and is not centered card-by-card.
4. Existing profile, ROM, and emulator flows remain unchanged.
