# Profiles and Save Identity Implementation Plan

**Goal:** Require a persistent player profile before launch and use it to isolate the existing EmulatorJS save namespace.

**Architecture:** A reusable JSON-backed profile store owns profile validation and serialization. The Node backend exposes that store and requires a profile on its launch endpoint. React displays a profile selector before opening the existing player iframe, which forwards the profile ID into a profile-scoped EmulatorJS game ID.

**Spec:** [.spec/005-profiles-and-save-identity.md](005-profiles-and-save-identity.md)

## Tasks

1. Add failing package tests for creating, listing, rejecting duplicate profiles, and retaining profiles after reopening the store. Implement the local Git-ignored profile store in `apps/packages/`.
2. Add failing backend contract tests for profile listing/creation and profile-required launch descriptors. Add the profile routes, request parsing, and launch validation.
3. Add the profile dialog to the existing React hub. Play opens it; selection or creation calls the profile-aware launch endpoint; the iframe receives both IDs.
4. Set EmulatorJS's game ID from the profile-aware launch descriptor. Verify the same profile/title is stable and distinct profiles cannot share it.
5. Run the backend tests and manually verify creation, selection, persistence, and ROM launch in the browser. Do not run a project build.
