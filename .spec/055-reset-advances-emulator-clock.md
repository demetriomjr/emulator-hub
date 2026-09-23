# Spec 055 — Profile-scoped odds manipulator clock

## Goal

Provide an optional **Odds Manipulator** control for reset-based shiny hunts.
The feature controls only the date, hour, and minute supplied to the emulator's
RTC/SID path. It does not simulate realistic elapsed time.

When the feature is enabled for a profile, the virtual clock is a frozen
logical timestamp. Every accepted hard reset or soft reset advances that
timestamp by exactly one minute. The resulting minute count is persisted with
the profile so closing and reopening the game continues from the same point.

## User workflow

```text
open the game/profile normally
→ click Odds Manipulator in the player header
→ enable it for the active profile
→ perform hard or soft resets during the hunt
→ each reset advances that profile's logical clock by one minute
→ close/reopen the game
→ enable the manipulator again
→ continue from the profile's persisted minute count
```

There is no date picker, time picker, increment picker, or manual timestamp
entry. The initial logical timestamp is always derived from the persisted
profile counter.

## Current application context

- The React hub opens each game/profile in an independent same-origin
  `player.html` iframe.
- The parent header broadcasts reset commands to active frames.
- Hard Reset uses `emulator-hub:reset` and calls the existing
  `gameManager.restart()` path.
- Soft Reset uses `emulator-hub:soft-reset` and the existing
  A+B+Start+Select sequence, with the current 120 ms hold interval.
- L2/R2 trigger actions already dispatch reset commands only on a press edge.
- `player.js` configures EmulatorJS and appends `loader.js` dynamically.
- EmulatorJS/mGBA reads the JavaScript clock in the player iframe during reset
  and core startup according to the validated runtime behavior.
- Profiles are currently scoped by catalog game ID. The persistent odds state
  therefore belongs to the `(gameId, profileId)` pair, even though the UI calls
  it the profile's state.

## Core clock semantics

### Normal mode

- The Odds Manipulator is disabled by default.
- `Date.now()` remains the native browser/system clock.
- Hard and soft resets do not change the persisted odds counter.
- Existing saves, snapshots, leases, controls, and EmulatorJS behavior remain
  unchanged.

### Manipulator mode

- The clock is not based on real elapsed time.
- The clock is fixed between resets.
- The logical timestamp is derived from the persisted reset count:

```text
logicalTimestampMs = oddsResetCount * 60_000
```

- A new profile has `oddsResetCount = 0`, which means Unix timestamp `0`.
- The timestamp zero is only the default for a profile with no prior odds
  manipulation. It is not a global reset applied to every profile.
- Every accepted reset increments the profile count by one and changes the
  logical timestamp by exactly 60,000 milliseconds.
- The clock does not add real milliseconds between resets.
- Seconds and sub-minute elapsed time are intentionally irrelevant to this
  feature because the target SID/RNG behavior consumes date, hour, and minute.

The player-side wrapper must therefore return a fixed provider value while the
feature is active. It must not use the earlier continuously advancing model:

```js
const realNow = Date.now.bind(Date)
let virtualTimestamp = realNow()
let manipulatorEnabled = false

Date.now = () => manipulatorEnabled ? virtualTimestamp : realNow()
```

The exact implementation may differ, but the behavior must remain equivalent.
The native `Date.now` reference must be retained so disabling the feature
restores normal time without recursion.

## Persisted profile state

Each profile record must gain a validated odds-manipulation field, for example:

```json
{
  "id": "profile-id",
  "name": "May",
  "createdAt": "2026-09-23T00:00:00.000Z",
  "oddsResetCount": 0
}
```

Requirements:

- The field is an integer greater than or equal to zero.
- Missing legacy values migrate to zero in memory and are persisted on the next
  profile write or explicit odds-state update.
- The counter is stored with the backend profile record, not in save bytes,
  emulator snapshots, cookies, browser local storage, or frontend-only state.
- Renaming a profile preserves the counter because the profile ID is stable.
- Deleting a profile deletes its counter with the profile.
- Creating a new profile always starts at zero.
- The counter is not shared between different game IDs, even if profile names
  are equal.
- The backend is the source of truth when the profile picker is refreshed or a
  new player session is opened.

## Profile synchronization contract

The Odds Manipulator is controlled by the frontend, but the frontend cannot
write Redis directly. The active player keeps the live counter locally and
synchronizes it asynchronously with the backend profile. The local counter is
authoritative for the currently open session; the backend value is the durable
checkpoint used when the profile is loaded again.

The existing profile collection/list response must expose `oddsResetCount`. The
existing save/close payloads must also carry the latest counter when available,
so those already-existing backend flows persist it together with their other
profile/session data. This does not turn the binary save payload into profile
state: it is only an additional profile metadata field handled by the backend.

In addition, the frontend must use a lightweight profile synchronization
operation for an active session, conceptually:

```http
PATCH /api/games/{gameId}/profiles/{profileId}/odds-state
```

```json
{ "oddsResetCount": 51 }
```

