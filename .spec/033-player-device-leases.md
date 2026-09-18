# Spec 033 — Player device leases

## Goal

Prevent two browser devices from running the same profile and game save at the
same time, while allowing the same browser installation to recover immediately
after a reload or an iOS browser-process restart.

The backend is the authority for lease ownership. The browser reports liveness;
it does not decide that another device's lease may be released.

## Identity model

Every profile selection that starts an emulator iframe creates a distinct
frontend `sessionId` with `crypto.randomUUID()`. It is in-memory state only and
belongs to that player instance, rather than to the complete Hub page. This
preserves the existing multi-instance player: one surface may hold independent
leases for multiple profile/game pairs.

The frontend never persists or reuses an instance `sessionId` after that
instance closes, acquisition fails, or its iframe fails to start. Closing the
whole player surface releases every instance lease and discards every instance
session ID.

The backend creates an opaque, random `deviceId` the first time a browser
installation reaches the Hub. It sets that value in a cookie with these
attributes:

- `HttpOnly`, so application JavaScript cannot read or replace it.
- `SameSite=Lax` and `Path=/`.
- `Secure` on HTTPS deployments.
- A persistent expiration suitable for a browser installation, not a player
  session.

The cookie identifies a browser installation, not a physical device and not a
user account. Clearing site data creates a new device identity. The frontend
does not read, generate, store, or attach the `deviceId`; normal same-origin
requests carry it automatically.

A player lease is keyed by the exact `(profileId, gameId)` save identity and
contains:

```json
{
  "profileId": "...",
  "gameId": "...",
  "deviceId": "backend-issued opaque value",
  "sessionId": "frontend UUID",
  "generation": 1,
  "expiresAt": "2026-09-18T00:00:00.000Z"
}
```

Different games may run concurrently, including under the same profile. A
second device may not run the same profile and game combination while its lease
is live.

## Lease acquisition and immediate recovery

Player opening is a backend mutation, not a side effect of the existing
read-only launch lookup. The existing `GET /api/games/:gameId/launch` remains a
non-mutating compatibility lookup. A new acquisition route receives
`profileId` and the frontend-created `sessionId`; the server reads `deviceId`
from the cookie, validates the profile and ROM, atomically acquires the lease,
and returns the launch descriptor plus its lease generation.

The acquisition route is idempotent for the same `(deviceId, sessionId,
profileId, gameId)`. The parent Hub currently verifies launch before mounting
an iframe and the iframe independently bootstraps its launch descriptor. The
iframe therefore retrieves its descriptor from a read-only session-launch
route; it must not make a second acquisition request that could replace the
lease it just received.

For an existing live lease of the same `(profileId, gameId)`:

- If the request has a different `deviceId`, the backend returns `409` and
  does not disclose or release the existing owner.
- If the request has the same `deviceId`, the backend atomically replaces the
  old `sessionId` with the new one and advances the generation. This is the
  immediate recovery path for a normal page reload or a browser process that
  iOS killed and then restored.

The replacement rule intentionally also fences an older tab from the same
browser installation. It is preferable to permit one current writer than to
allow two tabs with the same save to continue concurrently.

The player iframe receives only the frontend `sessionId` and lease generation
as launch parameters. It never receives or reads the `deviceId` cookie.

An acquisition creates an opening lease immediately. The iframe starts its
heartbeat before cloud-save loading and EmulatorJS/ROM startup, so a slow ROM
load cannot expire an otherwise valid opening lease. If the iframe never boots,
no heartbeat arrives and the normal expiry path frees the lease.

## Heartbeat and expiry

Each iframe sends a heartbeat every five seconds for its own lease, beginning
at bootstrap and continuing while it is alive. The backend renews a lease only
when both of these match the current record:

1. the cookie's backend-issued `deviceId`; and
2. the request's `sessionId`.

The lease expires after 45 seconds without a successful heartbeat. Heartbeats
are liveness evidence only: backgrounding, `visibilitychange`, `pagehide`,
and browser unload events are not proof that a player stopped. A heartbeat is
idempotent and may arrive after a replacement; it must never revive an expired
or superseded session.

If a heartbeat returns `409` or `410`, the player has lost ownership. It must
stop periodic save synchronization, stop further heartbeats, and close with a
clear expired-session error. It must not silently continue running or attempt
to reacquire the lease.

## Save-write fence

Every save upload requires the active lease session and generation in addition
to the existing revision precondition. The backend verifies the cookie,
`sessionId`, and generation against the active lease before accepting the
write.

