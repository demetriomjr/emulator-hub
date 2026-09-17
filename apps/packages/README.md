# Shared packages

Put reusable code below the presentation layer here, regardless of whether its first consumer is the frontend or backend. These packages are compiled with and consumed by the applications in `apps/`. Define package boundaries and public contracts in `.spec/` before adding implementations.

`profile-store.mjs` persists and validates player profiles for backend use. `hub-client.js` is the browser client for catalog, profile, and launch APIs. The profile-selected launch descriptor provides a stable profile/title-specific EmulatorJS game ID; cloud synchronization is intentionally outside this package's current contract.
