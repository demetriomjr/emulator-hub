# Spec 015 — Automatic trusted ROM discovery

## Goal

Replace manual-only cataloging with a backend scan of `apps/backend/roms/`.
Supported files become games only after an exact public No-Intro dump match.
The backend persists the accepted registration, supplies title and cover to the
existing hub, and preserves profile, launch, save, and Pokémon Hub contracts.

Out of scope: downloading ROMs, uploading ROM bytes, accepting ROM hacks,
adding a catalog-management UI, cloud synchronization, and project builds.

## Current evidence

The first slice intentionally used `apps/backend/catalog.json` as a manual
allow-list. Emerald was registered with its filename and SHA-256, as described
in [Spec 003](003-first-playable-hub.md). Files subsequently added to
`apps/backend/roms/` were invisible because they have no manual entries.

On 2026-09-17, a fingerprint-only test against RetroBase Collection's public
batch lookup matched all five current 16 MiB GBA files as `no-intro`: Emerald,
FireRed, LeafGreen, Ruby, and Sapphire. Only SHA-1, MD5, and byte length left
the machine; ROM bytes did not. This validates the MVP source, not ownership or
physical-cartridge provenance.

## Trust boundary

No-Intro publishes DAT preservation metadata, not ROM downloads. Its database
distinguishes verified, not-verified, and bad dumps. RetroBase's public v1 API
is the online lookup adapter because it accepts batched CRC32/MD5/SHA-1/size
fingerprints and returns normalized game metadata, dump provenance, and media.

In this feature, `original` has the precise meaning: exact local bytes match a
public record whose `dump_source` is `"no-intro"`, whose platform agrees with
the extension-derived system, and whose returned SHA-1/MD5/size agree with the
local values. An ordinary hack, translation, patch, corrupt file, or unknown
dump will not satisfy that rule and is rejected. This cannot prove the source
of the user's copy, legal ownership, or permanent remote-service availability.

The backend sends only fingerprints and size, performs lookup server-side with
no API key, and validates all response fields as untrusted input.

Sources consulted 2026-09-17:

- [No-Intro](https://no-intro.org/) describes DAT catalogs and its refusal to facilitate ROM downloads.
- [No-Intro database guide](https://wiki.no-intro.org/index.php?title=DAT-o-MATIC_Guide) defines dump statuses.
- [RetroBase public API](https://retrobase-collection.com/developers) documents fingerprint lookup, batches, media, limits, and provenance.
- [RetroBase OpenAPI](https://retrobase-collection.com/api/public/v1/openapi.json) defines `/lookup/batch`.

## Storage and compatibility

`apps/backend/catalog.json` remains a reviewable compatibility overlay, not the
complete inventory. It can preserve a legacy game ID and optional integration
metadata such as `pokemonSave` for an exact known SHA-256. Emerald consequently
keeps its existing identity rather than stranding profiles/saves on first scan.

The reusable registry in `apps/packages/` owns Git-ignored
`apps/backend/data/rom-registry.json`. It stores schema version, safe filename,
size, SHA-1, MD5, SHA-256, stable game ID, system/core, trusted source, matched
game/dump metadata, title, region, and selected cover. It never stores ROM
bytes, save bytes, profiles, or API keys, and is atomically replaced.

New identities are `rom-` plus lowercase SHA-1. Renames preserve identity; two
accepted files with equal content appear once, served from the lexicographically
first safe filename. A matching legacy overlay has priority for ID and optional
product metadata.

## Discovery and registration flow

1. `GET /api/games` scans before responding, so adding a file and reloading the
   existing hub discovers it without a server restart or a new UI control.
2. Scan immediate regular files only; ignore directories, symlinks, and unknown
   extensions. Allowed pairs: `.gb`/`gb`/`gambatte`, `.gbc`/`gbc`/`gambatte`, and
   `.gba`/`gba`/`gba`.
3. Stream each candidate locally to calculate SHA-1, MD5, SHA-256, and length;
   do not trust filename or ROM header for identity.
4. Reuse a persisted entry only after those current fingerprints still match.
   Batch changed/new candidates in groups of at most 100 to `/lookup/batch`.
5. Accept only an aligned response with `no-intro` provenance, matching system,
   exact returned SHA-1/MD5/size, and a valid game object. Missing/null/malformed
   result, mismatch, timeout, rate limit, and non-No-Intro source reject.
6. Choose title as `names.us`, then `names.eu`, then `name`. Select only HTTPS
   `box-2D` art, preferring dump region, `us`, `eu`, `wor`, then any. Store the
   provider dump region; do not guess ROM language.
7. Persist accepted entries. Rejected files are not listed, profile-eligible,
   launchable, or streamable. Existing accepted content can remain available
   during a transient lookup outage only when current hashes exactly match the
   persisted record; a changed file immediately loses that status.

## HTTP/UI contract

`GET /api/games` retains `{ "games": [...] }` and each ready item retains
`id`, `title`, `system`, `core`, `status`, optional `region`, and optional
`coverUrl`. The existing React client already renders those fields and opens the
profile selector using the game ID; it makes no third-party API request and
needs no new control.

`GET /api/games/{id}/launch`, `GET`/`HEAD /roms/{id}`, game-profile routes,
saves, and Pokémon Hub catalog reads resolve against auto registry plus legacy
overlay. They retain the existing profile ownership checks, regular/non-symlink
path checks, and SHA-256 validation immediately before serving bytes.

## Package boundaries and safety

`apps/packages/rom-discovery.mjs` owns safe enumeration, hashes, batch request
validation, metadata selection, deduplication, and normalized accepted entries.
`apps/packages/rom-registry.mjs` owns schema validation, deep-cloned reads, and
atomic persistence. Both use injected I/O/fetch seams for deterministic tests.
`apps/backend/server.mjs` wires the default public client and combined catalog;
the frontend stays API-only.

No recursion, archive support, symlink following, permissive fallback, backend
image proxying, or catalog.json mutation is allowed. Use an abort timeout; never
retry indefinitely. Do not expose raw hashes or remote payloads to the browser.

## Acceptance criteria

1. With an empty registry, the current five GBA files are registered by one
   catalog request; FireRed, LeafGreen, Ruby, and Sapphire need no JSON edit.
2. Accepted cards contain API-derived US/English-preferred names and HTTPS
   `box-2D` art when supplied.
3. Unsupported, directory, symlink, unmatched, malformed, mismatched, or
   community/non-No-Intro candidates never list, profile, launch, or stream.
4. Legacy Emerald keeps its game ID and `pokemonSave` metadata after matching.
5. Accepted registration persists restart/outage only while all current content
   fingerprints/size match. Rename preserves ID; duplicate bytes create one game.
6. Existing profile/launch/GET/HEAD/save/Pokémon Hub regressions remain green;
   discovery tests make no live external request. No project build runs.

## Verification boundary

Automated tests cover registration, rejection, persistence, identity, and HTTP
integration. The live fingerprint probe above confirms the current five hashes.
Full user-visible confirmation still requires adding a previously unseen
authorized ROM, reloading the rendered hub, seeing its card/cover, creating a
profile, and launching it through EmulatorJS.
