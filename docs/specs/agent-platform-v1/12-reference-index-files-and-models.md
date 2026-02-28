# Reference Index: Files and Data Models

## Purpose
This index is the enforcement layer for "fully referenced" specs.

Use this to verify that each subsystem spec points to concrete implementation files and concrete data models.

## 1) System map

Spec:
- [00-system-file-tree.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/00-system-file-tree.md)

Primary implementation files:
- `/Users/pablo/proliferate/apps/web/src/server/routers/actions.ts`
- `/Users/pablo/proliferate/apps/web/src/server/routers/automations.ts`
- `/Users/pablo/proliferate/apps/web/src/server/routers/integrations.ts`
- `/Users/pablo/proliferate/apps/web/src/server/routers/sessions.ts`
- `/Users/pablo/proliferate/apps/web/src/server/routers/triggers.ts`
- `/Users/pablo/proliferate/apps/gateway/src/hub/session-hub.ts`
- `/Users/pablo/proliferate/apps/gateway/src/hub/session-runtime.ts`
- `/Users/pablo/proliferate/apps/worker/src/automation/index.ts`
- `/Users/pablo/proliferate/apps/trigger-service/src/api/webhooks.ts`

Primary data models:
- `sessions` (`packages/db/src/schema/sessions.ts`)
- `automations` (`packages/db/src/schema/automations.ts`)
- `triggers`, `trigger_events` (`packages/db/src/schema/triggers.ts`)
- `integrations`, `repo_connections` (`packages/db/src/schema/integrations.ts`)
- `action_invocations`, `org_connectors`, `outbox` (`packages/db/src/schema/schema.ts`)
- `billing_events` (`packages/db/src/schema/billing.ts`)

## 2) Required functionality and UX

Spec:
- [01-required-functionality-and-ux.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/01-required-functionality-and-ux.md)

Primary implementation files:
- `/Users/pablo/proliferate/apps/web/src/server/routers/automations.ts`
- `/Users/pablo/proliferate/apps/web/src/server/routers/sessions.ts`
- `/Users/pablo/proliferate/apps/gateway/src/hub/session-runtime.ts`
- `/Users/pablo/proliferate/apps/worker/src/automation/finalizer.ts`

Primary data models:
- `automations`, `sessions`, `triggers`, `trigger_events`
- `action_invocations`, `outbox`, `org_connectors`
- `session_notification_subscriptions`

## 3) E2B interface and usage

Spec:
- [02-e2b-interface-and-usage.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/02-e2b-interface-and-usage.md)

Primary implementation files:
- `/Users/pablo/proliferate/packages/shared/src/providers/e2b.ts`
- `/Users/pablo/proliferate/packages/shared/src/providers/index.ts`
- `/Users/pablo/proliferate/packages/shared/src/snapshot-resolution.ts`
- `/Users/pablo/proliferate/apps/gateway/src/hub/session-runtime.ts`

Primary data models:
- `sessions`
- `configurations`
- `repos`

## 4) Actions, OAuth, MCP, and org usage

Spec:
- [03-action-registry-and-org-usage.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/03-action-registry-and-org-usage.md)

Primary implementation files:
- `/Users/pablo/proliferate/apps/gateway/src/api/proliferate/http/actions.ts`
- `/Users/pablo/proliferate/packages/services/src/actions/service.ts`
- `/Users/pablo/proliferate/packages/services/src/actions/db.ts`
- `/Users/pablo/proliferate/packages/services/src/actions/modes.ts`
- `/Users/pablo/proliferate/packages/services/src/actions/connectors/`
- `/Users/pablo/proliferate/packages/services/src/integrations/tokens.ts`
- `/Users/pablo/proliferate/packages/services/src/connectors/service.ts`
- `/Users/pablo/proliferate/packages/services/src/secrets/service.ts`

Primary data models:
- `action_invocations`
- `integrations`
- `org_connectors`
- `organization.action_modes`
- `automations.action_modes`
- `outbox`
- `sessions` (for session-scoped git/identity context and audit linkage)

## 5) Long-running coworkers

