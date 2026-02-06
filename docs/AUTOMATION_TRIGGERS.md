# Automation Triggers

This document describes the trigger types that can start an automation today, how they are configured, and where the code paths live.

## Supported triggers (current)

Integration-backed (via Nango):
- GitHub (`provider: github`) — issues, PRs, pushes, checks, workflows
- Linear (`provider: linear`) — issue create/update with filters
- Sentry (`provider: sentry`) — issue events with project/environment/severity filters

Standalone:
- PostHog (`provider: posthog`) — event webhooks from PostHog
- Webhook (`provider: webhook`) — generic POST endpoint
- Scheduled (`provider: scheduled`) — cron-based runs

## Trigger setup by type

### GitHub / Linear / Sentry (Nango)

These require a Nango connection. The trigger-service receives Nango forwarded webhooks and creates trigger events.

Key code paths:
- Trigger definitions: `packages/triggers/src/service/adapters/*-nango.ts`
- Trigger-service webhook ingress: `apps/trigger-service/src/api/webhooks.ts`
- Trigger processor (creates runs + events): `packages/services/src/triggers/processor.ts`

### PostHog (Webhook destination)

PostHog sends events to an automation-scoped webhook endpoint.

Endpoint format:
- `POST /api/webhooks/posthog/{automationId}`

Filters:
- Event names (optional)
- Property filters (optional)

Signature verification:
- If you enable “Require signature verification” on the trigger, the server will require a valid signature or token.
- This is enforced by `PostHogProvider.verifyWebhook`, which supports HMAC signatures (header `X-PostHog-Signature`) or a token header (`X-PostHog-Token` or `Authorization: Bearer ...`).
- If your PostHog instance does not send a signature, leave signature verification disabled.

Key code paths:
- Provider logic: `packages/triggers/src/posthog.ts`
- Webhook handler: `apps/web/src/app/api/webhooks/posthog/[automationId]/route.ts`

### Generic Webhook

Endpoint format:
- `POST /api/webhooks/automation/{automationId}`

If “Require signature verification” is enabled, we validate HMAC-SHA256 against one of:
- `X-Webhook-Signature`
- `X-Signature`
- `X-Hub-Signature-256` (without the `sha256=` prefix)
- `X-Signature-256`

Key code path:
- `apps/web/src/app/api/webhooks/automation/[automationId]/route.ts`

### Scheduled

Cron-based triggers are managed via the automations UI. Runs are created on schedule.

## Notes

- Trigger events create automation runs via `runs.createRunFromTriggerEvent` (transactional run + trigger_event + outbox enqueue).
- Deduplication uses provider-level dedup keys when available.
