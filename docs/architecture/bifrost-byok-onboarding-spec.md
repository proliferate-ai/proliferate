# Bifrost BYOK And Managed Credit Onboarding Spec

Status: implemented on `codex/bifrost-byok-onboarding-spec`; remaining live
E2B/Bedrock checks are opt-in environment-gated follow-ups.

Date: 2026-05-25

## Purpose

This spec defines the target implementation for agent LLM authentication in
managed cloud sandboxes:

- free onboarding LLM credits backed by Proliferate-owned provider keys
- BYOK credentials for personal and organization sandboxes
- Bifrost virtual-key materialization
- E2B sandbox auth application
- usage import, credit debit, and exhaustion handling
- local validation with Proliferate env files, AWS CLI, E2B CLI, and Bifrost

The core decision is that Bifrost is the LLM data plane. Proliferate is the
product and billing control plane.

```text
agent harness in sandbox
  -> Bifrost public endpoint
  -> model provider
  -> streamed response

Proliferate server
  -> owns users, orgs, entitlements, billing, sandbox profiles, and auth choices
  -> stores BYOK credentials encrypted
  -> materializes provider keys and virtual keys into Bifrost
  -> writes Bifrost virtual keys into managed sandboxes
  -> imports Bifrost logs/costs into Proliferate usage ledgers
```

This supersedes the LiteLLM-forwarding data-plane shape in
`docs/architecture/agent-llm-auth-gateway-spec.md` for this workstream. The old
document remains useful as historical context for agent-auth entities and
synced-path auth, but the target request path here is not
`agent -> Proliferate gateway -> LiteLLM -> provider`.

## Docs Read For This Spec

- `docs/README.md`
- `docs/server/README.md`
- `docs/server/guides/database.md`
- `docs/server/guides/integrations.md`
- `docs/server/guides/config.md`
- `docs/reference/dev-profiles.md`
- `docs/reference/env-secrets-matrix.md`
- `docs/architecture/agent-llm-auth-gateway-spec.md`
- `docs/architecture/shared-sandbox-config-admin-ui-spec.md`
- local Bifrost source at `/Users/pablohansen/bifrost`
  - `docs/features/governance/virtual-keys.mdx`
  - `docs/providers/request-options.mdx`
  - `docs/features/keys-management.mdx`
  - `framework/configstore/tables/key.go`
  - `framework/configstore/tables/virtualkey.go`

## Scope

In scope:

- Personal managed LLM credit onboarding.
- Organization/admin BYOK credential setup.
- Personal BYOK credential setup when exposed by product UI.
- Bifrost provider-key and virtual-key materialization.
- Claude Code, Codex, and Gemini CLI routing through Bifrost where the harness
  supports a compatible base URL and key env.
- Bedrock provider configuration through Bifrost for BYOK.
- Usage import from Bifrost logs into Proliferate.
- Credit exhaustion and sandbox launch gating.
- Local smoke tests using root repo `.env` as a developer-provided source,
  official `server/.env.local` process env, AWS CLI, E2B CLI, and a Bifrost
  deployment reachable from E2B.

Out of scope:

- Proliferate hot-path LLM request forwarding.
- Real-time penny-perfect billing enforcement.
- Replacing Bifrost with a custom router.
- Multi-organization membership changes except where billing ownership needs a
  single active organization.
- Organization billing UI in full; this spec only defines the auth/usage
  surfaces it must consume.
- Long-term HA topology for Bifrost. V1 requires an operator-run hosted
  deployment and local-dev profile support.

## Broad Questions To Answer

This section is the reviewer-facing map for the implementation. The deeper
scenario sections below remain the operational detail.

### DB Models

The implementation is intentionally split between billing, organization,
agent-auth, sandbox profile, and Bifrost-materialization records.

| Model | Owns | Important notes |
| --- | --- | --- |
| `Organization` | Team shell and status | Team checkout creates a `pending_checkout` organization first, then Stripe activation marks it `active`. |
| `OrganizationMembership` | Active team membership and role | One active membership per user is enforced, so team creation must fail clearly if the creator already belongs to a team. |
| `OrganizationCheckoutIntent` | In-progress Team upgrade checkout | Stores pending organization, creator, Stripe ids, checkout URL, activation state, expiry, invite emails, and idempotency key. |
| `BillingSubject` and billing grant rows | Cloud and managed-credit budget ownership | Personal account credits and organization/team budgets stay separate. Free LLM credits must not require creating a team. |
| `SandboxProfile` | Personal or organization sandbox config | Holds owner scope, billing subject, desired agent-auth revision, and lifecycle status for the sandbox profile. |
| `SandboxProfileAgentAuthRevision` | Audit point for auth config changes | Bumped when auth choices change so runtime materialization can decide whether sandboxes need new env. |
| `SandboxAgentAuthSelection` | Chosen auth method per agent harness | Connects Claude/Codex/Gemini to managed credit, synced local auth, or BYOK provider credentials. |
| `AgentAuthCredential` | Encrypted personal, organization, or system credential | Stores provider payload ciphertext and redacted metadata. Raw provider secrets are never sent to sandboxes. |
| `AgentAuthCredentialShare` | Share boundary for personal credentials | Allows future personal-to-organization sharing without copying raw secrets. |
| `AgentGatewayProviderCredential` | Provider-specific Bifrost source materialization state | Tracks provider kind, validation status, Bifrost key id, sync status, and model metadata. |
| `AgentGatewayPolicy` | Product policy for how a credential can be used | Connects selections to managed credit or BYOK, model allow-lists, sync status, and Bifrost virtual-key id. |
| `AgentGatewayBudgetSubject` | LLM budget owner | Represents personal or organization LLM spend subject and current credit status. |
| `AgentGatewayFreeCreditEntitlement` | One-time or period-based free LLM credit | Deduped by allocation guard, especially GitHub provider user id. |
| `AgentGatewayRuntimeGrant` | Runtime-scoped auth grant | Historical grant shape remains for compatibility, but active Bifrost runtime auth is materialized through virtual keys. |
| `AgentGatewayRouterMaterialization` | Bifrost provider-key or virtual-key object mapping | `router_kind` is Bifrost-only. Existing `litellm*` API/DB aliases are compatibility names and do not imply a LiteLLM runtime. |
| `AgentGatewayLlmUsageEvent` | Imported Bifrost usage log | Idempotently links Bifrost log ids to Proliferate budget/policy/materialization records. |
| `AgentGatewayUsageImportCursor` | Incremental Bifrost log import cursor | Lets the usage importer resume without double-charging. |

The practical write/read order is:

| Flow | Rows touched |
| --- | --- |
| Team upgrade starts | Create `organization`, `billing_subject`, and `organization_checkout_intent`; keep the organization in `pending_checkout`. |
| Team upgrade completes | Update `organization_checkout_intent`, activate `organization`, create `organization_membership`, upsert `billing_subscription`, and create `organization_invitation` rows for staged invites. |
| Team billing changes | Use `billing_seat_adjustment`, `billing_hold`, `billing_entitlement`, `billing_overage_remainder`, and `webhook_event_receipt` rows to make Stripe side effects idempotent and inspectable. |
| Personal cloud credit starts | Ensure personal `billing_subject`, `sandbox_profile`, `agent_gateway_budget_subject`, and `agent_gateway_free_credit_entitlement` rows. |
| Cloud runtime usage accrues | Write `usage_segment`, `billing_grant_consumption`, `billing_usage_cursor`, and `billing_usage_export` rows for runtime-hour billing. |
| BYOK or managed auth is configured | Write or update `agent_auth_credential`, `agent_gateway_policy`, `agent_gateway_provider_credential`, `sandbox_agent_auth_selection`, `sandbox_profile_agent_auth_revision`, and `agent_auth_audit_event`. |
| Bifrost runtime auth is materialized | Write `agent_gateway_router_materialization`, update `sandbox_profile_target_state`, and retain `agent_gateway_runtime_grant` only for compatibility paths. |
| Bifrost usage is imported | Write `agent_gateway_llm_usage_event` and advance `agent_gateway_usage_import_cursor`. |

<details>
<summary>Field-level DB row inventory</summary>

The inventory below spells out each concrete row/table used by the Team
checkout, billing, sandbox profile, agent-auth, Bifrost materialization, and
usage-import flows. Field names are the persisted ORM column names. Fields with
`litellm_*` names are compatibility storage/API names; the runtime router is
Bifrost-only.

#### `organization`

Row: team shell, including the pending shell created before Stripe activation.

Fields: `id`, `name`, `logo_domain`, `logo_image`, `status`, `created_at`,
`updated_at`.

#### `organization_membership`

Row: one user membership in one active team.

Fields: `id`, `organization_id`, `user_id`, `role`, `status`, `joined_at`,
`removed_at`, `created_at`, `updated_at`.

#### `organization_checkout_intent`

Row: resumable Stripe Checkout attempt for creating or upgrading to a Team.

Fields: `id`, `organization_id`, `created_by_user_id`, `billing_subject_id`,
`team_name`, `status`, `activation_status`, `activation_error_code`,
`activation_error_message`, `last_webhook_event_id`,
`stripe_checkout_session_id`, `stripe_customer_id`, `stripe_subscription_id`,
`idempotency_key`, `invite_emails_json`, `checkout_url`, `expires_at`,
`completed_at`, `failed_at`, `cancelled_at`, `created_at`, `updated_at`.

