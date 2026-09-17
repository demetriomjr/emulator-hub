---
title: Pokemon Hub Record Model and Snapshot Transport
date: 2026-09-17
tags: [spec, pokemon, hub, records, snapshots, synchronization, integrity]
status: proposed
---

# Spec 024 — Pokemon Hub Record Model and Snapshot Transport

## Goal

Define the durable Pokemon record, the narrow snapshot payload exchanged with the backend, and the boundary between optimistic frontend placement and backend-owned game data. The result must preserve every title-specific fact needed for a lossless future transfer while keeping frequent synchronization small and safe.

This spec complements [Spec 023](023-pokemon-hub-snapshot-integrity.md). Spec 023 owns exclusive source sessions, leases, reconciliation, and duplicate correction. This spec owns the Pokemon record model and the bytes and fields that do or do not cross the frontend boundary.

No implementation is authorized by this document. It is the data contract to implement after the frontend snapshot-state tests in Spec 023.

## Current state

The current React drag state is visual and local only. A populated slot currently carries a safe projection containing `species` and `shiny`; it has no `pokemonInstanceId`, no full Pokemon record, no source revision, and no backend synchronization.

The Generation III adapter currently reads a PC record as 80 bytes and exposes only its personality value, original trainer ID, species, trainer IDs, and shiny status. It preserves the raw PC bytes when an existing backend transfer path stores a Pokemon document, but it does not yet decode the complete Emerald record. That is intentional: an incomplete projector must never discard fields it does not understand.

## Mandatory first observation

Creating, attaching, restoring, or replacing a save for a profile is an import transaction, not merely a file write. Before that save can be opened in an editable Hub workspace, the backend must:

1. Persist the complete received save revision without changing its bytes.
2. Select the title adapter and inspect every Party and PC location covered by that adapter's layout.
3. Create or reconcile one `pokemonInstanceId` for every non-empty, decodable record, then record its initial placement, source provenance, and native representation.
4. Retain the full source save revision and every discovered native record, including any field the current adapter does not yet decode.
5. Refuse editable acquisition if inspection is incomplete, ambiguous, or detects a non-empty record that cannot be safely accounted for. The original save remains preserved for diagnosis; it is never silently cleaned or rewritten.

An empty new save therefore produces no Pokemon records. An imported save with Pokemon records is fully adopted before the frontend can move any of them. Reopening the same persisted save reconciles against its prior authoritative snapshot; it does not mint new IDs merely because its positions are read again.

The import reconciler uses the `saveLineageId` and ordered evidence rules in Spec 023. An exact native-record fingerprint is the preferred continuity match; an adapter-specific continuity key may only resolve one unmatched candidate in that same lineage. An ambiguous match blocks editing instead of attaching the wrong backlog to a different Pokemon. A record newly observed in an unrelated imported save is a distinct Hub record even when its native bytes happen to match another record.

## Data ownership

| Data | Owner | May be sent by browser in a snapshot? |
| --- | --- | --- |
| Slot location and `pokemonInstanceId` | Frontend's optimistic placement map, confirmed by backend | Yes |
| Source key, lease/session token, base revision, client sequence, idempotency key | Workspace synchronization state | Yes |
| Species, form, shiny flag, nickname, level, and other display fields | Backend read model | No; backend sends them to the browser |
| Native save bytes, encrypted payload, checksums, fingerprints, trainer secrets, adapter-private metadata | Backend only | No |
| Canonical game data such as moves, effort values, contest values, ribbons, markings, met data, and title-specific fields | Backend record projector and native representation | No |

The frontend moves opaque identifiers between locations. It never asserts that an identifier is shiny, belongs to a species, has a particular move, or contains a particular native byte sequence. The backend reconstructs those facts from its authoritative record store.

## Durable Pokemon record

Each discovered or transferred Pokemon has one backend-assigned, opaque `pokemonInstanceId`. It is a UUID or another collision-resistant server-generated token, is immutable for the life of that Hub record, and never includes a slot, game name, trainer ID, or Pokédex number.

The target logical document is:

```js
{
  schemaVersion: 1,
  pokemonInstanceId,
  revision,
  state: 'in-save' | 'stored' | 'pending-transfer',

  // Read model returned to the frontend only as needed for rendering.
  display: { species, form, shiny, nickname, level },

  // Normalized fields exposed by adapters only after their fidelity is proven.
  canonical: {
    ownership: {},
    training: {},
    battle: {},
    met: {},
    ribbons: [],
    contests: {},
    markings: {},
    gameSpecific: {},
    unknownFields: {},
  },

  // Adapter-specific identity is diagnostic and reconciliation metadata,
  // never the global Hub identifier.
  nativeIdentity: { adapter, values: {}, recordFingerprint },
  provenance: { firstObservedAt, originSourceKey, originSnapshotRevision },
  representations: [{ adapter, kind, byteLength, sha256, bytesBase64 }],
  history: [],
}
```

