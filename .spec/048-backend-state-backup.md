# Spec 048 — Backend state backup endpoint and startup barrier

## Goal

Provide an operator-triggered backend backup that captures all profile records,
their canonical save bytes and revision metadata, and the current Pokémon Hub
state. The same backup operation runs once during container startup and must
finish successfully before the HTTP listener becomes reachable.

This is a safety mechanism for production tests and upgrades. It does not
replace Redis's own durable backup policy and does not deploy or schedule jobs.

## Current persistence model

- Generic game profiles, control profile, user preferences, ROM registry,
  Pokémon Hub documents, and related metadata are stored in the configured
  Redis namespace.
- Canonical game saves and revision metadata are stored in the backend data
  volume under the save store.
- The backup must therefore combine Redis records and local save files into one
  versioned archive written to the persistent backend volume.

## Backup artifact

The service creates an atomic gzip JSON archive under
`<backend-data>/backups/backend-state-<UTC timestamp>-<id>.json.gz`. The archive
contains:

```json
{
  "schemaVersion": 1,
  "createdAt": "ISO-8601",
  "reason": "startup|operator",
  "redis": { "namespace": "...", "records": [{ "key": "...", "value": "..." }] },
  "saves": [{ "profileId": "...", "gameId": "...", "revision": 1, "sha256": "...", "fenceGeneration": 1, "bytesBase64": "..." }]
}
```

Redis records include every key in the configured application namespace. This
includes generic profiles and the current Pokémon Hub profile, inventory,
Pokémon, event, snapshot, lease, and preference state. Raw save bytes are kept
separately with their validated metadata. Secrets are not added by the backup
service outside the configured Redis namespace; the resulting archive is
operator-sensitive and must remain on the private data volume.

The archive is assembled in memory, written to a unique temporary file, fsynced
where supported, and renamed atomically. A failed write removes the temporary
file and does not replace the previous successful archive.

## Endpoint

`POST /api/ops/backups/backend-state`

Authentication is required with `Authorization: Bearer <EMULATOR_HUB_BACKUP_TOKEN>`.
The token is configured only through the environment and is never logged or
returned. Missing or invalid credentials return `401`; a missing configured
token disables the endpoint with `503` so an accidental unauthenticated route
cannot be opened.

Success returns `201` with metadata only:

```json
{ "schemaVersion": 1, "createdAt": "...", "reason": "operator", "fileName": "...", "sizeBytes": 1234, "sha256": "...", "recordCounts": { "redis": 12, "saves": 4 } }
```

The response never includes save bytes, profile contents, Redis values, or the
filesystem path outside the backup file name. Concurrent backup calls are
serialized; a second request waits for the active operation and then creates a
new artifact.

## Startup barrier

The production backend creates the backup service after Redis connects and
legacy migration completes. It runs one `reason: "startup"` backup before
calling `server.listen`. If the backup fails, the process closes Redis, does not
bind the HTTP port, and exits with a non-zero status. Health checks therefore
cannot report the backend ready until the backup has completed.

Tests that construct an isolated server may inject a backup service or disable
the production startup hook explicitly; the default production entry point
keeps the barrier enabled.

## Integrity and consistency

- Redis keys are enumerated and read through the existing persistence adapter;
  no direct Redis client is exposed to HTTP handlers.
- Save enumeration validates bytes and metadata using the save store's existing
  integrity rules and includes the revision/fence values needed for recovery.
- The backup records one logical point-in-time operation. Writes occurring
  concurrently may appear before or after the Redis scan, but every included
  record is self-consistent and every save has matching bytes and metadata.
- The operation never mutates profiles, saves, Pokémon Hub state, leases, or
  snapshots.

## Tests

1. Backup service writes a gzip archive with Redis records, all saves, metadata,
   and SHA-256; temporary files are cleaned after a failure.
2. Endpoint rejects missing, malformed, and wrong bearer tokens, and does not
   leak archive contents.
3. Authorized endpoint returns metadata and serializes concurrent calls.
4. Startup bootstrap waits for backup completion before `listen`; a rejected
   backup prevents listening and closes persistence.
5. A production Compose/Dockerfile contract test verifies the backup token is
   environment-only and no backup command is run after the listener starts.

## Acceptance criteria

- An operator can call one authenticated endpoint to capture profiles, saves,
  and current Pokémon Hub state.
- The archive is durable, atomic, versioned, and contains no omitted save bytes
  or profile records from the configured stores.
- The production container performs the same backup before becoming accessible.
- A failed startup backup leaves the backend inaccessible and exits non-zero.
- Existing save, profile, Pokémon Hub, and Redis tests continue to pass.
