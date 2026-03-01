# Notification Mechanisms for Agents

## Goal
Make notifications reliable, low-noise, and actionable for both interactive runs and long-running coworkers.

## Product behavior
Notifications should answer:
- What happened?
- Does a human need to act?
- Where do I click to inspect/fix/approve?

They should also support a coworker-style communication model:
- Per-coworker thread/channel destination
- Optional "ping me on every meaningful update" mode
- Immediate escalation for blocked/approval-required states

## Notification event types (V1)
Required:
- `approval_required`
- `approval_resolved`
- `run_started`
- `run_blocked`
- `run_failed`
- `run_completed`
- `agent_health_degraded`

Optional in V1.1:
- `digest_daily`
- `digest_weekly`

## Delivery channels
V1 required channels:
- In-app notifications center (durable source of truth)
- Slack (primary external channel)

V1.1+ channels:
- Email
- Webhook sink
- Desktop push

## Architecture model
Use durable outbox + async dispatch.

Current code anchors:
- [notifications service](/Users/pablo/proliferate/packages/services/src/notifications/service.ts)
- [notifications db](/Users/pablo/proliferate/packages/services/src/notifications/db.ts)
- [outbox service](/Users/pablo/proliferate/packages/services/src/outbox/service.ts)
- [worker notification dispatch](/Users/pablo/proliferate/apps/worker/src/automation/notifications.ts)

## Notifications file tree

```text
packages/services/src/notifications/
  service.ts                  # notification intents + enqueue
  db.ts                       # subscriptions and notify markers

packages/services/src/outbox/
  service.ts                  # claim/retry/dispatched/failed transitions

apps/worker/src/automation/
  notifications.ts            # run notification formatting + delivery
  outbox-dispatch.ts          # generic outbox dispatch loop
```

## Core data models

| Model | Purpose | File |
|---|---|---|
| `outbox` | Durable queue and retry/lease state for notification delivery | `packages/db/src/schema/schema.ts` (`outbox`) |
| `session_notification_subscriptions` | Per-user per-session subscription preferences and delivery marker | `packages/db/src/schema/slack.ts` |
| `automations.notification_*` fields | Coworker-level destination defaults | `packages/db/src/schema/automations.ts` |
| `automation_runs` / `sessions` | Source state for notification content and deep links | `packages/db/src/schema/schema.ts`, `packages/db/src/schema/sessions.ts` |
| `automation_run_events` | Durable timeline/audit events consumed by notification and session views | `packages/db/src/schema/schema.ts` (`automationRunEvents`) |

## State layering contract (required)

To avoid mixing concerns, treat these as separate layers:

1. Entity statuses (source of truth for lifecycle)
- `action_invocations.status`: `pending | approved | denied | completed | failed | expired`
- `sessions.status`: `starting | running | paused | stopped | failed`
- `automation_runs.status`: orchestration lifecycle status values

2. Timeline events (durable history, append-focused)
- examples: `approval_required`, `approval_resolved`, `resume_queued`, `resuming`, `continued`, `resume_failed`
- stored durably and shown in run/session timelines

3. Notification intents (delivery tasks)
- records queued for in-app notifications center / Slack / email channels
- created from status changes + timeline events under noise-control policy

## End-to-end flow
1. Runtime status changes (or approval requirement occurs)
2. System writes durable notification intent (outbox + subscription state)
3. Dispatcher claims pending outbox rows
4. Channel delivery attempt runs
5. Delivery result stored (`sent`, `failed`, `retrying`, `dead_letter`)
6. UI reflects latest state from DB

Approval-resume durable timeline chain:
- `approval_required`
- `approval_resolved` (`approved` / `denied` / `expired`)
- `resume_queued`
- `resuming` (or `continued` when fallback continuation session is created)
- terminal outcome: `run_completed` / `run_failed` / `resume_failed`

## Recipient resolution model
Resolve recipients by precedence:
1. Run/session-level override
2. Coworker-level notification config
3. Org defaults
4. User notification preferences (mute/escalation)

## Required payload fields
Every notification should include:
- organizationId
- automationId and/or automationRunId and/or sessionId
- event type
- short title
- human-readable summary
- deep link(s) to run/session/approval
- severity
- createdAt

For approvals, include:
- requested action
- reason
- invocation id
- expiry timestamp
- approval links
- origin session/run references

## Reliability rules
- Use idempotency key per notification intent
- Retries with backoff for transient channel errors
- Dead-letter after max attempts
- Never lose notifications due to websocket disconnects (DB is source of truth)

## Noise control rules
- Coalesce repeated events for same run in short window
- Avoid sending both "started" and immediate "failed" spam chains
- Use digest mode for low-priority updates
- Always send `approval_required` immediately

## Security and privacy rules
- Do not include secrets in notification payloads
- Limit sensitive stack traces in external channels
- Keep full details in app (linked secure page)
- Record who approved/denied in audit trail

## UX requirements

### In-app notifications center
Must support:
- Filter by status/severity/type
- Mark read/unread
- Approve/deny from notification context where applicable (or deep-link to session approval surface)
- Deny with reason (optional text)
- Clear link to session detail and artifacts
- Show action context (what will happen, target resource, requester/run identity, and expiry)

### Slack
Must support:
- Human-readable summary
- Button/link to "View Run" and "Review Approval"
- For approval-required, clear call-to-action with deep link to web sessions filters/detail (Slack-native approve/deny is optional, not required in V1)
- Stable thread/channel targeting for each coworker when configured

Approval timeout rule:
- Approval-required notifications must show a clear expiration window (`24h` default).
- On expiration, send follow-up status notification (`expired`) and keep durable audit trail.

External push noise policy:
- External channels should not receive every resume-state transition by default.
- Required external pushes:
  - `approval_required`
  - `resume_failed`
  - final resumed/continued outcome (`run_completed` / `run_failed`)
- `approval_resolved` external push is optional by org preference; durable in-app timeline remains required.

## Cloud billing tie-in
Notification usage may become billable later, but V1 treats notification dispatch as operational cost, not primary billing dimension.

## Non-goals (V1)
- Full campaign-style notification rules engine
- Arbitrary user-built workflows for notification routing
- Multi-channel fanout policies with complex conditional trees

## Definition of done checklist
- [ ] Notification intents are written durably
- [ ] Dispatcher retries and marks final delivery status
- [ ] In-app notifications center shows reliable DB-backed notifications
- [ ] Slack notifications include actionable deep links
- [ ] Approval-required notifications are immediate and auditable
- [ ] Coworker-level destination preferences are respected
