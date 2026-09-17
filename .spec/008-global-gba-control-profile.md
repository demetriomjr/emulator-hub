# Spec 008 — Global GBA control profile

## Goal

Provide one persistent global control profile for the Game Boy Advance layout. The profile is edited from the player header, applied to every newly loaded EmulatorJS iframe, and reapplied to all currently open instances after saving.

## Model

The backend owns one Git-ignored JSON document:

```json
{
  "version": 1,
  "name": "Default",
  "system": "gba",
  "bindings": {
    "8": { "keyboard": "z", "gamepad": "BUTTON_1" }
  }
}
```

`bindings` is keyed by EmulatorJS player-one input ID. Each binding stores a keyboard `event.key` value normalized for EmulatorJS and a gamepad code. Future profile lists can store multiple documents with this same shape without changing the player contract.

## Scope

- `GET /api/control-profile` returns the stored profile or a complete default GBA profile. `PUT /api/control-profile` validates and persists a replacement profile.
- The player header aligns control configuration to the left. Add-instance, fullscreen-all, and close-session remain aligned to the right.
- The control dialog presents a GBA layout for D-pad, A, B, L, R, Start, and Select. Each displayed control has a keyboard capture field and a gamepad capture field.
- Clicking a keyboard field captures the next key. Clicking a gamepad field polls the connected gamepad and captures the next pressed button or moved axis. The dialog shows a capture prompt until a value arrives.
- Saving validates and persists the profile, increments the active player revision, and reloads every open iframe with the new `EJS_defaultControls` configuration. New iframes retrieve the same profile before loading EmulatorJS.
- EmulatorJS receives player-one mappings as `{ 0: bindings, 1: {}, 2: {}, 3: {} }` through `EJS_defaultControls`.

## Boundaries

Only the GBA layout and a single global profile are included. There is no profile list, per-user profile, per-game override, mobile virtual gamepad, or hot application of mappings through undocumented EmulatorJS runtime APIs. Reloading iframes is the supported way to apply the pre-loader configuration to already-running instances.

## Acceptance

1. The player header has a left-aligned control button and keeps session controls on the right.
2. The dialog draws GBA controls and captures keyboard and gamepad values for every supported GBA input.
3. A saved profile survives a backend restart and is loaded by a later player session.
4. Saving refreshes all active iframe keys; each iframe loads the saved mapping before EmulatorJS starts.
5. Invalid, incomplete, or unsupported profile payloads are rejected without overwriting the stored profile.
