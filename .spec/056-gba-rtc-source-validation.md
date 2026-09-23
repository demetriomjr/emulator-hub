# Spec 056 — GBA RTC source validation

## Goal

Determine whether the pinned EmulatorJS 4.2.3 GBA runtime obtains the emulated
RTC from the browser/host wall clock through `time(0)`, or from an internal
emulator/core clock.

This spec defines an investigation only. It does not add a virtual clock,
middleware, RTC override, ROM patch, or EmulatorJS/mGBA modification.

## Context

The Hub launches the `gba` core through `window.EJS_core`. EmulatorJS maps the
default GBA core to mGBA. In the mGBA RTC path, the fallback source calls
`time(0)` when no RTC source is injected. The project currently does not
configure an RTC source.

The test must verify the actual pinned browser runtime rather than infer the
result from source code alone.

## Test setup

- Runtime: EmulatorJS `4.2.3`, using the Hub's current `gba` core.
- Browsers: Chrome desktop first; repeat on Chrome iOS/WebKit if the runtime
  is supported there.
- Fast-forward: disabled.
- Save-state restore: disabled.
- Test page: a temporary diagnostic harness that installs the clock probe
  before appending EmulatorJS `loader.js`.
- Test ROM: the existing `test-data/Pokemon Ruby.gba`, used only to start the
  real GBA runtime. The game is not expected to display RTC values.

The diagnostic harness must record:

- browser and OS;
- EmulatorJS data URL and resolved core asset URL;
- real host time at launch;
- values returned by the clock probe;
- runtime surfaces exposed by `gameManager.Module`, including heap, exports,
  and known time/memory symbol candidates;
- timestamps for every RTC read observation.

## Procedure

### 1. Baseline host-clock observation

Run Pokémon Ruby with no clock override and record the runtime probe result as
the baseline. This confirms that the pinned GBA core started; it does not by
itself identify the RTC source.

### 2. Frozen browser-clock test

Before loading `loader.js`, temporarily replace the browser clock functions
used by the page with deterministic values:

```text
initial virtual Unix time: T
virtual time remains T for the entire observation
```

Do not replace `performance.now()`, requestAnimationFrame, timers, or any
emulator scheduling API.

Run the core long enough that the real host clock changes. Record the runtime
probe and any exposed time-related surface.

Expected interpretation:

- A directly exposed or wrapped time symbol changes with the synthetic clock:
  evidence that the core reaches the browser clock through that path.
- No such surface is exposed, or the core follows real time despite the
  frozen probe: continue to the runtime syscall/import inspection.

### 3. Synthetic minute-step test

Restart the harness with a virtual clock that returns `T`, then advances by
exactly 60 virtual seconds while less than 2 real seconds pass.

Record the runtime probe before and after the synthetic step.

Expected interpretation:

- An exposed time source advances by exactly one minute: browser-clock
  interception is controlling the source consumed by the core.
- No exposed time source changes: the core uses another time path or the
  relevant source is not reachable from the page.

### 4. Runtime source inspection if the probe fails

Inspect the actual EmulatorJS JavaScript glue and WASM instantiation path for
the pinned `gba`/mGBA asset. Determine whether the `time(0)` implementation is:

1. implemented through `Date.now()` or `Date`;
2. an imported WASM function/syscall whose imports can be wrapped before
   instantiation; or
3. compiled entirely inside the WASM/runtime with no page-level interception
   point.

Repeat the frozen-clock test using only the identified path if it is different
from `Date`.

## Evidence rules

- A matching host time at startup is not enough to identify the source.
- A frozen-clock result plus a synthetic-minute result is sufficient to classify
  an exposed source as browser/host-clock driven.
- A real-time RTC despite the frozen `Date` test is evidence against that hook,
  not proof of an internal clock until the runtime path is inspected.
- RNG outcomes, shiny results, reset counts, and frame counts are not valid
  primary evidence for this test.
- No system clock changes are permitted; all clock manipulation must remain in
  the temporary browser harness.

## Results

Record exactly one of these outcomes:

### `HOST_CLOCK_VIA_BROWSER_API`

The RTC follows the frozen and synthetic browser clock. The current runtime
reads its RTC source through a browser time API, and a browser-level virtual
clock is technically feasible without changing the core.

### `HOST_CLOCK_VIA_WASM_IMPORT`

The RTC follows a wrapped WASM/runtime time import, but not the initial browser
API probe. The exact import name and wrapping point must be recorded.

### `INTERNAL_OR_UNREACHABLE_CLOCK`

The RTC ignores the controlled browser and WASM import paths, or the runtime
does not expose a safe interception point. No middleware design may proceed
from this test alone; the result must document the blocking boundary.

## Acceptance criteria

1. The test identifies the actual time source used by the pinned EmulatorJS
   4.2.3 GBA runtime in at least one supported browser.
2. The result includes direct evidence from the actual EmulatorJS runtime
   surface; a game-screen RTC display is not a requirement.
3. The frozen-clock and synthetic-minute cases are both recorded.
4. The test does not modify EmulatorJS, mGBA, the ROM, save data, or the host
   operating-system clock.
5. The result names the precise interception layer, or explicitly records that
   no safe page-level interception point was found.
6. No implementation or build is required to close this validation spec.

## Out of scope

- Implementing the virtual clock.
- Changing fast-forward behavior.
- Changing RNG, TID, SID, or shiny odds.
- Adding a browser extension, backend endpoint, or native companion.
- Modifying or rebuilding EmulatorJS, mGBA, or a core.

## Harness implementation plan

The validation harness must be isolated under:

```text
test-data/gba-rtc-source-validation/
```

