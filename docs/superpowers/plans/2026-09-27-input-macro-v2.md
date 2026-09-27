# Input Macro V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Implement the version 2 macro model, progressive execution, and editable modal described in spec 042.

**Architecture:** The shared package owns validation, migration, list editing, and progressive cursor/execution. The backend persists both stored versions and accepts version 2 writes. The player owns input and run lifecycle; the hub coordinates player frames and renders the editor state.

**Tech Stack:** JavaScript ESM, React, Ant Design, Node test runner.

**Spec:** `.spec/042-input-macro-simulator.md`

## Global Constraints

- Do not run a project build or create a commit for this prompt.
- Keep ROM, profile, lease, and save validation independent of the optional macro feature.
- Preserve old saved macros until a user reviews and saves them as version 2.

## Review Focus

- A later Repeat revisits earlier Repeats with reset counters.
- Repeat 0 does not freeze the browser, including a sequence containing only Repeat.
- Cancel releases only the macro source, preserving physical input.
- A short run ending during start acknowledgments leaves the hub idle.
- A malformed old record does not make other saved macros disappear.

---

### Task 1: Shared model and runner

**Files:** `apps/packages/input-macro-simulator.mjs`, `apps/packages/input-macro-simulator.test.mjs`

- [x] Write failing tests for defaults, validation, migration, nested Repeat counts, timing, and cancellation.
- [x] Run the targeted test to confirm failures.
- [x] Implement the version 2 helpers, cursor, and progressive runner.
- [x] Run the targeted test to confirm passes.

### Task 2: Persistence and input ownership

**Files:** `apps/packages/input-macro-store.mjs`, `apps/packages/gamepad-input.mjs`, relevant tests.

- [x] Write failing tests for mixed stored versions and independent synthetic sources.
- [x] Run targeted tests to confirm failures.
- [x] Update both stores and gamepad adapter.
- [x] Run targeted tests to confirm passes.

### Task 3: Player execution protocol

**Files:** `apps/frontend/src/player.js`, relevant tests.

- [x] Write failing tests for prepare/start/stop and terminal messages where practical.
- [x] Run targeted tests to confirm failures.
- [x] Integrate the progressive runner, source ownership, and lifecycle cancellation.
- [x] Run targeted tests to confirm passes.

### Task 4: Hub editor and coordinator

**Files:** `apps/packages/input-macro-simulator-ui.jsx`, `apps/frontend/src/main.jsx`, `apps/frontend/src/styles.css`, relevant tests.

- [x] Write failing tests for insertion, editing, reordering, and run-state coordination.
- [x] Run targeted tests to confirm failures.
- [x] Replace the editor controls and implement confirmed multi-frame run state.
- [x] Run relevant tests and inspect the diff.

### Task 5: Final verification

- [x] Run all relevant Node tests; inspect every failure.
- [x] Check source syntax and `git diff --check` without invoking a build.
- [x] Compare the result with every acceptance criterion in spec 042.