`representations` is backend-only. Its native bytes are retained without lossy rewrite until an adapter can prove a field-level mutation preserves the title's format and integrity checks. `unknownFields` is not permission to invent values; it marks information that remains represented only in native bytes or awaits a verified adapter decoder.

## Canonical backlog and cross-title projections

The durable record is a superset backlog, not a mirror of the game currently holding the Pokemon. Moving a Pokemon out of a title with fewer capabilities must not delete fields that title cannot express.

For each accepted transfer, the backend keeps:

```js
{
  canonical: { /* latest validated cross-title facts */ },
  fieldLedger: [{
    fieldPath,
    value,
    observedAt,
    observedIn: { adapter, sourceKey, sourceRevision },
    confidence: 'native-decoded' | 'derived' | 'preserved-native',
  }],
  representations: [{
    adapter,
    kind,
    byteLength,
    sha256,
    bytesBase64,
    capturedAt,
    status: 'current' | 'historical',
    capabilityVersion,
  }],
}
```

`fieldLedger` is append-only audit evidence, while `canonical` is the current value chosen from valid evidence. An adapter's capability descriptor explicitly states, per field, whether the title can read, write, derive, preserve opaquely, or cannot represent it. This descriptor is versioned and tested with the adapter; it is never inferred from whether a UI happens to display the field.

Example: a Pokemon leaving Emerald for Yellow retains its Emerald ribbons in the canonical backlog and historical Generation III representation. Yellow receives only the projection it can represent. When the Pokemon later enters a title whose verified capability descriptor supports a ribbon, the write adapter may restore that canonical ribbon value. The older-title projection never clears it merely because the older format has no ribbon field.

The write path must compose a new destination representation from the latest canonical facts plus the destination adapter's capability descriptor. It must not blindly replay an older raw representation, because that could overwrite newer supported changes with stale bytes. Unsupported fields remain in the backlog until a compatible destination is available. A rejected, invalid, or impossible field for the destination stays preserved but is not injected.

Every projection and rehydration is appended to record history with source and destination adapter versions, the fields applied, fields retained only in backlog, and the resulting representation hash. This makes a later return to a compatible game auditable and permits recovery without trusting browser data.

## Separate immutable event collection

Pokemon documents and Box/Snapshot reads must not embed an ever-growing movement history. The backend writes an immutable domain event to a separate collection for each accepted lifecycle fact. The initial collection is keyed by profile and event ID, with a secondary per-Pokemon lookup path; loading a Box or rendering a sprite never reads either collection.

```js
{
  schemaVersion: 1,
  eventId,
  profileId,
  pokemonInstanceId,
  operationId,
  type: 'pokemon.observed' | 'pokemon.placement-changed' | 'pokemon.projection-applied' | 'pokemon.reconciliation-required',
  occurredAt,
  source: { sourceKey, location },
  destination: { sourceKey, location },
  sourceRevision,
  destinationRevision,
  adapter: { source, destination, capabilityVersion },
  representationHashes: { source, destination },
}
```

An event contains trace metadata only. It never contains `bytesBase64`, encrypted payloads, canonical gameplay fields, trainer secrets, a full display record, or an arbitrary client-provided payload. The durable Pokemon record remains the sole holder of native representations and canonical backlog.

The event ID and `operationId` make emission idempotent: retrying an already accepted snapshot must not create a second movement event. Events are append-only; correction is represented by a later event, never an update or deletion of an earlier event. History queries are explicitly paginated and requested by Pokemon identifier or operation, never joined into ordinary Box reads.

For the snapshot backend phase, placement-index change, source revisions, accepted snapshot result, idempotency record, and corresponding events form one authoritative transaction or durable outbox. The legacy imperative transfer route is not a substitute for this boundary and must not claim an event was committed unless its movement was committed as well.

The current `hubPokemonId` in the existing Hub persistence path becomes the migration predecessor of `pokemonInstanceId`. The implementation plan must decide whether to rename it in place or retain it as a backwards-compatible alias, but it must result in one server-owned instance identifier.

## Generation III and Pokemon Emerald fidelity

For Emerald PC storage, the authoritative representation is the complete 80-byte `BoxPokemon` record. Its encrypted payload and integrity checksum must round-trip byte-for-byte. A party record includes that PC-compatible core plus title-specific party runtime data; the implementation must define which party bytes are preserved before it permits party-origin writes.

