---
title: Alpha Compose deployment
date: 2026-09-19
tags: [spec, deployment, docker, compose, alpha]
status: active
---

# Spec 037 — Alpha Compose deployment

## Goal

Make the alpha deployable on a VPS with Docker Compose while Caddy, the public
domain, TLS, and the existing Redis database remain external to this repository
deployment.

## Services and network

Compose creates exactly two application containers:

1. `frontend` serves the built React application on host port `127.0.0.1:8080`.
   Its Nginx configuration serves static files and proxies `/api` and `/roms`
   to the internal `backend:3001` service, preserving the browser's same-origin
   contract.
2. `backend` runs the Node HTTP server on the internal Compose network only.
   It receives `HOST=0.0.0.0`, `PORT=3001`, and mandatory `REDIS_URL` from the
   VPS environment. Compose never starts, configures, exposes, or persists
   Redis.

Caddy is configured by the operator to reverse-proxy the chosen subdomain to
`http://127.0.0.1:8080`. No TLS certificates, Caddy configuration, domain, or
public port are managed by this Compose file.

## Persistence and content

The backend's Git-ignored `data/` directory uses a named Compose volume so
normal saves and emulator snapshots survive container replacement. ROMs use a
read-only bind mount from `./deploy/roms` to the backend's `roms/` directory;
the operator supplies ROM files and the matching catalog before deployment.
Generated dependencies, ROMs, runtime data, `.env`, and secrets remain out of
Git.

## Operations

`deploy/.env.example` documents only non-secret variable names. The VPS holds
the actual `deploy/.env` with its existing Redis URL. Deployment is performed
from the repository root with `docker compose --env-file deploy/.env up -d --build`.
The compose file never runs migrations automatically and does not declare an
external database service.

## Acceptance

1. Compose defines only `frontend` and `backend` services.
2. Redis is configured only through required `REDIS_URL` environment input.
3. Only frontend binds `127.0.0.1:8080`; backend and Redis have no host port.
4. `/api` and `/roms` reach the backend from the browser through the frontend.
5. Backend runtime data persists in a named volume and ROMs are read-only.
6. `docker compose config` validates with a deployment environment file; no
   project image build is part of repository verification.