Spec:
- [04-long-running-agents.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/04-long-running-agents.md)

Primary implementation files:
- `/Users/pablo/proliferate/apps/worker/src/automation/index.ts`
- `/Users/pablo/proliferate/apps/worker/src/automation/resolve-target.ts`
- `/Users/pablo/proliferate/apps/worker/src/automation/finalizer.ts`
- `/Users/pablo/proliferate/apps/trigger-service/src/polling/worker.ts`
- `/Users/pablo/proliferate/packages/services/src/runs/service.ts`

Primary data models:
- `automations`
- `triggers`, `trigger_events`
- `automation_runs`
- `sessions`
- `outbox`

## 6) Trigger services

Spec:
- [05-trigger-services.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/05-trigger-services.md)

Primary implementation files:
- `/Users/pablo/proliferate/apps/trigger-service/src/api/webhooks.ts`
- `/Users/pablo/proliferate/apps/trigger-service/src/webhook-inbox/worker.ts`
- `/Users/pablo/proliferate/apps/trigger-service/src/polling/worker.ts`
- `/Users/pablo/proliferate/packages/services/src/triggers/service.ts`
- `/Users/pablo/proliferate/packages/services/src/triggers/db.ts`
- `/Users/pablo/proliferate/packages/services/src/webhook-inbox/db.ts`

Primary data models:
- `triggers`
- `trigger_events`
- `trigger_event_actions`
- `trigger_poll_groups`
- `webhook_inbox`

## 7) Gateway runtime

Spec:
- [06-gateway-functionality.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/06-gateway-functionality.md)

Primary implementation files:
- `/Users/pablo/proliferate/apps/gateway/src/hub/session-hub.ts`
- `/Users/pablo/proliferate/apps/gateway/src/hub/session-runtime.ts`
- `/Users/pablo/proliferate/apps/gateway/src/hub/event-processor.ts`
- `/Users/pablo/proliferate/apps/gateway/src/api/proliferate/http/actions.ts`
- `/Users/pablo/proliferate/apps/gateway/src/api/proliferate/http/tools.ts`

Primary data models:
- `sessions`
- `action_invocations`
- `integrations`, `org_connectors`
- `outbox`

## 8) Cloud billing

Spec:
- [07-cloud-billing.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/07-cloud-billing.md)

Primary implementation files:
- `/Users/pablo/proliferate/apps/web/src/server/routers/billing.ts`
- `/Users/pablo/proliferate/apps/worker/src/billing/worker.ts`
- `/Users/pablo/proliferate/apps/worker/src/jobs/billing/outbox.job.ts`
- `/Users/pablo/proliferate/packages/services/src/billing/metering.ts`
- `/Users/pablo/proliferate/packages/services/src/billing/gate.ts`

Primary data models:
- `billing_events`
- `llm_spend_cursors`
- `billing_reconciliations`
- `sessions` (metering context)

## 9) Coding harnesses

Spec:
- [08-coding-agent-harnesses.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/08-coding-agent-harnesses.md)

Primary implementation files:
- `/Users/pablo/proliferate/packages/shared/src/sandbox/opencode.ts`
- `/Users/pablo/proliferate/packages/shared/src/sandbox/config.ts`
- `/Users/pablo/proliferate/packages/shared/src/opencode-tools/index.ts`
- `/Users/pablo/proliferate/apps/gateway/src/api/proliferate/http/tools.ts`

Primary data models:
- `sessions`
- `action_invocations`
- `integrations`, `org_connectors`
- `outbox`

## 10) Notifications

Spec:
- [09-notifications.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/09-notifications.md)

Primary implementation files:
- `/Users/pablo/proliferate/packages/services/src/notifications/service.ts`
- `/Users/pablo/proliferate/packages/services/src/notifications/db.ts`
- `/Users/pablo/proliferate/packages/services/src/outbox/service.ts`
- `/Users/pablo/proliferate/apps/worker/src/automation/notifications.ts`

Primary data models:
- `outbox`
- `session_notification_subscriptions`
- `automations.notification_*`
- `automation_runs`, `sessions`

## 11) Layering and mapping