#### `organization_invitation`

Row: staged or delivered invite into the newly activated Team.

Fields: `id`, `organization_id`, `email`, `role`, `status`, `token_hash`,
`handoff_token_hash`, `handoff_expires_at`, `delivery_status`,
`delivery_error`, `delivered_at`, `invited_by_user_id`, `accepted_by_user_id`,
`expires_at`, `accepted_at`, `revoked_at`, `expired_at`, `created_at`,
`updated_at`.

#### `billing_subject`

Row: budget/accounting owner, either personal or organization.

Fields: `id`, `kind`, `user_id`, `organization_id`, `stripe_customer_id`,
`overage_enabled`, `overage_cap_cents_per_seat`,
`overage_preference_set_at`, `created_at`, `updated_at`.

#### `billing_subscription`

Row: Stripe subscription mirror for a billing subject.

Fields: `id`, `billing_subject_id`, `stripe_subscription_id`,
`stripe_customer_id`, `status`, `cancel_at_period_end`, `canceled_at`,
`current_period_start`, `current_period_end`, `cloud_monthly_price_id`,
`overage_price_id`, `seat_quantity`, `monthly_subscription_item_id`,
`metered_subscription_item_id`, `latest_invoice_id`, `latest_invoice_status`,
`hosted_invoice_url`, `created_at`, `updated_at`.

#### `billing_hold`

Row: billing block or caution attached to a billing subject.

Fields: `id`, `billing_subject_id`, `kind`, `status`, `source`, `source_ref`,
`created_at`, `resolved_at`, `updated_at`.

#### `billing_decision_event`

Row: audit trail for a billing gate decision before or during launch.

Fields: `id`, `billing_subject_id`, `actor_user_id`, `workspace_id`,
`decision_type`, `mode`, `would_block_start`, `would_pause_active`, `reason`,
`active_sandbox_count`, `remaining_seconds`, `created_at`.

#### `billing_grant`

Row: free or purchased runtime-hour grant for a billing subject.

Fields: `id`, `user_id`, `billing_subject_id`, `grant_type`,
`hours_granted`, `remaining_seconds`, `effective_at`, `expires_at`,
`source_ref`, `created_at`, `updated_at`.

#### `free_cloud_allocation`

Row: dedupe guard for account-level free cloud allocation.

Fields: `id`, `allocation_kind`, `github_provider_user_id`,
`billing_subject_id`, `user_id`, `issued_billing_grant_id`, `period_key`,
`status`, `created_at`, `updated_at`.

#### `billing_grant_consumption`

Row: debit from a grant for a specific runtime usage segment.

Fields: `id`, `billing_subject_id`, `billing_grant_id`, `usage_segment_id`,
`accounted_from`, `accounted_until`, `seconds`, `source`, `created_at`.

#### `billing_usage_cursor`

Row: per-usage-segment cursor so runtime billing resumes without double debit.

Fields: `id`, `billing_subject_id`, `usage_segment_id`, `accounted_until`,
`created_at`, `updated_at`.

#### `billing_usage_export`

Row: idempotent export of billable runtime usage to Stripe metering.

Fields: `id`, `billing_subject_id`, `billing_subscription_id`,
`usage_segment_id`, `period_start`, `period_end`, `accounted_from`,
`accounted_until`, `quantity_seconds`, `meter_quantity_cents`,
`cap_cents_snapshot`, `cap_used_cents_snapshot`, `writeoff_reason`,
`idempotency_key`, `stripe_meter_event_identifier`, `status`, `error`,
`created_at`, `updated_at`.

#### `billing_entitlement`

Row: entitlement attached to a billing subject.

Fields: `id`, `user_id`, `billing_subject_id`, `kind`, `effective_at`,
`expires_at`, `note`, `created_at`, `updated_at`.

#### `billing_seat_adjustment`

Row: idempotent Stripe/team seat-count adjustment and related grant issuance.

Fields: `id`, `billing_subject_id`, `billing_subscription_id`,
`organization_id`, `membership_id`, `stripe_subscription_id`,
`monthly_subscription_item_id`, `previous_quantity`, `target_quantity`,
`grant_quantity`, `attempt_count`, `period_start`, `effective_at`,
`source_ref`, `status`, `stripe_confirmed_at`, `grant_issued_at`,
`last_error`, `created_at`, `updated_at`.

#### `billing_overage_remainder`

Row: fractional overage accounting remainder for a billing period.

Fields: `id`, `billing_subject_id`, `billing_subscription_id`, `period_start`,
`fractional_cents`, `created_at`, `updated_at`.

#### `usage_segment`

Row: one sandbox runtime usage interval.

Fields: `id`, `user_id`, `billing_subject_id`, `runtime_environment_id`,
`workspace_id`, `sandbox_id`, `external_sandbox_id`,
`sandbox_execution_id`, `started_at`, `ended_at`, `is_billable`,
`opened_by`, `closed_by`, `created_at`, `updated_at`.

#### `webhook_event_receipt`

Row: idempotency receipt for external webhook processing.

Fields: `id`, `event_id`, `provider`, `event_type`, `external_sandbox_id`,
`status`, `attempt_count`, `processing_lease_expires_at`, `last_error`,
`received_at`, `processed_at`, `updated_at`.

#### `sandbox_profile`

Row: personal or organization sandbox configuration root.

Fields: `id`, `owner_scope`, `owner_user_id`, `organization_id`,
`billing_subject_id`, `created_by_user_id`, `desired_agent_auth_revision`,
`status`, `created_at`, `updated_at`, `archived_at`, `deleted_at`.

#### `sandbox_profile_agent_auth_revision`

Row: monotonic revision marker for sandbox auth changes.

Fields: `id`, `sandbox_profile_id`, `revision`, `reason`, `force_restart`,
`created_by_user_id`, `created_at`.

#### `agent_auth_credential`

Row: encrypted system, personal, or organization provider credential.

Fields: `id`, `owner_scope`, `owner_user_id`, `organization_id`,
`created_by_user_id`, `agent_kind`, `credential_kind`, `display_name`,
`redacted_summary_json`, `status`, `revision`, `payload_ciphertext`,
`payload_ciphertext_key_id`, `created_at`, `updated_at`, `revoked_at`.

#### `agent_auth_credential_share`

Row: personal credential share boundary for organization use.

Fields: `id`, `credential_id`, `owner_user_id`, `organization_id`,
`share_scope`, `shared_by_user_id`, `status`, `allowed_agent_kind`,
`created_at`, `revoked_at`, `revoked_by_user_id`.

#### `agent_gateway_budget_subject`

Row: managed LLM credit budget subject for Bifrost-backed auth.

Fields: `id`, `budget_kind`, `owner_scope`, `owner_user_id`,
`organization_id`, `litellm_team_id`, `included_budget_usd`,
`budget_duration`, `entitlement_source`, `entitlement_period_key`,
`litellm_sync_status`, `litellm_sync_fingerprint`, `status`, `revision`,
`last_provisioned_at`, `last_litellm_reconciled_at`, `last_error_code`,
`last_error_message`, `created_at`, `updated_at`.

#### `agent_gateway_free_credit_entitlement`

Row: personal managed LLM credit entitlement.

Fields: `id`, `user_id`, `budget_subject_id`, `source`, `period_key`,
`included_budget_usd`, `status`, `activated_at`, `exhausted_at`,
`revoked_at`, `last_error_code`, `last_error_message`, `created_at`,
`updated_at`.

#### `agent_gateway_policy`

Row: product policy connecting a credential to a managed-credit or BYOK mode.

Fields: `id`, `credential_id`, `policy_kind`, `owner_scope`, `owner_user_id`,
`organization_id`, `budget_subject_id`, `litellm_team_id`,
`litellm_virtual_key_id`, `litellm_virtual_key_ciphertext`,
`litellm_virtual_key_ciphertext_key_id`, `litellm_sync_status`,
`litellm_sync_fingerprint`, `status`, `revision`, `last_provisioned_at`,
`last_litellm_reconciled_at`, `last_error_code`, `last_error_message`,
`created_at`, `updated_at`.

#### `agent_gateway_provider_credential`

Row: provider-specific encrypted payload and validation state for a policy.

Fields: `id`, `policy_id`, `provider_kind`, `payload_ciphertext`,
`payload_ciphertext_key_id`, `redacted_summary_json`, `validation_status`,
`validated_at`, `validation_error_code`, `validation_error_message`,
`revision`, `created_at`, `updated_at`.

#### `sandbox_agent_auth_selection`

Row: chosen auth method for one agent harness on one sandbox profile.

Fields: `id`, `sandbox_profile_id`, `owner_scope`, `agent_kind`,
`credential_id`, `credential_share_id`, `materialization_mode`,
`selected_revision`, `status`, `last_error_code`, `last_error_message`,
`created_at`, `updated_at`.

#### `sandbox_profile_target_state`

Row: target-specific application state for auth and runtime config.

