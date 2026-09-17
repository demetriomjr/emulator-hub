# Spec 002 — Backend content and cloud saves

Status: draft for architecture review. Scope: backend delivery of curated game content and automatic management of in-game save files for web desktop and Electron. This spec is runtime-neutral between C# and Node.js.

## Goal and data ownership

The backend is authoritative for the catalog, ROM references, player/title save bytes, and save revision. The browser or Electron renderer runs EmulatorJS but is not the permanent store. A player can save progress in the game; the product transfers that progress automatically. The player has no upload, download, replacement, or file editing action for ROMs or saves in the product UI.

The first save type is the game's persistent battery/in-game save (`.sav`-style data). Emulator save states (snapshots of memory/CPU) are a separate feature. The documented `EJS_loadStateURL` is for save states and must not be mistaken for an in-game save import mechanism.

## Approaches considered

- Browser-local saves only are the simplest EmulatorJS default, but they do not follow a player between devices and do not meet the backend-managed requirement.
- Client-side export/import controls can move save files manually, but they give players file handling that this product explicitly excludes.
- Backend-authoritative `.sav` synchronization through EmulatorJS save callbacks meets the desired behavior and reuses the browser emulator. This is the selected approach, contingent on proving automatic restoration of `.sav` bytes for the pinned core. A save-state URL is not a substitute because a state and an in-game save have different lifecycle and compatibility rules.

## Content delivery

- Operator-controlled content intake records each title's ROM object, checksum, version, system, core, and expected save properties. No public ROM upload endpoint exists.
- The backend serves ROM bytes through a versioned endpoint or a short-lived backend-issued asset URL. It must support the delivery requirements observed for the selected EmulatorJS core, including browser fetch and caching behavior. EmulatorJS runtime files are hosted at a pinned version rather than silently following `latest` or `nightly`.
- For a memory-first client flow, send ROM and save responses with `Cache-Control: no-store`, disable EmulatorJS's built-in ROM/core/BIOS IndexedDB cache with `EJS_cacheConfig.enabled = false`, and avoid product-created persistent copies. Verify the pinned EmulatorJS release for any remaining IndexedDB save writes; `EJS_disableLocalStorage` only disables settings storage and does not establish a no-disk save guarantee. Do not promise that HTTP headers or memory handling make client-delivered bytes inaccessible to the device owner.
- The client receives only the launch descriptor for a title the backend recognizes. It never supplies a ROM path or arbitrary URL to the backend.
- Separate asset checksums from title names so renaming a display title does not change save identity.

## Save identity and storage

- Key a save by backend player identity, stable `titleId`, ROM/content compatibility version, and save kind. An Electron window or web iframe has an additional transient instance ID for coordination, never as the permanent save key.
- Persist binary save bytes in backend-managed storage with metadata: revision, checksum, byte length, core/system, content version, creation/update time, and last accepted instance. Keep a previous accepted revision for recovery from a bad sync or accidental overwrite.
- The exact storage provider and authentication implementation remain deployment choices. Their observable contract must be the same in C# or Node.js. A multi-user deployment requires account identity and access checks on every save read/write. A single-profile prototype must be explicitly isolated from public deployment.

## Save lifecycle

1. Before starting the emulator, fetch the current cloud save metadata and bytes for the player/title. If no save exists, create a new-game session. If the fetch fails, block launch or ask for an explicit offline session; never silently start a new game over an existing save.
2. Restore the in-game save into EmulatorJS before gameplay begins. The integration must use documented hooks where possible. Because the published options document `EJS_loadStateURL` for states but do not establish a complete startup `.sav` restoration contract, a small feasibility test on a pinned EmulatorJS version and selected core is required before implementation. It must prove that a cloud `.sav` can be restored without a user file picker and then saved again. If only an internal API works, document and pin its version and treat that path as a compatibility risk; do not claim a documented API exists.
3. The pinned EmulatorJS 4.2.3 runtime does not expose `EJS_onSaveUpdate` or `EJS_fixedSaveInterval`. Its `GameManager.saveSaveFiles()` flushes the core and returns the current `.sav` bytes through the runtime. The player adapter periodically invokes that flush, hashes the returned bytes, and queues an upload only when the hash changes. It also flushes before a frame closes. Save state button events do not replace the in-game save adapter.
4. Upload the binary with the known base revision and content version. The backend validates and atomically advances the revision only if the base revision still matches. The frontend displays a cloud-synced state only after backend acknowledgment.
5. On exit/window close, request a final flush where the pinned core supports it and wait for the last upload within a bounded timeout. If synchronization fails, preserve a recoverable local pending copy and clearly report that cloud progress is pending. Reconnect retries use the original base revision and conflict rules.

