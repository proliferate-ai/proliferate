# Trigger Services (GitHub, Linear, Sentry, Slack)

## Goal
Turn external events into reliable internal work requests for agents.

## Core rule
Trigger-service ingests and persists events quickly, then async workers process them.
Do not run heavy agent logic directly in webhook HTTP handlers.

Current key files:
- [webhooks ingestion](/Users/pablo/proliferate/apps/trigger-service/src/api/webhooks.ts)
- [webhook inbox worker](/Users/pablo/proliferate/apps/trigger-service/src/webhook-inbox/worker.ts)
- [polling worker](/Users/pablo/proliferate/apps/trigger-service/src/polling/worker.ts)
- [trigger services](/Users/pablo/proliferate/packages/services/src/triggers)

## V1 trigger scope
Required:
- GitHub (mentions, issue/PR events, CI signal entrypoints)
- Linear (issue updates/comments)
- Sentry (issue events)
- Slack (mentions/commands)

Optional/later:
- PostHog batch analysis
- Jira parity for enterprise bundles

## Wake model (recommended)
Use both methods:
- Webhooks for immediate user/issue events
- Polling for periodic backlog scans and resilience

Why both:
- Webhooks are fast but can miss events
- Polling is reliable but slower and rate-limited
- Together they provide speed + recovery

## Event pipeline
1. Receive event from provider
2. Validate source/signature
3. Persist inbox row
4. Ack provider quickly
5. Worker claims inbox row
6. Match to target agent(s)
7. Create trigger event + run/session request
8. Dispatch work via outbox/worker pipeline

## Dedup and idempotency
Must dedupe on:
- Provider event id
- Content hash + source + time window

Must support safe reprocessing if worker crashes.

## Trigger-to-agent mapping
Mapping model should support:
- Org-level agent owning source (for example global Sentry triager)
- Repo/project scoped agent binding
- Manual override in UI

## UX expectations
Users should not configure brittle technical trigger graphs for V1.
They should configure:
- Which sources this agent watches
- Which projects/repos are included
- Poll cadence (if applicable)

## Definition of done checklist
- [ ] Webhook ingestion is durable and async
- [ ] Polling path exists for at least one provider batch source
- [ ] Dedup prevents duplicate run storms
- [ ] Trigger events map cleanly to target agents
- [ ] Trigger failures are visible and retryable
