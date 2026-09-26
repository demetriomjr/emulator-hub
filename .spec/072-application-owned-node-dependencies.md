# Application-owned Node dependencies

`apps/backend` and `apps/frontend` are the npm projects. Each application declares and installs the external packages it uses in its own manifest and lockfile. `apps/` is only their parent directory and must not have a package manifest, lockfile, or installed dependencies.

The Redis persistence module accepts the backend's Redis client factory (or an existing client for tests). The Pokémon resource normalizer accepts the frontend's image processor. The backend and frontend pass those dependencies at their existing entry points. Tests that need those external packages live in the owning application. These two shared modules no longer resolve npm packages from `apps/node_modules`.

This change does not make every file in `apps/packages/` independent of npm packages. In particular, `pokemon-hub-ui.jsx` is a React UI module with frontend library imports under an earlier specification. Its placement requires a separate boundary decision.

The backend deployment installs from `apps/backend`, and the frontend deployment installs from `apps/frontend`. Both copy the shared source next to the application as before. Local setup likewise installs in each application directory. The existing Redis persistence, sprite output, and resource sync behavior must remain the same. Tests verify application dependency ownership and the injected adapters without running a project build.
