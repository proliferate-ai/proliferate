# Phase 1: Triggers (The Ingestion Firehose)

**Branch:** `vnext/phase-1-triggers`
**Base:** `main` (after Phase 0 is merged)
**PR Title:** `feat: vNext Phase 1 — triggers ingestion firehose`

**Role:** You are a Staff Principal Engineer working on Proliferate.

**Context:** You are executing Phase 1. We have merged the Phase 0 database schemas. You are separating the webhook ingestion boundary from the processing boundary to survive API rate-limit storms.

## Instructions

1. Create branch `vnext/phase-1-triggers` from `main`.
2. Read `docs/specs/triggers.md` (old) and `docs/specs/vnext/triggers.md` (new).
3. Consolidate all webhook routes into `apps/trigger-service/src/api/webhooks.ts`. Delete the old Next.js API webhook routes.
4. Build the BullMQ worker that processes `webhook_inbox` rows asynchronously (calling `parse`, `hydrate`, `matches`, and executing the outbox handoff).
5. Update the polling worker to orchestrate by `trigger_poll_groups`.
6. Run `pnpm typecheck` and `pnpm lint` to verify everything compiles.
7. Commit, push, and open a PR against `main`.

## Critical Trap Patches (MUST IMPLEMENT)

- **The Synchronous Rate Limit Bomb:** The Express webhook routes must ONLY verify signatures, extract identity, `INSERT INTO webhook_inbox`, and return `200 OK` immediately. Do NOT call `hydrate()` or block the HTTP response on upstream API calls.
- **The Polling Fan-Out Multiplier:** Fetch events once per connection (polling group), and then fan out in-memory to evaluate `matches()` across triggers. Do not schedule a separate BullMQ job for every individual trigger.
- **Inbox Garbage Collection:** Add a lightweight cron worker to `DELETE FROM webhook_inbox WHERE status IN ('completed', 'failed') AND processed_at < NOW() - INTERVAL '7 days'` to prevent DB bloat.
- **Orphaned Pollers:** Ensure that when the *last* polling trigger for a specific group is disabled/deleted, the `trigger_poll_groups` row is removed and the BullMQ job is unscheduled.
