# Spec 043 — Generic IPS patch discovery

## Goal

When a verified ROM is launched, discover and apply its compatible IPS patch
when one is registered and valid. The mechanism must work for any game ID,
title, and supported system; game-specific patch associations must not live in
application code.

## Compatibility registry

IPS files do not identify their target ROM. Each patch therefore needs an
explicit, data-only association using the trusted ROM and patch SHA-256 values.
`assets/ips/manifest.json` is the registry and is copied with the IPS assets to
`apps/backend/patches/` in production. Its version 1 shape is:

```json
{
  "version": 1,
  "patches": [
    {
      "romSha256": "<64 lowercase hex characters>",
      "file": "<safe .ips filename>",
      "patchSha256": "<64 lowercase hex characters>"
    }
  ]
}
```

Adding a patch requires adding its IPS asset and registry entry only. A registry
entry applies to the exact ROM bytes, independent of ROM filename, title,
catalog ID, or game system. A ROM can have at most one registered IPS patch;
duplicate entries are ambiguous and are skipped.

## Runtime behavior

- The backend looks up the verified ROM SHA-256 in the registry when producing
  a launch descriptor and when serving the patch route.
- The patch must be a regular non-symlink `.ips` file within the patch asset
  directory, match its registered SHA-256, and satisfy IPS record/EOF format
  validation before it is attached.
- No match means the launch descriptor omits `patchUrl` and `patchSha256`.
- Missing, unsafe, malformed, ambiguous, unreadable, or hash-mismatched patch
  data is logged and skipped; the ROM remains launchable without a patch.
- The player fetches and independently hashes a declared patch before passing
  it to EmulatorJS. Fetch or hash failure skips the optional patch and must not
  block ROM startup.
- An incompatible stored snapshot is not restored and must not block startup.
- ROM bytes remain unchanged. Battery saves remain keyed to game/profile;
  snapshots and local recovery include an optional applied patch hash.

## Acceptance

- Integration tests demonstrate patch discovery by ROM hash for arbitrary game
  identities and successful descriptor/patch serving.
- Tests cover no matching entry, duplicate entries, missing and unsafe files,
  invalid IPS bytes, and patch hash mismatch. These cases never make the ROM
  unavailable or prevent a lease/launch.
- Player tests cover successful patch loading and graceful fallback after fetch
  or hash failure, including incompatible snapshots.
- No project build runs for this work.
