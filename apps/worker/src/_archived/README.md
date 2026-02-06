# Archived Automation Workers

These workers were part of an incomplete automation/trigger system.

## What's Here

- `trigger-worker.ts` - Processes trigger events, but calls a missing API endpoint
- `polling-worker.ts` - Polls external APIs (Linear, Sentry), creates trigger events
- `scheduled-worker.ts` - Creates trigger events on cron schedules
- `redis.ts` - Redis helpers for poll state (only used by polling-worker)

## Why Archived

The flow is broken:

1. Webhooks/polling/scheduled workers create `trigger_events` and queue them
2. `trigger-worker.ts` picks up events and tries to call `/api/internal/process-trigger-event`
3. **That API endpoint doesn't exist** - so nothing actually happens

## To Restore

To make automations work, either:

1. **Option A:** Make `trigger-worker.ts` create sessions directly (like `SlackClient` does)
2. **Option B:** Create the missing `/api/internal/process-trigger-event` endpoint

The Slack integration (`clients/slack/`) shows the working pattern - it creates sessions
directly in `processInbound()` without delegating to an external API.
