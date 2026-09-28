# Player trigger actions

## Goal

Allow the currently open player overlay to assign one header action to each
controller trigger, L2 and R2.

## Requirements

- The emulator header shows an L2 selector and an R2 selector.
- Each selector offers `Do nothing`, `Fast Forward`, `Soft Reset`, `Hard Reset`, `Save state`, `Load state`, and `Iniciar/parar último macro`.
- Both selectors default to `Do nothing` until the saved user preferences are loaded.
- The existing control settings expose gamepad bindings for L2 and R2. They
  default to the controller's lower shoulder buttons and can be changed there.
- Pressing a configured trigger dispatches frame actions to every active
  emulator frame. The macro action controls the hub's current macro execution.
  `Do nothing` dispatches nothing.
- A held trigger fires its action only on the press edge, not every gamepad poll.
- Trigger action selections use the existing user preferences. Their L2/R2
  controller bindings use the existing persisted control profile.
- Starting a macro through either the editor or saved list stores its ID in the
  browser sessionStorage after the player start is confirmed. This ID is scoped
  to the browser tab and is not part of user preferences.
- On an `Iniciar/parar último macro` press, an active macro is stopped regardless of
  its ID. If no macro is active, the stored ID is looked up among the current
  saved macros and started if present. No ID or no matching saved macro is a
  no-op; a missing macro clears the stale ID.
- A held trigger fires once on its press edge. Simultaneous or repeated presses
  during macro lookup do not start multiple runs. While stopping, extra presses
  do not start a macro.
- No mobile-specific layout is required.

## Boundaries

- Existing header buttons and their message contracts remain unchanged.
- L2 and R2 controller labels come from the configured control profile.
