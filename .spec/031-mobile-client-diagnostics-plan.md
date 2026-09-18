# Mobile client diagnostics implementation plan

**Goal:** Surface iPhone browser failures through the existing HTTPS proxy and backend without persisting sensitive application data.

**Architecture:** A reusable browser reporter sends a minimal allowlisted event to a package-owned in-memory store exposed by the backend. Caddy writes independent JSON access logs; the opaque session ID joins hub and iframe diagnostics.

**Tech stack:** Browser APIs, Node.js HTTP server and test runner, Caddy Caddyfile JSON logs.

**Spec:** `.spec/031-mobile-client-diagnostics.md`

## Global constraints

- Do not build the project.
- Do not change the user-owned Vite configuration edits.
- Diagnostics run only behind `debug=1` and must not carry save/ROM bytes, request/response bodies, credentials, or URL query strings.
- Backlog is in-memory, capped at 200 events, and process-local.

### Task 1: Package-owned diagnostic contracts

**Files:**
- Create: `apps/packages/client-diagnostic-store.mjs`
- Create: `apps/packages/client-diagnostic-store.test.mjs`
- Create: `apps/packages/client-diagnostics.mjs`
- Create: `apps/packages/client-diagnostics.test.mjs`

- [ ] Write failing store tests for allowlisted sanitization, newest-first bounded retention, and session filtering.
- [ ] Run those tests and verify they fail because the store is absent.
- [ ] Implement the minimal in-memory store and safe event normalizer.
- [ ] Write failing browser reporter tests for opt-in installation, error reporting, and shared session propagation helpers.
- [ ] Run the reporter tests and verify expected failure.
- [ ] Implement the minimal global error, promise rejection, and failed-fetch reporter.
- [ ] Run package tests.

### Task 2: Backend intake and backlog API

**Files:**
- Modify: `apps/backend/server.mjs`
- Modify: `apps/backend/test/server.test.mjs`

- [ ] Write failing HTTP tests for accepted sanitized diagnostics, session-filtered retrieval, malformed input, and method handling.
- [ ] Run the targeted backend test and verify expected failure.
- [ ] Wire the package store into `createHubServer`, then add the two routes and structured diagnostic logger.
- [ ] Run the targeted backend test and then the backend suite.

### Task 3: Browser bootstrap and Caddy correlation

**Files:**
- Modify: `apps/frontend/src/main.jsx`
- Modify: `apps/frontend/src/player.js`
- Modify: `tmp/caddy-lan/Caddyfile`

- [ ] Install the reporter in both documents only when debug mode is present.
- [ ] Pass the hub session ID into player iframe URLs without changing normal player URLs.
- [ ] Add a Caddy JSON access log output to the local-only configuration.
- [ ] Run the package tests and backend suite; validate the Caddyfile without starting or building the project.
