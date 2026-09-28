---
title: Pokémon Hub pane-local profile loading
date: 2026-09-28
tags: [spec, pokemon, hub, workspace, loading]
status: active
---

# Spec 080 — Pane-local profile loading

## Goal

Selecting a profile in one Pokémon Hub container must leave the other empty containers usable. The selected container shows its existing “Processando…” splash over its entire area, including its header controls, until that selection succeeds or fails.

## Behavior

- A completed source selection reserves only its own pane and shows the pane-local splash immediately. Other panes may select sources while it waits.
- Selections enter one FIFO queue. Each job performs the whole structural flow, including pending snapshot synchronization, save layout loading, session acquisition, pane loading, and local commit, before the next job starts. The backend's per-session serialization remains authoritative.
- A queued source is reserved against duplicate choices in another pane. A failed selection releases its reservation and removes only its own splash.
- A pane's visible source changes only after its server command is accepted. An empty pane stays empty while its choice is queued or loading.
- The Add control may append a third empty pane during a load. A successful load preserves any pane appended while its request was in flight. Removing or reordering panes waits until queued selections settle, avoiding index changes in pending commands.
- Closing the whole Hub waits for the active selection to settle, discards selections that have not started, then closes the session using its final accepted snapshot.
- Each job has a five-minute deadline starting when it leaves the queue. Its session opening, save layout request, pending snapshot drain, and pane command use that deadline. If time expires after a session exists, the client ends its local session and discards queued selections because the backend outcome may be unknown. The backend's existing lease expiry and recovery handle any unfinished server operation. A timeout before a session exists releases only that pane's pending selection.

## Scope and verification

This changes the React package and its pane splash styling. It does not change the HTTP contract or bypass save and lease checks. Verify that three selections may be queued, only the selected panes show splashes, the other empty panes remain selectable, duplicate pending sources are rejected, and a newly added third pane survives an earlier load response. Existing session queue and workspace tests remain passing.