The record model must retain or be able to derive, at minimum, every Emerald fact required by a future transfer, including:

- ownership and trainer data;
- personality-derived properties such as nature and shiny status;
- species, held item, experience, moves, move PP, effort values, individual values, friendship, ability-related state, and markings;
- encounter/met data, contest attributes, and all ribbons supported by the title;
- all remaining encrypted substructure data and any adapter-unknown fields.

The frontend is not required to display these fields yet. Retaining the full native representation is the initial fidelity guarantee; normalized fields can be added gradually behind adapter tests that compare original and rewritten records.

No generic `size` field is assumed for Emerald. A size-like property may enter `gameSpecific` only when a title's actual format and adapter decoder establish its meaning and preservation rules.

## Identity limits of native saves

Generation III exposes values such as the 32-bit personality value (PID) and the original trainer ID. They are useful native attributes, but neither is a global unique identifier, and their pair is not a uniqueness guarantee across independently created saves. They can collide, and a copied save can contain a byte-for-byte identical Pokemon record.

Therefore the backend must not derive `pokemonInstanceId` from PID, trainer ID, species, checksum, or a hash of the native record alone. On first acquisition it creates a server identifier and records the source provenance plus a native fingerprint. The fingerprint helps detect an unexpected mutation of the same stored record; it is not proof that two records from unrelated saves are the same creature.

This distinction is deliberate:

1. The Hub can guarantee that one `pokemonInstanceId` has at most one authoritative placement.
2. The Hub cannot infer, solely from identical external save bytes, whether two records were independently produced collisions or one externally copied record. That policy requires additional provenance or an explicit import/clone rule and is outside this synchronization contract.

## Acquisition response

When a source lease is acquired, the backend returns its authoritative snapshot plus a safe display projection. The browser stores the display projection keyed by opaque identifier and uses it only to render sprites and later details.

```js
{
  sourceKey,
  sourceSessionId,
  leaseToken,
  sourceRevision,
  snapshotRevision,
  receivePolicy: { acceptsAdapters: ['...'] },
  placements: [{ location, pokemonInstanceId: '...' } | { location, pokemonInstanceId: null }],
  pokemonDisplay: {
    '...': { species, form, shiny, nickname, level }
  },
}
```

The server may omit display properties that are not available yet. It must never return raw save bytes, native fingerprints, encrypted payloads, or arbitrary canonical fields merely because the frontend is rendering a sprite.

`receivePolicy` is a safe, server-authored capability projection. It lets the frontend prevent an obviously unsupported optimistic move, but never authorizes a transfer by itself; the backend repeats capability and integrity validation when it receives the snapshot.

## Snapshot synchronization request

The frontend sends one complete placement map for every source currently leased by its workspace. It does not send a drag command and does not send full Pokemon records.

```js
{
  workspaceId,
  clientSequence,
  idempotencyKey,
  sources: [{
    sourceKey,
    sourceSessionId,
    leaseToken,
    baseRevision,
    placements: [{ location, pokemonInstanceId: '...' } | { location, pokemonInstanceId: null }],
  }],
}
```

The payload is intentionally a map of positions to opaque IDs. It is sufficient to express a move, a swap, a clear, and a correction while preventing a browser from mutating a Pokemon's identity, stats, shiny state, ribbons, or native representation.

The backend validates the complete submitted workspace snapshot atomically. On acceptance it returns an acknowledgement with accepted revisions. On any stale, lease, duplicate, or validation failure it returns the last authoritative snapshot for the affected sources; the frontend replaces its optimistic map with that authority state.

```js
// Accepted
{ status: 'accepted', clientSequence, idempotencyKey, serverSequence, snapshots: [{ sourceKey, sourceRevision, placements }] }

// Not accepted or corrected
{ status: 'corrected' | 'stale', clientSequence, idempotencyKey, code, serverSequence, snapshots: [{ sourceKey, sourceRevision, placements, pokemonDisplay }] }
```

## Synchronization cadence

The initial policy is a 500 ms trailing debounce after the most recent local placement change, with an 800 ms maximum delay measured from the first unsynchronized change. It creates a short batch when the user makes several moves but does not indefinitely defer a dirty snapshot.