Lease replacement and expiry recovery advance a monotonically increasing
generation for that save identity. The existing `saveStore` fence generation is
the durable write fence: lease transition and save acceptance must be serialized
per `(profileId, gameId)` so a write validated under an old generation cannot
commit after a replacement. A stale player receives a lease/fence conflict and
cannot overwrite the new owner, including after iOS resurrects an old page.

The existing save revision (`If-Match`) remains required. The lease fence
prevents stale ownership; the revision precondition prevents conflicting bytes
within the current ownership generation.

The acquire/replace, heartbeat, release, and save-write checks are atomic
transitions on that identity. In particular, a save request that began before a
same-device replacement may finish before the replacement fence is committed,
but it can never commit after the new generation is authoritative. The new
iframe always restores the last save accepted by that serialized sequence.

## Close and local session rotation

The close control keeps the current ordering:

1. request the final in-frame cloud-save synchronization within its bounded
   timeout;
2. release each active lease only when the request has the matching cookie,
   `sessionId`, and generation; and
3. remove the player UI.

The frontend rotates its in-memory `sessionId` in `finally`, whether the close
completed, the final synchronization failed, or opening/closing the modal
failed. A release is best effort; a stopped page may never send it, so expiry
remains mandatory.

`pagehide` may make a best-effort final synchronization and release attempt,
but correctness cannot depend on it. A browser can freeze or terminate a page
without running that handler.

## Storage and backend responsibilities

Lease records and their generation counters are Redis-backed and survive a
backend restart. Their state transitions use the existing atomic Redis
transition abstraction; request paths must not scan all leases. Expiry cleanup
may use an expiry index, but acquisition and heartbeat must independently treat
an elapsed lease as expired so cleanup timing cannot retain ownership.

The server issues the device cookie before handling a request that needs device
identity, including the first acquisition request. HTTP tests inject a stable
cookie value explicitly; they do not depend on a browser cookie jar.

All mutating lease and save requests require a same-origin `Origin` when the
browser supplies one. A cookie is an automatic credential; origin validation
prevents an unrelated origin from using it to acquire, replace, release, or
write a lease.

## Boundaries

- No MAC address, browser fingerprint, IP-address matching, user agent matching,
  or WebRTC network data is used for device identity.
- No account, login, device-management screen, pairing flow, or user-visible
  device list is added.
- No offline save queue or conflict-resolution UI is introduced here. Existing
  final-save failure behavior remains unchanged.
- This does not alter the multi-instance limit. One player surface may hold
  leases for multiple distinct profile/game pairs.

## Profile-picker presentation

An active lease never removes a profile from its game's profile picker. The
profile stays visible in its normal position so the user can see that it
exists, but the following controls are disabled while that profile/game lease
is active:

- selecting the profile to open the game;
- renaming the profile; and
- deleting the profile.

The disabled state applies regardless of whether the current lease belongs to
this browser device or another one. The picker refreshes its lease availability
when it opens and after a lease acquisition, release, or expiry response; it
does not infer availability from stale frontend state.

The backend also rejects rename and delete for an actively leased profile/game.
The frontend disabled state is presentation only and must not be the authority.

## Acceptance

1. Opening a profile/game on one browser device prevents another browser device
   from opening that same profile/game while the first lease is alive.
2. Reloading the same browser installation creates a new frontend `sessionId`
   for each recreated player instance and immediately replaces its prior lease
   without waiting for expiry.
3. The former session cannot heartbeat, release, or upload after same-device
   replacement.
4. A backgrounded or terminated page releases no authority merely because an
   unload event might have run; it becomes reclaimable after 45 seconds without
   heartbeat.
5. A new device can acquire an expired lease, and an old page resumed later
   cannot overwrite its save.
6. The normal close path flushes first, releases matching leases, removes the
   player, and rotates the frontend session identifier even when flushing fails.
7. Different games remain independently playable; a lease for one game does not
   block another game.
8. Clearing browser site data produces a distinct device identity and therefore
   follows the foreign-device lease rule until the old lease expires.
9. A leased profile remains visible in the picker, while its open, rename, and
   delete controls are disabled until its lease is no longer active.
10. The existing read-only launch lookup cannot create or replace a lease; a
    duplicate bootstrap request for one session remains idempotent.
11. A player loading a slow ROM keeps its opening lease only by sending its own
    heartbeat, and an iframe that never starts becomes reclaimable by expiry.
