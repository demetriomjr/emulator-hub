# Emulator Hub

## Project direction

- Build a multi-project emulator hub around Emulator.js.
- Target a web frontend, a backend, and an Electron application.
- Electron uses a precompiled web frontend and consumes the backend.
- All functionality below the presentation layer, whether used by frontend or backend, belongs in `apps/packages/`. The application projects compile and consume these packages.
- The application projects live in `apps/frontend`, `apps/backend`, and `apps/electron`, alongside `apps/packages/`.
- Keep application boundaries and package contracts explicit in `.spec/` before implementation. Follow spec-driven development for new features and architectural changes.

## Working rules

- Do not run project builds unless the user explicitly asks.
- Keep the project literally minimal. Implement only behavior and UI elements the user explicitly directs. Do not add decorative sections, extra pages, controls, or features on your own.
- The current web hub contains square boxes with cover artwork when available, a green button with a white Play icon, and a readable title and ROM metadata strip. Keep the dark green theme: minimalism applies to elements, not color or finish. Opening a game shows a proportional floating emulator container over the same screen, blocking the hub behind it; the container can close or enter fullscreen. There is no game details page.
- A game launch requires a selected backend-owned profile. A profile scopes the current browser-managed EmulatorJS save namespace; cloud save synchronization remains a separate later feature.
- The frontend uses React. The first runnable backend slice uses Node.js; the long-term backend language can be revisited before later specs.
- Do not assume a backend framework, deployment topology, or shared package contract until it is specified.
- Keep generated output, dependencies, local configuration, and secrets out of Git.