The exact route may follow the existing API naming, but the operation must only
validate and persist the odds counter for that profile. It must not save ROM
bytes, create a snapshot, reset the emulator, or wait for a user-visible
response. It must use the existing game/profile identity and lease validation.

The backend must validate a non-negative integer and must not allow a stale
lower value to overwrite a newer counter. Because the counter only moves
forward, the storage transition may use a monotonic `max(existing, incoming)`
write under the existing profile/lease guard. The response remains observable
for diagnostics, but reset execution must not await it.

The frontend must:

1. read the current counter from the profile data already loaded for the active
   game/profile;
2. increment that value locally by one for an accepted reset;
3. derive `virtualTimestamp = oddsResetCount * 60_000` immediately;
4. apply the timestamp and execute the existing reset immediately; and
5. mark the local counter dirty for asynchronous synchronization.

The backend must validate that the profile exists, the counter is a
non-negative integer, and the update preserves the stable profile identity.
The profile lease already prevents another player session from using the same
game/profile concurrently. Profile editing is disabled while that lease is
active, and the lightweight synchronization operation must retain that guard.

The backend still performs the actual Redis write; “frontend-controlled” means
the UI initiates and owns the session workflow, not that the browser bypasses
the backend or connects to Redis.

Multiple resets are coalesced. While the counter is dirty, the latest absolute
value is sent approximately every 30 seconds. A response is not required to
continue resetting; a failed request keeps the counter dirty for a later retry
and is reported to diagnostics/status without interrupting the emulator.

The sync timer must not be a global queue: different profiles may synchronize
in parallel. For one profile, only one request may be in flight; resets that
occur while it is pending update the next payload to the newest local value.

## Reset transaction and ordering

When the Odds Manipulator is active, a reset has one synchronous local phase
and one asynchronous persistence phase:

1. Read the selected profile's current local counter from the parent session.
2. Increment it exactly once and derive the next logical timestamp.
3. Apply that timestamp to the player iframe.
4. Execute the existing hard or soft reset immediately.
5. Mark the profile counter dirty for the periodic sync and future flushes.

The reset must not wait for a backend response and must not fail merely because
Redis or the profile endpoint is temporarily unavailable. If persistence fails,
the local counter remains ahead and is retried. A browser crash before a sync
can lose only the not-yet-persisted tail of resets; this bounded loss is an
accepted first-version tradeoff. The backend must still prevent a later stale
payload from moving the durable counter backwards.

When the Odds Manipulator is disabled, the existing reset flow remains
unchanged and does not update the profile counter.

The latest dirty counter must be included opportunistically in the existing
save and close flows. Those flows may also perform a best-effort odds flush
before releasing the player lease, but a timeout or failure must not block the
normal emulator close path. Disabling the toggle stops new increments and may
trigger the same best-effort flush; it does not reset or rewrite the counter.

The increment must happen once per accepted reset command, not once per
simulated soft-reset input. The existing soft reset still presses A, B, Start,
and Select together, holds them for 120 ms, and releases them.

## Parent/player protocol

The parent must send an explicit configuration message to each active player
when enabling the feature or when a new iframe becomes ready, for example:

```js
{
  type: 'emulator-hub:odds-manipulator-configure',
  enabled: true,
  virtualTimestamp: 3000000,
  oddsResetCount: 50
}
```

For a reset, the parent must provide the locally advanced timestamp before the
existing reset command is executed, for example:

```js
{
  type: 'emulator-hub:reset',
  virtualTimestamp: 3060000,
  oddsResetCount: 51
}
```

The exact message names may be adjusted to match the existing protocol, but:

- reset message names must remain compatible with current header and L2/R2
  behavior where possible;
- messages must be accepted only from `window.parent` and the same origin;
- the player must validate finite non-negative integer counts and timestamps;
- the timestamp must equal `oddsResetCount * 60_000`;
- stale or malformed timestamp/count pairs must be ignored;
- a reset message must not advance the profile counter from inside the iframe;
- the iframe must not write profile data directly to backend storage.

## Player clock lifecycle

The player must install a safe clock provider before appending `loader.js`, but
it starts in native mode:

1. Capture the native `Date.now` function.
2. Create the provider with `manipulatorEnabled = false`.
3. Complete the existing launch descriptor, ROM, save, and snapshot loading.
4. Configure all `EJS_*` globals.
5. Install the `Date.now` dispatch wrapper before appending `loader.js`.
6. Append `loader.js` and start EmulatorJS normally.
7. If the parent later activates the manipulator, set the fixed timestamp in the
   player context without performing a reset.
8. On the next accepted reset, use the timestamp supplied by the backend
   increment operation before restarting the core.

The wrapper must not change `performance.now()`, timer scheduling, `Date`
constructor behavior, backend lease time, save revisions, or snapshot
timestamps. The virtual clock is only a browser-side input to EmulatorJS/mGBA.

## Header behavior

- Add one header control for Odds Manipulator.
- The control opens a minimal enable/disable action or confirmation surface;
  it does not open date/minute inputs.
