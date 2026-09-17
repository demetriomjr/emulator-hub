# Spec 007 — Player control normalization

## Goal

Separate session-level controls from per-emulator controls and remove local controls that conflict with hub-owned behavior.

## Scope

- The multi-instance surface has a dedicated header outside the emulator grid. It contains the existing add-instance, fullscreen-all, and close-session controls, in that order.
- Each EmulatorJS iframe keeps only reset, pause/play, volume, and exit-emulation controls.
- EmulatorJS hides its fullscreen, cache-manager, cheats, gamepad/control-settings, context-menu, and all save-state/save-file controls. This includes save state, load state, quick save/load, and save/load save-file actions.
- The hub does not add save controls in this scope. Save management remains deferred.

## Boundaries

The header controls the complete multi-instance session. Per-emulator reset, pause/play, volume, and exit retain their existing EmulatorJS behavior. No keyboard mappings, cache behavior, save persistence, or new global controls are introduced.

## Acceptance

1. Header controls are visibly outside the emulator grid.
2. Each embedded toolbar shows reset, pause/play, volume, and exit-emulation.
3. Each embedded toolbar omits fullscreen, cache manager, cheats, control settings, context menu, and every save-state/save-file control.
4. Fullscreen continues to apply to the whole player surface.
