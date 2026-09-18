---
title: Mobile standalone player
date: 2026-09-18
tags: [spec, mobile, pwa, player, frontend]
status: active
---

# Spec 032 — Mobile standalone player

## Goal

Make the Hub installable as a standalone web app and make mobile game play usable without unsupported iPhone orientation locking.

## Scope

- The frontend declares a web-app manifest, theme metadata, and a purpose-built Hub icon. It requests `standalone` display mode; it does not register a service worker or cache ROMs, saves, API responses, or pages for offline use.
- The frontend treats a changed document revision as a mandatory update: when an installed app returns to the foreground, it checks the document ETag without cache and reloads if the served revision changed.
- An installed launch opens the Hub at `/` with browser chrome minimized according to platform support. On a narrow non-standalone viewport, the Hub provides an explicit install guide: Chrome Share, then Add to Home Screen.
- On a narrow portrait viewport, the Hub renders a blocking accessible rotate overlay above every surface. Browser viewport resize and orientation events remove it only after the viewport becomes landscape; it never attempts to lock orientation or invoke native fullscreen APIs. The mobile install control sits in the sidebar beside the controls button.
- Closing a player attempts to synchronize every iframe save, but always closes the overlay even when an iframe fails or times out. A failure remains visible as a warning after close.

## Non-goals

- Programmatic iPhone orientation locking.
- Native fullscreen on iPhone browsers.
- Offline operation or browser-managed ROM/save cache changes.
- Changing desktop player controls or layout.

## Acceptance criteria

1. The installable metadata requests standalone display with name, start URL, colors, and icon; a mobile user can open an in-app guide for the required iPhone installation steps.
2. A portrait mobile Hub blocks every surface with rotate guidance before a game is opened and while a player is active; only a landscape viewport removes it.
3. Player close releases the overlay after all save attempts settle, including a failed iframe response.
4. A close warning never claims a failed save was synchronized.
5. Existing Vite configuration changes remain untouched.
