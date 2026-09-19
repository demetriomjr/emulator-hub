---
title: Production Compose readiness for external Caddy
date: 2026-09-19
tags: [spec, deploy, docker, compose, caddy, backup]
status: active
---

# Spec 039 — Production Compose readiness

## Goal

Make the alpha deployment topology explicit and recoverable while retaining
exactly two application containers: frontend and backend. Caddy and Redis stay
external to this Compose project.

## Context and decision

The previous Compose file published the frontend only to host loopback. That
works only when Caddy runs on the host. It cannot serve a Caddy container, and
the ordinary short `depends_on` form starts Nginx before the backend is known
ready. The backend data volume also existed without a documented backup or
restore procedure.

The production topology is therefore:

```text
Internet -> external Caddy container -> caddy network -> frontend:8080
                                            frontend -> application network -> backend:3001
backend -> external Redis endpoint
```

`CADDY_NETWORK` names the pre-existing Docker network to which the separately
managed Caddy container is attached. The frontend joins that network; the
backend does not. The frontend also binds only `127.0.0.1:8080` for an
externally managed Caddy process running directly on the VPS host.

An internal Docker network was rejected because the backend must reach the
externally managed Redis endpoint. The non-published application network still
prevents direct host exposure of the backend.

## Requirements

1. `docker-compose.yml` defines only frontend and backend services.
2. The frontend joins the required external Caddy network and binds only
   `127.0.0.1:8080` on the VPS host. The backend is reachable only as
   `backend:3001` from the frontend.
3. The backend exposes a Compose healthcheck that confirms its HTTP service is
   responding. The frontend uses long-form `depends_on` with
   `condition: service_healthy`.
4. `restart: unless-stopped`, external Redis environment variables, read-only
   ROM mount, and persistent backend data remain intact.
5. The persistent volume has a stable configurable Docker name so its backup
   is not coupled to an incidental Compose project name.
6. `deploy/.env.example` and a production runbook specify network creation,
   deployment, Caddy upstream, backup, restore, and the distinct Redis backup
   responsibility.

## Operations

Before first deployment, create the Caddy network once:

```sh
docker network create caddy
```

Set `CADDY_NETWORK=caddy` and production `REDIS_URL` in `deploy/.env`, provide
ROMs under `deploy/roms/`, then run:

```sh
docker compose --env-file deploy/.env up -d --build
```

Caddy proxies to `frontend:8080` on the same `caddy` network when it is a
container, or to `127.0.0.1:8080` when it runs on the VPS host. It owns TLS
and the public subdomain; this project does not bind ports 80 or 443.

The runbook backs up the named data volume to an operator-provided directory
and restores only while Compose is stopped. Redis remains external and must be
backed up by its own operator/provider workflow.

## Verification

1. Compose configuration resolves with a populated production environment.
2. `backend` becomes healthy before `frontend` is created.
3. Caddy can reach `frontend:8080`; neither service publishes a host port.
4. A volume archive can be created, Compose stopped, and the archive restored.
5. Existing frontend/backend production builds continue to pass when requested.
