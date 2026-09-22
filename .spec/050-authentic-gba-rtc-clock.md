# Spec 050 — Authentic GBA RTC clock provider

## Context

Ruby and Sapphire initialize their LCG from the GBA cartridge RTC minute
counter. The documented routine folds the minute counter into a 16-bit seed.
The retail Emerald build has a separate game bug and boots the RNG at zero;
changing its RTC source does not repair that bug. FireRed and LeafGreen do not
use a cartridge RTC for the initial seed; they generate it from title-screen
timing when A/Start is pressed.

The Hub launches EmulatorJS 4.2.3 and supplies the GBA core through
`EJS_core`. EmulatorJS maps the GBA core to mGBA. mGBA's RTC implementation
uses an injected RTC source when available and otherwise falls back to the
host `time(0)` value, converted to local calendar fields. The current player
does not configure an RTC source or override.

References:

- EmulatorJS core mapping: <https://emulatorjs.org/docs4devs/cores/>
- mGBA RTC implementation: <https://sources.debian.org/src/mgba/0.8.4%2Bdfsg-2/src/gba/hardware.c/>
- Ruby/Sapphire and Emerald seed behavior: <https://0xabad1dea.github.io/emeraldscc/initmain/>
- Gen 3 initial-seed behavior: <https://github.com/Wi-Fi-Labs/Labs-Guides/blob/main/GEN%203/Guides/Gen3InitialSeedRNG.md>

## Goal

Make the source of the emulated GBA RTC explicit, testable, and authentic by
default so Ruby/Sapphire behave like a real GBA. The goal is not to add entropy
or randomize the game's RNG. The goal is to verify that the real host clock
reaches the mGBA RTC path that the game already consumes.

The first implementation must preserve the native mGBA RTC path. A browser
clock extension or native clock bridge is considered only if a runtime test
proves that the pinned EmulatorJS WASM build does not expose or correctly use
that path. An extension alone is not treated as an RTC implementation, and no
solution may make a minute-based game seed more granular than the hardware.

## Requirements

### Clock-provider contract

- Define a small provider contract returning a Unix timestamp in seconds and a
  source label: `system`, `extension`, `native`, or `fixed-test`.
- The default provider reads the browser/OS wall clock. It must be the same
  civil time that the browser already exposes and must not require an
  extension, account, network request, or permission prompt.
- Reject non-finite, out-of-range, stale, or backward-jumping extension/native
  values and fall back to the system provider.
- Keep the provider in-memory for a player session. Do not write clock values
  into game saves, backend profiles, global preferences, or snapshots.
- Expose a development-only diagnostic record containing source, timestamp,
  timezone offset, and last update age. Never include secrets or extension
  credentials.

### mGBA/EmulatorJS integration

- Add an explicit integration boundary between the player page and the GBA
  core. The boundary must document the exact mGBA/EmulatorJS hook used to
  provide RTC values to the WASM core.
- If the pinned EmulatorJS core has no supported runtime RTC-source hook,
  produce a compatibility result and stop there; do not patch the game seed or
  silently alter ROM behavior.
- A browser extension transport may send timestamp messages only after the
  page verifies origin, extension protocol version, freshness, and monotonic
  update sequence. The player must remain fully functional without it.
- A native companion or extension is optional infrastructure. It is not the
  source of truth when the system clock is already available.
- The default production mode must consume the host clock through the normal
  mGBA fallback, preserving authentic game behavior.

### Reset and RNG semantics

- Document that Ruby/Sapphire's initial seed is minute-resolution. Multiple
  resets in the same RTC minute can legitimately produce the same seed.
- Do not add milliseconds, random bytes, browser entropy, or player-session
  IDs to the RTC value. Those would make the game diverge from hardware.
- Emerald remains explicitly documented as seed-zero on retail boot. A future
  Emerald RNG research mode must be a separate, opt-in feature and is outside
  this spec.
- FireRed/LeafGreen remain title-screen timing based and must not be routed
  through an RTC-seed path.
- Resetting or reopening the player must not reset the provider to a synthetic
  epoch or a saved snapshot timestamp.

### Extension option

- If an extension is implemented, keep it as a thin clock transport:
  `extension -> postMessage/native messaging -> player provider -> core RTC`.
- The extension must expose a read-only current-clock capability, declare a
  protocol version, and send no game state or save data.
- The player must show whether the session uses `system` or `extension` only in
  diagnostics; no extra game control is required in the normal UI.
- Extension absence, denial, disconnect, malformed payloads, and clock drift
  must fall back to `system` without blocking launch.

## Preferred implementation order

1. Verify the current application behavior with Ruby/Sapphire across resets in
   the same minute and across a minute boundary. Record the in-game clock and a
   reproducible RNG observation before changing code.
2. Verify the pinned EmulatorJS/mGBA WASM build's RTC behavior with a minimal
   instrumented ROM or mGBA test ROM that reads RTC seconds/minutes.
3. Implement the provider interface and deterministic fake clock tests in
   `apps/packages/`.
4. Add the player-to-core RTC adapter only if the pinned core exposes a stable
   hook; otherwise record the limitation and keep the host fallback.
5. Add extension transport behind feature detection and origin validation only
   after the native path is proven unavailable or incorrect.
6. Add diagnostics and a manual validation matrix for Ruby, Sapphire, Emerald,
   FireRed, and LeafGreen.

## Test requirements

- Provider returns system time when no extension is present.
- Valid extension timestamps are accepted; malformed, stale, backward, and
  cross-origin messages are rejected.
- Provider fallback does not block launch when the extension is unavailable.
- Fixed-clock tests reproduce the same Ruby/Sapphire minute seed.
- Tests prove that sub-minute changes do not change a minute-based seed.
- Tests verify that Emerald is not falsely reported as RTC-seeded.
- Tests verify that FireRed/LeafGreen use title-screen timing metadata rather
  than the RTC provider.
- Integration tests verify that the chosen timestamp reaches the actual core
  hook, if and only if that hook exists in the pinned EmulatorJS build.
- Existing save, snapshot, lease, multi-player, and fast-forward behavior must
  remain unchanged.

## Acceptance criteria

1. The Hub's default RTC source is identified as the host system clock and is
   consumed by mGBA without requiring an extension.
2. A clock extension can be added without changing game saves or backend
   persistence, but its absence is transparent to players.
3. No implementation claims to make Ruby/Sapphire seeds more granular than
   the game's RTC minute counter.
4. The actual EmulatorJS/mGBA RTC hook is verified or the unsupported boundary
   is documented before any extension work is shipped.
5. Reset behavior is covered for Ruby, Sapphire, Emerald, FireRed, and
   LeafGreen, with the known game-specific differences preserved.

## Scope boundaries

This spec does not add RNG manipulation, seed randomization, ROM patches,
Emerald bug fixes, network time synchronization, backend clock storage, or a
user-facing clock selector. Those would require a separate explicit spec.