- Enabling reads the selected active profile's current counter and applies its
  derived timestamp.
- The control visibly indicates whether manipulation is active.
- Disabling stops future counter increments and restores native clock behavior
  for the player context. If returning immediately to native time could move
  the running emulated clock backwards, the implementation must first define a
  safe transition; it must not silently create an unexpected reset condition.
- Enabling or disabling never saves game state, loads a state, or performs a
  reset automatically.
- The feature must remain usable on the existing mobile header layout.

## Multiple instances

- The active profile identity is `(gameId, profileId)` for each iframe.
- A header activation applies the current profile counter to each targeted
  active iframe.
- A broadcast reset must increment each distinct active profile exactly once.
- Existing multi-instance selection rules already prevent reusing a profile
  that is active in another instance; the implementation must preserve that
  invariant.
- A newly added iframe loads the current persisted counter for its own profile.
- Different profiles may have different counters and therefore different
  logical timestamps.

## Persistence and session restart

Closing the player does not lose progress because the counter is stored with
the backend profile. Reopening the same game/profile and enabling the Odds
Manipulator reads the saved counter and resumes at the corresponding logical
minute. No save-state or emulator snapshot restoration is involved.

The feature is not automatically active merely because a profile has a
non-zero counter. The user must click the Odds Manipulator control again.

The enabled/disabled toggle is strictly session state:

- it exists only in the active React player session and live player iframes;
- it is not stored in user preferences;
- it is not stored in the profile record alongside `oddsResetCount`;
- it is not stored in cookies, local storage, IndexedDB, saves, snapshots, or
  cloud-save metadata;
- closing the emulator discards the toggle state;
- reopening the emulator always starts with the toggle disabled;
- a user may leave while the counter is non-zero and later continue normally
  without first having to disable anything.

The persisted counter and transient toggle are intentionally independent:

```text
profile.oddsResetCount      → persistent progress for future hunts
session.oddsManipulatorOn   → temporary permission for this open player only
```

## Error and concurrency behavior

- If the profile cannot be loaded, the manipulator cannot be enabled.
- A profile sync failure does not cancel or delay the reset; it leaves the local
  counter dirty and schedules another attempt.
- If the lease is lost, the sync is rejected and the player follows the
  existing lease-loss behavior; no further durable progress is claimed.
- Syncs for different profiles may run in parallel.
- For one profile, the sync coordinator allows one in-flight request and
  coalesces newer local values into the next request. This is not a global reset
  queue and does not delay independent profiles.
- If the parent receives two reset triggers for the same profile, the local
  timestamps are consecutive minutes even if their persistence requests are
  coalesced.
- Backend persistence errors must be observable in diagnostics/status, but must
  never block the live emulator reset.
- Profile deletion must be blocked or coordinated while its player lease is
  active, using the existing profile lease protections.

## Acceptance criteria

1. A normal player launch starts with the Odds Manipulator disabled and native
   browser time.
2. A new profile has odds counter zero and derived timestamp zero.
3. Enabling the feature requires no date, hour, minute, or increment input.
4. Enabling a profile with counter `50` configures timestamp `3,000,000` ms.
5. Each accepted hard reset increments the local counter once, applies its
   timestamp immediately, and schedules asynchronous persistence.
6. Each accepted soft reset increments the local counter once and preserves
   the existing A+B+Start+Select sequence.
7. Fifty resets result in counter `50`; the next reset uses counter `51`.
8. The logical clock remains fixed between resets; real elapsed milliseconds do
   not change it.
9. Closing and reopening the same game/profile resumes from the persisted
   counter when the user enables the feature again.
10. Different profiles maintain independent counters.
11. A failed or delayed sync does not prevent a reset; the dirty counter is
    retried and stale lower payloads cannot regress the durable value.
12. Existing normal reset behavior is unchanged while the feature is disabled.
13. Save bytes, snapshots, profile names, profile IDs, and lease data remain
    unaffected except for the new persisted odds counter field.
14. Enabling the header toggle does not reset, save, load, or simulate input;
    it only arms the next Hub reset.
15. Disabling the header toggle does not reset or increment the profile and
    returns the iframe to native clock mode for future operation.
16. Header Soft Reset, header Hard Reset, L2 Soft Reset, and L2/R2 Hard Reset
    all use the same reset dispatcher and increment behavior.
17. A held L2/R2 trigger cannot cause duplicate backend increments or resets.
18. The toggle is rendered beside/after Controller Settings with enabled and
    disabled accessibility and visual states.
19. Closing and reopening a player always returns the toggle to disabled,
    regardless of the persisted profile counter or previous session state.
20. User preferences, cookies, browser storage, saves, snapshots, and profile
    records contain no enabled/disabled toggle state.

## Verification plan

- Unit-test the clock provider in native mode and frozen manipulator mode.
- Test timestamp derivation for counters zero, one, fifty, and large valid
  values.
- Test that time does not advance between resets even when the injected real
  clock advances.
- Test profile-store creation, migration, read, serialized increment, rename, and
  deletion behavior.
