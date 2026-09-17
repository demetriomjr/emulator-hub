---
title: Pokemon Hub Read-Only Drag and Drop
date: 2026-09-17
tags: [spec, pokemon, hub, frontend, drag-and-drop, read-only]
status: active
---

# Spec 022 — Pokemon Hub Local Drag and Drop

## Goal

Introduce local drag-and-drop for occupied Pokémon Hub, Party, and Box slots. The visible workspace must reflect accepted moves and swaps immediately while issuing no backend write request or persisting a save change.

## Library boundary

The frontend depends on `@dnd-kit/react` 0.5.0. One drag provider encloses the open Pokémon Hub workspace. The prototype uses its draggable and droppable hooks plus a viewport-level drag overlay; it does not use the legacy package family or an additional sortable package.

## Interaction model

1. An occupied slot is draggable. Empty slots are not draggable.
2. Every rendered slot is a droppable target, including empty slots.
3. A pointer must travel 6 pixels before a drag begins, so an ordinary click preserves the existing selection behavior.
4. During an active drag, the source keeps its loaded visual content and a floating overlay shows the dragged sprite above the workspace. The overlay cannot receive pointer events.
5. The current target receives a visual hover state. Dropping outside a slot cancels the interaction.
6. Dropping on an empty slot moves the Pokémon locally, clearing the source and filling the target.
7. Dropping on an occupied slot swaps the two Pokémon only when both slots are in the same Party of one save, the same Box of one save, or the same Hub profile grid.
8. Dropping onto an occupied slot in every other combination—including Party to Box, Box to Party, Hub to a save, a save to the Hub, or two different saves—does nothing.
9. Dropping outside a slot or onto the source slot cancels the interaction without changing local data.

## Identity contract

Each DnD participant has a stable, string-form identity derived solely from the currently rendered location:

```text
hub:{hubProfileId}:{slot}
game:{gameId}:{profileId}:party:{slot}
game:{gameId}:{profileId}:box:{box}:{slot}
```

The identity is UI-only in this increment. Drag event data also retains the existing location fields and pane index for later mapping, but no event handler may call a backend client or change the loaded collection.

## Read-only boundary

While this prototype is active, the Pokémon Hub presents no action that writes transfers. Accepted drops mutate only React state for the open workspace; closing or reopening the workspace discards those local changes. The existing confirmation control and its backend transfer handler remain absent from this screen. Loading profiles and save content continues to use the existing read APIs.

## Accessibility and visual constraints

- Native image dragging remains disabled.
- The existing non-selectable text rule remains active.
- Drag source and target state are announced through accessible slot labels; the decorative overlay is hidden from assistive technology.
- The overlay is rendered above scrollable panes, without copying the viewport or measuring coordinates manually.
- The Party-only sprite offset and the existing Box and standard Hub layouts remain unchanged when no drag is active.

## Scope

Included:

- current DnD Kit dependency and frontend-only provider;
- draggable occupied slots, droppable rendered slots, active-target styling, and visual overlay;
- immutable drag events and stable location identity; and
- local in-memory movement into empty slots;
- local swaps within one Party, one Box, or one Hub profile grid; and
- removal of the transfer-write control from this read-only prototype.

Excluded:

- save updates, backend write routes, persistence, transfer validation, or optimistic updates;
- persistence, backend transfer calls, save-file writes, undo, or automatic slot selection;
- a sortable package, keyboard movement semantics, multi-item dragging, touch-specific behavior, undo, history, or a new global layout layer; and
- changes to sprite resources or save decoding.

Persistent source reservations, snapshot synchronization, opaque per-Pokémon identifiers, duplicate correction, and backend authority are specified separately in [Spec 023](023-pokemon-hub-snapshot-integrity.md). This increment remains local-only until that contract's frontend test phase is implemented.

## Acceptance criteria

1. The frontend declares `@dnd-kit/react` 0.5.0 and React 19 remains within its peer dependency range.
2. The open Pokémon Hub workspace has one provider covering every Hub, Party, and Box slot.
3. Only occupied slots can initiate a pointer drag; every slot can become a visible drop target.
4. A 6-pixel activation threshold preserves ordinary slot clicks.
5. An active drag displays a pointer-transparent decorative overlay above scrollable panes and highlights the current target.
6. Dropping on an empty target moves the local slot data without a backend call.
7. An occupied target swaps only within the same Party, the same Box, or the same Hub profile grid; every cross-area or cross-save occupied target remains unchanged.
8. Cancelling, self-dropping, and invalid occupied-target drops leave local data unchanged.
9. No DnD path invokes a backend client, and the Hub exposes no transfer-confirmation control during this prototype.
10. Automated tests cover the dependency declaration, provider boundary, stable location identities, draggable/droppable eligibility, local movement and swap eligibility, overlay/target style contracts, click threshold, and absence of a transfer-write call. No project build is run.

## Verification record

- 2026-09-17: Focused identity, sprite, and rendering contract tests passed with 12 tests and 0 failures. The frontend source was transformed successfully through Vite's OXC transformer; no project build or frontend server start was run.
