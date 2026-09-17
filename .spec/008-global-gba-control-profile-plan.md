# Global GBA Control Profile Implementation Plan

**Goal:** Persist and apply one global Game Boy Advance control mapping across all EmulatorJS instances.

**Spec:** [.spec/008-global-gba-control-profile.md](008-global-gba-control-profile.md)

## Tasks

1. Add failing package and HTTP contract tests for default retrieval, validation, persistence, and replacement of a control profile.
2. Implement the reusable control-profile store in `apps/packages/` and expose its GET/PUT adapter from the backend.
3. Load the profile in `player.html` before the EmulatorJS loader and translate it into `EJS_defaultControls`.
4. Add the GBA layout editor, keyboard/gamepad capture, save action, and player revision reload in the React player header.
5. Verify keyboard capture, profile persistence, the reloaded iframe configuration, and header placement in the browser. Run the backend suite without a project build.
