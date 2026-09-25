# Production deployment

This Compose project starts only Emulator Hub frontend and backend containers.
Caddy and Redis are external services.

## First deployment

1. Create the shared Caddy network once. Use the network name used by the
   separately managed Caddy container:

   ```sh
   docker network create caddy
   ```

2. Copy `deploy/.env.example` to `deploy/.env`, set the real external
   `REDIS_URL`, set `CADDY_NETWORK` to the Caddy network, and set
   `REDIS_NETWORK` to the Docker network containing Redis.
3. Put authorized ROM files in `deploy/roms/`.
4. Start the application from the repository root:

   ```sh
   docker compose --env-file deploy/.env up -d --build
   ```

The backend image takes IPS files only from `assets/ips/`. Its patch directory
is cleared before those files are copied, and Compose does not mount that
directory as a volume. On the next deployment with `--build`, the new backend
container contains the current manifest and patches; obsolete IPS files from
the previous image do not carry over. The persistent save data and ROM mounts
are unaffected. `docker compose up -d` without `--build` may keep using the old
image and must not be used to publish a changed IPS.

For a containerized Caddy, configure the upstream as `frontend:8080` and
attach Caddy to `CADDY_NETWORK`. The backend joins `REDIS_NETWORK` so its
`REDIS_URL` must use the Redis container DNS name on that network. For Caddy
running directly on the VPS host, use `127.0.0.1:8080`. Caddy owns the public
hostname and TLS; this project does not bind ports 80 or 443.

## Separate browser origins for concurrent players

EmulatorJS executes in each visitor's browser. Giving up to six player iframes
distinct origins lets compatible Chromium browsers schedule them separately.
This changes browser execution, not the number of frontend or backend Docker
containers. The Hub page and all players still use the same frontend image.

The default deployment leaves `PLAYER_ORIGIN_PORTS` empty and serves players
on the Hub origin. To enable six player origins:

1. Choose **six distinct, unused external TCP ports**. They must differ from
   the Hub's own HTTPS port and be reachable from each visitor's browser.
   Check host listeners, existing Docker publications, provider firewall rules,
   and any private network policy. Ports inside Docker alone are insufficient.
2. Set `PLAYER_ORIGIN_PORTS` in `deploy/.env` to the comma-separated ports,
   for example `8444,8445,8446,8447,8448,8449`. The frontend Docker build
   receives this value through a build argument. Rebuild that image after
   changing the list; restarting the existing image cannot change it.
3. If Caddy is containerized, add the same six TCP port publications to **the
   Caddy service's** Compose file. Add six Caddy site addresses on the existing
   Hub hostname, one per port, each `reverse_proxy`ing to the same frontend
   service on their shared Docker network. The script below prints both
   fragments using your hostname and upstream:

   ```sh
   node deploy/print-player-caddy.mjs hub.example.com 8444,8445,8446,8447,8448,8449 frontend:8080
   ```

   If Caddy runs directly on the host, use the frontend's published upstream,
   such as `127.0.0.1:8080`. Review and merge the printed fragments into your
   separately managed Caddy configuration; the script does not modify a live
   server. Reload or recreate Caddy as required by changes to its port
   publications. Keep your existing 443 and private listeners intact.
4. Keep the existing DNS name. Ports change browser origins without creating
   new subdomains or DNS records. Caddy uses the hostname's existing TLS
   certificate on these additional HTTPS ports. Verify `/player.html` on each
   port from **outside** the VPS with normal certificate validation, including
   the `Document-Isolation-Policy: isolate-and-require-corp` response header.
   Verify that `/api/` and `/roms/` on each port reach the same frontend proxy.
   Then test a real game, lease, save, local recovery and snapshot restoration.

The parent Hub assigns one port to each active player and keeps that slot until
the player closes. Parent/player messages validate the actual frame origin,
source and session. Because all player URLs retain the **same hostname**,
host-only device cookies are shared across ports, while IndexedDB remains
origin-specific; the player uses the Hub's storage bridge for local recovery.
The Nginx document-isolation header applies only to `/player.html`. Browsers
without effective isolation use the ordinary EmulatorJS core. An empty or
invalid port configuration uses the Hub origin so game launch remains available.

In development, `npm run dev` starts six loopback proxies automatically on the
Vite port plus one through plus six, or the six ports in
`apps/frontend/.env` under `PLAYER_ORIGIN_PORTS`. It passes the available
ports to Vite without a query parameter. If those local ports cannot be
reserved, it logs one warning and uses same-origin players for that run.

## Persistent data backup

The backend creates one authenticated startup backup before it begins
listening. Operators can request another backup with:

```sh
curl -fsS -X POST https://YOUR_HOST/api/ops/backups/backend-state \
  -H "Authorization: Bearer $EMULATOR_HUB_BACKUP_TOKEN"
```

Set `EMULATOR_HUB_BACKUP_TOKEN` as a deployment secret. The endpoint returns
archive metadata only; the archive remains in the backend data volume.

The backend save data lives in the Docker volume named by
`EMULATOR_HUB_DATA_VOLUME`. Back it up before upgrades and on the schedule your
operations policy requires:

```sh
mkdir -p backups
docker run --rm \
  -v emulator-hub-data:/source:ro \
  -v "$PWD/backups:/backup" \
  alpine:3.21 tar -C /source -czf /backup/emulator-hub-data-"$(date +%F-%H%M%S)".tgz .
```

Replace `emulator-hub-data` with the configured volume name when it differs.
Redis is external to this project and needs its own backup process.

## Restore

Stop the application before replacing its data:

```sh
docker compose --env-file deploy/.env down
docker run --rm \
  -v emulator-hub-data:/target \
  -v "$PWD/backups:/backup:ro" \
  alpine:3.21 sh -c 'rm -rf /target/* /target/.[!.]* /target/..?*; tar -C /target -xzf /backup/ARCHIVE.tgz'
docker compose --env-file deploy/.env up -d
```

Use the exact archive filename in place of `ARCHIVE.tgz`. Restore is destructive
to the selected data volume; verify the volume name and archive before running
it.
