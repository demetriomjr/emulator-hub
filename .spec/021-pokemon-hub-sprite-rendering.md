---
title: Pokemon Hub Sprite Rendering
date: 2026-09-17
tags: [spec, pokemon, hub, frontend, sprites, visual]
status: active
---

# Spec 021 — Pokemon Hub Sprite Rendering

## Goal

Render the existing locally stored Pokémon sprite over each occupied Pokémon Hub, Party, and Box slot. The sprite must remain centered and correctly sized as the user resizes the viewport or scrollable workspace.

This is a visual-only increment. It does not introduce data-model changes, save writes, record movement, new backend routes, a new frontend dependency, or a new interpretation of save data. The later visual drag prototype is specified separately in Spec 022.

## Current display input

The current slot projections already expose `occupied`, National-Dex `species`, and, for decoded Generation III slots, `shiny`. This feature consumes those fields exactly as they are currently supplied.

For this visual increment only, a positive National-Dex `species` value is used directly as the local sprite filename key. The Generation III adapter owns its native-to-National conversion before this visual layer receives the projection. Regional-form detection and support for additional save families remain deferred.

## Local artwork resolution

The frontend uses only local resource paths:

```text
/resources/pokemon/{species}.png
/resources/pokemon/{species}-shiny.png
```

An occupied slot with `shiny: true` requests the shiny path. Any other occupied slot requests the normal path. Empty slots request no image.

The existing centered numeric content remains in the DOM behind the sprite as a visual fallback. It is not removed or repurposed by this increment. If an image fails to load, the number remains readable.

## Slot visual plane

Every occupied slot has a local, non-interactive sprite plane:

1. the square itself remains the interactive and accessible slot surface;
2. the slot index and existing fallback number retain their current placement;
3. the sprite plane is absolutely positioned within that same square and stacked above the fallback number;
4. the image uses contain-fit sizing, preserves its aspect ratio, and cannot receive pointer events; and
5. the plane derives its dimensions from the square, not from a copied viewport, measured coordinates, timers, or JavaScript resize handling.

All text inside the Pokémon Hub workspace, including profile modals and the option lists rendered by Hub selectors, is non-selectable. This prevents text selection from competing with the future drag gesture; it intentionally applies to every Hub control without an editable-text exception.

Party sprites have a Party-only upward visual offset of 6 pixels, keeping their visible art clear of the fixed bottom status strip. Box and standard Hub sprites retain the common centered position.

Because the sprite plane is owned by each square, grid layout, responsive column changes, scrolling, and viewport resizing reposition it automatically with that square. No duplicate invisible grid or viewport exists.

## Future drag boundary

This spec deliberately does not install or configure a drag-and-drop library.

The local sprite plane must be pointer-transparent so a future drag source can be attached to the slot without the image intercepting input. A future drag specification may introduce one separate workspace-level drag-preview layer above the current UI while an item is actively dragged. That future preview is not part of this feature and must not be implemented now.

## Scope

Included:

- rendering local normal and shiny PNGs in occupied Hub, Party, and Box slots;
- CSS-only alignment and responsive behavior; and
- image-load fallback to the existing numeric content.

Excluded:

- drag-and-drop, movement, drop targets, transfers, selection behavior changes, or save writes;
- new dependencies;
- record/schema/API/backend changes;
- National Pokédex conversion and regional-form identity;
- asset downloads or changes to the resource synchronizer; and
- layout redesign, new controls, overlays, or global sprite layers.

## Acceptance criteria

1. Every occupied rendered slot requests exactly one local normal or shiny image path; empty slots request none.
2. A successfully loaded image visually covers the existing centered number without intercepting click, focus, selection, or future drag input.
3. If an image is unavailable, the existing number remains visible and the slot remains usable.
4. Resizing the viewport, changing responsive columns, scrolling the workspace, and switching Box views keep each sprite centered over its own slot without JavaScript measurement or coordinate copying.
5. Party, Box, standard Hub grid, and profile Hub grid use the same sprite-plane behavior.
6. No drag-and-drop package, global drag preview, save mutation, route, or data-contract change is introduced.
7. All visible Hub text, including text in associated modals and selector popups, cannot be selected.
8. Party sprites are visually offset 6 pixels upward without changing Box or standard Hub sprite placement.
9. Automated tests cover local normal/shiny path selection, empty-slot omission, fallback behavior, the shared slot rendering contract, no-selection boundary, and Party-only sprite offset. Manual verification resizes the existing Hub workspace with occupied normal and shiny fixtures. No project build is run.

## Verification record

- 2026-09-17: `node --test` ran the Hub layout, sprite-rendering, slot-sprite, and local-resource suites: 16 passing tests, 0 failures.
- 2026-09-17: `git diff --check` completed with no whitespace errors.
- 2026-09-17: The already-running frontend was inspected without altering its data. It currently exposes no Hub profiles or occupied slots, so end-to-end visual resizing remains for a session containing normal and shiny slot fixtures.