Fields: `id`, `sandbox_profile_id`, `target_id`, `active_sandbox_id`,
`slot_generation`, `desired_agent_auth_revision`,
`applied_agent_auth_revision`, `agent_auth_status`,
`agent_auth_force_restart_required`, `last_agent_auth_command_id`,
`last_agent_auth_worker_id`, `last_agent_auth_attempted_at`,
`last_agent_auth_applied_at`, `last_agent_auth_error_code`,
`last_agent_auth_error_message`, `pending_agent_auth_cleanup_json`,
`applied_runtime_config_sequence`, `applied_runtime_config_revision_id`,
`runtime_config_status`, `last_runtime_config_command_id`,
`last_runtime_config_worker_id`, `last_runtime_config_attempted_at`,
`last_runtime_config_applied_at`, `last_runtime_config_error_code`,
`last_runtime_config_error_message`, `created_at`, `updated_at`.

#### `agent_gateway_runtime_grant`

Row: historical runtime-scoped token grant retained for compatibility paths.

Fields: `id`, `token_hash`, `hash_key_id`, `policy_id`, `credential_id`,
`selection_id`, `issued_profile_revision`, `target_id`,
`sandbox_profile_id`, `cloud_sandbox_id`, `slot_generation`,
`organization_id`, `user_id`, `agent_kind`, `protocol_facade`,
`expires_at`, `revoked_at`, `last_used_at`, `created_at`.

#### `agent_gateway_router_materialization`

Row: durable Bifrost provider-key or virtual-key materialization mapping.

Fields: `id`, `router_kind`, `router_object_kind`, `object_scope`,
`policy_id`, `provider_credential_id`, `budget_subject_id`, `selection_id`,
`sandbox_profile_id`, `target_id`, `cloud_sandbox_id`, `slot_generation`,
`agent_kind`, `protocol_facade`, `router_object_id`,
`router_object_secret_ciphertext`, `router_object_secret_ciphertext_key_id`,
`sync_status`, `sync_fingerprint`, `status`, `last_reconciled_at`,
`last_error_code`, `last_error_message`, `created_at`, `updated_at`.

#### `agent_gateway_llm_usage_event`

Row: imported Bifrost usage/cost log.

Fields: `id`, `router_kind`, `router_log_id`, `router_virtual_key_id`,
`router_provider_key_id`, `materialization_id`, `policy_id`,
`budget_subject_id`, `owner_scope`, `owner_user_id`, `organization_id`,
`agent_kind`, `protocol_facade`, `provider`, `model`, `status`, `cost_usd`,
`prompt_tokens`, `completion_tokens`, `total_tokens`, `occurred_at`,
`imported_at`, `raw_usage_json`.

#### `agent_gateway_usage_import_cursor`

Row: Bifrost usage importer checkpoint.

Fields: `id`, `router_kind`, `last_seen_at`, `last_seen_router_log_id`,
`updated_at`.

#### `agent_auth_audit_event`

Row: audit event for auth credential, policy, selection, and materialization
operations.

Fields: `id`, `action`, `actor_user_id`, `owner_scope`, `owner_user_id`,
`organization_id`, `credential_id`, `sandbox_profile_id`, `target_id`,
`metadata_json`, `created_at`.

</details>

### Intended UX Flow

The primary UX is not "configure a gateway." It is "choose how my cloud
sandbox pays for agent LLM calls."

1. A new user signs in and can start a personal cloud workspace using
   Proliferate managed credit without entering a provider key.
2. When a user wants Team features, the Create Team form first opens an
   upgrade gate dialog. The dialog explains the Team benefits, then the user
   confirms to start Stripe Checkout.
3. Stripe Checkout returns to the correct surface. Desktop return links go
   through the desktop handoff path; web return links stay in the web app.
4. After Stripe confirms payment, Proliferate activates the pending
   organization, creates the owner membership, applies team billing, and sends
   staged invitations.
5. Organization admins configure shared sandbox auth in settings. Members can
   use shared auth but cannot view raw provider secrets.
6. Sandbox launch applies only Bifrost base URL and virtual key env to the
   target. The raw Anthropic/OpenAI/Gemini/Bedrock secret remains in
   Proliferate/Bifrost control-plane storage.
7. Usage import reconciles Bifrost logs back into Proliferate credit, billing,
   and usage surfaces.

### Specific Workflow Questions End To End

| Workflow question | Expected answer |
| --- | --- |
| What happens when a user creates a Team? | The UI opens the reusable upgrade gate, then creates an `OrganizationCheckoutIntent`, a pending organization, and a Stripe Checkout session. No active membership is granted until Stripe activation completes. |
| What happens if the user already has pending checkout? | Settings shows the current intent with Continue checkout and Cancel setup actions instead of creating a duplicate intent. |
| What happens when Stripe succeeds? | The webhook loads the intent by Stripe session/subscription metadata, locks it, validates creator/team state, marks it activating, creates membership and billing state, marks it completed, and sends invitations. |
| What happens if the desktop receives a checkout success URL? | The web return handoff routes back into Desktop rather than leaving the user on a web login screen. |
| How does a new personal cloud workspace get LLM auth? | The server ensures a personal sandbox profile, chooses managed credit by default, materializes or reuses Bifrost objects, and gives the sandbox only Bifrost URL plus virtual key. |
| How does organization BYOK get into a sandbox? | An admin saves a provider credential, policy materialization creates the Bifrost provider key, runtime selection creates a Bifrost virtual key scoped to that provider/model set, and sandbox env receives the virtual key. |
| How is Bedrock different? | Bedrock payloads use AWS configuration and IAM/credential material instead of a single API key, but the sandbox still receives only the Bifrost-facing virtual key. |
| How is Codex/Claude/Gemini routed? | Each harness receives the env shape it supports: a Bifrost-compatible base URL plus key, with provider/model restrictions encoded in Bifrost. |
| How is usage charged? | Bifrost logs are imported by cursor, matched to router materialization and budget subject, then written as `AgentGatewayLlmUsageEvent` rows for entitlement debit and billing display. |
| What happens when credit is exhausted? | New managed-credit launches are blocked before work is scheduled, the Bifrost virtual key is disabled or replaced, and the UI points the user toward BYOK or Team upgrade. |
| What happens when a credential is revoked or rotated? | Proliferate updates credential/policy state, disables affected Bifrost objects, bumps sandbox auth revision, and requires new runtime materialization for future launches. |

### Primitives Involved

- **Owner scope**: `personal`, `organization`, or `system`; every credential,
  budget, and sandbox profile must be scoped.
- **Billing subject**: the budget entity for cloud runtime hours and managed LLM
  credit.
- **Team checkout intent**: a resumable pending Team upgrade record tied to
  Stripe Checkout.
- **Upgrade gate dialog**: reusable UI primitive that explains benefits before
  a gated action starts checkout.
- **Agent harness**: Claude, Codex, Gemini, or another configured runtime
  agent that needs LLM auth.
- **Agent auth credential**: encrypted provider material owned by a user,
  organization, or system.
- **Agent auth selection**: the sandbox profile choice of auth mode per agent
  harness.
- **Bifrost provider key**: Bifrost-side provider credential, created from a
  Proliferate managed key or BYOK payload.
- **Bifrost virtual key**: sandbox-facing key that restricts provider keys,
  models, and usage metadata.
- **Router materialization**: Proliferate's durable mapping from product policy
  to the Bifrost provider-key or virtual-key object.
- **Runtime grant/env materialization**: target-side application of Bifrost URL
  and virtual key into E2B/AnyHarness sandbox env.
- **Usage import cursor**: durable checkpoint for Bifrost log ingestion.

### Failure Modes

| Failure mode | Product behavior | Control-plane behavior |
| --- | --- | --- |
| User closes upgrade dialog | No checkout intent is created. | No DB write beyond local UI state. |
| Stripe checkout creation fails | Dialog or form shows the error and allows retry. | No active organization or membership is created. |
| Pending checkout expires | UI offers a fresh checkout path. | Intent moves to expired or is ignored by current-intent lookup. |
| Stripe webhook arrives twice | User sees one activated team. | Idempotency and Stripe ids prevent duplicate activation. |
| Creator joins another team before webhook | Checkout activation fails with a business-state error. | Pending organization remains non-active and intent records the failure. |
| Bifrost admin API is unavailable | Auth setup or launch reports gateway provisioning unavailable. | Policy/materialization stays pending or failed with retryable status. |
| Provider credential is invalid | UI shows not ready or validation failed. | Provider credential/policy does not become ready for runtime selection. |
| Bifrost virtual key creation succeeds but key value is missing | Launch fails before sandbox receives incomplete auth. | Materialization is marked failed and can be retried. |
| Sandbox starts but auth env cannot be applied | Workspace needs attention and launch is blocked or retried. | Runtime materialization error is surfaced on workspace/provision state. |
| Bifrost usage import loses position | Import resumes from cursor and idempotent log ids. | Duplicate `AgentGatewayLlmUsageEvent` rows are avoided. |
| Managed credit is exhausted mid-run | Existing process may fail provider calls; next launch is blocked cleanly. | Budget subject and virtual key state are updated on reconciliation. |
| BYOK credential is revoked while workspaces exist | Future launches stop using it; running workspaces may need restart. | Related Bifrost objects are disabled and sandbox auth revision is bumped. |

### Background Concepts Involved

- **Bifrost is the data plane**: agent requests go directly to Bifrost and then
  to the provider. Proliferate does not proxy token streams in the hot path.
- **Proliferate is the control plane**: users, teams, billing, entitlements,
  sandbox profiles, auth selections, and usage ledgers live in Proliferate.
