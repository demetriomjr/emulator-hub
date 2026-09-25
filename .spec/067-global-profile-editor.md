# Spec 067 — Global profile editor

## Current system

- The hub sidebar has a global **Configurar controles** button. The catalog comes from `GET /api/games` and includes every registered game, its title, cover when verified, status, and cached profiles. The main grid disables launch for unavailable ROMs.
- Save profiles belong to a game ID. `GET /api/games/:gameId/profiles` lists current profiles and lease state. `PATCH /api/games/:gameId/profiles/:profileId` immediately persists a printable 1–32 character name. Names may repeat as corrected in [Spec 068](068-profile-names-and-gamepad-unlock.md). Renaming remains allowed during an active save lease; deletion does not.
- The launch picker and running player both keep profile names in client state. The player close payload contains save/session identity and does not transport profile metadata. A rename must update visible client state immediately, without waiting for player close.
- Ant Design is already installed and themed in the frontend through `ConfigProvider`. Its controlled `Modal` supports `open`, `onCancel`, a custom or absent footer, and a wide `width`; `Input` and `Button` support the edit form.

## Requirements

1. Add a sidebar **Editar perfis** action directly after **Configurar controles**, using a simple account icon. It opens a large, centered modal over the hub and leaves the underlying hub unavailable until closed.
2. Divide the modal into three vertical columns at desktop width: all registered game cards (including unavailable ROMs), profiles for the selected game, and editable data for the selected profile. A game selection clears the previous profile and draft. A profile selection loads its current server record before showing the editor. Show concise empty, loading, and request-error states.
3. The first column uses the existing catalog identity/title/cover. Unavailable ROMs may still have editable profiles; profile metadata editing must not depend on ROM launchability. The second column is scoped to the selected game and shows profile names without launching a game. No profile creation, deletion, save handling, or game launch belongs in this modal.
4. Introduce `GET /api/games/:gameId/profiles/:profileId` for the third column. It uses the same catalog/game validation and profile store as existing routes, returns the profile plus `leaseActive`, and returns 400 for malformed game IDs and 404 for missing games or profiles. It is read only and does not require a lease or verified ROM. The frontend client wrapper validates the response shape.
5. The third column starts in edit mode with the name field. Save sends `{ name }` immediately through the existing PATCH route and uses the server response as the source of truth. Update this modal's list and selected profile, the catalog cache, any open profile picker, and the active player's displayed profile name. Keep the editor open after save so another selection is easy. Failure leaves the draft and error visible. Match the existing 32-character input limit and server validation; disable duplicate submits while saving.
6. Avoid stale responses when switching games/profiles or closing the modal. On narrow viewports, preserve the same three ordered sections with scrolling rather than clipping controls. Keep the dark green theme, accessible labels and focus handling. This global modal opens from the hub only; no player input/lock behavior changes.

## Verification

- Backend route tests for current profile, missing game/profile, malformed ID, and method handling.
- Frontend contract/state tests for selection, stale request protection, immediate save, and error behavior; lint and relevant existing tests.
- No project build, commit, push, or deploy in this task.

## UI and save corrections (2026-09-25)

- Give the global sidebar actions a small vertical gap so adjacent buttons do not touch.
- Render the game titles in the first column as square cover cards in a two-column grid at desktop modal width, with readable title labels and a usable narrow layout. Keep the selected game's profile names in the middle column.
- Keep fetching the selected game's profiles and the selected profile's current record from the API.
- Keep **Salvar** enabled whenever a valid profile is loaded, including when the name has not changed. The backend validates and normalizes every submission; if the normalized name equals the stored name, it returns the existing profile successfully without writing storage. A successful submission shows a visible saved confirmation. While a request is in flight, prevent duplicate submits.
- Style the editor's input and save button to match the existing dark green UI, with readable button text and hover/focus states.