- No request is made while the confirmed placement map is clean.
- At most one synchronization is in flight per workspace.
- If movement occurs while a request is in flight, the frontend retains only the newest complete snapshot and sends it after the acknowledgement.
- A retry reuses the same sequence, idempotency key, and deterministic placement payload. A newer queued snapshot receives fresh `baseRevision` values from the accepted acknowledgement before it is sent.
- A close or explicit release first flushes the newest dirty snapshot, then releases the lease only after an accepted acknowledgement.
- Lease renewal remains separate from placement synchronization and follows Spec 023's 10-second renewal interval.
- Network failures do not cause the frontend to construct a partial compensating payload. It retains the last confirmed snapshot, stops further edits for the affected source when authority cannot be confirmed, and logs unexpected errors without bytes or lease tokens.

The 500/800 ms values are configuration defaults, not a wire-format contract. They may be tuned only with deterministic scheduler tests and without weakening full-snapshot validation.

## Backend validation rules

For each received snapshot the backend must, in addition to Spec 023's lease and revision checks:

1. Require exactly the valid locations for every submitted source: no omitted occupied slot, invented slot, or duplicate location.
2. Resolve every non-null identifier from the backend record store and reject unknown, deleted, or incompatible identifiers.
3. Confirm every identifier is authorized in this workspace's prior authoritative placement set or a server-authorized transfer transition; clients cannot mint identifiers.
4. Rebuild all display and canonical fields from the backend record, never from a snapshot value.
5. Enforce one authoritative placement per `pokemonInstanceId` across all relevant sources.
6. Commit placement-index revision, source revisions, accepted snapshot, and idempotency result together before initiating any later native-save write.
7. Validate every requested source transfer against its adapter capability descriptor, including its destination-specific projection rules, before accepting a move between sources.
8. Emit exactly one immutable movement event per affected Pokemon only after the placement change is authoritative, using the request's idempotency operation identity.

An accepted snapshot becomes the only input to later save persistence. If a native write fails after an accepted placement revision, recovery must restore or reconcile from the server's accepted snapshot rather than replaying a browser gesture.

Before an accepted transfer writes a destination save, the backend also validates the destination adapter capability descriptor and records a projection plan. The plan lists every canonical field applied to the destination and every field intentionally retained only in the backlog. If the adapter cannot preserve the destination record without an unverified lossy operation, the transfer is rejected rather than silently dropping data.

## Required implementation tests

Before backend routes or real save writes are enabled, deterministic frontend/package tests must prove:

1. A serializer emits every valid leased location and only `{ location, pokemonInstanceId }` placement data.
2. The serializer never emits `species`, `shiny`, native identity values, canonical fields, raw bytes, fingerprints, or lease tokens in error logs.
3. A move and an allowed local swap preserve identifiers while leaving display records unchanged.
4. The 500 ms debounce, 800 ms maximum delay, one-in-flight rule, and queued-latest-snapshot rule hold under a fake clock.
5. A correction or stale response replaces the complete optimistic placement map and uses only the returned display data.
6. Duplicate and unknown identifiers are rejected by a deterministic fake authority without partial local application.
7. Generation III fixtures round-trip their raw PC record bytes unchanged whenever no verified field-level mutation is requested.
8. Import fixtures create one identifier per non-empty Party or PC record before the source becomes editable; malformed or undecodable non-empty data blocks editable acquisition while retaining the original save bytes.
9. A lower-capability destination projection retains unsupported fixture fields in the canonical backlog, and a later compatible projection restores only adapter-supported values without replaying stale native bytes.
10. Re-inspection fixtures cover exact-record continuity, one valid continuity-key match, a newly observed record, and an ambiguous match that blocks editing without choosing an identifier.
11. Event fixtures prove that movement events live outside Pokemon documents, reject raw/native gameplay data, are idempotent per accepted operation, and are absent from ordinary Box payloads.

No project build, manual browser test, backend call, or save write is part of this spec's first implementation phase.

## Acceptance criteria

1. Every rendered occupied slot is backed by a backend-assigned `pokemonInstanceId` once synchronized state is introduced.
2. The browser synchronizes only complete placement maps and never complete Pokemon records.
3. The backend owns native bytes and all rich gameplay fields, returning only a safe display projection to the frontend.
4. Emerald records retain all native information, including ribbons and not-yet-decoded fields, before any future transfer or write feature is enabled.
5. PID, trainer ID, checksum, and native fingerprints are documented as non-global identifiers and are never used as the Hub's uniqueness key.
6. Failed validation replaces optimistic client state with the last authoritative snapshot.
7. Every non-empty Pokemon record is adopted during save import before it can be moved, and lower-capability games cannot erase unsupported canonical data.
8. A native continuity key is never treated as globally unique; ambiguous save-lineage reconciliation remains non-editable until resolved safely.
9. Events are immutable, separate from Box data, free of native bytes and rich gameplay fields, and emitted exactly once for each accepted movement operation.
