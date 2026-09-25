# Spec 069 — Pokémon Hub source order

## Current behavior and source of truth

- The main hub renders ROMs through `groupGamesByLayout(games, hubLayout)`, where `apps/frontend/src/hub-layout.json` defines section order and custom game IDs. Unlisted games in a section fall back to title order.
- The launch picker receives `GET /api/games/:gameId/profiles` in creation order from `profileStore.list()`. The catalog's embedded profiles use that same store method.
- Pokémon Hub fetches `GET /api/games` independently, then `deriveSaveProfileCatalog()` filters eligible ROMs and profiles without applying the hub layout. Its ROM selector consequently follows catalog order rather than the home screen. Its save profile selector currently inherits catalog order without stating or enforcing the creation-order contract.

## Requirements

1. The Pokémon Hub ROM selector must present eligible ROMs in the same relative order as the main screen, using the same `hubLayout` and `groupGamesByLayout` rules. Eligibility and selection identity must remain unchanged.
2. For each selected ROM, the Save profile selector must present profiles with `hasSave: true` from oldest to newest `createdAt`, matching the launch picker. Keep stable order for equal timestamps and preserve each profile's ID and name.
3. Keep the existing catalog request and pane-availability filtering. Selecting a ROM or profile must not add a request or mutate a save.

## Verification

- Unit test with catalog order differing from custom home order, including an unlisted ROM and an ineligible ROM.
- Unit test with save profiles supplied out of creation order, including equal timestamps and a profile without a save.
- Run the focused package and frontend tests plus frontend lint. Do not build, commit, push, or deploy without a current request.
