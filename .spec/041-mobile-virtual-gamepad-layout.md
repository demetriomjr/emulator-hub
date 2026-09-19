---
title: Mobile virtual gamepad layout
date: 2026-09-19
tags: [spec, mobile, player, emulatorjs, controls]
status: active
---

# Spec 041 — Mobile virtual gamepad layout

## Goal

Apply the approved landscape mobile control layout to EmulatorJS while keeping its native touch input components.

## Scope

- The mobile player uses a digital EmulatorJS `zone` for GBA directions, so a player can slide a finger between directions.
- The D-pad has a dead zone equal to 24% of its rendered diameter, preventing small movements from the center from activating a direction.
- A/B, Start, Select, L, and R remain native EmulatorJS buttons.
- The native shoulder buttons always display the literal labels `L` and `R`.
- The approved logical 844 by 390 layout is: D-pad zone `(133, 263, 195)`; A `(775, 248, 91)`; B `(672, 323, 91)`; Start `(494, 313, 95)`; Select `(350, 313, 89)`; L `(121, 48, 150)`; R `(723, 48, 150)`.
- Positions map directly to the current landscape player viewport, avoiding letterbox padding when the mobile control rail reduces its width. Control sizes remain uniform.

## Boundaries

- No custom touch overlay, new player controls, persistence, control editor, or desktop layout change.
- The EmulatorJS upstream speed controls remain absent.

## Acceptance

1. The layout is active only in the existing mobile landscape player mode.
2. Directional input uses the native digital zone with GBA input values `[4, 5, 6, 7]`.
3. The remaining controls occupy the approved scaled positions and sizes.
