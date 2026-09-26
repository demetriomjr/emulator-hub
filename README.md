# Emulator Hub

The hub shows one card per configured ROM. Play first asks the player to create or select a persistent profile, then embeds EmulatorJS on the same screen. Each profile/title pair has a separate browser-managed save namespace.

## Local development

1. Add an authorized ROM to `apps/backend/roms/` and a catalog entry with its independently trusted SHA-256 in `apps/backend/catalog.json`. See the [backend instructions](apps/backend/README.md) for the entry format. The ROM directory is ignored by Git.
2. Configure `HOST` and `PORT` in `apps/backend/.env`, install backend dependencies from `apps/backend` with `npm install`, then start it there with `npm start` (the provided local configuration is `http://127.0.0.1:3001`).
3. Configure `HOST`, `PORT`, and `BACKEND_URL` in `apps/frontend/.env`, install frontend dependencies from `apps/frontend` with `npm install`, then start it with `npm run dev` (the provided local configuration is `http://127.0.0.1:5173`). The Vite dev server proxies API and ROM requests to `BACKEND_URL`.
4. Open `http://127.0.0.1:5173/`. Reload after editing the catalog.

No project build is needed for this local flow. A game is marked playable only when its server-side ROM matches the catalog hash.