- Test 30-second sync coalescing, one in-flight request per profile, parallel
  sync for different profiles, retry after failure, and best-effort flush from
  save/close/disable flows.
- Test parallel updates for different profiles and serialized updates for the
  same profile.
- Test frontend activation/deactivation without implicit reset or save.
- Test the header toggle's placement, labels, enabled/disabled state, and
  no-op-on-toggle behavior.
- Test a close/reopen lifecycle always starts with the toggle disabled while
  retaining only the persisted profile counter.
- Test hard and soft reset ordering: local increment, timestamp application,
  reset operation, then asynchronous persistence scheduling.
- Test that header and L2/R2 reset paths call the same dispatcher.
- Test reset behavior when the profile update fails or the player lease is
  lost.
- Test multi-instance broadcasts with distinct profile counters.
- Test closing and reopening a profile resumes its persisted counter.
- Manually validate a SID/RNG-visible GBA title at counter zero, after several
  hard resets, after several soft resets, and after reopening the profile.
- Run relevant focused tests and `git diff --check`; do not run a project build
  unless explicitly requested.

## Implementation checklist

- [ ] Define the profile field and migration default of zero.
- [ ] Extend profile read/update validation with `oddsResetCount`.
- [ ] Preserve active-lease validation and add monotonic odds-state persistence.
- [ ] Include the latest counter in existing save/close payloads without
      coupling reset execution to their responses.
- [ ] Add the lightweight odds-state sync operation and validate its payload.
- [ ] Add a 30-second dirty-counter sync timer with retry and coalescing.
- [ ] Add best-effort flushes on save, close, disable, and relevant page
      lifecycle events.
- [ ] Expose the counter in profile-list responses.
- [ ] Add the minimal Odds Manipulator header control.
- [ ] Keep its default state disabled and avoid date/minute configuration UI.
- [ ] Add parent session state for the active profile configuration.
- [ ] Keep toggle state strictly in active session memory; do not add it to
      user preferences, profile persistence, cookies, or browser storage.
- [ ] Add validated player configure/timestamp messages.
- [ ] Install the fixed/native Date.now provider before `loader.js`.
- [ ] Increment locally before hard reset and before soft-reset input begins.
- [ ] Preserve existing reset messages, input IDs, hold timing, and press-edge
      behavior.
- [ ] Add focused package, backend, frontend, and integration tests.
- [ ] Verify the complete diff and tests before claiming completion.

## Technical analysis — phase 1: emulator wireframe and engine boundary

### Confirmed current wireframe

The current player is already an isolated document per active game/profile.
The first implementation should use that boundary instead of modifying the
EmulatorJS runtime files or the React parent clock.

```text
React hub (parent window)
  ├─ profile picker selects (gameId, profileId)
  ├─ lease launch returns sessionId/generation and profile-scoped descriptor
  ├─ player header renders reset and control actions
  ├─ Odds Manipulator reads persisted profile counter
  └─ active player grid
       ├─ iframe: /player.html?...gameId...profileId...sessionId...
       │    └─ player.html document
       │         ├─ player.js creates clock provider
       │         ├─ player.js fetches launch/save/snapshot data
       │         ├─ player.js sets EJS_core and other EJS_* globals
       │         ├─ player.js installs Date.now dispatch wrapper
       │         ├─ player.js appends EmulatorJS loader.js
       │         └─ EmulatorJS → Emscripten → selected core engine
       └─ reset command messages are sent to each target iframe
```

The parent owns profile persistence and reset sequencing. Each iframe owns the
actual JavaScript clock value observed by its EmulatorJS/Emscripten runtime.
The parent must never replace its own `Date.now()` because that would corrupt
React, fetch coordination, profile polling, and unrelated player instances.

### Activation wireframe

The header control is a session action, not a date/time editor:

```text
[Odds Manipulator: off]
        │ click
        ▼
parent identifies active (gameId, profileId)
        │ GET/current profile metadata
        ▼
profile oddsResetCount = N
        │ derive virtualTimestamp = N * 60_000
        ▼
send configure message to the matching iframe
        │ no reset
        ▼
iframe freezes Date.now() at virtualTimestamp
        │
        ▼
[Odds Manipulator: on]
```

For a multi-instance session, the parent repeats the operation per active
`(gameId, profileId)` pair. A profile's counter is never inferred from another
iframe's local state.

### Reset wireframe while disabled

```text
header or L2/R2 press edge
  → existing reset message
  → iframe uses native Date.now()
  → existing hard restart or soft input sequence
```

### Reset wireframe while enabled

```text
header or L2/R2 press edge
  → parent resolves target (gameId, profileId, session lease)
  → serialized profile update for that profile
  → backend persists and returns N + 1 and (N + 1) * 60_000
  → parent sends timestamp/configuration to target iframe
  → iframe sets its frozen Date.now() value
  → iframe executes existing hard or soft reset
```

The backend increment is the commit point. A network failure, lease failure,
stale response, or invalid counter must stop the reset before EmulatorJS is
restarted. The iframe must never guess the next counter locally.

