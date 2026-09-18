---
title: Mobile client diagnostics
date: 2026-09-18
tags: [spec, mobile, diagnostics, caddy, frontend, backend]
status: active
---

# Spec 031 — Mobile client diagnostics

## Goal

Make an iPhone browser failure observable from the local development host without requiring a remote browser inspector. Caddy remains the HTTPS/access-log boundary; the application reports browser-runtime failures that a reverse proxy cannot observe.

## Scope

- Diagnostics activate only when the page URL contains `debug=1`.
- The hub document and every EmulatorJS player iframe share one generated client session identifier.
- The browser reports uncaught errors, unhandled promise rejections, and failed same-origin API requests to `POST /api/debug/client-events`.
- The backend validates, sanitizes, keeps only a bounded in-memory backlog, and emits each accepted event through a dedicated structured logger.
- `GET /api/debug/client-events` returns the ephemeral newest-first backlog, optionally filtered by `sessionId`.
- The LAN Caddy configuration writes JSON access logs to `tmp/caddy-lan/caddy-access.log`, so the diagnostic POST and its request metadata can be correlated with proxy traffic.
- Chrome on iPhone (`CriOS`) stays on EmulatorJS's Safari/WebKit suspended-audio guard. This preserves the upstream resume control required by iOS; the separate game-surface retry never suppresses it.
- Once EmulatorJS starts, the game surface retries `AudioContext.resume()` on its first pointer, touch, or keyboard gesture and removes those listeners once the context is running. The context is resolved from the current OpenAL source when the runtime does not expose `currentCtx.audioCtx`. This restores audio after iOS rejects automatic audio startup without interfering with game input.
- With diagnostics enabled, the player compares the EmulatorJS frame counter one second after the game-start event and records an `emulator-frame-stall` event when it did not advance.

## Privacy and durability

- No diagnostic input may contain request bodies, response bodies, cookies, authorization headers, ROM bytes, save bytes, query strings, or raw location URLs.
- Events retain only the route pathname, an opaque client session ID, a bounded error message/stack, safe request method/status, user agent, and viewport dimensions.
- The backlog is process-local and bounded to 200 events. It is never written to Redis or disk and disappears when the backend restarts.

## API

```text
POST /api/debug/client-events
  <- { sessionId, source, kind, message?, name?, stack?, request?, page?, userAgent?, viewport? }
  -> 204

GET /api/debug/client-events?sessionId=<opaque-id>
  -> { events: [...] }
```

Malformed input returns 400. Unsupported methods return 405. The response never includes arbitrary client-provided fields.

## Correlation

The frontend appends its generated `debugSession` query parameter when it creates a player iframe. Its diagnostics therefore use the same `sessionId` as the hub. Caddy access logs identify the diagnostic request; backend structured logs and the backlog use that same session ID to relate browser runtime events to proxy/upstream events.

## Acceptance criteria

1. Without `debug=1`, no global listeners, fetch wrapping, or diagnostics HTTP requests are installed.
2. With `debug=1`, hub and player iframe events have the same opaque session ID.
3. An uncaught client error, rejected promise, or failed API request is accepted, sanitized, logged, and visible through the GET backlog.
4. More than 200 events evicts the oldest; backend restart leaves no retained events.
5. Caddy produces JSON access-log entries in `tmp/caddy-lan/caddy-access.log` after reload.
6. Existing frontend Vite configuration changes remain untouched.
7. Chrome on iPhone retains the EmulatorJS Safari/WebKit suspended-audio popup path.
8. The first touch on a suspended game resumes audio; a rejected attempt remains retryable on the next gesture.
9. A debug player whose core advances no frames after startup emits one frame-stall diagnostic.
