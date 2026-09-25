# Spec 066 — Edit the running save profile name

## Goal

The player header has an information button immediately beside the odds manipulator. It opens a small editor centered over the currently focused emulator instance. The editor starts in edit mode, displays the running save profile's name, and offers Save and Close. The profile can gain more fields later; this slice edits only its name.

## Current contracts

- The profile record already contains `id`, `name`, `createdAt`, and `oddsResetCount`. `PATCH /api/games/:gameId/profiles/:profileId` accepts `{ "name": "..." }`, validates a printable 1–32 character name, and returns the updated profile. Names may repeat as corrected in [Spec 068](068-profile-names-and-gamepad-unlock.md).
- The backend currently rejects that PATCH while the game's save lease is active. The lease protects the save and profile deletion; renaming the metadata must be allowed while playing. DELETE stays blocked by the active lease.
- Closing a player synchronizes save bytes, clears recovery as appropriate, and releases the player lease. The close messages and release payload carry session and lease identity, not the profile name. Renaming is persisted immediately by the PATCH and is not added to the close payload.

## Behavior

1. The new header button targets the existing focused session, falling back to the first active session. It is unavailable while the close chooser or save overlay is active.
2. Opening the editor initializes a draft from that session's current `profileName`, focuses the name input, and positions the modal in the center of that session's `.player-cell`. It does not navigate away or restart the iframe.
3. The editor blocks keyboard, pointer, and gamepad input to its own emulator while open. Other running instances continue receiving gamepad input. Closing the editor waits for the controller to become neutral before its held input can reach the edited emulator again.
4. Save sends the draft name immediately through the existing profile PATCH route. On success, update the active session's display name, profile picker state, and cached game profiles from the returned record, then close the editor. A failure leaves the editor open with an error. Do not add a profile-name field to save, snapshot, close, or lease-release payloads.
5. Closing without saving discards the draft. A session removed by normal close or lease loss cannot leave an editor open over another instance. Global close lock retains precedence if closing begins while the editor is open.
6. Keep the existing name validation. Repeated names are allowed; profile ID remains the identity. No additional profile fields, views, or controls are included.

## Verification

- Backend test: PATCH succeeds under the active player lease and DELETE remains blocked.
- Frontend tests: focused-session targeting, immediate PATCH and name/cache update, error persistence, session-scoped input suppression, neutral re-entry, and close-lock precedence.
- Run focused tests and lint. Do not run a project build unless explicitly requested.
