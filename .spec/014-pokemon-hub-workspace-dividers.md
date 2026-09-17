---
title: Pokémon Hub Workspace Dividers
date: 2026-09-17
tags: [spec, pokemon, hub, workspace, layout, dividers]
status: active
---

# Spec 014 — Pokémon Hub Workspace Dividers

## Goal

Let one Pokémon Hub workspace show one, two, or three independently selected source containers for a later transfer flow. A container is the complete unit made of its source header and its box/content area. Adding or closing a container only changes the in-memory workspace layout; it never writes a Hub profile, a game save, a Pokémon slot, or visual dimensions.

This spec supersedes the one-partition restriction in Spec 013. It does not implement a Pokémon transfer, save loading, a divider that the user can drag, or persistence of workspace layout.

## Terms and ownership

- **Pane/container**: one workspace unit containing its source selectors, its pane action controls, and its selected profile or game-box content.
- **Workspace layout**: the ordered in-memory `panes` array. It begins with one `null` pane and may contain at most three panes.
- **Source**: either a fully identified Hub profile `{ kind: 'hub', hubProfileId }` or a fully identified game save `{ kind: 'game', profileId, gameId }`. A partially chosen type has no identity and is not a duplicate.
- **Frontend**: owns pane creation/removal, responsive layout, source-selection interaction, and clearing transient selection when the layout changes.
- **Existing profile/save services**: remain read-only for this slice. They do not receive a layout request.

## Pane actions

Each pane header contains its existing type selector, the source selector that applies to that type, the Hub-profile creation button when applicable, and a right-aligned action group. Header children are vertically centered against the action controls.

| Pane count | First pane | Middle pane | Last pane |
| --- | --- | --- | --- |
| 1 | Add (`+`) | — | — |
| 2 | Close | — | Close + Add (`+`) |
| 3 | Close | Close | Close |

The add control is a prominent 42px Ant Design icon button labeled `Abrir novo container`. It is rendered only in the final pane while there are fewer than three panes. The close control uses a same-sized icon button labeled `Fechar container`; it is rendered in every pane once a second pane exists. The workspace-level close button remains separate and closes the entire Pokémon Hub.

Adding appends one empty pane. Closing removes the exact pane the user selected; it does not reset or reload surviving panes. When a close changes the arrangement, any pending pair-of-slot selection is cleared, a pending creation modal is closed, and the terminal surviving pane receives Add again if the new count is below three. The last remaining pane cannot be closed.

## Source uniqueness

`choosePaneSource` keeps a defensive duplicate guard, but the interface prevents a duplicate selection before it can be attempted. Each source selector omits complete source identities already selected in another pane, while retaining its own current value:

- A Hub profile may appear once by `hubProfileId`.
- A game save may appear once by the pair `profileId` and `gameId`.
- An empty pane or a type choice without its required identifier is never considered a duplicate.

The type selector is not clearable: once chosen, it remains the context for that pane. A selected source profile can be cleared through the profile Select `×`, preserving its selected type. A cleared or closed pane releases its source immediately, so it returns to every other relevant selector. The defensive helper keeps its former source and returns an error only for impossible stale/racing state.

## Responsive layout

The workspace body has one equal-width column per pane: one full-width pane, two exact half-width panes, or three equal-width panes. Separators are a 1px visual gap only. A pane header runs flush from edge to edge within its pane and has only its own internal control padding; its content area uses 10px padding and holds the box selector, profile canvas, and grids. The content grid uses a `minmax(0, 1fr)` track and its profile layout has no intrinsic minimum width, so a previously wide card canvas can never prevent a pane from shrinking. Its selectors, grid canvas, header summary, and scroll frame measure their own available width; cards never measure the whole workspace. A Hub grid observes the scroll frame and also recomputes after every pane-count change, so adding or removing dividers immediately recalculates its 5–20 column width.

A Hub profile name is limited to 26 printable characters. Its box-summary title remains a single centered, ellipsized line and scales from the original 100% title size in one pane to 80% in two panes and 60% in three panes. This keeps the title clear of the count and action controls without permitting a line wrap.

At narrow viewport widths the panes stack vertically in the same order and the workspace body scrolls. Pane-header selectors may wrap within their pane; action controls stay visible at the header's right edge. A Hub grid retains its existing 5–20 fixed-card rule and horizontal-scroll fallback within its own pane.

## State helpers

`apps/packages/pokemon-hub-workspace.mjs` is the sole pure state boundary for this layout:

```js
createPokemonHubWorkspaceState()
// -> { profile: null, panes: [null], boxes: {} }

addWorkspacePane(panes)
// [a] -> [a, null]; [a, b] -> [a, b, null]; throws at three panes

removeWorkspacePane(panes, index)
// removes the indexed pane; throws if it would remove the last pane

choosePaneSource(panes, index, nextSource)
// updates exactly one pane or returns the original array with a duplicate error

isPaneSourceAvailable(panes, index, source)
// reports whether a completed source is free for the indexed pane
```

## Acceptance criteria

1. The initial workspace shows one container with its selectors and one Add control.
2. Adding creates a second equal-width empty container; the first switches from Add to Close, and the second shows both Add and Close.
3. Adding from the terminal second container creates three equal-width containers; all three show Close and none show Add.
4. Closing any pane while two or three panes exist preserves the other sources and content, clears transient transfer selection, and restores Add only to the surviving final pane when allowed.
5. A complete Hub profile or game save selected in one container disappears from all other relevant source selectors, but remains visible in its current selector. Changing only a source type does not falsely reserve an option. Each selected source can be cleared with the selector's `×` and immediately becomes available again elsewhere.
6. In two and three pane layouts, every selector and grid derives width from its own container. At narrow widths panes stack without card shrinking or clipped controls.
7. No action in this feature persists a pane count, visual divider, row/column count, Hub profile grid, Pokémon, or game save.

## Tests

- Workspace helper tests cover: append from one to two and two to three, rejection at three, removal of each valid index, rejection of last-pane removal, source release after removal, duplicate complete Hub profiles, duplicate complete game saves, selector availability for a source's own pane versus other panes, and permitted incomplete type choices.
- The React flow is manually verified using the existing dev server: add to two, add to three, select a source and confirm it disappears from the other source lists, clear with `×` and confirm it returns, close first/middle/last, retain loaded sources, and verify narrow pane header wrapping and grid horizontal scrolling.