- **Managed credit and BYOK are different product promises**: managed credit
  spends Proliferate-owned provider budget; BYOK spends a user or team's own
  provider credential.
- **Personal and Team billing must not be conflated**: account onboarding
  credits are personal; Team entitlements are organization-owned and require an
  active team.
- **Sandbox isolation depends on virtual keys**: sandboxes never need raw
  provider secrets if Bifrost virtual keys carry provider and model
  restrictions.
- **Compatibility names remain**: some persisted fields and generated API
  aliases still use `litellm*` names for migration compatibility. The runtime
  router implementation is Bifrost-only.
- **End-to-end validation crosses systems**: a correct flow has visible UI
  state, Proliferate DB/API records, Bifrost provider/virtual-key records, E2B
  sandbox env, and imported usage rows.

## End State UX

The UI should make one product promise:

```text
Pick what auth a sandbox should use for each agent harness.
If the user has free managed credit, it works immediately.
If the team has BYOK configured, the sandbox uses the team's key through
Bifrost without exposing the raw provider secret.
```

The validation shape is intentionally end-to-end. A manual tester should be
able to start from product UI, inspect Proliferate DB/API state, inspect Bifrost
state, run a sandbox command, and see the corresponding usage ledger row.

| Scenario | User-visible result | Backend proof | Live proof |
| --- | --- | --- | --- |
| New user managed credit | Cloud workspace can start without entering an LLM key | Free-credit entitlement, managed policy, Bifrost VK materialization | E2B request streams through Bifrost and debits credit |
| Credit exhausted | Managed-credit launch is blocked with a clear upgrade/BYOK path | Entitlement exhausted, VK disabled | Reusing the VK fails at Bifrost |
| Personal BYOK | User selects own provider key for personal cloud | Encrypted credential, Bifrost provider key, restricted VK | Sandbox uses VK and never sees raw provider key |
| Organization BYOK | Admin selects team auth for shared sandbox | Org-scoped credential, shared policy, shared sandbox target revision | Shared sandbox request is attributed to org subject |
| Bedrock BYOK | Admin can validate AWS-backed auth | Bedrock provider config materialized into Bifrost | AWS CLI and Bifrost live request both succeed |
| Usage display | Credit/usage screen updates after run | Imported usage ledger row with cost and tokens | Bifrost log id matches Proliferate usage event |

### Entitlement Ownership

Do not create an organization to give a user free LLM credits.

There are two distinct entitlement subjects:

```text
Account managed credits
  User/account-scoped onboarding credits.
  Keyed by auth identity, especially GitHub provider user id.
  Shown as "Account credits" or "Free LLM credit".
  Usable by the user's personal cloud sandbox.

Team managed credits
  Organization billing-subject entitlement.
  Created only when a Team/paid organization exists.
  Shown as "Team managed credits".
  Usable by the organization shared sandbox.
```

Free onboarding credits must be deduped through the free-allocation guard
before an `AgentGatewayFreeCreditEntitlement` is created. The grant key should
include:

```text
allocation_kind = agent_gateway_free_credits
github_provider_user_id
period_key
```

If the allocation is unavailable or already consumed, the UI should show free
credits unavailable and offer BYOK or Team upgrade paths.

### New User Onboarding

After GitHub sign-in, a new user can start a cloud workspace without opening
Desktop and without entering an LLM key.

The visible state is:

- Account or onboarding banner shows the configured free LLM credit amount, for
  example `Free LLM credit: $5.00 available`.
- Home/new workspace target picker can choose `Personal cloud`.
- Agent auth defaults to `Proliferate managed credit`.
- The first Claude Code or Codex cloud run streams normally.
- Usage/billing view shows managed LLM credit decreasing after reconciliation.

The user should not see Bifrost, provider keys, virtual keys, or router ids.

Manual validation must prove:

- Proliferate created a free-credit entitlement.
- Proliferate created or reused the Bifrost managed provider key.
- Proliferate created a Bifrost virtual key restricted to managed provider
  keys.
- E2B sandbox received the virtual key and Bifrost base URL.
- Bifrost logged the request with virtual-key and cost metadata.
- Proliferate imported that usage and reduced remaining credit.

### Exhausted Free Credit

When the managed grant is exhausted:

- New managed-credit launches are blocked.
- Existing running workspaces should be allowed to stop cleanly.
- The UI says the managed LLM credit is exhausted.
- The user is prompted to add BYOK or use a paid organization path.
- The Bifrost virtual key for managed credit is disabled or replaced with an
  inactive key.

Manual validation must prove:

- A tiny test grant can be exhausted.
- A subsequent Bifrost request with that virtual key fails.
- A subsequent Proliferate cloud launch using managed credit is blocked before
  work is scheduled.

### Personal BYOK

When enabled, a user can add a personal provider credential for personal cloud
sandboxes.

The visible state is:

- Settings > Agent Auth shows harness rows.
- Each harness can use `Proliferate managed credit`, `Synced local auth`, or a
  personal BYOK credential.
- Provider credential rows show provider, readiness, last validation time, and
  where usable.
- Raw secrets are never displayed after save.

Manual validation must prove:

- Saving an Anthropic/OpenAI/Gemini credential stores encrypted material in
  Proliferate.
- Materialization creates a Bifrost provider key.
- The sandbox receives a Bifrost virtual key, not the raw provider key.
- The Bifrost virtual key can only use the selected provider key.

### Organization BYOK

An organization admin configures shared agent auth for the shared sandbox.

The visible state is:

- Settings > Shared Sandbox or Organization > Shared Sandbox owns team-wide
  auth choices.
- Admins configure provider credentials:
  - Anthropic API key
  - OpenAI API key
  - Gemini API key
  - Bedrock role/config/region/model access
  - OpenAI-compatible endpoint if supported
- Admins select one auth method per harness for the shared sandbox.
- Members see shared auth as available for team work but cannot reveal secrets.
- Non-admins see status only.

Manual validation must prove:

- A Bedrock config can be validated with AWS CLI credentials locally.
- Proliferate materializes it to a Bifrost provider key.
- A shared sandbox receives only a Bifrost virtual key.
- Requests are attributed to the organization/shared sandbox usage subject.

### Developer And Operator UX

Local development should be explicit and reproducible:

- Root `/Users/pablohansen/proliferate/.env` may be sourced by the developer
  shell for local CLI smoke tests.
- The server still reads supported settings from `server/.env`,
  `server/.env.local`, or process environment. Do not add a home-directory env
  fallback.
- For worktree QA, copy the root and server env files from the primary checkout
  into the worktree before starting the dev profile:
  - `.env`
  - `.env.local`
  - `.env.prod` when the local smoke needs the same production-like provider
    settings
  - `server/.env`
  - `server/.env.local`
- `make dev PROFILE=<name> AGENT_GATEWAY=bifrost` and
  `make dev PROFILE=<name> AGENT_GATEWAY=1` use the target local workflow.
- `pdev gateway` remains the concrete local QA shortcut. It should run the
  Bifrost gateway profile and pick up the first-class Makefile wiring.
- `AGENT_GATEWAY=1` is kept as a shorthand for the Bifrost workflow.
- E2B live tests require a public Bifrost URL, because an E2B sandbox cannot
  reach the developer machine at `127.0.0.1`.
- Local Bifrost must run with `client.enforce_auth_on_inference=true` and
  `client.enable_logging=true`. Dev bootstrap writes `config.json` and updates
  a running local Bifrost through `/api/config` so anonymous inference is
  rejected and all managed-credit traffic is attributable to virtual keys.

## Bifrost Capabilities This Relies On

Bifrost virtual keys are the request auth unit. The local Bifrost gateway
expects the virtual key in:

- `x-bf-vk: sk-bf-*`

This matches the major harness conventions:

- Codex/OpenAI-compatible clients can use the existing Codex provider config
  with `CODEX_API_KEY`.
- Claude/Anthropic-compatible clients should send
  `ANTHROPIC_CUSTOM_HEADERS=x-bf-vk: <virtual-key>` and may also materialize
  `ANTHROPIC_AUTH_TOKEN=<virtual-key>` for client builds that do not reliably
  forward custom headers. Bifrost records the `x-bf-vk` identity for usage
  attribution and also accepts the bearer token fallback in local cloud QA.
- Gemini-style clients can use `x-goog-api-key` if the CLI can be pointed at a
  compatible base URL.

Bifrost provider keys are stored in Bifrost, not passed through per request.
The v1.5 direct-key bypass is removed, so all requests must route through
Bifrost-managed provider keys. This is good for Proliferate because raw BYOK
secrets should not be injected into sandboxes.

Bifrost provider key support includes:

- model allowlists and denylists
- provider key enable/disable
- weighted load balancing
- Azure config
- Vertex config
- Bedrock access key, secret key, session token, region, ARN, role ARN,
  external id, and role session name
- OpenAI-compatible style providers through the provider/key model

Bifrost virtual keys support:

- provider/model filtering
- key restrictions via `key_ids`
- budgets
- rate limits
- active/inactive status
- team or customer attachment, mutually exclusive

Every virtual-key `provider_configs[]` entry must include:

```text
provider
allowed_models
key_ids
```

`key_ids` are Bifrost provider key ids returned by the Provider Keys API. Do not
use Bifrost database numeric ids. Do not omit `key_ids`, and do not use `["*"]`
for BYOK or managed-credit keys. Empty or omitted key restrictions should be
treated as a provisioning error because they can either deny all traffic or
fail open after future Bifrost changes.

