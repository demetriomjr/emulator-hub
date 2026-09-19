---
title: Global game-save access leases
date: 2026-09-19
tags: [spec, saves, leases, player, pokemon-hub, concurrency]
status: proposed
amends:
  - 023-pokemon-hub-snapshot-integrity.md
  - 029-pokemon-hub-canonical-session-snapshot.md
  - 030-pokemon-hub-session-close.md
  - 033-player-device-leases.md
---

# Spec 040 — Global game-save access leases

## Goal

Make a game save have exactly one live writer/reader authority across the
product. A `(profileId, gameId)` may be owned by either a running emulator
player or a Pokémon Hub game-save source, but never by both at the same time.

This closes the gap between the existing player-device lease and the separate
Pokémon Hub source lease. They are currently independent reservations for the
same native `.sav`; they must become two owner modes of one global save-access
lease.

Within the production ownership model, this is the integrity guarantee for a
native save: a valid save is read only after its current owner has completed
its write and released ownership. Users do not have filesystem access to edit
production saves. A save with no valid native sector copy, or one corrupted by
an emulator/storage failure or interrupted persistence, is rejected as lost;
the product provides no salvage or fallback-to-stale-bytes path.

## Scope

- Define one backend-authoritative, atomic lease for every native game-save
  identity `(profileId, gameId)`.
- Make player launch and Pokémon Hub save-source attachment mutually exclusive.
- Ensure a Hub may not inspect, adopt, cache, drag from, or materialize a save
  while that save has a live player owner.
- Ensure an emulator may not launch or upload a save while that save has a live
  Pokémon Hub owner, including Hub flush/recovery finalization.
- Preserve the existing ability to use different game IDs under one profile
  concurrently.

## Non-goals

- Leasing a Hub profile. Hub profiles are backend-owned grids, not native game
  saves and cannot be opened by EmulatorJS.
- Allowing a player to view or take over a save opened in a Hub workspace.
- Adding a force-unlock control, cross-device ownership UI, account identity,
  conflict resolution, or concurrent read-only save access.
- Changing canonical snapshot ownership, Pokémon transfer rules, save format,
  or the player multi-instance limit.

## Identity and terminology

- **Game-save identity** is exactly `(profileId, gameId)`. It is not merely a
  profile ID: the same profile may legitimately run or be edited in distinct
  games at the same time.
- **Global save-access lease** is the single exclusive reservation for that
  identity. The backend is its authority.
- **Player owner** is one emulator instance, identified by the existing opaque
  device ID, frontend player session ID, and monotonically increasing
  generation.
- **Hub owner** is one attached Pokémon Hub workspace source, identified by the
  existing workspace/source session IDs and opaque source lease token.
- **Recovery owner** is a short server-controlled continuation of a Hub owner
  that is finalizing an accepted canonical snapshot into the native save after
  client liveness has ended. It is not a third user-visible mode and cannot be
  acquired by a client.

The global lease record is conceptually:

```json
{
  "profileId": "...",
  "gameId": "...",
  "ownerKind": "player | pokemon-hub | hub-recovery",
  "ownerId": "opaque owner-specific identifier",
  "fence": 1,
  "expiresAt": "backend timestamp"
}
```

The concrete owner-specific data remains private to the backend. The frontend
never receives another client or workspace's identifier or token.

## Acquisition rules

All acquisition, renewal, release, expiry evaluation, and save-write fencing
for one game-save identity occur through one atomic backend transition. No
route may first inspect one lease namespace and then create another lease in a
separate operation.

### Player launch

Before returning a mutable player launch descriptor, the player acquisition
route attempts to acquire the global lease as `ownerKind: "player"`.

- An absent or expired lease is acquired normally.
- The same player device may replace its own player session as defined by Spec
  033; this advances the fence generation.
- A live `pokemon-hub` or `hub-recovery` owner rejects the launch with `409
  SAVE_IN_USE_BY_POKEMON_HUB`.
- A rejected launch never mounts an emulator iframe and cannot later upload a
  save under a prior player generation.

### Pokémon Hub save-source attachment

Before reading a native save, creating its layout projection, adopting it into
a canonical snapshot, or acquiring its Hub source session, the Hub attempts to
acquire the global lease as `ownerKind: "pokemon-hub"`.

- An absent or expired lease is acquired for the Hub source.
- The same live Hub source may renew its own ownership; another Hub workspace
  is still rejected by the existing source-session exclusivity rules.
- A live player owner rejects the action with `409 SAVE_IN_USE_BY_PLAYER`.
- A rejected Hub request returns no native layout, no Pokémon projection, and
  no newly adopted snapshot source.

The Hub's source-session lease remains responsible for canonical snapshot
authorization. The global lease is the additional native-save access fence;
it does not replace Hub-profile source leases or their complete-workspace
snapshot requirement.

## Lifetime, flush, and recovery

