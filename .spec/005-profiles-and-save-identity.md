# Spec 005 — Profiles and save identity

## Goal

Before a verified title starts, the player selects an existing profile or creates one. A profile is the required identity for that game session and determines the save namespace. The same frontend flow is used by the web app and by Electron's compiled frontend.

## Scope

- The backend persists profiles as `{ id, name, createdAt }` in its local, Git-ignored data directory. A profile name is trimmed, normalized, 1–32 characters, and unique without case sensitivity.
- `GET /api/profiles` lists profiles. `POST /api/profiles` accepts `{ "name": string }` and returns the created profile. `PATCH /api/profiles/{id}` accepts `{ "name": string }` and returns the renamed profile. `DELETE /api/profiles/{id}` removes an existing profile after the frontend has asked for confirmation. Invalid names return `400`; a duplicate returns `409`; an unknown profile to update or delete returns `404`.
- `GET /api/games/{id}/launch?profileId={profileId}` requires an existing profile. Missing `profileId` returns `400`; an unknown profile returns `404`. The launch descriptor includes the profile ID and uses a deterministic numeric EmulatorJS game ID derived from `profileId + titleId`.
- Clicking a ROM's Play icon opens a small profile dialog. Its full-width header holds the title and close button. Existing profiles form a continuous, square-cornered list: each selection control fills its row and each row has edit and delete controls. The create form remains hidden behind a centered plus icon until chosen. Selecting a profile, or successfully creating one, launches that title. Deleting a profile requires a browser confirmation and does not start a game. The selector can close without launching. No account, password, or avatar is included.
- `player.html` forwards the profile ID to the launch endpoint. EmulatorJS receives the profile-scoped numeric game ID. Its existing browser-managed persistent game save is therefore isolated per profile/title. No save is transferred to a third party, and this does not implement cloud-save synchronization.

## Boundaries

The profile record and launch validation are backend-owned. The profile store is a reusable package in `apps/packages/`; `apps/backend` adapts it into HTTP; `apps/frontend` presents it; Electron inherits it through the frontend artifact. Profile data is not committed. The future cloud-save contract remains [Spec 002](002-cloud-saves-and-content.md); when that work starts, its save key must be `profileId + titleId + content version` and it must preserve the current profile-selection contract.

## Failure behavior

If profiles cannot be loaded or persisted, creation and launch fail visibly and the player does not start. A malformed creation request cannot create a profile. A game launch never falls back to a shared or anonymous save identity.

## Acceptance

1. A player can create a profile, then it appears in the selector after a page reload.
2. A player can select a profile and open the verified ROM.
3. The backend rejects a launch without a profile and rejects an unknown profile.
4. Different profile/title pairs receive different numeric EmulatorJS game IDs; the same pair receives the same one.
5. A profile can be renamed, and the name remains after a reload.
6. A profile can be deleted after confirmation and no longer appears after a reload.
7. The create controls only appear after selecting the plus icon.
8. The existing card, player container, fullscreen behavior, ROM verification, and metadata continue to work.
