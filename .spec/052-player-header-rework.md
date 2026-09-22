# Spec 052 — Player header control rework

## Goal

Reorganize the player header into a predictable control strip and make every icon button self-explanatory through accessible help text.

## Required order

1. Fast Forward button and speed selector.
2. Vertical separator.
3. Save state and Load state buttons.
4. Vertical separator.
5. Soft Reset and Hard Reset buttons, in that order.
6. Vertical separator.
7. L2 and R2 action selectors.
8. Vertical separator.
9. Controller settings.

The existing player actions for add instance, fullscreen, and close remain in their existing right-side action group.

## Visual and copy requirements

- Add Soft Reset immediately to the left of Hard Reset.
- Soft Reset uses a refresh icon.
- Hard Reset uses a power icon.
- Load state uses an upload icon. Save state keeps the save icon.
- The visible labels for reset-related trigger options are Soft Reset and Hard Reset.
- Every header icon button has both an accurate `aria-label` and matching `title` help text: Fast Forward, Save state, Load state, Soft Reset, Hard Reset, Controller settings, Add instance, Fullscreen/Exit fullscreen, and Close emulator.
- Separator elements are decorative and hidden from assistive technology.
- Existing mobile header behavior remains usable; controls may continue stacking vertically under the existing mobile media rule.
- Keep the current dark green visual language and existing button dimensions unless required to fit the requested order.

## Interaction requirements

- Fast Forward and speed keep their current runtime and persistence behavior.
- Save and Load state keep their current broadcast messages.
- Soft Reset broadcasts the new soft-reset message; Hard Reset broadcasts the existing reset message.
- L2/R2 selectors keep backend-persisted preference behavior and press-edge semantics.
- Controller settings remains the final control in the global control strip.

## Acceptance

1. DOM order matches the nine groups above.
2. The two reset buttons are adjacent, with Soft Reset first.
3. All icon buttons expose matching accessible labels and browser help text.
4. The Load state icon is visibly an upload arrow and reset icons are distinct refresh/power shapes.
5. Existing header actions continue dispatching their current contracts, with Soft Reset added as a separate contract.
6. Focus-visible styles and mobile layout remain intact.
7. Static/component tests cover order, labels, titles, separator count, icon paths, and message contracts.

## Boundaries

This rework does not add new player capabilities beyond Soft Reset, does not change backend preferences, and does not run a project build unless explicitly requested.