### Responsibilities by layer

| Layer | Responsibility | Must not do |
| --- | --- | --- |
| React parent | Render control, identify active profiles, call backend, coordinate reset ordering, send iframe messages | Replace parent `Date.now()` or maintain authoritative counters only in React state |
| Hub client package | Typed profile metadata and serialized odds-counter profile updates | Hide conflicts or blindly apply a second local increment |
| Backend route/service | Validate profile/game/lease, persist the profile counter, return derived timestamp | Read/write the counter as a frontend-controlled arbitrary timestamp |
| Profile store | Store and migrate `oddsResetCount` per game-scoped profile | Store emulator save bytes or runtime snapshots in the profile field |
| Player iframe | Maintain fixed/native clock mode, validate parent messages, apply returned timestamp, execute reset | Increment backend state or derive a new counter independently |
| EmulatorJS boundary | Receive the browser clock through the existing Emscripten path | Require changes to ROMs, save format, or core source for the first version |

## Engine and core compatibility analysis

### Engine selection currently present in the project

The reusable ROM registry currently recognizes these system/core pairs:

| Catalog system | Catalog core | EmulatorJS path | Odds Manipulator status |
| --- | --- | --- | --- |
| `gba` | `gba` | GBA EmulatorJS runtime mapped to mGBA | First implementation target; SID/RNG use case |
| `gb` | `gambatte` | Gambatte Game Boy runtime | Not enabled until RTC behavior is separately verified |
| `gbc` | `gambatte` | Gambatte Game Boy Color runtime | Not enabled until RTC behavior is separately verified |

The active catalog currently contains a Pokémon Emerald GBA entry. The registry
being generic does not mean every registered engine is compatible with the
feature. Compatibility must be decided from `(system, core)` metadata and not
from a title-specific branch.

### Common integration layer

The `Date.now()` wrapper belongs to the generic player-side clock provider
because all engines execute inside the same `player.html` JavaScript context.
The provider has three modes of concern:

1. native mode: return the original browser clock;
2. frozen odds mode: return the profile-derived logical timestamp; and
3. reset update: replace the frozen value with the atomically returned next
   profile timestamp.

The provider itself must not claim that every engine consumes the value. The
engine compatibility policy decides whether the header control is available.

### GBA/mGBA path

For the first implementation:

1. backend catalog entry identifies `system: gba` and `core: gba`;
2. `player.js` assigns `window.EJS_core = launch.core`;
3. the provider is installed before `loader.js` runs;
4. EmulatorJS loads the GBA runtime and mGBA through Emscripten;
5. mGBA's RTC/SID path reads the frozen `Date.now()` value during startup/reset;
6. the reset operation consumes the newly assigned profile timestamp.

This is the only engine path included in the first acceptance target. The
implementation must test at least one RTC/SID-visible GBA title and verify that
the date/hour/minute observed in the game corresponds to the profile counter.

### Gambatte GB/GBC path

The current generic registry also permits `gambatte`, but this spec does not
assume that Gambatte's time behavior is identical to mGBA's. The wrapper may be
present in the player context, yet the Odds Manipulator control must remain
hidden or disabled for `gb`/`gbc` until all of the following are proven:

- the selected EmulatorJS/Gambatte build reads the substituted browser clock;
- its RTC behavior is reset-compatible with the desired one-minute stepping;
- a test ROM or supported title observes the expected date/hour/minute; and
- the behavior does not break existing save, snapshot, or reset flows.

Enabling Gambatte later requires only a compatibility-matrix update if the
generic provider contract remains sufficient. A core-specific adapter is
required if Gambatte exposes a different clock import or needs a different
reset boundary.

### Engine metadata contract

The launch descriptor or catalog metadata must make compatibility explicit. The
frontend must not infer support from the display name or ROM filename. A future
normalized field may be equivalent to:

```json
{
  "system": "gba",
  "core": "gba",
  "oddsManipulator": {
    "supported": true,
    "clockMode": "frozen-minute",
    "resetStepMs": 60000
  }
}
```

For unsupported engines, the field is absent or reports `supported: false`.
The backend remains authoritative for launch metadata; the frontend uses it to
render or suppress the control.

## Technical questions resolved for this phase

- **Where is the clock installed?** In every `player.html` iframe, before
  `loader.js`; never in the React parent.
- **Where is the authoritative progress?** In the backend profile's persisted
  `oddsResetCount`, keyed by game and profile.
- **What does the player receive?** A validated frozen timestamp derived from
  the committed counter, not an instruction to add time locally.
- **What advances the counter?** Only an accepted hard or soft reset while the
  feature is active.
- **What happens between resets?** The virtual timestamp remains fixed.
- **Which engine is in scope now?** GBA/mGBA. Gambatte is a documented future
  compatibility case, not an implicit first-version target.
- **What happens on normal launch?** Native clock and existing behavior.
- **What happens on close/reopen?** The backend counter is retained; the
  manipulator is manually re-enabled and resumes from the saved counter.

