# Spec 054: Snapshot restoration must not rewrite canonical saves

## Problem

The player has two independent persisted artifacts:

- the canonical battery save (`.sav`) synchronized by `cloudSaveSynchronizer`; and
- the emulator runtime snapshot, restored through `gameManager.loadState()` and stored by the snapshot endpoint.

The current startup flow restores a selected snapshot and then unconditionally calls `cloudSaveSynchronizer.restore()`. That writes the backend `.sav` into EmulatorJS and reloads its save files, coupling two user decisions. Closing the player can also flush the current emulator save automatically, which can overwrite the canonical `.sav` after a snapshot was selected.

## Requirements

1. Accepting a local recovery or cloud snapshot must call only `gameManager.loadState()` for runtime state restoration.
2. Accepting a snapshot must never call `FS.writeFile()` or `loadSaveFiles()` through the cloud save synchronizer.
3. The canonical `.sav` is restored only when no runtime snapshot/recovery was accepted (the user declined the snapshot and chose the saved game path).
4. Accepting a runtime snapshot must not invoke the canonical save restore path. Later in-game save events remain independent and may synchronize the `.sav` normally.
5. Snapshot persistence remains state-only: snapshot capture may update the snapshot endpoint and its `saveRevision` metadata, but must not write save bytes.
6. Backend snapshot reads, writes, revision reconciliation, and deletion must not mutate canonical `.sav` bytes.
7. The UI restore decision remains per emulator instance; restoring one player must not trigger a global save restore or modal.
8. Restore requests and responses must carry and validate `sessionId`, `profileId`, and `gameId`; a response for another player must be ignored.

## Existing coupling inventory

- `apps/frontend/src/player.js` loads remote save bytes into the synchronizer during launch, then previously called `cloudSaveSynchronizer.restore()` after every snapshot decision. The synchronizer writes `gameManager.getSaveFilePath()` with `FS.writeFile()` and calls `loadSaveFiles()`.
- `restoreSnapshotState()` itself is state-only and calls `loadState()` after acceptance. The unsafe coupling was at its caller, not in the snapshot package.
- `observeEmulatorSaveFiles()` and the save poller feed `queueCloudSave()`. The close path also reads `getSaveFile()` and feeds the same queue, so a snapshot session needed a guard at this single ingress point.
- `persistEmulatorState()` sends only `getState()` bytes and snapshot metadata. It does not read, write, or upload `.sav` bytes.
- Backend snapshot GET/PUT and lease-release reconciliation use `snapshotStore` independently from `saveStore`; existing HTTP coverage verifies snapshot upload leaves canonical save bytes unchanged.
- The prompt is rendered inside the matching `.player-cell`; the parent currently maps requests by iframe source and session id, but the message payload must also be identity-checked to prevent a cross-profile response from being accepted.

## Design

Track whether a local recovery or cloud snapshot was accepted. The startup sequence restores only the runtime state in that branch. If no runtime state was accepted, reset the emulator first and then restore the canonical `.sav`. Snapshot capture remains independent and records only `gameManager.getState()`; normal later save events continue through the existing save pipeline.

Declining snapshot recovery resets the emulator before the canonical saved-game path is applied. A snapshot can therefore be abandoned without changing the `.sav` that existed before it was opened.

## Acceptance criteria

- Accepting a cloud snapshot produces `loadState` only; no `FS.writeFile`, `loadSaveFiles`, or cloud save restore occurs.
- Declining the cloud snapshot restores the remote `.sav` exactly once before the player becomes ready.
- Accepting local recovery has the same save isolation guarantee.
- Later save events, polling, and close-time final-save flushing remain available and are independent of snapshot restoration.
- Snapshot PUTs continue to work and contain runtime state plus save revision metadata only.
- Tests cover accepted/declined branches, the write guard, close behavior, and backend snapshot/save separation.
