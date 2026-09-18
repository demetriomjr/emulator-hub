---
title: Global emulator snapshots
date: 2026-09-18
tags: [spec, emulator, snapshots, cross-device, save-state]
status: proposed
---

# Spec 034 — Global emulator snapshots

## Goal

Give each game Save Profile one global, cross-device EmulatorJS save state. A
player can save the current emulator state on desktop, then open the same
profile/game on another device and resume that exact state without relying on
an in-game save point.

A snapshot is not a `.sav` file and does not replace normal cloud-save
synchronization. It is the raw emulator state returned by
`gameManager.getState()`, together with the exact `.sav` bytes that were live
when that state was captured. The latter is required to prevent a state from
being restored beside a newer, unrelated battery save.

There is exactly one snapshot slot per `(profileId, gameId)`. Saving a new
snapshot atomically replaces the previous slot after its complete state bundle
has been accepted. There are no names, timestamps to select, history, slots,
manual uploads/downloads, sharing, or snapshot browser.

The snapshot is valid only for the exact `.sav` revision from which it was
captured. Any accepted write to that profile/game's normal save — including a
Pokémon Hub materialization — deletes its snapshot slot before the save request
returns. A write for another profile or another game cannot affect the slot.

## Existing baseline

- The iframe currently keeps `savedState` only in JavaScript memory. Its Save
  state and Load state toolbar controls broadcast messages to every active
  iframe; closing or switching device loses those bytes.
- Game `.sav` bytes are already global through `save-store.mjs` and the
  profile/game save routes. A player lease fences writes by session and
  generation.
- The player starts EmulatorJS immediately after loading the launch descriptor
  and current `.sav`. EmulatorJS then fetches the ROM by URL. That ordering
  permits the engine to start before all cross-device state is known.
- EmulatorJS exposes a raw `Uint8Array` state through `gameManager.getState()`
  and accepts raw state through `gameManager.loadState(state)`. The configured
  `EJS_gameUrl` may be a `blob:` URL, so a verified ROM fetched during
  preflight can be handed to the later EmulatorJS loader without a second ROM
  network download.

## Identity, authority, and compatibility

The snapshot identity is exactly the existing save identity:

```text
(profileId, gameId)
```

The backend owns the authoritative slot. The browser may retain a best-effort
local IndexedDB copy of the last fully acknowledged bundle, but it is only a
recovery cache: it is never sent in a cookie, never used to replace a newer
server result, and never makes a snapshot available on another device.

Cookies remain restricted to the backend-issued HttpOnly device identity used
by player leases. Snapshot bytes must not be stored in cookies: they are binary
and potentially megabytes large, while cookies are small and sent with every
same-origin request.

Every accepted bundle records immutable compatibility metadata:

```json
{
  "revision": 7,
  "sha256": "hex SHA-256 of state bytes",
  "byteLength": 123456,
  "saveSha256": "hex SHA-256 of bundled .sav bytes, or null",
  "saveByteLength": 131072,
  "core": "gba",
  "romSha256": "verified catalog ROM hash",
  "runtimeId": "explicit EmulatorJS runtime compatibility identifier",
  "createdAt": "ISO-8601 timestamp",
  "fenceGeneration": 12
}
```

`runtimeId` is a deliberate, versioned compatibility identifier supplied by
the player launch contract. It must change whenever the configured EmulatorJS
loader/core combination can no longer safely consume previous states. A moving
`latest` CDN label is not a valid compatibility identifier. Snapshot support
therefore pins or explicitly versions the runtime used for state creation and
loading.

The server validates that profile and game exist, the player has the current
lease, the request is binary, all size/hash/metadata limits are valid, and the
metadata matches the verified launch descriptor. It does not attempt to prove
that client-provided state bytes represent genuine gameplay.

## Storage contract

`snapshot-store.mjs` is a new backend package alongside `save-store.mjs`. It
stores one Git-ignored, atomically replaced bundle under the backend data
directory, separate from normal saves:

```text
data/snapshots/<profileId>/<gameId>.state
data/snapshots/<profileId>/<gameId>.sav
data/snapshots/<profileId>/<gameId>.json
```

The JSON metadata and both binary files are committed as one recoverable slot:
write temporary generation-specific files, fsync/close them, then publish the
metadata last. Reads accept only a metadata record whose named state and save
objects both exist, match their recorded lengths and SHA-256 values, and match
the requested identity. Interrupted replacement leaves the previous metadata
and bundle readable; unreachable temporary files are safe cleanup candidates.

The store serializes writes per identity and uses the same bounded lock and
fence-generation discipline as `save-store.mjs`. It caps raw state at 32 MiB
and bundled `.sav` bytes at the existing 2 MiB save limit. A revision
precondition (`If-Match`) prevents a stale request from replacing the only
slot. A lease replacement advances the snapshot fence as well as the save
fence, so a fenced iframe cannot publish a late snapshot.

The package exposes `get`, `put`, and `advanceFence`. `get` returns complete
state bytes, bundled save bytes when present, and metadata. `put` accepts the
complete bundle plus expected revision and fence generation. It never accepts
a metadata-only snapshot or a state without its capture-time save companion.

## HTTP contract

The profile/game resource is distinct from Pokémon Hub session snapshots:

```text
GET /api/profiles/:profileId/games/:gameId/snapshot
PUT /api/profiles/:profileId/games/:gameId/snapshot
```

`GET` requires the current player lease headers and returns `404` when no
snapshot exists. A successful response is the deterministic binary snapshot
envelope with `Content-Type: application/vnd.emulator-hub.snapshot`,
`Cache-Control: no-store`, `ETag: "<snapshot revision>"`,
`X-Content-Type-Options: nosniff`, and the server-computed state hash. The
client validates the envelope, metadata, part lengths, and hashes before it
considers preflight complete.

The envelope is a four-byte unsigned big-endian UTF-8 JSON-header length,
followed by that JSON header, raw state bytes, and raw capture-time `.sav`
bytes. The header declares both binary lengths, identity, compatibility
metadata, hashes, and revision. This is deliberately not MIME: neither the
browser nor the Node HTTP server needs a multipart parser to exchange the
single opaque snapshot bundle.

`PUT` requires `Content-Type: application/vnd.emulator-hub.snapshot`,
`If-Match`, and the current lease headers. It receives the same complete
envelope. `If-Match: *` creates the first snapshot; a quoted revision replaces
the latest one. Success returns the new revision and server-computed hashes.
It returns `412` for a stale revision, `410` for a stale/expired lease, `409`
for a fence conflict, `413` for an oversized body, and `400` for malformed or
incompatible metadata.

The launch descriptor adds `snapshotUrl`, `romSha256`, and `runtimeId`. It
does not embed binary bytes. The existing `.sav` resource and its contract
remain unchanged.

## Save snapshot lifecycle

The existing global Save state button remains the entry point. It broadcasts
to all active iframes; each iframe writes only its own profile/game slot.

For one iframe, saving is serialized behind any currently running snapshot
operation and follows this sequence:

1. Verify that the iframe still owns its player lease.
2. Ask the core to flush save files, read the current `.sav`, and synchronize
   that byte sequence through the existing cloud-save path.
3. Obtain the raw emulator state with `gameManager.getState()` and copy it to
   a standalone `Uint8Array`.
4. Build metadata from the lease generation and launch descriptor, then PUT
   the complete `{ state, capture-time .sav, metadata }` bundle with the last
   known snapshot revision.
5. Replace the local IndexedDB recovery cache only after the PUT succeeds, and
   report success only after that acknowledgement.

Failure never clears the previously accepted server snapshot. A local pending
copy may retry while the same lease remains current, but a later device never
depends on an unacknowledged snapshot. A lease loss cancels pending retries and
prevents new capture or upload.

## Atomic preflight and startup lifecycle