## Technical questions deferred

- Whether unsupported engines hide the control entirely or show a disabled
  explanation.
- Whether a future engine requires an explicit Emscripten import adapter instead
  of the generic browser clock wrapper.

## Technical analysis — phase 2: reset injection and header interaction

### Reset entry points in the current player

The feature must be inserted at the existing parent-side reset dispatch
boundary. There are four user-facing paths, but only two reset commands:

| User action | Current parent path | Message | Required Odds Manipulator path |
| --- | --- | --- | --- |
| Header Soft Reset button | header callback → broadcast helper | `emulator-hub:soft-reset` | route through shared soft-reset dispatcher |
| Header Hard Reset button | header callback → direct frame loop | `emulator-hub:reset` | route through shared hard-reset dispatcher |
| L2/R2 configured Soft Reset | trigger action press edge → dispatch callback | `emulator-hub:soft-reset` | route through the same shared soft-reset dispatcher |
| L2/R2 configured Hard Reset | trigger action press edge → dispatch callback | `emulator-hub:reset` | route through the same shared hard-reset dispatcher |

The implementation must not add a second reset mechanism to the emulator core.
It must centralize the two parent actions so the header and L2/R2 paths cannot
diverge in clock behavior.

EmulatorJS's own internal reset controls are outside this phase. They are not
part of the Hub's current reset contract and may be removed later. The first
implementation only covers reset functions called by Hub buttons and Hub L2/R2
shortcuts.

### Planned shared reset dispatcher

Introduce a parent-side operation conceptually equivalent to:

```text
dispatchReset(kind)
  kind = "soft-reset" or "reset"
```

The operation must:

1. identify the active player frames and their `(gameId, profileId)` pairs;
2. if the Odds Manipulator is disabled, send the existing reset message to
   each eligible frame with no backend counter operation;
3. if enabled, increment the local counter once for each distinct active
   profile and mark each counter dirty;
4. send each locally derived timestamp/configuration to the matching iframe;
5. let each iframe execute the existing reset operation for `kind`; and
6. allow the periodic or save/close flush to synchronize the latest counters.

The header and trigger-action code must call this dispatcher rather than
calling `broadcastPlayerMessage()` or a direct hard-reset loop for reset kinds.
Non-reset actions such as save state, load state, and fast-forward retain their
current dispatch paths.

### Toggle timing semantics

The header toggle is an arm/disarm control only:

```text
Odds Manipulator OFF
  → user clicks toggle
  → read current profile counter/configuration
  → send frozen timestamp to player
  → no reset, no save, no counter increment
  → Odds Manipulator ON
```

When enabled, the next user-triggered Hub reset is the first operation that
increments the local counter. Enabling must not call hard reset, soft reset,
`gameManager.restart()`, `softResetEmulator()`, or any simulated input.

```text
Odds Manipulator ON
  → user prepares the game
  → user clicks Soft Reset/Hard Reset or presses configured L2/R2
  → shared dispatcher performs the increment and reset
```

Disabling also performs no reset and no counter increment:

```text
Odds Manipulator ON
  → user clicks toggle off
  → send native-clock mode to the relevant player frames
  → no reset, no save, no counter mutation
  → future Hub resets use the normal path
```

The player must leave the emulator running when disabled. Its `Date.now`
provider returns to the captured native clock, allowing the ordinary emulator
clock path to continue. No artificial rewind, reset, or timestamp persistence
is performed during disable.

### Header placement and visual contract

The new toggle is the final control in the existing left-side header control
stack, immediately beside/after the Controller Settings control. It is not a
new page, modal workflow, or date configuration surface.

The control follows the existing Fast Forward toggle conventions:

- icon button with an accurate `aria-label` and matching `title`;
- distinct enabled and disabled visual states;
- enabled state means only that the next Hub reset will manipulate the profile
  clock;
- disabled state means Hub resets remain completely normal;
- clicking it does not reset, save, load, or otherwise interrupt the game;
- it remains available in the existing mobile header layout;
- the button is unavailable or visually disabled when the active session has no
  supported engine/profile context.

The header does not show a date, time, minute amount, reset count editor, or
manual timestamp field. The persisted counter is an implementation detail of
the selected profile.

### Parent/iframe toggle messages

The parent needs two explicit player commands conceptually equivalent to:

```js
{
  type: 'emulator-hub:odds-manipulator',
  enabled: true,
  virtualTimestamp: profile.oddsResetCount * 60000,
  oddsResetCount: profile.oddsResetCount
}
```

and:

```js
{ type: 'emulator-hub:odds-manipulator', enabled: false }
```

These commands only change the iframe's clock mode. They must not invoke a
reset. Reset commands may include the locally advanced timestamp, or the
timestamp may be sent as a separate immediately preceding command; the
implementation must make the ordering explicit and test it. Backend
synchronization runs independently of this message ordering.

All player messages continue to require same-origin and `window.parent` source
validation. A stale timestamp or profile identity must not change the iframe's
clock.

### Multi-instance dispatch rules

