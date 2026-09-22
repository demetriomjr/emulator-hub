# Spec 053: Profile-scoped EmulatorJS save namespace

## Problem

Production logs show that the backend returns the correct save on every launch, but reopening a profile can start EmulatorJS without that profile's data. Multiple profiles of the same game currently share `window.EJS_gameID = launch.gameId`, allowing EmulatorJS local state and battery-save paths to collide across profiles and sessions.

## Requirements

1. Every player instance must use a deterministic EmulatorJS identity scoped to both the verified game and the selected profile.
2. The namespace must be stable across close and reopen, and different for every profile of the same game.
3. The remote save endpoint and backend save identity remain unchanged: `profileId + gameId` continues to be authoritative.
4. Existing remote saves must load into the new namespace without requiring migration of backend data.
5. Snapshot compatibility must continue to use the canonical backend `gameId` and `profileId`; changing the EmulatorJS identity must not invalidate valid backend snapshots.
6. Initialisation must wait for remote save restoration before the player is released to the user.
7. Save diagnostics must record the profile-scoped EmulatorJS identity and hashes before and after restoration when diagnostics are enabled.
8. Closing one player must not write or clear another profile's local EmulatorJS data.
9. Tests must cover same-game different-profile isolation, stable identity across reopen, remote save restoration, and unchanged backend save URLs.

## Design

Use a namespaced runtime identity derived from the canonical game and profile identifiers, encoded so it is safe for EmulatorJS storage keys. Keep `launch.gameId` in all backend URLs and snapshot metadata. Set `window.EJS_gameID` to the derived runtime identity before loading EmulatorJS. Await the cloud save synchronizer before starting save polling and hiding the loading gate.

## Acceptance criteria

- Two profiles of Ruby can be opened sequentially and each displays its own save after reopening.
- Reopening the same profile reuses its own EmulatorJS namespace and never reads another profile's local save.
- Production logs show the same remote save revision and hash being applied to the matching profile-scoped runtime identity.
- Existing Pokémon Hub reads remain unchanged.
- Targeted tests, frontend build, backend build, and production health checks pass.
