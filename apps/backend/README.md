# Emulator Hub backend

This first slice uses Node.js built-in HTTP APIs and has no external runtime dependencies. It serves the configured game catalog and verified ROM bytes to the web frontend.

## Local setup

Place ROM files manually in `roms/` and add an entry to `catalog.json`. The ROM directory is intentionally ignored by Git. The expected hash must come from an independently trusted source; do not generate it from a file that has not been trusted yet.

Optional card metadata uses `pokeapiVersion` for the PokéAPI game version and `wikipediaPage` for its box-art thumbnail. `region` and `language` identify the verified ROM dump; PokéAPI name translations do not establish the ROM's language. API data is cached in memory and unavailable metadata does not block play. See [Spec 004](../../.spec/004-rom-card-metadata.md).

```json
[
  {
    "id": "pokemon-red",
    "title": "Pokémon Red",
    "system": "gb",
    "core": "gambatte",
    "file": "pokemon-red.gb",
    "sha256": "<64 lowercase hexadecimal characters>"
  }
]
```

The supported system/extension pairs are `gb`/`.gb`, `gbc`/`.gbc`, and `gba`/`.gba`. Before a game is listed as ready or its ROM is returned, the backend checks that the path is inside `roms/`, is a regular non-symlink file, and matches the catalog SHA-256 value.

## API

- `GET /api/games` returns `{ "games": [...] }`, including unavailable configured entries and their reason.
- `GET /api/profiles` returns `{ "profiles": [...] }`. `POST /api/profiles` accepts `{ "name": string }` and creates a profile. Profiles persist in Git-ignored `data/profiles.json`.
- `GET /api/games/:id/launch?profileId=:profileId` requires an existing profile and returns the verified launch descriptor `{ id, title, core, profileId, gameId, romUrl, saveUrl }`. `gameId` is stable per profile/title pair so EmulatorJS separates its browser-managed saves.
- `GET`/`PUT /api/profiles/:profileId/games/:gameId/save` restores and accepts the selected profile's binary in-game save. Uploads require a revision precondition and return the accepted revision and SHA-256.
- `GET /roms/:id` returns the verified ROM bytes with `Cache-Control: no-store`.
- `HEAD /roms/:id` returns the same verified ROM metadata without a body; EmulatorJS uses this when checking a previously loaded game.

Start the service with `npm start` from this directory. It listens on `127.0.0.1:3000` by default; `HOST` and `PORT` can override that address.

Run the backend checks with `npm test`.
