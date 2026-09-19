# Pokemon Hub Global Package Implementation Plan

**Goal:** Move the complete Pokémon Hub frontend feature to one lazily imported global package.

**Spec:** `.spec/038-pokemon-hub-global-package.md`

## Tasks

1. Add a package-level component contract test proving that the feature owns dnd-kit, presentation, and its global-package dependencies.
2. Move Pokémon Hub state, lifecycle handlers, UI components, and helper functions from `apps/frontend/src/main.jsx` into `apps/packages/pokemon-hub-ui.jsx`; retain the existing package-domain contracts unchanged.
3. Replace frontend feature code with a lazy package import and open/close composition. Update source-contract tests so the main bundle has no static dnd-kit/Pokémon Hub imports.
4. Build the frontend and compare emitted chunks; run focused Pokémon Hub and frontend tests.