No production source, package, backend route, build configuration, or
dependency may be changed for this test.

### Planned harness files

```text
test-data/gba-rtc-source-validation/
├── README.md                         # local runbook and evidence checklist
├── harness.html                      # isolated browser entry point
├── harness.js                        # EmulatorJS bootstrap and test controls
├── browser-clock-probe.mjs           # reversible Date/Date.now probe
├── rtc-observation.mjs               # observation records and JSON export
├── rtc-diagnostic-manifest.json      # ROM identity and runtime-test metadata
├── run-harness.ps1                    # starts a static server; does not build the project
└── results/.gitkeep                   # reserved for manually captured evidence
```

The ROM and result files must remain scoped to this directory. The harness may
reference the pinned CDN loader and core, but it must not import the Hub player
or use production saves, profiles, snapshots, or backend APIs.

The harness accepts a ROM through a browser file picker or a local `rom` URL.
The existing Pokémon Ruby ROM is sufficient to exercise the real runtime; no
diagnostic RTC-display ROM is required.

### Harness behavior

`harness.html` loads only the harness module. `harness.js` must:

1. Parse `mode`, `speed`, and `rom` from the query string.
2. Install the selected clock probe before creating or appending the
   EmulatorJS `loader.js` script.
3. Configure the same pinned runtime values used by the Hub:

   ```js
   window.EJS_player = '#game'
   window.EJS_core = 'gba'
   window.EJS_gameUrl = '<object URL for rtc-diagnostic.gba>'
   window.EJS_pathtodata = 'https://cdn.emulatorjs.org/4.2.3/data/'
   window.EJS_startOnLoaded = true
   ```

4. Keep fast-forward disabled and never call `changeSettingOption` for
   `fastForward` or `ff-ratio`.
5. Show the raw browser clock sample, the probe mode, the resolved loader URL,
   the resolved core URL if available, and the runtime probe JSON.
6. Export an evidence JSON file through a user-initiated download. The export
   must contain the run configuration, probe samples, displayed RTC samples,
   browser user agent, and pass/fail classification.

### Clock probe contract

`browser-clock-probe.mjs` must expose:

```js
installBrowserClockProbe({ mode, initialUnixMs, speed })
  // returns { read(), restore() }
```

Supported modes:

- `real`: preserve the browser's original `Date` behavior;
- `frozen`: always return `initialUnixMs` from `Date.now()` and equivalent
  zero-argument `new Date()` calls;
- `step`: return `initialUnixMs + elapsedProbeMs * speed`, using the original
  `performance.now()` only to calculate the synthetic clock.

The probe must:

- preserve `performance.now()`, timers, animation frames, and scheduling;
- preserve `new Date(value)`, `Date.parse`, `Date.UTC`, and constructor calls
  with explicit arguments;
- expose `restore()` for cleanup;
- record every synthetic time value returned;
- fail closed if the browser does not allow the targeted replacement.

### Runtime observation

`rtc-observation.mjs` may collect timestamped manual observations, but the
primary evidence is the runtime probe. It must not imply that Pokémon Ruby
displays the RTC or that a screenshot proves the RTC source.

The harness must not infer RTC values from shiny results, Pokémon PID values,
frame numbers, reset timing, or save data.

### Local run command

`run-harness.ps1` must serve only this subdirectory with a static HTTP server.
The planned command is:

```powershell
python -m http.server 41756 --bind 127.0.0.1 --directory .
```

The runbook must explain that the command is executed from
`test-data/gba-rtc-source-validation/`, then opened at:

```text
http://127.0.0.1:41756/harness.html?mode=real
```

No project build, bundler, package installation, or production server is
required.

### Required runs

The runbook must require these three independent browser runs:

```text
mode=real
mode=frozen&initialUnixMs=<T>
mode=step&initialUnixMs=<T>&speed=30
```

The step speed is intentionally chosen so that a one-minute virtual RTC jump
occurs in roughly two real seconds. The exact observed RTC transition must be
recorded; wall-clock display refresh latency must not be treated as a core
failure.

### Runtime import fallback

If `mode=frozen` does not freeze the diagnostic ROM's RTC, the harness work
must stop before implementing any virtual clock. The next diagnostic artifact
must record the actual JavaScript/WASM time import used by the pinned runtime.
Only after identifying that import may the harness add a temporary wrapper for
that import and repeat the frozen and step runs.

### Evidence layout

Captured files must use this structure:

```text
test-data/gba-rtc-source-validation/results/
├── README.md
├── <date>-real.json
├── <date>-frozen.json
├── <date>-step.json
└── screenshots/
    ├── <date>-real.png
    ├── <date>-frozen.png
    └── <date>-step.png
```

Evidence is valid only when the three JSON records include matching browser
clock samples and the runtime probe output. Screenshots are optional visual
evidence of the harness state.

### Harness acceptance criteria

1. A fresh browser tab can run the harness from the static server without the
   Hub backend or production frontend.
2. The `real` run starts the existing Pokémon Ruby ROM and records the runtime
   probe.
3. The `frozen` run records whether any exposed time surface follows the
   selected synthetic value while real host time advances.
4. The `step` run records whether any exposed time surface crosses the planned
   virtual minute boundary.
5. `performance.now()` and emulator scheduling remain unmodified.
6. `restore()` returns the page to the original browser clock behavior.
7. Each run can be exported as JSON and paired with a screenshot.
8. A failing browser-clock probe produces a recorded `HOST_CLOCK_VIA_WASM_IMPORT`
   or `INTERNAL_OR_UNREACHABLE_CLOCK` result instead of silently passing.