- The toggle state is held by the active player session in the parent.
- Each iframe retains its own current clock mode and timestamp.
- Enabling/disabling broadcasts the mode change to all supported active frames.
- A reset dispatcher increments each distinct active `(gameId, profileId)` once.
- A frame with an unsupported engine or missing profile is skipped without
  mutating any profile counter.
- One profile counter must never be incremented once per frame if the same
  profile somehow appears more than once; the existing profile-exclusion rule
  remains the normal protection.
- If one profile sync fails during a multi-instance broadcast, that profile's
  local reset still executes and remains dirty for retry; other profiles remain
  independent and are not rolled back.

### Shortcut behavior and press edges

The existing `createPlayerTriggerActions()` remains responsible for detecting
L2/R2 press edges. Its reset dispatch callback changes from a generic message
sender to the shared reset dispatcher. It must continue to guarantee:

- a held L2/R2 does not repeat the reset;
- releasing and pressing again produces one new reset request;
- L2 and R2 can independently be assigned Soft Reset or Hard Reset;
- save-state, load-state, and Fast Forward assignments are unaffected; and
- a failed backend increment does not create a second reset when the same
  physical trigger remains held.

### Phase 2 implementation sequence

1. Add the parent session toggle state and the header button beside Controller
   Settings.
2. Add typed hub-client operations for reading/updating the selected profile
   counter and configuring/disabling a player iframe.
3. Extract the existing direct soft/hard reset callbacks into one shared parent
   reset dispatcher.
4. Route header Soft Reset, header Hard Reset, and L2/R2 reset actions through
   that dispatcher.
5. Keep the disabled path byte-for-byte equivalent in behavior to the current
   reset messages.
6. Add the iframe clock-mode message handler without changing the existing
   reset operation implementations.
7. Add failure, concurrency, and press-edge tests before any visual polish.
8. Manually verify toggle-on preparation, next-reset activation, toggle-off
   continuation, header resets, and L2/R2 resets.

## Implementation-readiness audit

### What is already complete

The following decisions are sufficiently specified to begin coding:

- the feature is optional and disabled on every new player session;
- the enabled/disabled toggle is not persisted;
- only `oddsResetCount` is persisted per `(gameId, profileId)`;
- timestamp zero is the default for a profile with no counter;
- the clock is frozen while manipulation is active;
- each accepted Hub hard/soft reset advances one minute;
- EmulatorJS internal reset controls are out of scope;
- header buttons and L2/R2 shortcuts share one parent reset dispatcher;
- the clock wrapper lives in each `player.html` iframe;
- GBA/mGBA is the first supported engine; Gambatte is deferred;
- normal mode remains the existing native-clock behavior.

### Remaining implementation decisions

The earlier concerns are now reduced to implementation details under the
following agreed policy:

1. **Partial multi-instance failure:** each profile is independent. Reset
   updates may run in parallel. If one profile update fails, that profile's
   iframe does not reset; other successful profiles may reset. The parent may
   surface a transient partial-failure notice but must not roll back successful
   profile updates.
2. **Reset ordering:** no global queue is required. Different profiles may be
   synchronized in parallel. A minimal per-profile single-flight coordinator
   coalesces requests for the same profile, while local reset handling remains
   immediate and never waits for persistence.
3. **Endpoint shape:** add a small odds-state update operation, while also
   extending existing save/close payloads to carry the same counter. The
   frontend initiates the update; the backend continues to be the only
   component that writes Redis.
4. **Atomicity interpretation:** the first implementation relies on the
   existing active player lease plus a monotonic profile-store transition. An
   incoming lower counter must not replace a higher stored counter, even when
   delayed requests arrive out of order.

If deployment later permits multiple backend writers for the same profile, the
profile store will need a stronger compare-and-swap or Redis `EVAL` transition.
That is a scalability hardening path, not a first-version feature blocker under
the current single-player-lease invariant.

### Recommended final implementation shape

Use these bounded units:

1. Extend `profile-store`: validate/migrate/read/write `oddsResetCount` while
   preserving current name and ID behavior.
2. Extend profile read/list and existing save/close contracts to carry the
   counter, and add the lightweight odds-state update operation.
3. Parent `reset-dispatcher`: increment local state, send the timestamp to the
   iframe, then send the existing reset command; a separate sync coordinator
   flushes the latest dirty value on a roughly 30-second cadence.
4. Player clock provider: native/frozen modes and validated parent messages;
   it never mutates backend state.
5. Header toggle: transient React state only, configured beside Controller
   Settings, with no user-preference write.

The existing profile list exposes `oddsResetCount`. Profile rename/delete
preserve or remove it through the existing stable profile ID and lease rules.

### Implementation readiness conclusion

The feature is implementation-ready under the agreed first-version policy:
immediate local reset advancement, independent asynchronous profile sync,
30-second coalescing, save/close payload integration, monotonic persistence,
and no persistence of the session toggle. Remaining work is
package/backend/frontend implementation and focused verification; no further
product-scope discovery is required.

## Boundaries

