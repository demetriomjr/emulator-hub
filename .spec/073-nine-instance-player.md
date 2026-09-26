# Spec 073 — Nine-instance player surface and isolated origins

## Goal and intent

Allow up to nine concurrent EmulatorJS instances in one player session. The seventh starts a third row; the eighth and ninth fill that row in launch order. Preserve independent title/profile identity, launch validation and save integrity. This spec records the system survey, requirements, application/package boundaries, implementation sequence and acceptance checks in one place.

## Current system survey

| Boundary | Current behavior | Required change |
| --- | --- | --- |
| React session (`apps/frontend/src/main.jsx`) | `MAX_PLAYER_INSTANCES = 6` guards the add control, picker, launch handler and state update. Stable session keys preserve mounted iframes through reflow. | Set the common cap to nine at every existing guard; retain the same launch and close flows. |
| CSS surface (`apps/frontend/src/styles.css`) | Five/six use 3 columns × 2 rows and a 9:4 surface; each cell is 3:2. Fullscreen has matching sizing. | Seven/eight/nine use 3 columns × 3 rows and a 3:2 surface, with the same centered viewport fit in normal and fullscreen modes. No gap or padding is added. |
| Origin topology (`apps/packages/player-origin-topology.mjs`) | Validates exactly six distinct HTTPS or local development ports; allocates one slot per active iframe and validates message source/origin. | Validate exactly nine distinct ports and allocate slots 0–8. Existing session slot identities remain stable; closing a player frees its slot. Unconfigured, invalid or unreachable ports retain the existing same-origin fallback without blocking a valid launch. |
| Frontend development (`apps/frontend/scripts/dev.mjs`) | Starts six local player-origin proxies by default. | Start nine, on hub port +1 through +9, or use nine configured ports. |
| Deployment helper (`deploy/print-player-caddy.mjs`) | Prints six Caddy listeners and port publications. | Print nine and document the nine-port configuration. No deployment or live infrastructure change is part of this task. |
| Performance recorder (`apps/packages/emulator-performance-probe.mjs`) | Automatically captures when six frames are ready. | Capture at the new full capacity of nine; changes to membership still invalidate an in-progress capture. |
| Application dependencies | `apps/frontend` owns its npm dependencies; shared `apps/packages` source receives application-specific dependencies through existing entry points. | Preserve application-owned dependency isolation. The capacity and origin topology policy remains dependency-free in `apps/packages`; no new npm package or app-to-app import is needed. |

## Functional requirements

1. One through nine sessions use the existing verified game/profile selection, backend lease, separate `player.html` iframe, save namespace, snapshot and close behavior. A failed add leaves running players mounted.
2. The add control stays enabled through eight and is disabled at nine. All existing add entry points reject a tenth before mounting a frame.
3. Counts 1–6 retain their current layout. Counts 7–9 use three columns and three rows, row-major placement, one cell for each session, and empty cells after the last session. Every occupied cell remains 3:2. The whole surface is 3:2 and fits the available viewport under the 52px header in normal and fullscreen modes.
4. Selective close reflows survivors without replacing their iframe keys, URLs, origin slots, profile identities or saves. Session-wide controls continue to address all mounted frames.
5. A configured isolated-origin topology consists of exactly nine unique valid ports, excluding the Hub port. Each active player can receive a distinct origin. Existing source/origin/session checks and storage bridge behavior apply to slots 6–8. An unavailable origin keeps the current same-origin fallback; it does not become a core launch prerequisite.
6. Development defaults to nine loopback proxies; deployment configuration and the Caddy fragment helper describe nine HTTPS ports. Frontend and backend retain their separate package manifests and dependency ownership.
7. The automatic performance report targets nine ready players, without changing the sampler format or normal launch behavior.

## Boundaries and data integrity

No backend API, ROM catalog, profile model, lease rule, save format, snapshot format, game-specific branch, new UI control or dependency is added. ROM verification and required profile, lease and save checks remain hard requirements. Optional enhancements, including threaded runtime selection, continue to fail open independently. Electron continues its current capability-based same-origin path where separate HTTP origins are unavailable.

## Implementation sequence

1. Add focused failing tests for the nine-session guard, 7–9 layout, ninth origin allocation and validation, nine-proxy development behavior, nine-listener deployment output and nine-player automatic recorder.
2. Update the shared origin policy and frontend session cap. Change CSS only for counts 7–9 and both normal/fullscreen sizing.
3. Update development proxy defaults, deployment helper and operator examples. Adjust the performance recorder to the new full-capacity trigger.
4. Run focused tests and relevant Node test suites, inspect the final diff and verify unchanged code paths. Do not run a project build or create a commit: neither was requested for this task.

## Acceptance

1. Adding players 7, 8 and 9 succeeds through the current picker; adding player 10 is rejected and the add control is disabled at nine.
2. Seven, eight and nine render in ordered 3 × 3 cells, with new players beginning the third row. Their surface and every frame preserve the stated proportions in normal and fullscreen modes.
3. Nine configured ports allocate distinct origin slots; invalid or duplicate lists are rejected by the topology parser; absent/unreachable origins fall back as before.
4. The existing global controls, selective close, profile-scoped save identities, leases, recovery and snapshots remain attached to each live iframe, including slots 6–8.
5. Local and documented production configurations can expose nine isolated origins, while application-owned npm dependency boundaries remain intact.
6. Focused automated checks pass. A real nine-player browser run and production listener setup require the appropriate running services and infrastructure and are reported separately if not performed.

## Production preparation — 2026-09-26

The follow-up operations task extended the existing Caddy configuration on the VPS. `/opt/caddy/compose.yaml` now publishes TCP 8450–8452 in addition to 8444–8449; `/opt/caddy/sites/pokehub.caddy` sends the three new HTTPS listeners to the existing `frontend:8080` service. The Git-ignored `/home/deploy/emulator-hub/deploy/.env` now sets `PLAYER_ORIGIN_PORTS=8444,8445,8446,8447,8448,8449,8450,8451,8452`. The configuration backup is `/home/deploy/nine-player-backup-20260926T185923Z` and includes the former Caddy Compose file, Caddy site file and `.env` with restricted permissions.

Both staged and applied Caddy/Compose configurations validated. Only the Caddy container was recreated. External certificate-validated HTTPS probes returned 200 and `Document-Isolation-Policy: isolate-and-require-corp` for `/player.html` on 8450–8452; `/api/games` returned 200 on all three. The original 443 and 8444–8449 publications remain present, and the backend container remained healthy. The VPS Git checkout fast-forwarded to `0dd30f8`; the existing frontend/backend images were not rebuilt or replaced.

At the later application deploy, first preserve the current data volume and confirm `docker compose --env-file deploy/.env -f docker-compose.yml config --quiet`. When a build is explicitly requested for that task, rebuild and recreate the application containers with the nine-port `.env`, then verify that the served frontend bundle contains the nine-port configuration. Check all nine player document headers and API/ROM routing externally, then exercise nine simultaneous players in a browser, including profile-scoped launch/save, close, recovery and snapshot behavior. HTTP probes alone do not establish that browser renderer isolation or nine-player save behavior works.
