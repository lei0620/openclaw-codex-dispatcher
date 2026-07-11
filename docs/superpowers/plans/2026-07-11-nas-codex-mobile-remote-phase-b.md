# Phase B: Reliable Realtime Messaging Implementation Plan

## Goal

Make the NAS relay the durable realtime source of truth so phone messages, Codex output, task state, approvals, and connection changes arrive immediately, survive reconnects, and never execute twice.

## Invariants

- Every phone send carries a stable `clientMessageId`; one id creates at most one task.
- Every mobile event has a strictly increasing `eventId` persisted on the NAS.
- A reconnecting phone replays events after `lastEventId`; an expired cursor triggers a full REST reconciliation.
- Events always carry their `conversationId` when applicable, so switching the visible conversation cannot reroute a task.
- One conversation has at most one active task; different conversations may run in parallel.
- WebSocket is the primary update path. REST polling remains a slow reconciliation fallback only.

## Tasks

1. Add `clientMessageId`, persisted mobile events, bounded retention, and stale-cursor detection to `TaskStore`.
2. Make `POST /api/tasks` idempotent and expose an event-window endpoint for diagnostics and fallback.
3. Add authenticated `/events` WebSocket connections with snapshot-required, replay, and live broadcast messages.
4. Publish task, log, approval, conversation, agent, Codex-window, and health-relevant events.
5. Add a reconnecting browser WebSocket client with serialized event handling, cursor persistence, and exponential backoff.
6. Merge events into the active UI by ids, add optimistic sends/retries using the same `clientMessageId`, and reduce polling to 30 seconds.
7. Verify duplicate submission, cursor replay/expiry, 20-message delivery, same-conversation serialization, cross-conversation parallelism, realtime approvals, and reconnect reconciliation.
8. Deploy the NAS service, release the Android bundle, and complete real-device foreground/background QA when ADB is available.

## Release Gates

- Full Vitest suite and TypeScript build pass.
- Duplicate requests with the same `clientMessageId` return the same task id.
- Reconnect tests prove ordered replay without duplicate events.
- Twenty unique sends create exactly twenty tasks.
- Approval and task events reach a connected phone WebSocket without polling.
- Browser QA shows no duplicate bubbles, forced scroll-to-bottom, header/composer regression, or console errors.