## Backend save API contract

- `GET /api/titles/{titleId}/save` returns `404` for a verified player/title with no save, or save bytes plus revision, checksum, kind, and content version. A permission failure is not `404`.
- `PUT /api/titles/{titleId}/save` accepts binary bytes, expected revision (`If-Match` or equivalent), content version, and save kind. New saves require an explicit no-save precondition. It returns the accepted revision and checksum.
- Reject unknown title, unavailable content version, wrong player, unsupported kind, malformed metadata, unexpected save size/format for the configured system/title, and checksum mismatch. Enforce a request size limit and avoid trusting client-supplied filenames or paths.
- A version conflict returns `409` or `412` with the current revision metadata. The client does not overwrite it automatically. A conflict UI must offer a safe restart/reload path or operator recovery; automatic byte merging is not defined for emulator saves.
- A transient backend failure retains the upload as pending and retries with bounded backoff. Duplicate upload of the same bytes/base revision should be idempotent.

## First Node.js slice

- The current local prototype identifies a player through the selected backend-owned profile. Its save resource is `GET`/`PUT /api/profiles/{profileId}/games/{gameId}/save`.
- `GET` returns `404` when no save exists, otherwise raw save bytes with `ETag` set to the integer revision and `X-Save-Sha256` set to the accepted byte hash.
- `PUT` accepts `application/octet-stream` bytes and requires `If-Match: *` for a new save or the current quoted integer revision for an update. It atomically persists the bytes and metadata under the Git-ignored backend data directory.
- The frame fetches the cloud bytes before launch. Once the EmulatorJS core starts, it writes them to the core-provided save path and reloads save files before the player can interact. This uses the pinned 4.2.3 runtime API and is covered by the player adapter tests.

Validation confirms structural compatibility and ownership; it cannot prove that arbitrary client-supplied save bytes represent genuine gameplay. This is a trust boundary of client-side emulation, so the backend should not promise anti-cheat validation.

## Multi-instance policy

Different titles may run and save concurrently. The same player/title may have multiple active Electron windows, but only one save revision can be accepted as the next version. Prefer focusing an existing title window in the first release; if duplicate windows are allowed, optimistic revision checks prevent silent overwrite and one conflicting window must stop syncing until resolved. The same rule applies across Electron and browser sessions.

## Errors and acceptance criteria

- Existing cloud progress appears after launch on a fresh browser/device session without the player selecting a local file.
- In-game save changes become cloud revisions; re-opening the same title restores the latest accepted revision.
- The UI has no ROM upload or save import/export controls. Any EmulatorJS built-in file controls that would expose these actions are hidden or overridden using documented options.
- Sending an oversized, mismatched, unauthorized, or stale save is rejected without changing the previous accepted revision.
- Two instances saving different titles do not cross-associate bytes. Two instances of one title cannot silently overwrite each other.
- Offline or rejected uploads are visibly pending; no success indicator appears before backend acknowledgment.
- A selected ROM/core update is tested against stored saves before the backend marks it compatible.

## Research basis and technical gate

The [EmulatorJS options reference](https://emulatorjs.org/docs/options/) documents `EJS_onSaveUpdate`, `EJS_fixedSaveInterval`, save/import callbacks, toolbar visibility, `EJS_loadStateURL`, and the default IndexedDB cache for ROMs/cores/BIOS. Its [changelog](https://emulatorjs.org/docs/changelog/) records save update and browser persistence events. The [embed guide](https://emulatorjs.org/docs/embed/) requires an iframe for React/SPA hosting. [HTTP `no-store`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control) controls HTTP cache storage, not EmulatorJS's separate IndexedDB behavior. The cloud restoration path for an in-game save and any remaining client disk writes must be experimentally verified against a pinned release before development of the full player flow.

## Decisions for review

- Node.js or C# for the backend?
- Single player profile or account-based player identities at launch?
- Which storage/deployment environment is the first target?
- Should conflicting windows for the same player/title be prevented at launch, or allowed with explicit conflict handling?

The first implementation phase is complete only when these decisions, the initial title/core compatibility matrix, and the cloud `.sav` restoration gate have been resolved.
