# Reference Index: Files and Data Models

## Purpose
This index verifies that each subsystem spec maps to concrete implementation files and concrete data models.

## Shared model baseline (V1)

Core runtime entities referenced across this spec pack:
- `automations`
- `automation_runs`
- `sessions` (manager, worker, ad-hoc)
- `session_capabilities` (target)
- `session_skills` (target)
- `session_messages` (target)
- `action_invocations`
- `triggers`, `trigger_events`
- `outbox`

## Clean-slate DB table inventory (explicit)

This section is the canonical clean-slate table inventory for V1 planning/codegen.

Auth and org:
- `users`
- `auth_sessions`
- `auth_accounts`
- `organizations`
- `organization_members`
- `organization_invitations`
- `user_access_tokens`
- `cli_device_codes`

Repo, onboarding, env:
- `repos`
- `repo_connections`
- `env_bundles`
- `env_bundle_items`
- `repo_baselines`
- `repo_baseline_targets`
- `workspace_cache_snapshots`

Integrations and tools:
- `integrations`
- `integration_credentials`
- `org_connectors`
- `org_connector_tools`

Skills and capability policy:
- `skills`
- `organization_capability_policies`
- `automation_capabilities`
- `automation_skills`

Coworkers and wakes:
- `automations`
- `automation_source_bindings`
- `automation_schedules`
- `automation_source_cursors`
- `wake_events`
- `webhook_inbox`
- `automation_runs`
- `automation_run_events`
- `automation_checkpoints`

Sessions and runtime:
- `sessions`
- `session_capabilities`
- `session_skills`
- `session_messages`
- `session_events`
- `session_checkpoints`
- `session_acl`
- `session_tool_calls`
- `session_pull_requests`
- `artifacts`

Approvals and actions:
- `action_invocations`
- `action_invocation_events`
- `resume_intents`

Notifications:
- `notifications`
- `notification_preferences`
- `session_subscriptions`
- `slack_threads`
- `outbox`

Billing:
- `billing_event_keys`
- `billing_events`
- `llm_spend_cursors`
- `billing_reconciliations`

Locked modeling assumptions:
- One persistent manager session per automation (`automations.managerSessionId` target linkage).
- One active repo baseline per repo at a time (`repo_baselines` active/version contract).
- Denied capabilities are absent from session materialization (session rows only carry allow/approval-capable bindings).
- Org visibility defaults through `sessions.visibility = 'org'`; private sharing uses `session_acl`.
- Env bundles are encrypted at rest; runtime sessions reference bundle IDs, not plaintext values.

### Clean-slate table detail (keys and invariants)

Auth and org detail:
- `users`: canonical human/operator identity.
- `auth_sessions`: login session state (`user_id`, expiry, revocation state).
- `auth_accounts`: provider account linkage (`provider`, `provider_account_id`, `user_id`) with unique `(provider, provider_account_id)`.
- `organizations`: tenancy root (`slug`, plan/billing status, security defaults).
- `organization_members`: membership and role with unique `(organization_id, user_id)`.
- `organization_invitations`: pending invite lifecycle (`email`, `role`, `expires_at`, status).
- `user_access_tokens`: personal API tokens (hashed at rest, scoped, revocable).
- `cli_device_codes`: device auth challenge rows (`user_code`, `device_code`, polling expiry/state).

Repo, onboarding, env detail:
- `repos`: org repo identity (`organization_id`, provider metadata, default branch).
- `repo_connections`: integration-installation/repo binding (`repo_id`, `integration_id`) unique per pair.
- `env_bundles`: encrypted env bundle metadata (`organization_id`, name, version, digest).
- `env_bundle_items`: encrypted key/value payload rows linked to bundle version.
- `repo_baselines`: per-repo runnable baseline (`repo_id`, status, active flag, env bundle refs, working dir, command set, preview hints).
- `repo_baseline_targets`: named monorepo target rows under baseline (`baseline_id`, `target_name`, run/test/install overrides).
- `workspace_cache_snapshots`: optional E2B cache/snapshot pointers linked to repo baseline lineage.

Integrations and tools detail:
- `integrations`: org integration records (provider install/account linkage, enabled state).
- `integration_credentials`: encrypted token material or credential pointers with rotation metadata.
- `org_connectors`: org-level MCP connector config and enable/disable status.
- `org_connector_tools`: discovered normalized tool catalog per connector with stable `tool_id` and schema metadata.

Skills and capability policy detail:
- `skills`: skill registry (`skill_key`, versioning metadata, instruction payload refs).
- `organization_capability_policies`: org default capability policy template by capability key.
- `automation_capabilities`: automation-level capability defaults (allow/approval templates only; no surfaced deny for session materialization).
- `automation_skills`: default skill attachments at automation level (`automation_id`, `skill_id`, `version`).

