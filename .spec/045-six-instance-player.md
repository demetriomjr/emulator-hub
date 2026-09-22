# Spec 045 — Six-instance player surface

## Goal

Expand one player session from a maximum of four to a maximum of six simultaneously running EmulatorJS instances, while preserving the existing session controls and applying their global behavior to every active instance.

## Scope

- A player session may contain one through six independently launched title/profile instances. The add-instance control remains available until six instances are active and is disabled at six. Attempts to add beyond six are rejected before launching or mounting an iframe.
- Adding an instance keeps the existing title-first picker, ready-title catalog, profile picker, exclusion of profiles already assigned to active instances, new-profile flow, and verified launch endpoint. Existing instances stay mounted when another instance is added.
- The surface uses a zero-gap, zero-outer-padding grid. Instances fill in order: one occupies the first cell; two fill row one; three and four use two columns and two rows; five and six use three columns and two rows so the six-instance surface is horizontal and five keeps the same row geometry with one empty cell. Each iframe remains its own `player.html` document and preserves its profile-scoped EmulatorJS game ID and save isolation.
- Size the surface from the number of occupied rows and columns so every occupied cell retains the existing 3:2 aspect ratio. At five and six instances, the surface uses the 9:4 aspect ratio. The complete surface remains the fullscreen target and stays centered/proportional within the available viewport.
- Keep the existing dedicated player header and every current control: control configuration; add instance; fullscreen all; close session; fast-forward enable/disable and speed; reset all; and L2/R2 trigger-action selectors. Keep their current order, placement, labels, persistence, and mobile visibility/behavior unless this spec explicitly changes the instance limit. No control is removed or replaced as part of this expansion.
- Global controls continue to cover the complete active session at any supported count. Saving a control profile reloads/applies it to all active iframes; fast-forward settings are sent to every active iframe, including newly added ones; reset all dispatches to all active iframes; and L2/R2 configured actions retain their existing dispatch behavior for every eligible active instance.
- Fullscreen enters/exits for the complete six-instance surface. Close ends the complete player session and retains existing save-close behavior for every active instance.
- Existing per-emulator EmulatorJS controls, toolbar filtering, input/profile semantics, lease and save validation, and launch failure handling remain unchanged.

## Boundaries

This is a player-surface capacity and layout change. It does not add per-instance close, reorder, resize, audio-mixing, keyboard-routing, cloud-save, backend capacity configuration, or a configurable limit. The maximum is six. Optional integration failures and core launch/save checks retain their existing independent behavior.

## Acceptance

1. One through six title/profile instances launch in one session through the existing verified selection flow; a failed launch leaves already-running instances intact.
2. The add-instance control is enabled below six and disabled at six; no code path can mount a seventh iframe.
3. Placement is ordered and gapless: five and six instances use three columns and two rows. Every iframe retains a 3:2 ratio, and the five/six-instance surface is horizontal.
4. Fullscreen covers the complete surface at each count, including five and six, and exit returns to the normal player layout.
5. All existing header controls remain present and behave as before. Control-profile updates, fast-forward state/speed, reset-all, L2/R2 actions, fullscreen, and close-session cover every active iframe/session as applicable, including instances added after those settings were selected.
6. The existing mobile visibility and interaction rules are preserved while enforcing the six-instance cap on every supported surface.
7. Each instance keeps its separate iframe, verified launch descriptor, title/profile identity, EmulatorJS game ID, and save namespace.
8. No build is required by this spec; implementation verification uses focused tests and browser checks without running a project build.
