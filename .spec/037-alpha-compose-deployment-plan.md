# Alpha Compose Deployment Plan

**Goal:** Ship a two-container alpha stack that Caddy can proxy to locally.

**Spec:** `.spec/037-alpha-compose-deployment.md`

## Tasks

1. Add backend and multi-stage frontend Dockerfiles using the existing `apps` Node dependency root.
2. Add Nginx same-origin proxy configuration and a root Compose file containing only frontend/backend services, durable backend data, read-only ROM input, and external `REDIS_URL`.
3. Add deployment environment example and ignore rules; validate the Compose model without building images.