Proliferate should use Bifrost customers for personal subjects and Bifrost
teams for organization/shared subjects unless implementation proves one shape is
simpler. Virtual keys must be restricted by `key_ids`; do not rely only on
model/provider allowlists.

## Bifrost Deployment Invariants

Production and live local validation must make the Bifrost auth mode explicit.

Required invariants:

- Public inference must reject requests without a valid virtual key.
- Proliferate must validate both:
  - no virtual key fails
  - the chosen header/env style succeeds
- Bifrost admin APIs must be private/internal or otherwise protected by an
  admin token not exposed to sandboxes.
- Public inference URL and admin base URL are separate config values.
- TLS is required outside localhost.
- Request/response body logging is disabled by default for hosted production.
- Logs retained for Proliferate import should be metadata-first: request id,
  selected key, virtual key, provider, model, status, token usage, cost, and
  Bifrost dimensions.
- Bifrost virtual keys and provider secrets must be redacted in logs, server
  errors, UI responses, and test output.

If Bifrost generic inference auth is enabled and would consume `Authorization`,
agents must pass the virtual key through `x-bf-vk` or another verified virtual
key header. If Bifrost generic inference auth is disabled, the deployment may
accept provider-style headers as virtual-key auth, but the no-VK rejection test
is still mandatory.

Hosted V1 can run a single-node OSS Bifrost deployment if that operational risk
is accepted. In that mode, Proliferate must only write through Bifrost
management APIs, never directly to the Bifrost database, and the reconciler must
repair provider keys, virtual keys, budgets, and active flags after restart.
Multi-node hosted production requires either a proven shared-state OSS topology
or Bifrost Enterprise/HA.

## Target Architecture

### Data Plane

```text
Claude Code in E2B
  ANTHROPIC_BASE_URL=https://llm.proliferate.ai/anthropic
  CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST=1
  ANTHROPIC_CUSTOM_HEADERS="x-bf-vk: sk-bf-..."
  ANTHROPIC_AUTH_TOKEN=sk-bf-...
  -> Bifrost
  -> Anthropic or Bedrock

Codex in E2B
  CODEX_API_KEY=sk-bf-...
  protected Codex config:
    model_provider_id=proliferate
    model_providers.proliferate.base_url=https://llm.proliferate.ai/openai/v1
    model_providers.proliferate.env_key=CODEX_API_KEY
    model_providers.proliferate.wire_api=responses
    model_providers.proliferate.requires_openai_auth=false
  -> Bifrost
  -> OpenAI, Anthropic via OpenAI facade, or compatible provider

Gemini CLI in E2B
  follow-up, not V1 E2B acceptance:
    GOOGLE_GEMINI_BASE_URL=https://llm.proliferate.ai/genai
    GEMINI_API_KEY=sk-bf-...
  -> Bifrost
  -> Gemini provider
```

No Proliferate server process forwards streaming LLM responses in this path.
The bearer credential in the sandbox is still a spend token, so it must be
scoped and rotated like a runtime grant.

### Control Plane

```text
user/org changes auth selection
  -> Proliferate DB selection changes
  -> materializer computes desired Bifrost state
  -> Bifrost provider key / virtual key is created or updated
  -> encrypted virtual key is stored in Proliferate
  -> sandbox target state revision is bumped
  -> worker applies env/config into E2B sandbox
```

### Usage Plane

```text
Bifrost request logs
  -> Proliferate usage importer polls by cursor/time window
  -> idempotent usage events inserted
  -> free credit entitlement debited
  -> billing/usage UI reads Proliferate ledger
  -> exhausted subjects disable Bifrost VKs and block launches
```

## Server Ownership

Follow `docs/server/README.md` and focused guides:

- Bifrost HTTP calls live in `server/proliferate/integrations/bifrost/`.
- Product orchestration remains in
  `server/proliferate/server/cloud/agent_auth/`.
- DB access remains in `server/proliferate/db/store/**`.
- ORM definitions remain in `server/proliferate/db/models/**`.
- Env-derived settings live in `server/proliferate/config.py`.
- Shared protocol constants live in `server/proliferate/constants/cloud.py` or
  a focused agent-gateway constants module.

Proposed integration shape:

```text
server/proliferate/integrations/bifrost/
  __init__.py
  client.py
  errors.py
  models.py
  governance.py
  providers.py
  logs.py
```

The integration package should expose coarse operations:

- `create_provider_key`
- `update_provider_key`
- `disable_provider_key`
- `create_virtual_key`
- `update_virtual_key`
- `disable_virtual_key`
- `list_logs`
- `get_usage_stats` if needed
- `validate_health`

Do not leak Bifrost endpoint paths into product services.

## Config And Env

Retain generic product-level settings where possible. Add Bifrost-specific
settings:

```text
AGENT_GATEWAY_ENABLED
AGENT_GATEWAY_BIFROST_BASE_URL
AGENT_GATEWAY_BIFROST_PUBLIC_BASE_URL
AGENT_GATEWAY_BIFROST_ADMIN_TOKEN
AGENT_GATEWAY_BIFROST_REQUEST_TIMEOUT_SECONDS
AGENT_GATEWAY_RECONCILER_ENABLED
AGENT_GATEWAY_RECONCILER_INTERVAL_SECONDS
AGENT_GATEWAY_RECONCILER_BATCH_SIZE
AGENT_GATEWAY_USER_FREE_CREDIT_ENABLED
AGENT_GATEWAY_USER_FREE_CREDIT_USD
```

Config migration table:

| Setting | Secret | Default | Required When | Replaces / Notes |
| --- | --- | --- | --- | --- |
| `AGENT_GATEWAY_BIFROST_BASE_URL` | No | None | Gateway enabled | Private/admin Bifrost API base URL |
| `AGENT_GATEWAY_BIFROST_PUBLIC_BASE_URL` | No | None | Sandbox `gateway_env` materialization | Public inference URL reachable from E2B |
| `AGENT_GATEWAY_BIFROST_ADMIN_TOKEN` | Yes | None | Hosted or protected local Bifrost | Admin API auth; never sent to sandboxes |
| `AGENT_GATEWAY_BIFROST_REQUEST_TIMEOUT_SECONDS` | No | product default | Gateway enabled | Admin/control-plane HTTP timeout |

Implementation must update `server/proliferate/config.py`,
`docs/reference/env-secrets-matrix.md`, and `docs/reference/env-vars.yaml`.
Unknown env vars are ignored by settings today, so adding this spec without the
config/env-matrix changes is not sufficient.

Managed provider credentials should be explicit deployment secrets:

```text
AGENT_GATEWAY_MANAGED_ANTHROPIC_API_KEY
AGENT_GATEWAY_MANAGED_OPENAI_API_KEY
AGENT_GATEWAY_MANAGED_GEMINI_API_KEY
AGENT_GATEWAY_MANAGED_BEDROCK_REGION
AGENT_GATEWAY_MANAGED_BEDROCK_ROLE_ARN
```

Local development may source `/Users/pablohansen/proliferate/.env` before
starting commands, but application code must continue to use `server/.env`,
`server/.env.local`, or process env. Do not add an implicit home-directory
fallback.

## Persistence Model

### Existing Rows To Reuse

Keep these product concepts:

- `AgentAuthCredential`
- `AgentGatewayProviderCredential`
- `AgentGatewayPolicy`
- `AgentGatewayBudgetSubject`
- `AgentGatewayFreeCreditEntitlement`
- `SandboxAgentAuthSelection`
- `SandboxProfileTargetState`
- `AgentAuthAuditEvent`

Existing columns and response aliases with `litellm_*` names are compatibility
fields. New runtime behavior is Bifrost-only; rename the storage/API surface in a
separate migration when external compatibility allows it.

### New Router Materialization Table

Add:

```text
agent_gateway_router_materialization
```

Columns:

```text
id uuid primary key
router_kind text not null              -- bifrost
router_object_kind text not null       -- provider_key | virtual_key | customer | team | budget
router_object_id text not null
policy_id uuid null
provider_credential_id uuid null
budget_subject_id uuid null
selection_id uuid null
sandbox_profile_id uuid null
target_id uuid null
cloud_sandbox_id text null
slot_generation integer null
agent_kind text null
router_secret_ciphertext bytea null
router_secret_ciphertext_key_id text null
public_base_url text null
desired_fingerprint text not null
applied_fingerprint text null
sync_status text not null              -- pending | synced | drifted | failed | revoked
last_synced_at timestamptz null
last_reconciled_at timestamptz null
last_error_code text null
last_error_message text null
metadata_json jsonb not null default '{}'
created_at timestamptz not null
updated_at timestamptz not null
revoked_at timestamptz null
```

Indexes:

```text
unique active provider key per router/provider_credential/object kind
unique active virtual key per router/selection/target/sandbox/slot/agent kind
index(router_kind, sync_status, updated_at)
index(router_kind, router_object_kind, router_object_id)
```

Rationale:

- Keeps product rows router-neutral.
- Avoids adding `bifrost_*` columns to every existing compatibility table.
- Gives Bifrost materializations an ownership-specific home outside legacy field
  names.