Player ownership keeps the existing five-second heartbeat and 45-second
expiry policy from Spec 033. Its heartbeat renews, and its native-save uploads
validate, the global player owner/fence rather than a separate player-only
lease record.

Hub ownership follows the Hub source/session liveness policy. On a normal pane
close, its ordering is:

1. validate and commit the canonical close candidate;
2. materialize the accepted native `.sav` when required;
3. release the global game-save lease and the Hub source lease; and
4. remove the source from the workspace.

The global lease must not be released before native materialization succeeds.
If a Hub source expires or a close fails after an accepted canonical state
requires a flush, ownership becomes server-only `hub-recovery` until the
existing recovery protocol persists the authoritative save. A failed recovery
remains non-acquirable and is retried by that recovery protocol; it must never
fall back to the prior native bytes merely to make the profile launchable. A
player launch remains blocked during that interval. This prevents a player from
restoring stale bytes while the Hub's accepted state is still pending.

An elapsed player or Hub client heartbeat never authorizes another mode until
the atomic transition determines that there is neither a live owner nor a
required Hub recovery continuation.

Consequently, there is no meaningful human-time race between closing an
emulator and opening the Hub: either the player still owns the save and the
Hub is blocked, or the player has completed its final flush and released it.
The Hub never combines data from an in-progress player write with data from a
prior save copy.

## Backend enforcement points

The global lease check is an authority boundary, not just catalogue metadata.
It applies at least to:

1. player acquire/replace, heartbeat, release, launch descriptor, and native
   save upload;
2. Pokémon Hub game-save layout reads;
3. Pokémon Hub save-source adoption and snapshot acquisition;
4. Pokémon Hub source renewal, close, materialization, expiry recovery, and
   release; and
5. profile rename/delete guards already based on a live game-save lease.

The read-only legacy player-launch lookup remains non-mutating, but it must not
be sufficient to boot an iframe or authorize a save upload. A direct HTTP call
to any Hub or player route receives the same authoritative conflict as the UI.

During rollout, the backend must atomically honor any live legacy player lease
or live legacy Hub source lease before allowing a new global acquisition. It
may retire legacy keys only after their holders have expired or completed their
normal release path; deployment must not create a window where an already open
player and a newly attached Hub source overlap.

## Presentation and catalogue projection

The game catalogue projects one safe availability field derived from the global
lease, for example:

```ts
type SaveAccessAvailability = {
  leaseActive: boolean;
  leaseOwner: 'player' | 'pokemon-hub' | 'recovery' | null;
};
```

Owner-specific identifiers and tokens are never projected.

The ordinary player profile picker retains Spec 033 behavior: a leased profile
remains visible but its launch, rename, and delete controls are disabled. The
Pokémon Hub save selectors apply the same availability rule: a leased save is
not selectable as a new pane source. If a previously selected source becomes
leased before attachment completes, the UI clears that draft selection and
shows the conflict message returned by the backend.

Catalogue filtering is advisory and may be stale. The Hub refreshes its game
catalogue when opened and after a lease-conflict response; the player picker
retains its existing refresh behavior. Neither UI is permitted to infer that a
save is available solely because it was available in an earlier response.

## Error contract

| Code | HTTP | Meaning |
| --- | --- | --- |
| `SAVE_IN_USE_BY_PLAYER` | 409 | A live emulator player owns this game save. |
| `SAVE_IN_USE_BY_POKEMON_HUB` | 409 | A live Hub source or Hub recovery owns this game save. |
| `SAVE_ACCESS_LEASE_INVALID` | 409/410 | The caller's owner token, session, or fence is no longer current. |

The player and Hub surfaces render only a local explanation that the save is
currently in use. They do not reveal the device, tab, workspace, or owner
identity.

## Acceptance criteria

1. A player-held `(profileId, gameId)` cannot be selected, laid out, adopted,
   or attached by Pokémon Hub; direct backend requests receive
   `SAVE_IN_USE_BY_PLAYER`.
2. A Hub-held game-save source cannot be launched by the player; direct player
   acquisition receives `SAVE_IN_USE_BY_POKEMON_HUB`.
3. The inverse conflict is enforced even when both requests race on separate
   backend instances; exactly one atomic acquisition wins.
4. The same browser-device player recovery may replace only a player owner. It
   cannot replace a Hub owner.
5. Different game IDs under one profile remain independently usable by player
   and Hub at the same time.
6. A Hub pane close writes its accepted native save before releasing global
   ownership; a player can acquire only after that release succeeds.
7. Hub expiry recovery holds the global lease until the canonical native save is
   finalized, so a player cannot restore stale save bytes during recovery.
8. A stale player upload and a stale Hub materialization both fail their fence
   checks and cannot overwrite the current owner.
9. The player picker and Hub selector both project leased saves as unavailable,
   while backend conflict enforcement remains valid if either UI is stale.
10. Rollout tests prove that a live legacy lease prevents a conflicting global
    acquisition until it expires or completes normal release.
