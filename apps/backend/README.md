# Emulator Hub backend

This backend uses Node.js HTTP APIs and Redis for durable application data. It serves the configured game catalog and verified ROM bytes to the web frontend.

## Redis persistence

Application records (profiles, control profile, Pokémon Hub documents, and the ROM registry) require `REDIS_URL` before the backend starts. Game `.sav` bytes and their revision metadata remain in local `data/saves/`.

The production Redis Docker port is intentionally loopback-only on the VPS. Forward it over SSH rather than exposing it publicly, then point the backend at that local port:

```powershell
ssh -N -L 127.0.0.1:6380:127.0.0.1:6379 <vps-user>@<vps-host>
$env:REDIS_URL = 'redis://127.0.0.1:6380'
$env:REDIS_NAMESPACE = 'emulator-hub:v1'
npm start
```

The first start imports absent application records from the previous local JSON data and records a Redis migration marker. To run only that idempotent import, use `npm run migrate:redis`. It never uploads or removes a local `.sav` file.

## Local setup

Place supported ROM files in `roms/`; `GET /api/games` automatically scans them and registers only files whose SHA-1/MD5/size exactly match a `no-intro` record returned by the public hash lookup. The scan sends fingerprints and size, never ROM bytes. Unknown, modified, hacked, symlinked, and unsupported files are not listed or launchable. The local Git-ignored registration cache is `data/rom-registry.json`.

IPS patches are discovered globally by the verified ROM SHA-256. The
`patches/manifest.json` file maps ROM hashes to patch filenames and trusted
patch hashes; IPS format, path safety, and content hash are checked before a
patch is attached. A patch is independent of catalog IDs, titles, and ROM
filenames. To add a patch, add its `.ips` file and a manifest entry; no game
logic change is required. Missing, ambiguous, unsafe, malformed, unreadable, or
tampered patch data is skipped with a warning, and the ROM launches unpatched.
The production image copies the entire `assets/ips/` directory into
`patches/`, including its manifest.

`catalog.json` is now a compatibility overlay for legacy IDs and optional game-specific metadata such as Pokémon save adapters; new recognized ROMs do not need a manual entry. A hash match establishes identity with a public preservation dump, not legal ownership or physical-cartridge provenance.

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
- `GET /api/games/:id/launch?profileId=:profileId` requires an existing profile and returns the verified launch descriptor `{ id, title, core, profileId, gameId, romUrl, saveUrl }`. A ROM with a valid manifest-matched IPS also returns `patchUrl` and `patchSha256`; `gameId` is stable per profile/title pair so EmulatorJS separates its browser-managed saves.
- `GET`/`PUT /api/profiles/:profileId/games/:gameId/save` restores and accepts the selected profile's binary in-game save. Uploads require a revision precondition and return the accepted revision and SHA-256.
- `GET`/`PUT /api/profiles/:profileId/games/:gameId/snapshot` stores one lease-protected global EmulatorJS state per profile/game. The binary envelope contains raw state plus the capture-time `.sav`; a newer snapshot replaces the only slot.
- `GET /roms/:id` returns the verified ROM bytes with `Cache-Control: no-store`.
- `HEAD /roms/:id` returns the same verified ROM metadata without a body; EmulatorJS uses this when checking a previously loaded game.
- `GET /roms/:id/patch` returns the verified IPS bytes for a ROM with a valid registry entry; ROMs without an associated patch return `404`.

Start the service with `npm start` from this directory. Its local address is configured in `.env`; the provided default is `http://127.0.0.1:3001`. Copy `.env.example` when setting up another checkout.

Run the backend checks with `npm test`.
