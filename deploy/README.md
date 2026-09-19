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
   `REDIS_URL`, and set `CADDY_NETWORK` to that network name.
3. Put authorized ROM files in `deploy/roms/`.
4. Start the application from the repository root:

   ```sh
   docker compose --env-file deploy/.env up -d --build
   ```

For a containerized Caddy, configure the upstream as `frontend:8080` and
attach Caddy to `CADDY_NETWORK`. For Caddy running directly on the VPS host,
use `127.0.0.1:8080`. Caddy owns the public hostname and TLS; this project
does not bind ports 80 or 443.

## Persistent data backup

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
