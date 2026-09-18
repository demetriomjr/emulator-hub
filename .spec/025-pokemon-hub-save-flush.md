---
title: Pokemon Hub Deferred Save Flush
date: 2026-09-17
tags: [spec, pokemon, hub, saves, snapshots, persistence]
status: approved-for-implementation
---

# Spec 025 — Pokemon Hub Deferred Save Flush

## Goal

Persist accepted Pokemon Hub placement snapshots to their backend-owned save files without writing on every drag. The backend remains authoritative: browser payloads never contain native bytes and can only cause writes after snapshot validation succeeds.

## Authority and revisions

Every adopted save source stores two independent revisions:

- `sourceRevision` is the monotonic logical snapshot revision used by leases and snapshot requests.
- `saveRevision` is the revision returned by the save store after the last durable `.sav` write.

A periodic flush updates only `saveRevision`. It never lowers, replaces, or derives `sourceRevision` from the file revision. A later external save upload reconciles its complete contents and advances the logical revision from the current authoritative source state.

## Deferred flush behavior

1. An accepted snapshot marks each changed save source dirty. Hub-only sources do not create save writes.
2. Dirty save sources are flushed no earlier than five seconds after their first unsaved accepted change. Further accepted changes join the same pending flush.
3. A flush reads authoritative placements and native representations from the backend record store, materializes bytes through the destination adapter, then calls `saveStore.put` with the last known `saveRevision`.
4. The save store's atomic file replacement remains the only disk write mechanism. A materialization that produces identical bytes performs no file write.
5. A successful flush records the returned save revision and clears the dirty marker only if no newer snapshot made it dirty during the flush.
6. A failed flush leaves the source dirty, retains its lease, logs a safe server error without native bytes or lease tokens, and retries later. It never releases the source as if the write had succeeded.

## Handshake end and release

The browser sends an explicit release for a normally closed source. The backend flushes any dirty accepted state for that source before releasing the lease.

For a closed tab, network loss, or missed renewal, the backend detects the expired lease. It flushes the dirty source before releasing that expired lease. A source with an expired lease and pending flush is unavailable for new acquisition until that flush succeeds or is recovered administratively.

## Initial Generation III materialization boundary

The initial safe writer supports Box-to-Box changes only. It uses the complete 80-byte `BoxPokemon` representation and the established adapter slot writer, including save checksums.

Party changes are rejected before acceptance by the materialization policy. They are not approximated: Party records are 100 bytes and Party-count/order rules require a separately verified writer. Cross-title projection and moves involving unsupported adapters are rejected as well. This preserves every native byte rather than silently dropping Party-only state.

## Required tests

1. A dirty source flushes once after five seconds despite several accepted changes.
2. A flush uses backend record bytes and never accepts bytes from a browser request.
3. Identical materialization does not call `saveStore.put`.
4. A new accepted snapshot during a flush remains dirty for the following cycle.
5. A failed write preserves the dirty marker and prevents lease release.
6. Explicit release flushes before lease deletion.
7. Expired leases flush before becoming acquirable again.
8. Generation III Box moves preserve each 80-byte record and save integrity; Party and unsupported cross-adapter changes are rejected.
9. Save-file revision updates never lower or overwrite the logical snapshot revision.
