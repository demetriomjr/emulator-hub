---
title: Redis Application Persistence
date: 2026-09-17
tags: [spec, backend, redis, persistence, migration]
status: active
---

# Spec 019 — Redis Application Persistence

## Goal

Replace the backend's file-backed JSON application database with Redis while keeping binary game-save files and their revision metadata local to the backend host.

## Deployment boundary

The Redis service runs in Docker on the VPS. Its Docker port is bound only to the VPS loopback interface. A local backend reaches it through an SSH local-port forward and receives its connection address exclusively through `REDIS_URL`; neither the VPS address nor SSH credentials are hard-coded in source control.

The VPS Redis deployment must retain both a Docker volume mounted at `/data` and durable Redis persistence. The verified baseline is AOF enabled with `appendfsync everysec`, plus RDB snapshots. Redis is a database for this product, not a disposable cache.

## Redis ownership

All non-binary application persistence moves into a namespaced Redis keyspace, defaulting to `emulator-hub:v1`:

- generic game profiles;
- the global control profile;
- Pokémon Hub profiles;
- Pokémon Hub inventories and Pokémon documents; and
- the trusted ROM registry.

Game `.sav` bytes and their adjacent revision/SHA-256 metadata remain in the existing local save store. The trusted catalog remains source-controlled configuration, not database state.

## Runtime contract

The backend requires a reachable Redis connection before it serves application requests. It must not fall back to local JSON persistence when Redis is unavailable. Redis connection failures are visible at startup and request failures retain the existing safe HTTP error surface.

Redis values are JSON documents behind `apps/packages/` store contracts. Store methods preserve their public behavior, validation, copy semantics, and optimistic revision conflicts. Game save profile names may repeat under [Spec 068](068-profile-names-and-gamepad-unlock.md); Pokémon Hub profile rules remain separate. Existing Pokémon Hub session leases and snapshot bindings remain intentionally ephemeral runtime coordination rather than durable database records.

## Legacy migration

The first production startup imports existing local JSON-backed application data into absent keys in the configured Redis namespace, records a migration marker only after every import succeeds, and never overwrites a Redis record that already exists. The migration reads but never deletes local JSON files. Existing local saves are not imported because they remain local by design.

## Acceptance criteria

1. Backend application stores persist and retrieve their records through Redis, with no JSON write path for those records.
2. The backend uses only `REDIS_URL` and `REDIS_NAMESPACE` runtime configuration for database connectivity and key isolation.
3. The existing JSON database is imported once without deleting it or overwriting populated Redis records.
4. After a Redis restart with its mounted volume intact, durable application records remain available.
5. Game saves continue to use the local save store unchanged.
6. Automated tests cover Redis key isolation, profile and Hub-store revision behavior, session TTL behavior, and idempotent legacy import. No project build is run.
