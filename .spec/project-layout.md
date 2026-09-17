# Initial project layout

- `apps/frontend`: React web presentation, also compiled for Electron.
- `apps/backend`: Node.js server for the first runnable slice; the long-term backend language remains a later architecture decision.
- `apps/electron`: desktop shell that loads the compiled frontend and consumes the backend through its eventual API.
- `apps/packages`: functionality below the presentation layer, compiled and consumed by the application targets where applicable.

Define concrete package boundaries, the backend API, emulator asset hosting, and compilation/deployment flows in later specifications before implementing them.