- Gives drift detection a single place to compare desired and applied state.
- Preserves real foreign keys instead of a polymorphic `owner_kind/owner_id`
  pair.
- Supports runtime-scoped virtual keys rather than one broad key per user or
  organization.

Use typed nullable foreign keys plus check constraints rather than a single
polymorphic owner id. A materialization row should point at exactly the product
entity that owns it:

```text
provider_key
  provider_credential_id required

customer/team/budget
  budget_subject_id required

virtual_key
  policy_id required
  selection_id required
  sandbox_profile_id required
  target_id required
  cloud_sandbox_id and slot_generation required for active managed cloud slots
  agent_kind required
```

Rotation creates a new materialization row or updates the active row with a new
desired fingerprint while marking prior rows `revoked_at`. Old Bifrost virtual
keys must be disabled before or at the same time they are marked revoked in
Proliferate.

### New Usage Ledger

Add:

```text
agent_gateway_llm_usage_event
```

Columns:

```text
id uuid primary key
router_kind text not null              -- bifrost
router_log_id text not null
router_request_id text null
virtual_key_id text null
selected_key_id text null
policy_id uuid null
budget_subject_id uuid null
free_credit_entitlement_id uuid null
user_id uuid null
organization_id uuid null
sandbox_profile_id uuid null
sandbox_id text null
workspace_id uuid null
harness_kind text null
provider text null
model text null
prompt_tokens integer null
completion_tokens integer null
total_tokens integer null
cost_usd numeric(12, 6) null
status text not null                   -- succeeded | failed | needs_review | duplicate_ignored
occurred_at timestamptz not null
imported_at timestamptz not null
raw_metadata_json jsonb not null default '{}'
```

Indexes:

```text
unique(router_kind, router_log_id)
index(user_id, occurred_at)
index(organization_id, occurred_at)
index(budget_subject_id, occurred_at)
index(free_credit_entitlement_id, occurred_at)
index(virtual_key_id, occurred_at)
```

Proliferate usage rows are the billing source of truth. Bifrost logs are the
upstream observation source.

### Import Cursor

Add:

```text
agent_gateway_usage_import_cursor
```

Columns:

```text
router_kind text primary key
last_seen_occurred_at timestamptz null
last_polled_at timestamptz null
status text not null
last_error_code text null
last_error_message text null
metadata_json jsonb not null default '{}'
```

The importer should use overlap windows so late-arriving logs are still picked
up. Idempotency is enforced by the unique usage event key.

Bifrost log polling should use timestamp-window plus offset pagination, not a
monotonic id cursor:

```text
GET /api/logs
  start_time = last_seen_occurred_at - overlap
  sort_by = timestamp
  order = asc
  limit = batch_size
  offset = page_offset
```

Deduplicate by `(router_kind, log.id)`. Parse provider-key attribution from
Bifrost `selected_key_id`, token counts from `token_usage`, and cost from the
log cost field. Logs with missing or zero cost after a successful request should
produce `needs_review` rows unless pricing/cost recalculation has been proven
for that provider/model.

## Materialization Flows

### Managed Free Credit

Trigger:

- user signs up
- user first opens cloud workspace creation
- periodic repair notices a missing managed auth policy

Steps:

```text
0. Ensure the free-cloud allocation guard allows this GitHub identity and
   period:
   allocation_kind = agent_gateway_free_credits
   github_provider_user_id
   period_key
1. Ensure AgentGatewayFreeCreditEntitlement exists for the user/account.
2. Ensure AgentGatewayBudgetSubject exists for account managed LLM use.
3. Ensure Proliferate-managed provider credential records exist.
4. Ensure Bifrost provider keys exist for those managed credentials.
5. Ensure Bifrost customer/team subject exists.
6. Ensure runtime-scoped Bifrost virtual key exists with:
   - allowed providers/models for supported harnesses
   - provider_configs[].key_ids restricted to Proliferate-managed provider keys
   - budget no larger than the remaining or granted managed-credit amount
   - active=true while entitlement is active
7. Encrypt and store the Bifrost virtual key in router materialization.
8. Mark policy/materialization synced.
9. Bump sandbox target-state revision if this selection is active.
```

Bifrost budget and rate limits are the runtime enforcement layer. Proliferate
entitlement and usage ledger remain canonical for product display and billing.
If Proliferate cannot create/update the Bifrost budget or disable an exhausted
virtual key, new managed-credit launches fail closed.

### Bifrost Virtual Key Runtime Security

Bifrost virtual keys are bearer spend tokens. Direct Bifrost data plane removes
Proliferate's old per-request runtime-grant validation, so V1 must regain that
protection through tight key scope and revocation.

Do not mint one broad virtual key per user or organization. Active sandbox keys
must be scoped at least to:

```text
sandbox_profile_id
target_id
cloud_sandbox_id
slot_generation
agent_kind
sandbox_agent_auth_selection_id
policy_id
```

Virtual keys must be disabled when any of these change:

- sandbox slot is replaced
- sandbox target is paused, stopped, archived, or billing-blocked
- sandbox auth selection changes
- credential or provider key is revoked/rotated
- policy becomes invalid, exhausted, or disabled
- user leaves the organization that owns the shared sandbox
- organization subscription enters a blocking state

Each materialization and rotation must emit an `AgentAuthAuditEvent`. Reconciler
repair must disable orphaned active Bifrost virtual keys that no longer have an
active Proliferate materialization.

Usage attribution should prefer key granularity over request headers. If we need
workspace/session-level reporting, either mint virtual keys at that exact scope
or pass Bifrost-safe dimensions such as:

```text
x-bf-dim-proliferate_workspace_id
x-bf-dim-proliferate_sandbox_profile_id
x-bf-dim-proliferate_cloud_sandbox_id
x-bf-dim-proliferate_agent_kind
```

Only non-secret stable ids may be sent as dimensions. If a harness cannot carry
dimensions, the corresponding usage ledger columns must remain nullable and the
UI must not promise workspace/session-perfect attribution.

### BYOK Provider Credential

Trigger:

- user saves personal BYOK credential
- admin saves organization BYOK credential
- credential is edited, reconnected, disabled, or rotated

Steps:

```text
1. Validate provider kind and required fields.
2. Encrypt provider credential in Proliferate.
3. Create/update Bifrost provider key.
4. Store provider-key materialization id and desired fingerprint.
5. For active sandbox selections using that credential, create/update Bifrost
   virtual keys restricted to that provider key id.
6. Bump target-state revision for affected sandboxes.
7. Audit who changed the credential and what scope it affects.
```

Provider validation should not log secrets. Returned errors should identify the
provider and missing/invalid fields, not secret values.

Provider-specific validation requirements:

```text
openai_compatible
  HTTPS only outside localhost development.
  No embedded credentials in URLs.
  DNS and redirects are revalidated.
  Reject loopback, link-local, RFC1918, and cloud metadata IP ranges in hosted
  deployments.
  Apply response-size caps and request timeouts.
  Disable request/response body logging by default.

bedrock_assume_role
  Prefer AssumeRole with Proliferate-generated ExternalId.
  Validate the positive assume-role path from hosted Bifrost credentials.
  Validate a negative ExternalId test fails.
  Record region and role session name.
  Do not default hosted BYOK to long-lived AWS access keys.

api_key providers
  Validate with a minimal model-list or low-cost inference request when the
  provider supports it.
  Store only encrypted credentials and redacted validation metadata.
```

Credential revocation or rotation must disable old Bifrost provider keys and
dependent virtual keys. Provider-key names should be deterministic enough for
repair but must not reveal secret values.

### Sandbox Auth Selection

Trigger:

- user/admin selects auth source for a harness
- materialization completes or drifts
- sandbox target state is refreshed

Selection dimensions:

```text
sandbox_profile_id
agent_kind
credential_kind: managed_gateway | synced_path
credential_id
policy_id
router_kind: bifrost
protocol_facade: anthropic | openai
materialization_mode: gateway_env | synced_files
```

For `gateway_env`, the selected policy must have a synced router
materialization and a runtime-scoped virtual key. Keep the existing
`gateway_env` name because it is already accepted by the worker and AnyHarness
protected-env policy. Do not introduce a `bifrost_env` materialization mode.
For `synced_files`, existing worker file/env sync applies.

Provisioning readiness must distinguish CLI installation from launch-time
authentication. AnyHarness `/v1/agents` reports the static runtime state without
the sandbox auth overlay, so a selected `gateway_env` agent can appear as
`login_required` or `credentials_required` while still being launchable. After
the worker reports the sandbox auth config applied, cloud provisioning should
accept selected agents in those credential-gated states as ready, while still
rejecting `install_required`, `unsupported`, and `error`.

## Sandbox Runtime Application

The worker should materialize harness-specific env/config from a router-neutral
auth application plan.

Example plan:

```json
{
  "mode": "gateway_env",
  "router_kind": "bifrost",
  "harness_kind": "claude",
  "base_url": "https://llm.proliferate.ai/anthropic",
  "virtual_key_ref": "encrypted-materialization-id",
  "env": {
    "ANTHROPIC_BASE_URL": "https://llm.proliferate.ai/anthropic",
    "ANTHROPIC_CUSTOM_HEADERS": "x-bf-vk: <resolved in worker>",
    "ANTHROPIC_AUTH_TOKEN": "<resolved in worker>"
  }
}
```

Harness env mapping:

```text
claude
  ANTHROPIC_BASE_URL
  ANTHROPIC_CUSTOM_HEADERS = x-bf-vk: <virtual-key>
  ANTHROPIC_AUTH_TOKEN = <virtual-key>
  CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST = 1

codex
  CODEX_API_KEY = <virtual-key>
  protectedConfig.codex.model_provider_id = proliferate
  protectedConfig.codex.model_providers.proliferate.base_url = <public>/openai/v1
  protectedConfig.codex.model_providers.proliferate.env_key = CODEX_API_KEY
  protectedConfig.codex.model_providers.proliferate.wire_api = responses
  protectedConfig.codex.model_providers.proliferate.requires_openai_auth = false

gemini
  follow-up only:
  GOOGLE_GEMINI_BASE_URL = <public>/genai
  GEMINI_API_KEY or GOOGLE_API_KEY = <virtual-key>

opencode
  follow-up only:
  OPENAI_BASE_URL = <public>/openai/v1
  OPENAI_API_KEY = <virtual-key>
```

The worker may decrypt the Bifrost virtual key only when applying target state.
It must not write raw provider credentials for BYOK.

V1 manual E2B acceptance is Claude + Codex only. Gemini and OpenCode require
additional work before they can be accepted:

- E2B template installs the CLI.
- server protected-env allowlist accepts `gateway_env` for that agent kind.
- worker protected-env policy accepts the same keys.
- AnyHarness launch/config paths can prefer the protected provider config over
  repo/project-local settings.
- live CLI smoke proves the base URL and virtual-key header style.

## Usage Import And Credit Debit

Importer responsibilities:

```text
1. Poll Bifrost logs with an overlap window.
2. Parse virtual key id, selected key id, provider, model, token counts, cost,
   request id, status, and timestamps.
3. Resolve virtual key id to router materialization.
4. Resolve materialization to policy, budget subject, user/org, sandbox profile,
   and free-credit entitlement where applicable.
5. Insert idempotent usage event.
6. Debit active free-credit entitlement for managed-credit events.
7. Mark entitlement exhausted when remaining credit <= 0.
8. Disable related Bifrost virtual keys when managed credit is exhausted.
```

Accuracy target:

- Good enough for trial credit enforcement and usage display.
- Not required to be penny-perfect in real time.
- Must never allow unbounded usage after grant exhaustion.

Recommended guardrails:

- Bifrost virtual-key budget at or below grant amount.
- Proliferate pre-launch entitlement check.
- Reconciler disables exhausted virtual keys.
- Low-balance threshold can proactively reduce budget or require refresh.

The importer is not the primary enforcement layer. Bifrost hard budgets/rate
limits are the runtime guardrail; Proliferate import is the canonical product
ledger and display source. Missing token/cost data should not keep an exhausted
or suspicious managed-credit key active. Import those rows as `needs_review`,
attempt Bifrost cost recalculation when available, and fail closed for new
managed-credit launches if the remaining grant cannot be determined safely.

## Billing And Pausing Interaction

LLM credit exhaustion and sandbox-hour overage enforcement are separate gates.

Managed LLM credit exhaustion:

- disables managed-credit virtual keys
- blocks new managed-credit agent starts
- does not necessarily pause the E2B sandbox immediately

Cloud sandbox billing hold:

- blocks new sandbox starts
- pauses/stops eligible running cloud sandboxes according to billing policy
- should also prevent new agent turns that would consume managed LLM credit

Do not conflate LLM usage events with E2B sandbox-hour usage events. They feed
the same billing/usage UI but have separate source systems and ledgers.

## Local Validation Plan

### Credential Loading

Local developer commands may source:

```bash
cd /Users/pablohansen/proliferate
set -a
source .env
set +a
```

Server runs should receive supported settings through:

```text
server/.env
server/.env.local
process environment
```

Never print secret values in test logs. Smoke scripts should report only:

- env var present/missing
- provider name
- key id or masked suffix where unavoidable
- validation status

### AWS CLI Smoke

Purpose:

- prove local AWS identity
- prove Bedrock visibility before configuring Bifrost Bedrock provider keys

Commands:

```bash
aws sts get-caller-identity
aws configure list
aws bedrock list-foundation-models --region "${AWS_REGION:-us-east-1}"
```

Expected:

- identity command succeeds
- region is known
- Bedrock model list succeeds or fails with a clear permission error

If Bedrock AssumeRole is the target BYOK shape, also test:

```bash
aws sts assume-role \
  --role-arn "$BEDROCK_ROLE_ARN" \
  --role-session-name proliferate-bifrost-local-test
```

### E2B CLI Smoke

Purpose:

- prove local sandbox credentials and template are usable
- prove E2B can reach the Bifrost public base URL

Required control-plane env:

```text
SANDBOX_PROVIDER=e2b
E2B_API_KEY
E2B_TEMPLATE_NAME
```

Commands:

```bash
e2b auth info
e2b template list
```

If the installed E2B CLI exposes different command names, the live smoke script
should detect that and print the installed version/help output.

Expected:

- CLI sees the developer account/team.
- configured template exists.
- `E2B_API_KEY` and `E2B_TEMPLATE_NAME` are present in the shell or
  `server/.env.local`.

The legacy `scripts/smoke-e2b-runtime.mjs` should not be used as Bifrost/BYOK
acceptance unless it is rewritten to avoid raw provider keys and to call
Bifrost with only virtual keys.

### Bifrost Local Smoke

Run Bifrost from:

```bash
cd /Users/pablohansen/bifrost
```

The local deployment must expose:

- admin API base URL for Proliferate materialization
- public inference URL for local curl tests
- public tunnel URL for E2B tests

Example local env for Proliferate:

```text
AGENT_GATEWAY_ENABLED=true
AGENT_GATEWAY_BIFROST_BASE_URL=http://127.0.0.1:4000
AGENT_GATEWAY_BIFROST_PUBLIC_BASE_URL=https://<tunnel-host>
AGENT_GATEWAY_USER_FREE_CREDIT_ENABLED=true
AGENT_GATEWAY_USER_FREE_CREDIT_USD=5
AGENT_GATEWAY_RECONCILER_ENABLED=true
```

Host-only smoke:

```text
1. Create or reuse provider key in Bifrost.
2. Create virtual key restricted to that provider key.
3. Call an OpenAI-compatible or Anthropic-compatible Bifrost endpoint.
4. Confirm Bifrost log has virtual_key_id, selected_key_id, model, tokens, cost.
5. Call without a virtual key and confirm Bifrost returns 401.
```

E2B smoke:

```text
1. Start Bifrost with a public tunnel.
2. Start Proliferate dev profile with Bifrost settings.
3. Launch an E2B sandbox.
4. Apply sandbox auth state.
5. From inside E2B, curl the public Bifrost URL with the sandbox virtual key.
6. Confirm the request appears in Bifrost logs.
7. Run Proliferate usage importer.
8. Confirm Proliferate credit ledger changed.
```

### Proliferate Dev Profile

Target command:

```bash
make dev-init PROFILE=bifrost-auth
make dev PROFILE=bifrost-auth AGENT_GATEWAY=bifrost
```

`AGENT_GATEWAY=bifrost` starts or reuses local Bifrost, exports Bifrost
env, enables personal free-credit and personal BYOK dev flags, and seeds
managed provider env from local `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` when the
dedicated managed-provider variables are not set. `AGENT_GATEWAY=1` is an alias
for the same Bifrost workflow.

For public managed-sandbox/E2B validation, add the ngrok tunnel switch:

```bash
make dev-init PROFILE=bifrost-auth
make dev PROFILE=bifrost-auth AGENT_GATEWAY=bifrost AGENT_GATEWAY_TUNNEL=ngrok
```

`AGENT_GATEWAY_TUNNEL=ngrok` must expose both public endpoints a managed
sandbox needs:

- the Proliferate API worker callback URL, exported as `CLOUD_WORKER_BASE_URL`
  and `CLOUD_MCP_OAUTH_CALLBACK_BASE_URL`
- the Bifrost runtime gateway URL, exported as
  `AGENT_GATEWAY_BIFROST_PUBLIC_BASE_URL`

If `CLOUD_WORKER_BASE_URL` stays local, cloud workspace rows can be created but
E2B provisioning fails immediately because the sandbox cannot enroll its
worker against `127.0.0.1`.

For manual QA in a dedicated worktree, use the shared local helper profile:

```bash
cd /Users/pablohansen/.proliferate/worktrees/proliferate/bifrost-byok-onboarding-spec

# Copy local secrets from the primary checkout without printing values.
cp /Users/pablohansen/proliferate/.env .env
cp /Users/pablohansen/proliferate/.env.local .env.local
cp /Users/pablohansen/proliferate/.env.prod .env.prod
cp /Users/pablohansen/proliferate/server/.env server/.env
cp /Users/pablohansen/proliferate/server/.env.local server/.env.local
chmod 600 .env .env.local .env.prod server/.env server/.env.local

# Start the stack on the `gateway` dev profile.
zsh -ic 'pdev gateway AGENT_GATEWAY=bifrost'

# For E2B/public sandbox reachability, expose the API worker callback and Bifrost through ngrok.
zsh -ic 'pdev gateway AGENT_GATEWAY=bifrost AGENT_GATEWAY_TUNNEL=ngrok'
```

