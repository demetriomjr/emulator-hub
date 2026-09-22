# Spec 051 — GBA soft reset and explicit hard reset controls

## Goal

Provide a console-compatible soft reset for every active EmulatorJS instance and rename the existing core restart action to Hard Reset.

## Requirements

- The existing reset action is labeled Hard Reset in the header and in both L2/R2 action selectors.
- A new Soft Reset action is available in both L2/R2 selectors.
- Soft Reset sends the GBA combination A + B + Start + Select to every active emulator iframe.
- The sequence uses the current control profile's canonical GBA input identifiers: A id 8 (BUTTON_1), B id 0 (BUTTON_2), Select id 2 (SELECT), Start id 3 (START).
- All four inputs are pressed, held for a short deterministic interval, and released. The implementation must not call the hard-reset API.
- The action fires once per L2/R2 press edge, preserving the existing trigger behavior.
- L2 and R2 may independently be assigned Soft Reset, Hard Reset, Save state, Load state, Fast Forward, or Do nothing.
- Soft Reset, Hard Reset, Save state, and Load state continue to broadcast to all active instances.
- Missing or unavailable frames are skipped without aborting the remaining frames.
- The existing hard reset remains a core restart (gameManager.restart()) and is not renamed internally; only the user-facing action label changes.

## Acceptance

1. Selecting Soft Reset for L2 or R2 sends the four canonical inputs to every active player once per press edge.
2. A held trigger does not repeat the sequence; releasing and pressing again sends it again.
3. Selecting Hard Reset still calls the existing estart() path and never emits the four-button sequence.
4. Existing save/load/Fast Forward trigger actions remain unchanged.
5. Unit tests cover input identifiers, press/hold/release ordering, all active frames, and trigger action labels.

## Boundaries

No changes to EmulatorJS packages, controller bindings, save flow, RTC behavior, or deployment are included.
