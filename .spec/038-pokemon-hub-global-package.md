---
title: Pokemon Hub global frontend package
date: 2026-09-19
tags: [spec, pokemon-hub, packages, frontend, code-splitting]
status: active
---

# Spec 038 — Pokemon Hub global frontend package

## Goal

Remove the Pokémon Hub feature from the frontend application's `main.jsx` and
make it a reusable global package under `apps/packages/`. The frontend imports
one package entry point only when the Hub opens. This restores the application
boundary and prevents Pokémon Hub UI, drag/drop, and session code from being
part of the normal Hub/player entry bundle.

## Package boundary

`apps/packages/pokemon-hub-ui.jsx` exports a default `PokemonHub` React
component. It owns all feature-local React state, effects, API calls, Hub
profile CRUD, workspace panes, source selection, snapshot/session lifecycle,
drag/drop, and Pokémon-Hub-only presentation helpers. It imports the existing
global packages for hub HTTP, layouts, snapshots, workspace rules, transfer
identities, sprites, and request coordination.

The component interface is deliberately minimal:

```jsx
<PokemonHub onClose={() => setPokemonHubOpen(false)} closeSignal={pokemonHubCloseSignal} />
```

The frontend application retains only the `pokemonHubOpen` boolean needed to
compose modal surfaces and the lazy package import. It does not own Pokémon Hub
state, helpers, callbacks, Ant Design controls, or dnd-kit imports.

## Loading and presentation

`main.jsx` loads the package with `React.lazy(() => import(...))` and renders
it only while `pokemonHubOpen` is true. The existing dialog, pane controls,
drag/drop behavior, profile actions, layouts, styling class names, Portuguese
copy, and close semantics remain unchanged. A neutral existing loading state is
used while the feature chunk is requested; no new page, navigation, or product
control is added.

Vite's default dynamic-import chunking is the source of the loading boundary.
No `manualChunks`/vendor-only configuration is used, because static imports
would still be eagerly loaded and Vite 8 deprecates the old manual-chunk
approach.

The package lives outside the frontend directory, so the frontend Vite config
resolves only the package UI's React, dnd-kit, Ant Design, and icon imports
from the frontend installation. This is a scoped build-boundary bridge: it
does not alias application imports or duplicate package code.

## Lifecycle and failure behavior

- Opening creates the same fresh workspace and obtains the same Hub profile,
  snapshots, layouts, and session state as before.
- Closing preserves the existing local-first teardown: it captures the final
  canonical snapshot, closes the presentation, then finishes the remote
  session-close request without leaving the workspace mounted.
- Unmount cleanup cancels timers, heartbeat work, and requests as the current
  component does. Reopening starts a clean independent workspace.
- The normal emulator, player, profile picker, control panel, and local-runtime
  recovery paths do not import or depend on the Pokémon Hub package.

## Acceptance

1. `main.jsx` contains no Pokémon Hub helpers, state other than open/close
   composition, dnd-kit imports, or Pokémon Hub-specific Ant Design imports.
2. The package exports one self-contained `PokemonHub` component and imports
   all feature-specific packages itself.
3. Opening, editing, deleting, pane changes, transfer drag/drop, snapshot
   sync, and closing preserve current behavior.
4. The normal production entry no longer statically imports dnd-kit or the
   Pokémon Hub UI package; a separate dynamically imported chunk is emitted.
5. Focused package/frontend contract tests and the frontend production build
   pass. No new dependency, route, server endpoint, or UI feature is added.
