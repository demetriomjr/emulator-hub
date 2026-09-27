---
title: Global fast-forward control
date: 2026-09-16
tags: [spec, frontend, emulator]
---

# Global fast-forward control

## Context

The player header owns controls shared by every active emulator instance. Fast forward must therefore never become an individual emulator control.

## Requirements

- Add a fast-forward toggle to the player header.
- Place a non-editable speed selector beside it.
- Supported values are 1.5x through 5x, in increments of 0.5x.
- A toggle or speed change applies to every active iframe immediately.
- New emulator instances start with the current global fast-forward state and speed.
- A global reset action restarts every active emulator instance.
- Profiles in use by an active emulator cannot be edited or deleted.
- Fast-forward changes do not show a RetroArch on-screen notification over gameplay.

## Implementation boundary

The parent hub owns the selected state. The player iframe receives that state through its launch URL and same-origin messages. The iframe is the only layer that accesses EmulatorJS runtime controls.

### RetroArch notification configuration

The `Fast-Forward.` banner is rendered by RetroArch inside the game canvas, not by EmulatorJS's `.ejs_message` HTML element. In EmulatorJS 4.2.3, `loadExternalFiles()` passes downloaded `ArrayBuffer` data directly to `FS.writeFile()`, which truncates the destination before rejecting that data type. Supplying `retroarch.cfg` through this path erases the generated configuration and causes RetroArch to recreate defaults, including enabled notifications.

The player installs an `apps/packages/` runtime adapter at `EJS_ready`. At EmulatorJS's `saveDatabaseLoaded` event (after file preparation and before `callMain`), the adapter updates `notification_show_fast_forward` in the generated config using text accepted by `FS.writeFile()`. It preserves all other settings, including save directories and core-specific options. Do not replace the generated config with an external file, hide HTML messages, or send this frontend setting through the libretro core-option API. A configuration failure is logged without blocking game startup or weakening save validation.

## Acceptance criteria

1. The header shows the fast-forward toggle and a selector containing 1.5x, 2x, 2.5x, 3x, 3.5x, 4x, 4.5x, and 5x.
2. Changes update every open emulator.
3. An emulator added after a change starts with the same configuration.
4. The selector cannot receive arbitrary typed input.
5. Reset dispatches to every active iframe.
6. An active profile has disabled edit and delete actions.
7. With the actual EmulatorJS 4.2.3 mGBA runtime, enabling, disabling, and re-enabling fast-forward produces no canvas banner; emulation continues advancing and the configured save directory remains `/data/saves`.