Coworkers and wakes detail:
- `automations`: durable coworker identity/objective with `manager_session_id` (target) and default visibility/policy.
- `automation_source_bindings`: source/provider bindings (Sentry/Linear/GitHub etc.) per automation.
- `automation_schedules`: cadence/tick config and enablement state.
- `automation_source_cursors`: per-source checkpoint cursor state for incremental polling.
- `wake_events`: normalized wake records (tick/webhook/manual) with dedupe key and processing status.
- `webhook_inbox`: raw inbound webhook payload store + normalization status.
- `automation_runs`: one row per wake, linked to automation and manager session, with run lifecycle status.
- `automation_run_events`: ordered timeline/audit events for each run.
- `automation_checkpoints`: durable per-wake summary checkpoints for manager fallback reconstruction.

Sessions and runtime detail:
- `sessions`: core execution entity (`kind`, `automation_id`, optional `automation_run_id`, `visibility`, repo/baseline linkage, compute linkage, status fields).
- `session_capabilities`: immutable session-scoped permission rows (`capability_key`, mode, scope, credential policy) unique by `(session_id, capability_key, scope_key?)`.
- `session_skills`: immutable skill bindings per session (`session_id`, `skill_id`, `version`).
- `session_messages`: queued instruction/event rows with sender/recipient direction + delivery state.
- `session_events`: durable timeline events for status/runtime transitions.
- `session_checkpoints`: resumable or summary checkpoints for continuation/recovery.
- `session_acl`: explicit access grants for private/shareable sessions (viewer/editor/reviewer roles).
- `session_tool_calls`: normalized tool-call trace rows for observability/replay.
- `session_pull_requests`: PR linkage metadata created/observed during session.
- `artifacts`: generic artifact catalog (`owner_type`, `owner_id`, `kind`, `storage_ref`, digest, retention fields).

Approvals and actions detail:
- `action_invocations`: side-effect attempts (always `session_id`; also `automation_run_id` for manager-side actions) with mode, actor, credential owner, status.
- `action_invocation_events`: append-only state transition history for each invocation.
- `resume_intents`: durable approval-resolution resume orchestration keyed uniquely by `(origin_session_id, invocation_id)`.

Notifications detail:
- `notifications`: durable user/org notification records and read state.
- `notification_preferences`: per-user/channel preference controls.
- `session_subscriptions`: session follow/subscription rows for routing updates.
- `slack_threads`: mapping between internal entities and Slack thread/channel identities.
- `outbox`: reliable async dispatch queue for notifications/webhooks/fanout side effects.

Billing detail:
- `billing_event_keys`: idempotency/dedupe keys for billing ingestion.
- `billing_events`: normalized usage ledger rows (compute/runtime + LLM usage events).
- `llm_spend_cursors`: per-org/provider sync cursors for spend ingestion.
- `billing_reconciliations`: correction/reconciliation audit records.

Policy materialization note:
- `organization_capability_policies` may include explicit `hidden` template semantics.
- Session materialization in `session_capabilities` remains allow/approval only.
- Effective hidden behavior at runtime means "no capability row materialized for this session."

### V1 decisions explicitly locked

- `action_invocations` are for side-effecting writes/destructive actions; read/query calls are traced via session tool/timeline events.
- Manager transcript continuity uses bounded compaction summaries to prevent unbounded prompt growth.
- Mid-session skill edits do not hot-inject; manager changes apply next wake, worker changes apply on new worker sessions.
- Workspace snapshot loss never blocks execution by itself; baseline + git freshness + recipes are correctness source.
- Manager is orchestration-first and does not directly execute coding tasks in V1 default policy.
- Visibility inheritance defaults from creator context and can only be narrowed within policy bounds.

## 1) System map
Spec:
- [00-system-file-tree.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/00-system-file-tree.md)

Primary files:
- `/Users/pablo/proliferate/apps/web/src/server/routers/actions.ts`
- `/Users/pablo/proliferate/apps/web/src/server/routers/automations.ts`
- `/Users/pablo/proliferate/apps/web/src/server/routers/sessions.ts`
- `/Users/pablo/proliferate/apps/gateway/src/hub/session-runtime.ts`
- `/Users/pablo/proliferate/apps/worker/src/automation/index.ts`

Primary models:
- `automations`, `automation_runs`, `sessions`
- `session_capabilities`, `session_skills`, `session_messages` (target)
- `action_invocations`, `outbox`

## 2) Required functionality and UX
Spec:
- [01-required-functionality-and-ux.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/01-required-functionality-and-ux.md)

Primary files:
- `/Users/pablo/proliferate/apps/web/src/server/routers/automations.ts`
- `/Users/pablo/proliferate/apps/web/src/server/routers/sessions.ts`
- `/Users/pablo/proliferate/apps/worker/src/automation/index.ts`

Primary models:
- `automations`, `automation_runs`, `sessions`
- `session_capabilities`, `session_skills`, `session_messages` (target)
- `action_invocations`, `outbox`

