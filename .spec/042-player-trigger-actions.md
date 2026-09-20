# Player trigger actions

## Goal

Allow the currently open player overlay to assign one header action to each
controller trigger, L2 and R2.

## Requirements

- The emulator header shows an L2 selector and an R2 selector.
- Each selector offers `Do nothing`, `Reset game`, `Save state`, and `Load state`.
- Both selectors default to `Do nothing` whenever a player overlay opens.
- The existing control settings expose gamepad bindings for L2 and R2. They
  default to the controller's lower shoulder buttons and can be changed there.
- Pressing a configured trigger dispatches its selected existing action to every
  active emulator frame. `Do nothing` dispatches nothing.
- A held trigger fires its action only on the press edge, not every gamepad poll.
- The selection exists only while that player overlay is open. Closing it resets
  both selectors on the next open.
- Trigger action selections must not write localStorage, cookies, or backend
  state. Their L2/R2 controller bindings use the existing persisted control
  profile.
- No mobile-specific layout is required.

## Boundaries

- Existing header buttons and their message contracts remain unchanged.
- L2 and R2 controller labels come from the configured control profile.