The tester should then log in through the browser/Desktop surfaces served by
that profile. Subsequent manual QA should reuse the `gateway` profile so the
server database, app auth session, runtime home, and copied env files all match
the stack under test.

## Automated Test Plan

### Unit Tests

Add focused tests for:

- Bifrost config parsing and required-setting validation.
- Provider credential validation for Anthropic, OpenAI, Gemini, Bedrock, and
  OpenAI-compatible credentials.
- Desired-state fingerprinting.
- Materialization planner idempotency.
- Sandbox auth env planning per harness.
- Secret redaction.
- Free-credit debit and exhaustion rules.
- Usage import idempotency.
- Bifrost log parsing with missing cost/token fields.
- Rejection of `bifrost_env` as an invalid materialization mode.

### Integration Tests With Mocked Bifrost

Add tests for:

- create provider key
- update provider key after credential rotation
- create virtual key restricted to provider key ids
- verify each virtual-key provider config includes `allowed_models` and
  provider-key `key_ids`
- disable virtual key on exhaustion
- retryable vs terminal Bifrost errors
- drift detection and repair
- usage import cursor overlap
- no-virtual-key inference is rejected
- selected virtual key cannot route to an unlisted provider key

### Live Tests Gated By Env

Live tests must be opt-in:

```text
RUN_LIVE_BIFROST=1
RUN_LIVE_E2B=1
RUN_LIVE_BEDROCK=1
```

Suggested commands:

```bash
cd server
uv run pytest -q tests/unit/test_agent_gateway_integrations.py tests/integration/test_cloud_agent_auth_api.py
RUN_LIVE_BIFROST=1 uv run pytest -q tests/e2e/agent_gateway/test_bifrost_live.py
RUN_LIVE_BIFROST=1 RUN_LIVE_E2B=1 uv run pytest -q tests/e2e/cloud/test_bifrost_e2b_auth.py
RUN_LIVE_BIFROST=1 RUN_LIVE_BEDROCK=1 uv run pytest -q tests/e2e/agent_gateway/test_bifrost_bedrock_live.py
```

Live tests should skip with a clear message when required env vars are absent.

The checked-in phase-0 harness also proves a local Bifrost deployment without
needing the Proliferate server process:

```bash
PHASE0_BIFROST_BASE_URL=http://127.0.0.1:18080 \
OPENAI_API_KEY="$OPENAI_API_KEY" \
python3 scripts/agent-gateway-phase0-probe.py bifrost --require-live --json
```

That probe creates a temporary Bifrost provider key, creates a restricted
virtual key with a tiny budget, performs an OpenAI-compatible request through
Bifrost, waits for a log row with cost, then disables both temporary keys.

## Implementation Phases

### Phase 0: Proof Harness

- Add local Bifrost smoke script.
  Implemented in `scripts/agent-gateway-phase0-probe.py bifrost`.
- Verify Claude/OpenAI-compatible request paths.
  Bifrost source exposes `/anthropic/v1/...`, `/openai/v1/...`,
  `/genai/v1beta/...`, and `/v1/chat/completions`; Proliferate materializes
  harness base URLs so each CLI appends the expected suffix.
- Verify Bifrost logs contain usable cost metadata.
  Implemented in the phase-0 probe and
  `server/tests/e2e/agent_gateway/test_bifrost_live.py`.
- Verify Bedrock local auth path with AWS CLI.
- Verify E2B can reach tunneled Bifrost.
- Prove Bifrost isolation before exposing hosted BYOK:
  - `provider_configs[].key_ids` cannot be bypassed across aliases or
    provider/model prefixes.
  - duplicate public model names route only to selected provider keys.
  - fallback never escapes to Proliferate managed provider keys.
  - requests without virtual keys fail.
  - logs attribute to the expected virtual key and selected key.

Exit criteria:

- Host curl through Bifrost succeeds.
- E2B curl through Bifrost succeeds.
- Bifrost log import fixture is representative.
- Hosted BYOK UI remains hidden until the isolation proof passes.

### Phase 1: Config And Integration Client

- Add Bifrost env settings.
- Add `integrations/bifrost`.
- Add typed errors and response models.
- Add health/provider/virtual-key/log operations.
- Add mocked integration tests.

Exit criteria:

- No product service imports raw Bifrost endpoint paths.
- Tests cover success, auth failure, validation failure, and network failure.

### Phase 2: Router Materialization Persistence

- Add materialization table.
- Add usage ledger and import cursor tables.
- Add stores returning frozen dataclasses.
- Add desired-state fingerprint helpers.

Exit criteria:

- Re-running a materialization plan is idempotent.
- Drifted materializations can be found by indexed query.

### Phase 3: Managed Free Credits

- Ensure onboarding entitlement.
- Materialize managed provider keys and virtual keys.
- Store encrypted Bifrost VK materialization.
- Expose readiness/status to app surfaces.
- Use the free-allocation guard before creating account managed-credit
  entitlement.

Exit criteria:

- New user can launch a managed-credit cloud test request.
- UI can show free credit active vs exhausted.

### Phase 4: Sandbox Auth Apply

- Convert sandbox selection to harness env/config plan.
- Apply Bifrost virtual keys into E2B sandbox.
- Ensure raw provider secrets are never written to the sandbox.
- Support Claude and Codex first.
- Keep Gemini and OpenCode gated until template installation, protected-env
  allowlists, AnyHarness launch configuration, and live CLI smoke pass.

Exit criteria:

- E2B sandbox can call Bifrost with applied env.
- Bifrost logs identify the sandbox's virtual key.
- Worker accepts `gateway_env`; no `bifrost_env` mode is introduced.

### Phase 5: Usage Import And Exhaustion

- Poll Bifrost logs.
- Insert usage ledger rows.
- Debit managed-credit entitlements.
- Disable exhausted virtual keys.
- Block future managed-credit launches.

Exit criteria:

- Tiny grant exhaustion works end to end.
- Duplicate Bifrost logs do not double-charge.

### Phase 6: BYOK

- Add personal/admin credential APIs if not already present.
- Add provider validation.
- Materialize BYOK provider keys and sandbox virtual keys.
- Add Shared Sandbox/admin UI consumption.

Exit criteria:

- Anthropic/OpenAI BYOK works.
- Bedrock BYOK works in live gated test.
- OpenAI-compatible endpoint validation enforces hosted SSRF protections.
- Non-admin cannot inspect or change org BYOK secrets.

## Acceptance Criteria

The implementation is complete when these are true:

- A brand new web-only user can start a cloud agent run using managed free
  credit.
- The sandbox contains a Bifrost virtual key, not raw provider credentials.
- The sandbox virtual key is scoped to the active target/sandbox slot/agent
  selection and is revoked on slot, selection, credential, or billing changes.
- Bifrost logs the request with virtual-key and cost metadata.
- Proliferate imports the usage and debits the user's grant.
- Exhaustion disables managed-credit use.
- Hosted BYOK is exposed only after the Bifrost isolation gate passes.
- An org admin can configure a BYOK credential and apply it to the shared
  sandbox after that gate passes.
- Bedrock BYOK can be validated locally with AWS CLI plus a live gated Bifrost
  test.
- E2B live testing proves the public Bifrost URL is reachable from the sandbox.
- Existing synced-path/local auth flows remain available.

## Critique Hardening

The implementation should preserve these security and operability constraints:

- Sandbox materialization must require an explicit public Bifrost URL. It must
  never fall back to the private/admin Bifrost URL.
- Runtime virtual keys are scoped to a sandbox slot and selection. A selection,
  credential, provider-key fingerprint, or budget change disables the old
  runtime key and mints a new one instead of mutating the old key in place.
- Bifrost provider-key fingerprints include non-reversible digests of secret
  material and Bedrock config, so provider credential rotation is reconciled.
- Runtime virtual keys must use explicit model allowlists. Wildcard
  `allowed_models` is not acceptable for BYOK.
- Bifrost usage import must paginate logs, dedupe by router log id, and treat a
  successful managed-credit request with missing/zero cost as a review state
  that disables managed-credit runtime keys until reconciled.
- Router disable failures remain retryable. A key that may still be active in
  Bifrost should stay active locally with failed sync status so import and later
  disable passes keep seeing it.

Remaining budget caveat:

- Per-runtime Bifrost budgets are only a remote guardrail. They do not by
  themselves enforce one aggregate Proliferate trial balance across many
  simultaneous runtime virtual keys. Proliferate's imported ledger is the
  canonical source of truth for free-credit exhaustion in this pass. Before
  high-scale managed credits, either map budget subjects to a shared Bifrost
  customer/team budget or keep Proliferate-owned preflight/usage reconciliation
  tight enough for the intended trial exposure.

## Open Questions

- Gemini and OpenCode gateway support are follow-ups after protected-env,
  template, AnyHarness launch, and live CLI proof work.
- Whether Proliferate should map personal subjects to Bifrost customers and org
  subjects to Bifrost teams, or use one Bifrost concept for both, should be
  finalized during Phase 0 after API ergonomics are tested.
- Whether the hosted public URL should expose raw Bifrost branding paths or use
  `https://llm.proliferate.ai` with route aliases is an operator/deployment
  decision. Product code should treat it as config.
- Exact Bifrost admin API auth mode for hosted production is a deployment
  blocker, not a post-launch cleanup item.