## 3) E2B interface and usage
Spec:
- [02-e2b-interface-and-usage.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/02-e2b-interface-and-usage.md)

Primary files:
- `/Users/pablo/proliferate/packages/shared/src/providers/e2b.ts`
- `/Users/pablo/proliferate/apps/gateway/src/hub/session-runtime.ts`

Primary models:
- `sessions`
- `repos`
- `repo_baselines` (target)

## 4) Actions, OAuth, MCP, org usage
Spec:
- [03-action-registry-and-org-usage.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/03-action-registry-and-org-usage.md)

Primary files:
- `/Users/pablo/proliferate/apps/gateway/src/api/proliferate/http/actions.ts`
- `/Users/pablo/proliferate/packages/services/src/actions/service.ts`
- `/Users/pablo/proliferate/packages/services/src/integrations/tokens.ts`

Primary models:
- `action_invocations`
- `integrations`, `org_connectors`
- `sessions`, `session_capabilities` (target)

## 5) Long-running coworkers
Spec:
- [04-long-running-agents.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/04-long-running-agents.md)

Primary files:
- `/Users/pablo/proliferate/apps/worker/src/automation/index.ts`
- `/Users/pablo/proliferate/packages/services/src/runs/service.ts`
- `/Users/pablo/proliferate/packages/services/src/sessions/service.ts`

Primary models:
- `automations`
- `automation_runs`
- `sessions`
- `session_messages` (target)

## 6) Trigger services
Spec:
- [05-trigger-services.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/05-trigger-services.md)

Primary models:
- `triggers`
- `trigger_events`
- `webhook_inbox`

## 7) Gateway runtime
Spec:
- [06-gateway-functionality.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/06-gateway-functionality.md)

Primary models:
- `sessions`
- `session_capabilities` (target)
- `action_invocations`
- `outbox`

## 8) Cloud billing
Spec:
- [07-cloud-billing.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/07-cloud-billing.md)

Primary models:
- `billing_events`
- `sessions`

## 9) Coding harnesses
Spec:
- [08-coding-agent-harnesses.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/08-coding-agent-harnesses.md)

Primary models:
- `sessions`
- `session_capabilities` (target)
- `action_invocations`

## 10) Notifications
Spec:
- [09-notifications.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/09-notifications.md)

Primary models:
- `outbox`
- `automation_runs`, `sessions`
- `session_notification_subscriptions`

## 11) Layering and mapping
Spec:
- [10-layering-and-mapping-rules.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/10-layering-and-mapping-rules.md)

## 12) Streaming and preview transport
Spec:
- [11-streaming-preview-transport-v2.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/11-streaming-preview-transport-v2.md)

Primary models:
- `sessions`
- `action_invocations`
- `automation_runs`

## 13) Self-hosting and updates
Spec:
- [13-self-hosting-and-updates.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/13-self-hosting-and-updates.md)

Primary models:
- `sessions`
- `automation_runs`
- `action_invocations`
- `outbox`

## 14) Session runtime contract
Spec:
- [14-boot-snapshot-contract.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/14-boot-snapshot-contract.md)

Primary models:
- `sessions`
- `session_capabilities` (target)
- `session_skills` (target)
- `session_messages` (target)
- `automation_runs`
- `action_invocations`

## 15) LLM proxy architecture
Spec:
- [15-llm-proxy-architecture.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/15-llm-proxy-architecture.md)

## 16) Agent tool contract
Spec:
- [16-agent-tool-contract.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/16-agent-tool-contract.md)

Primary models:
- `sessions`
- `session_capabilities` (target)
- `session_skills` (target)
- `session_messages` (target)
- `action_invocations`

## 17) Entity ontology and lifecycle
Spec:
- [17-entity-ontology-and-lifecycle.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/17-entity-ontology-and-lifecycle.md)

Primary models:
- `automations`
- `automation_runs`
- `sessions`
- `session_capabilities` (target)
- `session_skills` (target)
- `session_messages` (target)
- `action_invocations`

## 18) Repo onboarding and baseline lifecycle
Spec:
- [18-repo-onboarding-and-configuration-lifecycle.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/18-repo-onboarding-and-configuration-lifecycle.md)

Primary models:
- `repos`
- `repo_baselines` (target)
- `repo_baseline_targets` (target)
- `sessions`

## 19) Artifacts and retention
Spec:
- [19-artifacts-and-retention.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/19-artifacts-and-retention.md)

Primary models:
- `automation_runs.*ArtifactRef`
- `outbox`

## 20) Code quality contract
Spec:
- [20-code-quality-contract.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/20-code-quality-contract.md)

## Reference quality checklist
- Every subsystem spec includes implementation file references.
- Every subsystem spec includes core data-model references.
- Clean-slate table inventory is explicitly listed in this spec.
- Session capability/skill/message model split is explicit in runtime and tool specs.
- Repo baseline model replaces `configuration*` references in onboarding/runtime docs.