This spec does not add manual time travel, a date/time picker, a configurable
increment, realistic elapsed-time simulation, RNG patching, ROM changes, or
changes to the backend's current-time source. The only persisted odds state is
the profile-scoped reset counter and its derived logical timestamp.

## Test and observability runbook

### Enable diagnostic collection

Set the frontend environment variable before starting or restarting the frontend
dev server:

```dotenv
VITE_DEBUG=1
```

`VITE_DEBUG=0` disables collection. The value is injected by the frontend build
tool, so changing `.env` requires restarting the frontend dev server. URL
parameters cannot enable diagnostics. On every Hub document load, including F5,
the frontend creates a new local `debugSession` (the top-level Hub ignores any
old `debugSession` query value on reload); it passes that ID only to its
same-origin `player.html` iframes for correlation. Client events are sent to
`/api/debug/client-events` and are also visible in the browser console for reset
events. The backend prints odds sync events with the `[odds-manipulator]`
prefix.

Relevant event messages are:

| Layer | Event | Meaning | Guarantee |
|---|---|---|---|
| Hub | `odds.toggle.enabled` / `odds.toggle.disabled` | Session toggle transition | Proves the user action reached React; it does not prove the iframe received the message. |
| Hub | `odds.reset.applied` | Local counter was incremented and reset message was sent | Proves the selected Hub reset path used the manipulator and records the exact count/timestamp sent. |
| Hub | `odds.sync.started`, `odds.sync.succeeded`, `odds.sync.failed` | Asynchronous profile checkpoint lifecycle | Proves request scheduling and response outcome. |
| Backend | `odds.sync.persisted` / `odds.sync.rejected` | Profile-store result | Proves the durable backend value accepted or rejected the submitted count. |
| Iframe | `odds.clock.configured` | Frozen/native clock configuration accepted | Proves the iframe clock wrapper received and validated the configuration. |
| Iframe | `odds.hard-reset.clock-applied` / `odds.soft-reset.clock-applied` | Reset payload validated and applied before the reset operation | Proves the iframe supplied that timestamp to its browser `Date.now()` wrapper. |
| Iframe | `odds.*.clock-rejected` | Malformed or inconsistent timestamp/count pair | Proves the reset did not apply a valid virtual timestamp. |

Diagnostic payloads include `gameId`, `profileId`, `sessionId`,
`oddsResetCount`, `virtualTimestamp`, and an iframe `dateNow` sample where
available. They never include ROM bytes or save bytes.

### Manual test sequence

1. Set `VITE_DEBUG=1`, restart the frontend, and start the backend normally.
   Open the Hub, then record the generated `debugSession` from the first client
   diagnostic event or the browser network payload.
2. Open a profile and confirm normal startup. Before enabling the toggle,
   perform one hard reset and one soft reset; verify there are no
   `odds.reset.applied` events and no profile counter change.
3. Enable Manipulador de odds. Verify one `odds.toggle.enabled` event, an
   iframe `odds.clock.configured` event with count `0` and timestamp `0`, and no
   reset event.
4. Perform a hard reset. Verify the Hub emits count `1` and timestamp `60000`,
   the iframe emits `odds.hard-reset.clock-applied` with the same values, and
   the backend eventually emits `odds.sync.persisted` with count `1`.
5. Perform several rapid hard and soft resets. Verify local counts are
   consecutive, only the latest count is sent by a coalesced sync, and hard vs
   soft event names match the selected control.
6. Wait at least 30 seconds. Confirm a sync request is visible in Network and a
   matching backend persistence log is visible.
7. Temporarily make the odds endpoint fail or go offline. Perform a reset and
   verify the reset and iframe clock events still occur, followed by
   `odds.sync.failed`; restore connectivity and verify a later retry persists
   the latest count.
8. Disable the toggle. Verify no reset is generated, the iframe emits native
   clock configuration, and later resets do not increment the counter.
9. Close the emulator. Verify a best-effort final sync occurs before lease
   release. Reopen the same profile, enable the toggle, and verify the initial
   count equals the last persisted backend count.
10. Repeat with two active profiles. Verify each profile has an independent
    count and that one failed sync does not roll back or block the other.

### Layer guarantees and limits

- Parent Hub logs prove the dispatch decision and exact payload generated by
  the application.
- Iframe logs prove the payload was accepted by the player document and that
  its `Date.now()` wrapper returned the configured value immediately before
  invoking the reset path.
- Backend logs and a subsequent profile GET prove the durable profile value.
  They do not prove that mGBA consumed the value for every internal RTC read.
- EmulatorJS/mGBA does not expose a supported browser API to read its internal
  RTC/SID clock through the current iframe boundary. Direct recovery of that
  value would require an emulator-specific instrumentation hook or core change.
- The strongest black-box confirmation is the combination of iframe
  `dateNow`/clock-applied events, persisted profile count, and an in-game SID/RNG
  result whose expected seed changes by one-minute increments. That confirms
  behavior at the game level, but remains an empirical integration observation
  rather than a direct RTC getter.