Spec:
- [10-layering-and-mapping-rules.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/10-layering-and-mapping-rules.md)

Primary implementation files:
- `/Users/pablo/proliferate/apps/web/src/server/routers/*`
- `/Users/pablo/proliferate/apps/gateway/src/api/*`
- `/Users/pablo/proliferate/packages/services/src/**/service.ts`
- `/Users/pablo/proliferate/packages/services/src/**/db.ts`
- `/Users/pablo/proliferate/packages/services/src/**/mapper.ts`

Primary data model ownership map:
- Sessions/runtime -> `packages/db/src/schema/sessions.ts`
- Integrations/connectors -> `packages/db/src/schema/integrations.ts`, `packages/db/src/schema/schema.ts`
- Actions/approvals -> `packages/db/src/schema/schema.ts`
- Triggers/events -> `packages/db/src/schema/triggers.ts`
- Billing -> `packages/db/src/schema/billing.ts`

## 12) Streaming and preview transport

Spec:
- [11-streaming-preview-transport-v2.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/11-streaming-preview-transport-v2.md)

Primary implementation files:
- `/Users/pablo/proliferate/apps/gateway/src/api/proliferate/ws/`
- `/Users/pablo/proliferate/apps/gateway/src/api/proxy/`
- `/Users/pablo/proliferate/apps/gateway/src/hub/session-runtime.ts`
- `/Users/pablo/proliferate/packages/shared/src/providers/e2b.ts`
- `/Users/pablo/proliferate/packages/sandbox-daemon/`

Primary data models:
- `sessions`
- `action_invocations`
- `automation_runs`
- `billing_events`

## 13) Self-hosting and updates

Spec:
- [13-self-hosting-and-updates.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/13-self-hosting-and-updates.md)

Primary implementation files:
- `/Users/pablo/proliferate/charts/proliferate/`
- `/Users/pablo/proliferate/infra/pulumi-k8s/`
- `/Users/pablo/proliferate/infra/pulumi-k8s-gcp/`
- `/Users/pablo/proliferate/packages/environment/src/schema.ts`
- `/Users/pablo/proliferate/packages/db/drizzle/`

Primary data models:
- `sessions`
- `action_invocations`
- `automation_runs`
- `outbox`
- `billing_events`

## 14) Boot snapshot contract

Spec:
- [14-boot-snapshot-contract.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/14-boot-snapshot-contract.md)

Primary implementation files:
- `/Users/pablo/proliferate/apps/gateway/src/hub/session-runtime.ts`
- `/Users/pablo/proliferate/apps/gateway/src/api/proliferate/http/actions.ts`
- `/Users/pablo/proliferate/packages/services/src/actions/service.ts`
- `/Users/pablo/proliferate/packages/services/src/sessions/service.ts`

Primary data models:
- `sessions`
- `automation_runs`
- `action_invocations`
- env bundle reference fields resolved at runtime (see `14-boot-snapshot-contract.md`)

## 15) LLM proxy architecture

Spec:
- [15-llm-proxy-architecture.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/15-llm-proxy-architecture.md)

Primary implementation files:
- `/Users/pablo/proliferate/apps/llm-proxy/litellm/config.yaml`
- `/Users/pablo/proliferate/apps/llm-proxy/Dockerfile`
- `/Users/pablo/proliferate/packages/shared/src/llm-proxy.ts`
- `/Users/pablo/proliferate/packages/services/src/sessions/sandbox-env.ts`
- `/Users/pablo/proliferate/packages/services/src/billing/litellm-api.ts`
- `/Users/pablo/proliferate/apps/worker/src/jobs/billing/llm-sync-dispatcher.job.ts`
- `/Users/pablo/proliferate/apps/worker/src/jobs/billing/llm-sync-org.job.ts`

Primary data models:
- `llm_spend_cursors`
- `billing_events`
- `sessions`
- `organization`

## Reference quality checklist
- Every subsystem spec includes an implementation file-tree section.
- Every subsystem spec includes core data-model references.
- All action/integration/security claims reference service and schema files.
- Router specs keep transport-only boundaries explicit.
