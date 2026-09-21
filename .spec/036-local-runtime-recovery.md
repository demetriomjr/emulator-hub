---
title: Local runtime recovery snapshots
date: 2026-09-19
tags: [spec, emulator, recovery, indexeddb, saves]
status: amended
---

# Spec 036 — Local runtime recovery snapshots

> Amended by [Spec 044](044-save-and-snapshot-revisions.md): local recovery
> records preserve emulator state only and never carry or restore `.sav` bytes.
> Canonical battery saves follow the event-driven save revision contract.

## Goal

Protect the currently running EmulatorJS session when the runtime loses its
backend path or the browser is terminated unexpectedly. This is a local,
per-browser recovery mechanism; it is separate from Spec 034's explicit,
backend-authoritative cross-device snapshots.

Every active player records local recovery state every 2,500 ms. The record
contains raw emulator state and immutable launch compatibility metadata. It is never restored
automatically. After a confirmed runtime break, or an unclean previous session,
the next selection of the same game profile offers one recovery choice before
acquiring a player lease.

## Identity and local storage

The only key is `(profileId, gameId)`. Bundles live in a dedicated IndexedDB
store; no bytes or metadata use cookies, localStorage, the HTTP cache, a file
picker, downloads, or the normal server snapshot resource.

The local record has an atomically replaced complete bundle and these lifecycle
fields:

```json
{
  "profileId": "profile-id",
  "gameId": "game-id",
  "core": "gba",
  "romSha256": "verified ROM hash",
  "runtimeId": "emulatorjs-4.2.3",
  "state": "raw bytes",
  "reason": "active | runtime-break | possible-recovery"
}
```

The storage adapter must copy input bytes before persistence and return copied
bytes on read, so a later EmulatorJS buffer mutation cannot alter an accepted
recovery bundle. Replacing a bundle is one IndexedDB record write. Invalid,
empty, oversized, or compatibility-incomplete bundles are rejected and never
replace the prior record.

## Capture lifecycle

After `EJS_onGameStart`, the player starts a 2,500 ms capture timer. Each run
serializes behind an in-flight capture and reads `getState()` only. It stores a
copied state record when state bytes exist. Capture failures leave
the last valid bundle in place and do not close the player.

Canonical `.sav` uploads are driven by EmulatorJS `saveSaveFiles` events and
are independent from this local state capture.

An explicit normal close drains canonical save and server snapshot writes,
then tells every iframe to delete its local recovery state before its lease is
released and the iframe is removed. Reload/pagehide also sends a best-effort
delete. Browser lifecycle callbacks are not reliable: if deletion cannot finish
before termination, a surviving `active` record is reclassified as
`possible-recovery` on the next profile selection.

## Break detection and recovery offer

A heartbeat/lease request failure caused by backend or Redis unavailability is
not a reason to destroy the iframe. The player marks its newest local bundle
`runtime-break`, stops server synchronization and heartbeat requests, and tells
the parent that the session is unavailable. The parent removes the player UI
without attempting a release request that cannot reach the backend.

When the player runtime itself reports a fatal loader/core failure after startup,
the same `runtime-break` marking and UI removal occur. A browser/process kill
cannot run that code; its surviving `active` bundle is only a
`possible-recovery`, never claimed as confirmed.

At selection of the same profile and game, the hub reads the local record before
lease acquisition. If its identity and compatibility metadata match the current
game, it displays a minimal modal:

- confirmed record: “O emulador foi interrompido. Restaurar a recuperação local?”
- unclean record: “Há uma possível recuperação local. Restaurar?”

The actions are **Restore** and **Discard**. Restore passes the bundle only to
the newly-created same-origin iframe through its launch URL/session context;
the iframe validates identity/core/ROM/runtime metadata and loads the raw state
after EmulatorJS starts. It cannot restore until the
new fenced lease has been acquired. Discard deletes the record and starts a
normal session. A failed restore leaves the candidate available, reports the
failure, and does not silently start a new game over it.

## Boundaries

- This does not allow offline launch: normal launch still needs a valid backend
  lease and launch descriptor.
- It does not change backend save revision/conflict rules, create a server
  snapshot, or make the local record visible on another device.
- It does not restore without an explicit user choice.
- It does not claim that an unclean browser termination was a confirmed runtime
  break.
- The existing manual Save state/Load state controls remain Spec 034 behavior.

## Acceptance

1. A running emulator persists local state only every 2,500 ms after the core starts.
2. A forced lease/runtime failure preserves and marks the newest bundle without
   trying to upload or release through the unavailable backend.
3. Normal close and page reload issue local deletion; a record left by an
   interrupted lifecycle is presented only as a possible recovery.
4. Selecting the matching profile shows Restore/Discard before lease acquisition;
   another profile/game never sees the record.
5. Restore requires a fresh lease, validates compatibility, loads state only,
   and does not write any `.sav` bytes.
6. Discard permanently removes only that profile/game record.
7. Focused package and frontend contract tests cover timer cadence, copying,
   clean deletion, break classification, profile scoping, restore/discard, and
   no automatic restoration. No project build is run.
