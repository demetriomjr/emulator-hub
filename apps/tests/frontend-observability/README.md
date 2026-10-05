# Frontend events and real Emerald RNG E2E

Runs Chromium with EmulatorJS 4.2.3, the verified original Emerald ROM and the registered IPS. Uses the production package modules and a disposable Nginx receiver, checks its stdout, and puts a trap behind `/api/` to detect accidental backend logging. No application build or production restart is performed.

Requires Python with Playwright/Chromium, an authorized private ROM, and Docker locally or a specifically authorized SSH Docker host. The image must contain Nginx 1.29 and its NJS module with QuickJS support. The existing frontend image was qualified for this test.

```powershell
python apps/tests/frontend-observability/run.py --rom "test-data/Pokemon Emerald.gba" --image emulator-hub-frontend --ssh-target USER@HOST --ssh-identity "PATH_TO_IDENTITY"
```

For local Docker, omit the SSH options. Evidence is written under ignored `test-data/frontend-observability/`. Original ROM/save/state bytes are not committed. Every run creates a unique container, directory, and ports; cleanup removes only those test resources.

Coverage includes fixed/advanced RTC seeds with independent expected-value calculation, soft/hard resets, unpatched seed-zero control, 5×, nine isolated player origins, actual shared-memory threads, offline delivery, cancellation, real browser errors/snapshot events, HTTP validation, log injection and request limiting. Every emitted reset is checked against its matching frontend stdout record.

Passive capture can miss an initial seed frame. This is tested as an explicit limitation: the seed remains null and current RNG samples/gaps/costs are recorded. The unpatched control preserves every missed attempt and requires an actual zero-seed proof within five attempts. Failure to qualify that control fails the suite.

Production deployment and actual dashboard collection are separate delivery checks. See `.spec/089-frontend-observability-and-rng-reset-probes.md` for measured results and limitations.
