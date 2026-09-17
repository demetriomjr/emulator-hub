# Emulator Hub

The hub shows one card per configured ROM. Play first asks the player to create or select a persistent profile, then embeds EmulatorJS on the same screen. Each profile/title pair has a separate browser-managed save namespace.

## Local development

1. Add an authorized ROM to `apps/backend/roms/` and a catalog entry with its independently trusted SHA-256 in `apps/backend/catalog.json`. See the [backend instructions](apps/backend/README.md) for the entry format. The ROM directory is ignored by Git.
2. Start the backend from `apps/backend` with `npm start` (default `http://127.0.0.1:3000`).
3. Install frontend dependencies from `apps/frontend` with `npm install`, then start it with `npm run dev -- --host 127.0.0.1` (default `http://127.0.0.1:5173`). The Vite dev server proxies API and ROM requests to the backend.
4. Open `http://127.0.0.1:5173/`. Reload after editing the catalog.

No project build is needed for this local flow. A game is marked playable only when its server-side ROM matches the catalog hash.