The player maintains its heartbeat from the moment it starts, including during
slow downloads. It must not initialize EmulatorJS until preflight reaches a
terminal successful state.

1. Obtain the fenced launch descriptor and control profile.
2. Fetch the verified ROM bytes, current normal `.sav`, and snapshot bundle in
   parallel using `cache: 'no-store'`. `404` for normal `.sav` means new-game
   bytes; `404` for snapshot means no snapshot. Any other failure blocks the
   player before EmulatorJS is loaded.
3. Validate the downloaded ROM hash against `romSha256`. When a snapshot is
   present, validate its identity, core, ROM hash, runtime ID, hashes, and
   lengths before continuing. An incompatible or corrupt snapshot is not
   applied; it remains stored for diagnosis and the user sees a clear reason.
4. Create an in-memory `blob:` URL for the verified ROM and retain it until
   the iframe closes. Only now configure and append the EmulatorJS loader.
   The loader receives the blob URL, so ROM transfer does not occur again.
5. On `EJS_onGameStart`, write the capture-time snapshot `.sav` bytes when a
   compatible snapshot exists; otherwise write the current normal `.sav`
   bytes when present. Reload save files, then call `loadState()` with the raw
   snapshot bytes. Only after both calls settle may controls/gamepad input and
   periodic normal-save synchronization start.

When a compatible snapshot exists, its companion `.sav` deliberately wins over
a normal `.sav` that may have advanced after the snapshot was created. This
makes automatic snapshot restoration an internally consistent rollback to the
captured instant. The later normal save synchronization publishes the state
that the resumed core actually holds.

The existing global Load state button re-applies the already validated,
preloaded snapshot bundle for every active iframe. It never opens a file picker
or downloads a state at click time. If no compatible snapshot was preloaded,
the control reports that no snapshot is available and changes nothing.

## Failure behavior and boundaries

- No snapshot is a valid normal condition; the player starts with the current
  `.sav` or a new game.
- ROM, control-profile, normal-save (other than 404), snapshot transport, or
  snapshot integrity failure blocks engine initialization. The player releases
  its lease through the normal failed-open path.
- A snapshot created by another ROM, core, or runtime compatibility ID is
  never loaded. It must not silently fall back to applying raw bytes.
- A snapshot is not a replacement for automated `.sav` sync, does not add
  offline play, and does not make the ROM or runtime offline-capable.
- No cookie, localStorage, file picker, browser download, public upload,
  history, multi-slot UI, or Pokémon Hub snapshot route is reused.
- The browser cache is not an authority. Its IndexedDB copy must be namespaced
  by profile/game/revision/compatibility metadata and may be discarded safely.

## Testing and acceptance

1. Package tests prove atomic first write/replacement, integrity rejection,
   stale revision rejection, fence rejection, interrupted-write recovery, and
   one-slot replacement for `snapshot-store`.
2. Backend tests prove profile/game ownership, active-lease enforcement,
   binary-envelope validation, 404 absence, hashes/ETag, stale revision responses,
   compatibility rejection, and lease replacement fencing for snapshot writes.
3. Client contract tests prove GET/PUT bundle encoding and lease headers.
4. Player tests prove the loader is appended only after ROM/save/snapshot
   preflight completes; its ROM URL is an in-memory blob URL; a valid snapshot
   restores its bundled save before raw state; and no snapshot starts normally.
5. Player tests prove Save state synchronizes the capture-time `.sav` before
   publishing the snapshot, preserves the previous server slot on failure, and
   uses no cookie/localStorage snapshot bytes.
6. Player tests prove a corrupt/incompatible snapshot blocks automatic state
   application and displays its reason; a manual Load state without a prepared
   compatible snapshot is a no-op with clear feedback.
7. A cross-device integration sequence proves: save one snapshot on device A,
   stop A, acquire the lease on device B, preflight all resources, and resume
   the exact state using the replacement slot only.

No project build is part of this feature's verification. Focused Node package,
backend, and frontend source-contract tests are required before manual browser
or device validation.
