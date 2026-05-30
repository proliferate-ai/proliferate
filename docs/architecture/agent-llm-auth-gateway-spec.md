# Agent LLM Auth Gateway Spec

Status: proposed implementation spec

Date: 2026-05-17

## Purpose

This spec defines the centralized agent LLM auth gateway for managed cloud
targets and shared sandboxes.

The gateway gives a sandbox one of these auth sources for each agent harness:

```text
Proliferate managed credits
  Proliferate-owned provider credentials, org-scoped included usage, no overage.

BYOK through gateway
  User/org-owned provider credentials stored server-side, never injected into
  the sandbox. Hosted-cloud V1 does not expose this path; it is gated on
  LiteLLM Enterprise team-scoped routing or an equivalent isolated-router
  topology.

Synced path
  Existing native auth files or env vars synced into the sandbox by Desktop and
  worker.
```

The core runtime boundary is:

```text
AnyHarness launches a harness with a chosen model string.
The harness sends that exact model string to Proliferate Gateway.
Proliferate Gateway validates the sandbox token and forwards to LiteLLM.
LiteLLM routes the model for that team/policy, calls the provider, tracks
spend, and enforces budgets.
```

Proliferate does not do per-request model remapping. It provisions LiteLLM so
the harness-visible model ids that AnyHarness launches are valid LiteLLM public
model names for the policy's team.

## Hosted Cloud Launch Scope

Hosted-cloud V1 intentionally ships a narrower gateway surface:

```text
Enabled
  Proliferate managed credits through the gateway.
  Synced native auth files/env vars for user-owned or explicitly shared auth.

Disabled
  User/org BYOK provider credentials through the gateway.
  Gateway UI for adding Anthropic/OpenAI/Bedrock/OpenAI-compatible provider
  credentials.
  Shared public-model BYOK routing on the OSS LiteLLM router.
```

This is a product-scope cut, not a permanent architecture change. The BYOK
gateway path remains the V2 design, but hosted cloud must not expose it until
one of these isolation mechanisms is available:

```text
preferred
  LiteLLM Enterprise team-scoped deployments, where duplicate public model names
  are isolated by team/policy using team_public_model_name.

fallback
  isolated LiteLLM routers/instances per policy or budget subject.

deferred alternative
  Proliferate-side internal model aliases and protocol-aware request/response
  rewriting.
```

Managed credits can still ship on OSS LiteLLM because Proliferate owns the
provider credentials. For that path, global LiteLLM model deployments are
acceptable as long as they are backed only by Proliferate-owned provider
credentials, and org/user budgets are enforced through LiteLLM teams/virtual
keys plus Proliferate entitlement checks.

## Docs Read For This Spec

This spec is cross-cutting and follows:

- `docs/README.md`
- `docs/server/README.md`
- `docs/server/guides/database.md`
- `docs/server/guides/integrations.md`
- `docs/frontend/README.md`
- `docs/frontend/guides/access.md`
- `docs/anyharness/README.md`
- `docs/dev/ci-cd.md` before adding deployable gateway/LiteLLM services,
  deployment env vars, or runtime process changes
- `docs/architecture/cloud-worker-control-plane.md`
- `docs/architecture/cloud-worker-workspace-command-spec.md`
- `docs/architecture/target-runtime-mcp-skills-config.md` when present in the
  worktree; otherwise this spec's runtime-auth sections stand alone
- `docs/architecture/shared-sandbox-config-admin-ui-spec.md` when present in
  the worktree; otherwise this spec's consumer contract stands alone
- `docs/architecture/model-catalog-and-dynamic-registries.md`
- `docs/notes/model-gateway-auth-facts.md`

## Scope

In scope:

- Agent auth credential library for personal, organization, and system
  credentials.
- Gateway-backed provider auth for Proliferate managed credits.
- V2 architecture for BYOK through gateway, behind explicit availability gates.
- Synced-path credentials as a selectable auth source for personal and shared
  sandboxes.
- Org-scoped Proliferate managed credits with LiteLLM-enforced hard budget.
- LiteLLM provisioning for teams, virtual keys, provider credentials, and
  team-scoped model deployments.
- Gateway runtime grants and runtime agent auth refresh through worker and
  AnyHarness.
- UI flows for managed-credit status, synced native auth, and selecting agent
  auth per sandbox/harness. BYOK provider-credential setup is V2-gated.

Out of scope:

- Overage billing.
- Proliferate-owned per-request usage ledger.
- Self-hosted gateway/LiteLLM management.
- Hosted-cloud V1 BYOK through gateway.
- Gemini gateway support. V1 may keep Gemini on synced-path auth.
- A new product model catalog. `catalogs/agents/v1/catalog.json` remains the
  product model catalog.
- Direct exposure of LiteLLM virtual keys to sandboxes.

## Relationship To Adjacent Specs

This spec is one layer of the shared cloud sandbox stack:

```text
target-runtime-mcp-skills-config.md
  owns target-scoped MCP/skill manifests, lazy artifact fetch, and MCP/skill
  credential gap fill.

agent-llm-auth-gateway-spec.md
  owns agent harness LLM auth: Proliferate managed credits, V2 BYOK through the
  gateway, synced native auth files, LiteLLM provisioning, and runtime grants.

shared-sandbox-config-admin-ui-spec.md
  consumes both layers to let admins configure shared sandboxes.
```

The MCP/skill system and this LLM auth system should use the same target
profile/materialization shape where possible, but they should not be collapsed
into one credential model. MCP credentials authorize tools. Agent LLM
credentials authorize the model calls made by Claude Code, Codex, OpenCode, or
Gemini.

This document must also stand alone in worktrees that do not yet contain the
adjacent target-runtime or shared-sandbox specs. When an adjacent spec is absent
or older, use this document as the canonical source for agent LLM auth names,
ownership, worker commands, and sandbox selection semantics. Adjacent specs can
reference this one, but they do not need to repeat its data model.

### Consumer Contract For Shared Sandbox Specs

Adjacent specs and UI work should treat this spec as the source of truth for
agent LLM auth. They should consume only the public auth objects and APIs:

```text
Read/select:
  agent_auth_credential
  sandbox_agent_auth_selection
  agent auth readiness/status summaries

Write:
  sandbox_agent_auth_selection for a sandbox profile

Observe:
  selection status
  target/profile applied revision and materialization status
  credential owner/status/revision
```

They should not create parallel models for agent credentials or gateway
policies. In particular, shared sandbox specs should not define their own
`cloud_agent_credential`, `cloud_agent_api_key_credential`,
`cloud_agent_managed_gateway_credential`, or
`cloud_agent_credential_source` as normative data models. Those older concepts
map to this spec as:

```text
old cloud_agent_credential/source  -> agent_auth_credential
old shared credential source       -> sandbox_agent_auth_selection
old api_key credential             -> managed_gateway credential + provider credential
old managed_gateway credential     -> agent_gateway_policy
old worker credential apply        -> refresh_agent_auth_config
```

The shared sandbox/admin UI spec still owns the page composition and the fact
that an organization shared sandbox has per-harness selections. This spec owns
how credentials are created, validated, provisioned, selected, refreshed,
materialized, revoked, and enforced.

### Implementation Posture

This is an implementation spec, not only a north-star architecture note.
Existing launch docs may still describe synced credentials as the current V1
bridge or say that there is no centralized agent gateway for that launch. Those
statements describe current state, not the target state here.

Implementation should be phased, but the target model should not be watered
down into a second temporary credential abstraction. The immediate alignment
work is:

```text
1. Use this spec's names for new agent-auth work:
   agent_auth_credential
   sandbox_agent_auth_selection
   refresh_agent_auth_config

2. Treat unsupported gateway-backed paths as feature-gated statuses, not
   different models.

3. Keep synced-path credentials as one credential kind inside this model.

4. Prove gateway/provider compatibility through Phase 0 before enabling a
   provider broadly, but do not create provider-specific product models while
   waiting for that proof.
```

For doc-only landings, include this spec in `docs/README.md`. If adjacent specs
are landing in another worktree, they should link to this spec and consume the
consumer contract above instead of copying the older credential-source model.

## Decisions

1. LiteLLM is the hot-path router and budget enforcer.

   Proliferate validates the sandbox token, resolves the selected gateway
   policy, and forwards to LiteLLM with the internal key for that policy.
   LiteLLM decides which configured deployment handles the requested model and
   updates spend.

2. Proliferate concepts are canonical; LiteLLM ids are internal mirrors.

   Product state uses `agent_auth_credential`, `agent_gateway_policy`, provider
   credentials, sandbox selections, and runtime grants. LiteLLM team ids,
   virtual keys, and model ids are stored only so Proliferate can reconcile
   and repair the LiteLLM mirror.

3. LiteLLM team ownership follows the budget/routing subject.

   A gateway policy is the concrete auth/routing contract:

   ```text
   ACME shared sandbox uses Proliferate managed credits
   ACME shared sandbox uses ACME Bedrock role
   Alice personal sandbox uses Alice OpenAI key
   ```

   For hosted-cloud V1 managed credits, policies for the same org must share
   one `agent_gateway_budget_subject` and one LiteLLM team so the included
   credit budget is enforced across harnesses, not once per harness. BYOK
   gateway policies are V2: use LiteLLM Enterprise team-scoped routing if
   available, otherwise use isolated LiteLLM routers/instances per policy or
   defer the feature.

4. Proliferate managed credits are org-scoped in V1.

   The org gets an included dollar budget for the period. V1 has no overage.
   When the budget is exhausted, managed-credit requests fail closed.

5. Budget enforcement is outsourced to LiteLLM, but entitlement is not.

   Proliferate stores the plan/free-trial entitlement and provisions LiteLLM
   with `max_budget` and `budget_duration` on the shared managed-credit budget
   subject. LiteLLM stores and enforces current spend. Proliferate does not
   write a usage ledger on every request in V1.

6. V1 budget duration is LiteLLM-native `30d`.

   Do not use `30m`: in LiteLLM duration syntax that means 30 minutes. Stripe
   subscription-period alignment can be added later by updating/resetting the
   LiteLLM team on renewal.

7. BYOK through gateway is V2 and has no default dollar cap when enabled.

   Hosted-cloud V1 should not expose BYOK provider credentials through the
   gateway. When the V2 path is enabled, BYOK usage is reported, but
   Proliferate does not hard cap BYOK by default. Gateway still applies
   operational abuse protection. Admin-configured BYOK caps can be a later
   feature.

8. Fail closed.

   If the selected credential or policy is invalid, missing, unvalidated,
   exhausted, or revoked, launches and requests fail. They never silently fall
   back to Proliferate credits unless an explicit future fallback flag exists.

9. Managed-gateway provider secrets never enter the sandbox.

   Provider API keys, AWS role credentials, OAuth refresh tokens, and LiteLLM
   internal keys stay server-side. The sandbox receives only a scoped,
   revocable Proliferate gateway runtime grant.

10. Synced path intentionally writes native auth into the sandbox.

    Synced-path credentials are a separate auth kind. They are allowed for
    personal sandboxes and, by admin selection, shared sandboxes. Their whole
    purpose is to materialize native auth files/env vars in the sandbox.

11. Shared sandbox auth selection is admin-only in V1.

    Everyone may effectively be admin during early product rollout, but the
    authorization model should still use admin-only checks. A shared sandbox can
    select org/system gateway credentials or a selected user's personal synced
    files. The UI must show the source owner clearly.

12. Harness model strings pass through.

    AnyHarness chooses the model string from the existing product catalog and
    launches the harness with it. The harness sends the same model string to
    the gateway. Proliferate Gateway does not translate it in the launch path.
    For managed credits, LiteLLM deployments are backed by Proliferate-owned
    provider credentials. For V2 BYOK, LiteLLM team-scoped deployments expose
    the same public model name and translate to provider model ids internally.

13. Team-scoped LiteLLM model support is a BYOK gateway gate, not a managed
    credits launch gate.

    LiteLLM must support multiple teams using the same public model name with
    different provider credentials before hosted cloud can expose user/org
    BYOK through the gateway. The intended mechanism is team-scoped model
    deployments: `/model/new` with `model_info.team_id`, where LiteLLM stores a
    unique internal `model_name_*` and exposes `team_public_model_name` equal to
    the harness-visible model string. If this cannot be validated in the
    deployed LiteLLM edition, do not ship shared BYOK through the gateway.
    Managed credits may still ship if they use Proliferate-owned provider
    credentials and do not mix tenant-owned provider credentials into the same
    global model routing pool.

14. Request/response bodies are not persisted by default.

    Store usage metadata and diagnostics only. Debug body logging, if added,
    must be explicit and expire automatically.

## System Architecture

```text
Desktop/Web
  -> api.proliferate.ai
       canonical product DB
       auth library and sandbox selections
       LiteLLM provisioning
       worker commands

Sandbox harness process
  -> gateway.proliferate.ai
       validates Proliferate runtime grant
       resolves grant -> gateway policy -> LiteLLM internal key
       protocol facade: Anthropic, OpenAI-compatible, Responses
       forwards to private LiteLLM

Private LiteLLM
  -> provider APIs
       Bedrock, Anthropic, OpenAI, OpenAI-compatible
       team-scoped model routing
       spend tracking and hard budget enforcement
```

Production should run these as separate processes/services even if they live in
the same repo:

```text
api service       public control plane
gateway service   public model gateway
litellm service   private/internal, not exposed to sandboxes
```

## Product Object Model

### Sandbox Profile Contract

This spec depends on a sandbox profile identity owned by shared sandbox/admin
configuration work. Agent auth should consume that identity, not become the
owning domain for shared-sandbox configuration. If that schema has not landed
yet, Phase 1 must first add the minimal profile contract in the shared
sandbox/profile owning area, then agent auth can reference it.

```text
sandbox_profile
  id
  owner_scope                 personal | organization
  owner_user_id               nullable for org rows
  organization_id             nullable for personal rows
  managed_target_id           nullable until cloud is enabled
  agent_auth_revision         denormalized current pointer
  status                      active | archived
  created_at
  updated_at
  deleted_at
```

The auth gateway does not own repo environment config, MCP/skill selection, or
target cardinality. It only needs a stable `sandbox_profile_id` so the product
can say "this personal or shared sandbox profile uses these credentials for
these harnesses."

If another spec lands a fuller profile model first, use that table and keep
these fields as the auth gateway's required subset. Do not create a second
profile-like table under `agent_auth`. If no owning profile domain exists when
implementation starts, create it in the shared sandbox/profile owning area
first; agent auth owns only credential, selection, target-state, and grant
rows.

Profile lifecycle:

```text
personal profile
  create lazily when the user enables cloud, creates/selects an agent auth
  credential for cloud use, or launches the first cloud workspace.

organization profile
  create when an admin enables shared cloud or configures the first shared
  sandbox selection.

CloudCredential cutover
  backfill personal profiles for users with existing CloudCredential rows so
  new materialization can switch to sandbox_agent_auth_selection deterministically.

first launch after cutover
  if a user has legacy CloudCredential state but no sandbox profile yet, the
  server must create the personal profile, import the CloudCredential rows as
  synced-path agent_auth_credential rows, create default selections, bump
  agent_auth_revision, and dispatch the launch with requiredAgentAuthRevision.
  This happens before worker launch preflight so the old injection path can be
  removed without leaving a gap.
```

`sandbox_profile.agent_auth_revision` is the current desired revision pointer.
`sandbox_profile_agent_auth_revision` is the append-only revision history and
the source for `force_restart` and reason. Treat them as one revision stream,
not two independent counters.

### Agent Auth Credential

Reusable auth source visible in the Proliferate product.

`agent_kind` values must be catalog/AnyHarness agent kind strings. Do not
invent gateway-specific names based on product display names. Current canonical
values used here are `claude`, `codex`, `opencode`, and `gemini`; server Cloud
constants must be extended before exposing a kind that is not currently cloud
supported.

```text
agent_auth_credential
  id
  owner_scope                 system | personal | organization
  owner_user_id               nullable for org/system
  organization_id             nullable for personal/system
  created_by_user_id
  agent_kind                  claude | codex | opencode | gemini
  credential_kind             managed_gateway | synced_path
  display_name
  redacted_summary_json
  status                      pending | ready | needs_resync | invalid | revoked
  revision
  created_at
  updated_at
  revoked_at
```

Examples:

```text
System Proliferate managed credits
Org ACME AWS Bedrock role
Alice synced Claude auth files
Alice personal OpenAI key through gateway
```

Credential visibility is derived, not stored as a second state machine:

```text
system credential        visible where the system policy allows it
organization credential  visible to admins/users with org credential access
personal credential      visible only to the owner unless an active
                         agent_auth_credential_share exists for that org
```

There is no separate visibility column in V1. `agent_auth_credential_share` is
the single source of truth for owner opt-in of personal synced credentials.
This avoids overlapping states like a cached "shared" flag plus a revoked
share.

### Agent Auth Credential Share

Owner opt-in/delegation record for using a personal credential outside the
owner's personal sandbox.

```text
agent_auth_credential_share
  id
  credential_id
  owner_user_id
  organization_id
  share_scope                 organization
  shared_by_user_id
  status                      active | revoked
  allowed_agent_kind
  created_at
  revoked_at
  revoked_by_user_id
```

Rules:

```text
only the credential owner can create or revoke a share
admins can select only active shares for organization shared sandboxes
revoking the share invalidates affected sandbox_agent_auth_selection rows
selection UI must show the source owner and shared credential label
share consent copy must say this is reusable org-wide delegation for shared
  sandboxes until revoked
owner consent UI must show current where-used and later where-used must remain
  visible from the auth library
all create/select/revoke actions emit audit events
```

### Gateway Policy

Concrete LiteLLM-backed policy for `managed_gateway` credentials.

```text
agent_gateway_policy
  id
  credential_id
  policy_kind                 proliferate_managed | org_byok | personal_byok
  owner_scope                 system | personal | organization
  owner_user_id
  organization_id
  budget_subject_id           nullable; set for proliferate_managed
  litellm_team_id
  litellm_virtual_key_id
  litellm_virtual_key_ciphertext
  litellm_virtual_key_ciphertext_key_id
  litellm_sync_status         pending | synced | drifted | failed
  litellm_sync_fingerprint
  status                      provisioning | ready | invalid | revoked
  revision
  last_provisioned_at
  last_litellm_reconciled_at
  last_error_code
  last_error_message
```

For Proliferate managed credits, every org policy that spends the same included
credits must reference the same `budget_subject_id`; `litellm_team_id` mirrors
the budget subject's team for fast gateway lookup. For BYOK, `budget_subject_id`
is null, the policy owns its LiteLLM team, and no LiteLLM max budget is set
unless an admin cap is later added.

### Gateway Budget Subject

Budget-enforcement subject shared across one or more gateway policies.

```text
agent_gateway_budget_subject
  id
  budget_kind                 proliferate_managed
  owner_scope                 organization
  organization_id
  litellm_team_id
  included_budget_usd
  budget_duration             V1 "30d"
  litellm_sync_status         pending | synced | drifted | failed
  litellm_sync_fingerprint
  status                      ready | exhausted | invalid | revoked
  revision
  last_provisioned_at
  last_litellm_reconciled_at
  last_error_code
  last_error_message
```

V1 only needs `proliferate_managed` org budgets. The invariant is that Claude,
Codex, or future harnesses using Proliferate managed credits for the same org
spend against the same LiteLLM team budget.

### Gateway Provider Credential

Provider-side credential or connection config used by a gateway policy.

```text
agent_gateway_provider_credential
  id
  policy_id
  provider_kind               proliferate_bedrock_pool
                              anthropic_api_key
                              openai_api_key
                              bedrock_assume_role
                              openai_compatible
  payload_ciphertext
  payload_ciphertext_key_id
  redacted_summary_json
  validation_status           unvalidated | valid | invalid
  validated_at
  validation_error_code
  validation_error_message
  revision
```

Payload examples:

```json
{
  "providerKind": "bedrock_assume_role",
  "roleArn": "arn:aws:iam::123456789012:role/ProliferateBedrockRole",
  "externalId": "org_..._...",
  "region": "us-west-2",
  "validatedAccountId": "123456789012"
}
```

```json
{
  "providerKind": "openai_compatible",
  "baseUrl": "https://models.example.com/v1",
  "apiKey": "...",
  "discoveredProviderModelIds": ["..."]
}
```

Discovered provider model ids are validation/debug facts for that provider
credential. They are not product catalog entries and must not drive the model
picker directly.

### Sandbox Agent Auth Selection

What a sandbox profile uses for each harness.

```text
sandbox_agent_auth_selection
  id
  sandbox_profile_id
  owner_scope                 personal | organization
  agent_kind                  claude | codex | opencode | gemini
  credential_id
  credential_share_id         required when organization selects personal
                              synced_path credential
  materialization_mode        gateway_env | synced_files
  selected_revision
  status                      active | needs_resync | invalid
  last_error_code
  last_error_message
```

Shared sandbox rules:

```text
admin-only selection
may select org/system gateway credentials
may select a named user's personal synced files only through an active
  agent_auth_credential_share
must fail closed when the source credential becomes stale/revoked
must fail closed when the credential share is revoked
must show source owner in UI
```

Selection rows are desired state for the sandbox profile. They are not enough
to prove a target is current, because one profile can be applied to multiple
managed targets or SSH targets.

### Target Agent Auth State

Per-target applied/materialized state for a sandbox profile.

```text
sandbox_profile_agent_auth_target_state
  id
  sandbox_profile_id
  target_id
  desired_revision
  applied_revision
  status                      pending | materializing | applied | failed | superseded
  force_restart_required
  last_command_id
  last_worker_id
  last_attempted_at
  last_applied_at
  last_error_code
  last_error_message
  created_at
  updated_at
```

Rules:

```text
selection and credential changes update profile-level desired state
each target/profile pair records its own applied revision
worker status updates target_state, not selection rows
launch preflight checks the target's applied revision and AnyHarness local
  revision before starting/cold-restarting an actor
one online target cannot make another target look applied
```

### Runtime Grant

Scoped, revocable token given to the sandbox for managed gateway calls.

```text
agent_gateway_runtime_grant
  id
  token_hash
  policy_id
  credential_id
  selection_id
  issued_profile_revision
  target_id
  sandbox_profile_id
  organization_id
  user_id
  agent_kind
  protocol_facade             anthropic | openai
  expires_at
  revoked_at
  last_used_at
  created_at
```

The raw token is returned only in the worker materialization response. Store
only a hash in Proliferate DB.

`target_id` is the Cloud-side managed/SSH target where the grant is intended to
be valid. In V1 the runtime grant is still a bearer token: `target_id` and
`sandbox_profile_id` are authorization and revocation metadata checked by the
gateway after token lookup, not cryptographic source binding. Do not claim a
stolen grant cannot be replayed from another network location unless a later
target-proof mechanism is added.

Do not add an AnyHarness-owned sandbox/session id to this table in V1. If
session-level metadata becomes available, attach it to gateway request metadata
or logs as optional observability data, not as part of the grant identity.

Runtime grant lifecycle:

```text
service reuses an existing unexpired grant when it has more than 24h remaining
service mints a replacement only inside the refresh window or on selection
  change
at most two unrevoked/unexpired routine grants should exist for
  policy_id + target_id + sandbox_profile_id + agent_kind: current plus grace
routine grant grace is allowed only for the same selection_id and policy_id
selection change to a different credential/policy revokes old grants after the
  target reports the new revision applied, unless a future explicit live-grace
  flag is added
expired/revoked grants are cleaned up by retention job after the audit window
```

Future target proof, if needed:

```text
gateway can require a second signed target proof header derived from a
target-scoped secret delivered to AnyHarness/worker
protocol facades must prove the target proof can be sent by the harness config
before treating target_id as cryptographically source-bound
```

Personal synced credentials do not create gateway runtime grants. When a
materialization plan writes synced files because a shared sandbox selected a
personal credential, the plan and audit event must include the
`credential_share_id` that authorized that materialization.

Secret handling rules:

```text
runtime grant token generation:
  use at least 128 bits of entropy from a CSPRNG

token_hash:
  store HMAC-SHA256(server_secret, raw_token) or an equivalent keyed hash
  store a hash_key_id / version so token-hash keys can rotate with dual-read
  validation windows
  never store raw runtime grants in DB

ciphertext:
  store key ids for provider payloads and LiteLLM virtual keys
  use authenticated encryption with stable associated data such as table name,
    row id, owner scope, and provider kind
  support key rotation through write-new/read-old windows before old-key
    retirement

logs and repr:
  raw grants, provider payloads, LiteLLM virtual keys, auth headers, and synced
  file contents must be redacted from structured logs, exceptions, repr/debug
  output, worker status payloads, and command result payloads

materialization plan:
  assembled just in time by the worker materialization endpoint
  do not persist server-side plans containing runtime_grant_token, provider
    keys, or synced auth file bodies
  persist only redacted summaries, hashes, references, target state, and audit
    events
  returned only over authenticated worker channel
  never persisted by worker except required synced files/config
  status responses must not echo secrets

AnyHarness persistence:
  if agent auth config is persisted, encrypt it at rest or store only
  non-secret metadata plus a local secret reference

debug logging:
  request/response body logging and materialization-plan logging are disabled by
  default; any explicit debug capture must be access-controlled and expire
```

### Database Invariants

Add explicit constraints/indexes so auth resolution is deterministic:

```text
all mutable tables
  created_at and updated_at following server DB conventions
  revoked_at/deleted_at/status columns where rows are soft-retired

sandbox_profile
  check owner fields match owner_scope
  partial unique index for active personal profile by owner_user_id
  partial unique index for active organization profile by organization_id

agent_auth_credential
  check owner fields match owner_scope
  index owner_scope + owner_user_id + agent_kind + status
  index owner_scope + organization_id + agent_kind + status

agent_auth_credential_share
  partial unique index for active share by credential_id + organization_id
  enforce shared credential owner_user_id matches credential.owner_user_id with
    service validation plus composite FK or trigger; it cannot be a plain check
  index organization_id + allowed_agent_kind + status

agent_gateway_budget_subject
  partial unique index for active proliferate_managed budget by organization_id

agent_gateway_policy
  unique policy by credential_id
  check proliferate_managed requires budget_subject_id
  check BYOK policies have null budget_subject_id

agent_gateway_provider_credential
  unique provider credential by policy_id for provider-backed BYOK policies

sandbox_agent_auth_selection
  unique sandbox_profile_id + agent_kind
  check organization-owned selection of personal synced credential requires
    credential_share_id
  organization-owned selection must not use personal managed_gateway
    credentials in V1
  selected_revision must equal credential revision observed at selection time

sandbox_profile_agent_auth_target_state
  unique target_id + sandbox_profile_id
  index target_id + status + desired_revision + applied_revision
  applied_revision cannot exceed desired_revision

agent_gateway_runtime_grant
  unique token_hash
  index policy_id + revoked_at + expires_at
  index target_id + sandbox_profile_id + agent_kind
  index selection_id + issued_profile_revision
  service-level invariant: no more than current plus grace unexpired grants per
    policy_id + target_id + sandbox_profile_id + agent_kind
```

Implement these as concrete foreign keys, composite foreign keys, partial
unique indexes, row locks, service validations, and triggers where needed.
Cross-row/cross-table invariants must not be documented as plain SQL `CHECK`
constraints if Postgres cannot enforce them that way.

Revision bump semantics:

```text
selection writes lock sandbox_profile row
credential/share revocation locks affected sandbox_profile rows
target-state updates lock target_id + sandbox_profile_id state row
increment agent_auth_revision in the same transaction as selection/status change
enqueue refresh_agent_auth_config after commit using the committed revision
```

## LiteLLM Provisioning

### Managed Credits

When an org receives included credits:

```text
1. Create or update agent_gateway_budget_subject
   budget_kind = proliferate_managed
   owner_scope = organization
   included_budget_usd = plan/free-trial amount
   budget_duration = "30d"

2. Create or update LiteLLM team for the budget subject
   /team/new or /team/update
   max_budget = included_budget_usd
   budget_duration = "30d"

3. For each enabled harness path, create or update agent_auth_credential
   credential_kind = managed_gateway
   owner_scope = organization
   agent_kind = claude | codex | opencode | gemini
   display_name = "Proliferate managed credits"

4. Create or update agent_gateway_policy
   policy_kind = proliferate_managed
   budget_subject_id = shared org managed-credit budget subject
   litellm_team_id = budget subject LiteLLM team

5. Create internal LiteLLM virtual key
   /key/generate
   team_id = litellm_team_id

6. Create LiteLLM model deployments for supported harness-visible model ids.
   Hosted-cloud V1 managed credits may use global deployments because the
   provider credentials are Proliferate-owned. Do not add tenant-owned provider
   credentials to those global public model names.
```

LiteLLM is the source of truth for current spend. Proliferate is the source of
truth for the budget amount that should be provisioned.

Budget fail-closed rule:

```text
before a managed-credit credential can become selectable, Proliferate must
  reconcile the LiteLLM team/key/model/budget mirror and mark budget subject
  and policy litellm_sync_status = synced
gateway requests for managed credits fail closed if the budget subject or
  policy is drifted/failed/stale
launch preflight fails if required managed-credit policy is not synced
reconciliation is a launch/readiness gate, not a post-rollout hardening task
```

### BYOK (Enterprise-Gated V2)

Hosted-cloud V1 does not expose this setup flow. The API/data model may keep
the V2 shape, but BYOK provider credentials must not become selectable or
launchable in hosted cloud until LiteLLM Enterprise team-scoped routing or an
equivalent isolated-router topology is enabled.

When an admin adds BYOK through gateway:

```text
1. Create agent_auth_credential
2. Create agent_gateway_policy
3. Store encrypted provider credential payload
4. Validate provider credential
5. Create LiteLLM team with no default dollar budget
6. Create internal LiteLLM virtual key
7. Create team-scoped model deployments backed by that provider credential
```

### Team-Scoped Model Deployment (V2 BYOK)

For every harness-visible model id that should work under a policy, provision a
team-scoped LiteLLM model whose public name equals the model string AnyHarness
will launch.

Example for Claude Sonnet backed by Bedrock:

```json
{
  "model_name": "us.anthropic.claude-sonnet-4-6",
  "litellm_params": {
    "model": "bedrock/us.anthropic.claude-sonnet-...",
    "aws_region_name": "us-west-2",
    "aws_role_name": "arn:aws:iam::123456789012:role/ProliferateBedrockRole",
    "aws_session_name": "proliferate-org-...",
    "aws_external_id": "org_..._..."
  },
  "model_info": {
    "team_id": "litellm-team-id"
  }
}
```

LiteLLM should internally store a unique deployment name and expose the
requested `model_name` as `team_public_model_name`. Runtime requests still send
`model = "us.anthropic.claude-sonnet-4-6"`.

Do not create a Proliferate hot-path route table that maps catalog model ids to
provider models. The mapping is LiteLLM provisioning state.

For hosted-cloud V1 managed credits, this team-scoped deployment mechanism is
not required if every public model deployment is backed by Proliferate-owned
provider credentials. The V1 isolation boundary is the gateway grant plus
LiteLLM team/key budget enforcement, not per-tenant provider credential routing.

This is the exact boundary:

```text
Catalog:
  catalogs/agents/v1/catalog.json remains the product model catalog and picker
  source.

Provisioning time:
  Proliferate reads the existing agent catalog and creates LiteLLM deployments
  for the model ids that a harness may request under this policy.
  catalog model id / harness-visible model string ==
    LiteLLM team_public_model_name.
  provider model id exists only in LiteLLM deployment params.

Request time:
  Proliferate Gateway forwards the request model unchanged.
  LiteLLM either finds the team-scoped deployment or returns model_not_found.
  Gateway maps that to model_not_available.
```

If an admin connects a provider that cannot serve a catalog model, that model is
simply not provisioned for that policy. The UI may show it as unavailable for
that credential, but the gateway still does not translate model ids on the hot
path.

### LiteLLM API Surface Used

V1 should use these LiteLLM primitives:

```text
/team/new
/team/update
/team/info
/key/generate
/key/info
/model/new
/model/update or /model/delete for reconciliation
```

Gateway calls should use the internal LiteLLM virtual key for the resolved
policy, never the LiteLLM master key.

## Provider Setup

### Proliferate Managed Credits

User input: none.

Proliferate operates system provider credentials, preferably Bedrock where the
target harness/protocol path is compatible. If a harness requires a protocol
LiteLLM cannot faithfully translate to Bedrock, route that harness through the
provider account that matches its protocol.

Examples:

```text
Claude Code
  preferred: Anthropic-compatible gateway -> LiteLLM -> Proliferate Bedrock
  fallback: Anthropic-compatible gateway -> LiteLLM -> Proliferate Anthropic

Codex
  preferred only if Responses API path is compatible
  fallback: OpenAI Responses-compatible gateway -> Proliferate OpenAI
```

### AWS Bedrock BYOK

Deferred for hosted-cloud V1. Keep this as the V2 provider setup contract for
the gateway BYOK path. For launch, Bedrock may be used only as a
Proliferate-owned managed-credit provider credential or through synced native
auth outside the gateway.

Admin UX asks for:

```text
AWS region
Role ARN
```

Before that, Proliferate generates and displays:

```text
Proliferate AWS principal
External ID
CloudFormation launch link
copyable IAM trust policy
copyable Bedrock permission policy
```

Trust policy shape:

```json
{
  "Effect": "Allow",
  "Principal": {
    "AWS": "arn:aws:iam::<proliferate-account>:role/proliferate-agent-gateway"
  },
  "Action": "sts:AssumeRole",
  "Condition": {
    "StringEquals": {
      "sts:ExternalId": "<generated-external-id>"
    }
  }
}
```

Permission policy shape:

```json
{
  "Effect": "Allow",
  "Action": [
    "bedrock:InvokeModel",
    "bedrock:InvokeModelWithResponseStream",
    "bedrock:Converse",
    "bedrock:ConverseStream"
  ],
  "Resource": "*"
}
```

Validation must fail fast:

```text
AssumeRole with correct ExternalId succeeds
AssumeRole with missing/wrong ExternalId fails
GetCallerIdentity returns expected account
test Bedrock invocation succeeds in the selected region
at least one supported Proliferate model is available
```

Primary setup artifact: CloudFormation launch link. Secondary: copyable IAM
JSON. Terraform can come later.

### Anthropic API Key

Deferred for hosted-cloud V1 when the credential would back the gateway. A user
may still sync native Claude auth to a sandbox through the synced path.

Admin/user input:

```text
API key
label
```

Stored encrypted in Proliferate. Provisioned into LiteLLM model deployments
server-side. Never written to sandbox for `managed_gateway`.

### OpenAI API Key

Deferred for hosted-cloud V1 when the credential would back the gateway. A user
may still sync native Codex/OpenCode auth to a sandbox through the synced path.

Admin/user input:

```text
API key
label
optional organization id
optional project id
```

Stored encrypted in Proliferate. Provisioned into LiteLLM model deployments.

### OpenAI-Compatible Provider

Deferred for hosted-cloud V1. Arbitrary provider base URLs through the gateway
are a V2 feature because they require tenant-provider isolation and SSRF-safe
validation.

Admin/user input:

```text
Base URL
optional API key
label
```

Proliferate should try `GET /models`. If discovery fails, the advanced path may
ask for one exact model id plus capability hints. Normal setup should not ask
users to curate a full model list.

Because this is a server-side probe, V1 must treat the base URL as untrusted
network input:

```text
require HTTPS for hosted Proliferate cloud
reject credentials embedded in the URL
block localhost, loopback, link-local, RFC1918/private, and metadata IP ranges
resolve DNS before the request and reject private resolved addresses
disable redirects or revalidate every redirect target with the same rules
set short connect/read timeouts and a small response-size cap
send only the provider API key header needed for the probe
audit create/validate attempts without logging the key or response body
```

Self-hosted/private-network providers can be added later behind an explicit
self-hosted deployment mode. They are not part of hosted-cloud V1.

### Synced Path

Synced path reuses and generalizes current `CloudCredential` behavior:

```text
Claude Code files/env
Codex files
OpenCode config/auth files when added
Gemini files/env
```

Synced-path payloads are allowed to write real auth files into the sandbox.
They are not gateway-backed and do not involve LiteLLM.

V1 target isolation rule:

```text
synced native auth files are target-global unless/until AnyHarness can launch
  a harness with per-profile HOME/config isolation
therefore a target may have at most one active sandbox profile with
  materialization_mode = synced_files for a given agent_kind
if multiple profiles must coexist on one target, they must use gateway_env or
  implementation must first add per-profile home/config isolation
```

Revocation cleanup:

```text
materialization plans can contain tombstones/cleanup actions for synced auth
worker must delete/replace only allowlisted auth paths owned by the selected
  harness before writing new synced files
credential/share revocation queues a cleanup materialization so old native auth
  files do not remain usable on disk
```

### Current CloudCredential Cutover

Current `CloudCredential` and target-config materialization already sync
personal agent auth into cloud workspaces. The migration must be explicit so old
and new paths do not both inject provider auth.

Cutover rules:

```text
1. Add schema and idempotent backfill first. Import existing CloudCredential
   rows as personal agent_auth_credential rows with credential_kind =
   synced_path and the catalog agent_kind string, but do not switch launch
   reads yet.

2. Keep CloudCredential as the legacy backing/source table only until all reads
   go through agent_auth_credential.

3. New sandbox/profile materialization must eventually read
   sandbox_agent_auth_selection, not direct CloudCredential rows.

4. Do not stop legacy target-config credential injection until
   refresh_agent_auth_config, target/profile applied state, AnyHarness agent
   auth config, launch auth-scope persistence, worker capability gating, and
   launch preflight are all live behind a feature flag.

5. Cutover uses a global/profile-aware kill switch so exactly one path writes
   agent auth for a target: legacy CloudCredential injection or new agent-auth
   materialization, never both.

6. Workspace/repo env sync must continue to reserve provider-routing env vars
   so repo `.env` cannot override selected agent auth.

7. Once the new path is live for personal and shared profiles, remove the old
   direct CloudCredential injection path rather than keeping a permanent dual
   model.

8. Cover every direct legacy path before flipping the switch, including target
   config materialization, runtime credential freshness refresh, worker env
   materialization, and any Desktop sync path that still writes provider env.

9. On the first launch after cutover for an existing user/target with legacy
   CloudCredential rows but no profile selection yet, the server must
   synchronously create/backfill the personal sandbox profile, import the
   credentials, create default selections for the user's personal sandbox, bump
   the auth revision, and include requiredAgentAuthRevision on the launch
   command. The worker then applies the new materialization path before
   dispatching the launch.
```

## Harness Materialization

### Target Auth Revision

Every sandbox profile has a monotonic agent auth revision. The revision changes
whenever the target-side auth launch state should be re-applied:

```text
sandbox_profile_agent_auth_revision
  sandbox_profile_id
  revision
  force_restart
  reason                      selection_changed
                              credential_validated
                              credential_revoked
                              credential_share_revoked
                              synced_files_updated
                              grant_rotation
                              target_bootstrap
                              drift_repair
  created_at
```

The selected credentials remain in `sandbox_agent_auth_selection`. The revision
is the compact desired-state marker. Per-target apply state lives in
`sandbox_profile_agent_auth_target_state`; do not use selection rows as
materialization status.

### When To Queue Refresh

Queue `refresh_agent_auth_config` whenever the target auth state might have
changed or might expire:

```text
sandbox auth selection saved
gateway credential validated or revalidated
gateway credential payload changed
synced-path credential files/env updated
credential revoked, invalidated, or marked needs_resync
target created, claimed, restored, or worker reconnects with no applied revision
worker heartbeat reports applied revision behind desired revision
earliest gateway runtime grant is inside the refresh window
```

For managed cloud targets, this should feel immediate: save credential or
selection, bump revision, enqueue command, worker leases command, target launch
config updates. If the target is offline, paused, or not bootstrapped yet, the
command stays queued or the bootstrap path applies the latest revision before
new launches.

### Command Shape

Add a CloudCommand:

```text
kind = refresh_agent_auth_config
scope = target only
payload:
  sandboxProfileId
  revision
  reason
  forceRestart
```

Use an idempotency key scoped to the target/profile/revision:

```text
agent-auth-config:{target_id}:{sandbox_profile_id}:{revision}
```

`sandboxProfileId` is the agent-auth config id. There is no separate
`agent_auth_config` table in V1. The idempotency key also includes `target_id`
because the same profile revision can be applied to multiple targets, such as
organization SSH targets that use the same shared profile.

Older queued commands are harmless. If a worker leases revision `N` after
revision `N+1` exists, the materialization endpoint should return a superseded
response and the worker should report an accepted no-op result. It must not
mark revision `N` as applied.

```json
{
  "applied": false,
  "reason": "superseded",
  "currentRevision": 42
}
```

The command is target-scoped because agent auth is target launch state, not a
workspace/session mutation.

Superseded target-state transition:

```text
worker receives superseded materialization response
worker reports status = superseded with currentRevision
server leaves applied_revision unchanged
server sets desired_revision to currentRevision and status = pending if the
  target still needs the newer revision, or leaves the newer in-flight state
  unchanged if another command is already materializing it
```

### Launch Preflight And Ordering

Do not rely only on Cloud command ordering to make launches see the latest
agent auth. Launch-capable commands should carry the sandbox profile auth
revision they require:

```text
start_session payload:
  sandboxProfileId
  requiredAgentAuthRevision

send_prompt / resume-like payloads that may cold-start an actor:
  sandboxProfileId
  requiredAgentAuthRevision
```

These are existing command contract changes. The server command validators,
worker command envelope/mapping, and AnyHarness request mapping must preserve
them for launch-capable commands.

Worker compatibility gate:

```text
workers must advertise capability agent_auth_launch_preflight_v1 before they
  can lease launch-capable commands that include requiredAgentAuthRevision
server lease filtering must route those commands only to capable workers, or
  use new command kinds that old workers do not advertise
if no capable worker is connected, launch commands remain queued or fail
  fast with worker_capability_missing; they must not be delivered to old
  workers that would ignore the fields
```

The worker must run an auth preflight before dispatching any command that can
start or cold-restart an actor:

```text
1. Read requiredAgentAuthRevision from the Cloud command payload.
2. Read target/profile applied state and AnyHarness scoped auth status.
3. If applied >= required, dispatch the original command.
4. If applied < required, fetch and apply the latest agent auth materialization
   plan first.
5. Re-read target/profile applied state and AnyHarness scoped auth status.
6. Dispatch the original command only if applied >= required.
7. Otherwise fail the command with agent_auth_refresh_failed.
```

This avoids race conditions where a user changes credentials and immediately
starts work before the background `refresh_agent_auth_config` command has been
leased. The background command still exists for normal drift repair and
rotation, but launch preflight is the correctness guard.

If a credential was revoked or invalidated, the preflight must fail closed. It
must not dispatch a launch using stale target auth.

### Gateway Grant TTL And Rotation

Gateway runtime grants should be long-lived enough that a live harness process
does not fail during normal use, but still revocable:

```text
default grant TTL: 7 days
refresh cadence: daily
refresh threshold: enqueue when earliest grant expires within 24 hours
```

Routine rotation should overlap grants. Do not revoke the previous routine
grant merely because a new grant was applied; let it expire naturally. This
matters because already-running harness processes usually keep their launch env
for their lifetime and will not see a freshly written token until restart.

Security and correctness invalidation is different:

```text
credential revoked / invalid / needs_resync -> gateway rejects all grants for
  that credential or policy immediately

selection changed to another credential -> new launches use the new grant;
  old grants for the previous credential/policy are revoked after the target
  reports the replacement revision applied unless a future explicit live-grace
  flag exists
```

`force_restart` lives on the committed `sandbox_profile_agent_auth_revision`
row and is copied into the `refresh_agent_auth_config` command payload. It is
set by explicit admin action or security-sensitive transitions such as
credential/share revocation. Routine grant rotation and normal credential
revalidation should leave it false.

V1 should not rely on sub-hour tokens unless a later local sidecar or
file-backed token refresh mechanism lets running harnesses read updated tokens
without restart.

### Worker Flow

The worker receives a materialization plan containing gateway runtime grant
tokens and harness-specific launch config. It applies that config to AnyHarness
as runtime-scoped agent auth state. Cloud still scopes the command to a
CloudTarget, but the AnyHarness API should use AnyHarness-owned runtime/agent
terms rather than importing the Cloud target model into AnyHarness.

The worker then fetches the plan:

```text
GET /v1/cloud/worker/agent-auth-configs/{sandbox_profile_id}/materialization
  ?revision=...
  &command_id=...
  &lease_id=...
```

The plan contains:

```text
target_id
sandbox_profile_id
revision
selections[]
  agent_kind
  materialization_mode
  credential_id
  credential_revision
  gateway:
    base_urls by protocol
    runtime_grant_token
    expires_at
    protected_env
    support_env
    protected_config_files or config content
    support_config_files or config content
  synced_files:
    files/env payloads, when materialization_mode = synced_files
    credential_share_id, when a shared sandbox uses a personal synced
      credential through owner delegation
    cleanup actions/tombstones for allowlisted native auth paths when a
      credential/share was revoked or replaced
```

Worker apply sequence:

```text
1. Lease refresh_agent_auth_config.
2. Report materialization status = materializing.
3. Fetch the materialization plan with command_id, lease_id, and revision.
4. Validate plan target_id and revision match the command.
5. Apply synced-path cleanup actions, if any, restricted to the harness
   allowlist.
6. Write synced-path files/env payloads, if any.
7. Call AnyHarness PUT /v1/agents/auth-config with gateway env/config.
8. Read AnyHarness redacted auth-config status to confirm applied revision.
9. Persist local applied revision metadata for reconnect diagnostics.
10. Report materialization status = applied, superseded, or failed.
11. Report CloudCommand result.
```

The worker reports:

```text
POST /v1/cloud/worker/agent-auth-configs/{sandbox_profile_id}/status
  status = materializing | applied | superseded | failed
```

Status writes update `sandbox_profile_agent_auth_target_state` for the
command's `target_id + sandbox_profile_id`. They must not echo raw grants,
provider secrets, synced file contents, or config file bodies.

### Cloud Command Contract Changes

`refresh_agent_auth_config` must be added to the same concrete command
surfaces as existing worker commands:

```text
server/proliferate/constants/cloud.py
  CloudCommandKind.refresh_agent_auth_config
  ACTIVE_CLOUD_COMMAND_KINDS
  SUPPORTED_CLOUD_COMMAND_KINDS

server/proliferate/server/cloud/commands/domain/rules.py
  target-only command shape validation
  payload validation for sandboxProfileId, revision, reason, forceRestart
  launch-command payload validation for sandboxProfileId and
  requiredAgentAuthRevision on commands that can start/cold-restart actors

anyharness/crates/proliferate-worker/src/cloud_client/commands.rs
  SUPPORTED_COMMAND_KINDS includes "refresh_agent_auth_config"
  launch command payloads preserve requiredAgentAuthRevision
  worker capability advertises agent_auth_launch_preflight_v1

anyharness/crates/proliferate-worker/src/commands/dispatcher.rs
  process_refresh_agent_auth_config_command
  launch preflight before start_session/send_prompt/resume-like dispatch

server/proliferate/server/cloud/worker/service.py
  lease filtering prevents old workers from receiving launch-capable commands
    that require agent auth preflight

server/proliferate/server/cloud/commands/models.py
  parses accepted refresh_agent_auth_config result_json so superseded/no-op
    outcomes are visible in Cloud command responses
```

Current Cloud commands reject `preconditions`; do not depend on preconditions
for V1. Use `requiredAgentAuthRevision` in launch-capable command payloads and
perform launch preflight in the worker.

`CloudCommandStatus.superseded` exists for command lifecycle bookkeeping, but
auth refresh workers should not depend on a new worker-result shape for
superseded materialization responses. A superseded auth refresh should report
an accepted no-op result:

```json
{
  "status": "accepted",
  "result": {
    "applied": false,
    "reason": "superseded",
    "currentRevision": 42
  }
}
```

This fits the current worker result status validator while still making
superseded revision behavior observable.

### AnyHarness Agent Auth State

Add an AnyHarness agent auth config API:

```text
PUT /v1/agents/auth-config
GET /v1/agents/auth-config/status?external_scope_kind=...&external_scope_id=...
```

`PUT /v1/agents/auth-config` is the write path for secret-bearing launch
config. The request body contains an opaque external auth scope, a revision,
and per-agent launch config:

```text
externalAuthScope:
  kind = sandbox_profile
  id = <sandbox_profile_id>
revision
selections[]
  agent_kind
  protected_env
  support_env
  protected_config_files/config content
  support_config_files/config content
  expires_at
```

`GET /v1/agents/auth-config/status` is a redacted status endpoint only:

```text
externalAuthScope
revision
agent_kind summaries
expires_at
status
last_error_code
```

It must not return raw runtime grants, provider headers, env values, config
file content, synced auth files, or other bearer material.

`externalAuthScope` is Cloud-owned metadata. AnyHarness stores it only so the
worker can ask "which auth config revision is applied for this external scope?"
AnyHarness must not interpret sandbox profile ownership or policy.

Session launch authority:

```text
CreateSessionRequest / resume-or-cold-start request mapping must carry:
  launchAuthScope { kind = sandbox_profile, id }
  requiredAgentAuthRevision

AnyHarness session records persist launchAuthScope and the revision used at
creation. Bare prompt cold-starts read the persisted scope from the session
record; they must not rely on `origin` or caller-provided display metadata as
authority.

At session launch/cold restart, AnyHarness queries its local auth-config state
for the persisted launchAuthScope and fails closed if the applied revision is
missing, stale, expired, or incompatible with the requested agent_kind.
```

AnyHarness stores the current agent auth revision and merges the relevant agent
auth launch env/config at session launch. Agent auth config has two buckets:
non-protected support inputs and protected provider-routing inputs. Merge
precedence should be:

```text
workspace materialized env
agent auth non-protected env/config
session launch env
adapter spawn override env
agent auth protected env/config overlay
```

The protected overlay wins only for provider-routing inputs. Non-protected
agent auth inputs use the normal runtime-auth slot before session/adapter
overrides, so existing consumers can still pass non-provider launch knobs. Live
actors pick up changes only at launch/restart boundaries.

This change must update AnyHarness contract schemas, regenerate SDK clients,
and wire the launch-env merge in the owned AnyHarness session startup path.

Gateway-backed sessions also require authoritative model application. If
AnyHarness cannot apply the resolved model string before the harness can issue
requests, or if the harness rejects the model config, launch fails. Gateway
auth must not proceed under today's best-effort model-apply behavior.

### Protected Provider-Routing Inputs

Fail-closed gateway auth depends on later untrusted layers not overriding the
selected auth route. AnyHarness must treat provider-routing inputs from agent
auth config as protected.

Initial protected inputs:

```text
Claude:
  ANTHROPIC_BASE_URL
  ANTHROPIC_CUSTOM_HEADERS
  ANTHROPIC_AUTH_TOKEN
  ANTHROPIC_API_KEY
  CLAUDE_CODE_USE_BEDROCK
  CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST
  managed Claude config files/env fragments

Codex:
  CODEX_API_KEY
  model_provider
  model_providers.proliferate.*
  Codex provider config files/env fragments

OpenCode:
  provider id
  baseURL
  apiKey
  managed OpenCode config files

Gemini:
  synced native auth files/env when selected
```

Merge rule:

```text
1. Build workspace env/config.
2. Apply agent auth non-protected env/config.
3. Apply session launch env/config.
4. Apply adapter spawn override env/config.
5. Apply agent auth protected overlay last.
6. Reject launch if any untrusted layer attempts to override a protected key
   with a conflicting value for the selected agent.
```

Workspace/repo env sync should continue filtering reserved provider env vars,
but AnyHarness must still enforce the protected overlay because session launch
and adapter layers are later in the local process.

### Claude Code Gateway Config

Use the Anthropic-compatible facade.

Expected env shape:

```text
CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST=1
ANTHROPIC_BASE_URL=https://gateway.proliferate.ai/anthropic
ANTHROPIC_CUSTOM_HEADERS=Authorization: Bearer <runtime-grant-token>
ANTHROPIC_AUTH_TOKEN=
```

Do not set `CLAUDE_CODE_USE_BEDROCK` for managed gateway. Bedrock, if used, is
behind LiteLLM, not in the sandbox.

### Codex Gateway Config

Use the OpenAI Responses-compatible facade.

Expected config shape:

```text
model_provider = "proliferate"

[model_providers.proliferate]
name = "Proliferate Gateway"
base_url = "https://gateway.proliferate.ai/openai/v1"
env_key = "CODEX_API_KEY"
wire_api = "responses"
requires_openai_auth = false

CODEX_API_KEY = <runtime-grant-token>
```

Implementation must use the current Codex ACP launch/config override mechanism
and must not depend on project files that the user can override. The exact
config injection should follow the facts in
`docs/notes/model-gateway-auth-facts.md`: custom provider config uses
`base_url`, `env_key`, and `wire_api = "responses"`.

### OpenCode Gateway Config

Use OpenAI-compatible provider config if AnyHarness can force a managed config
and isolate project config.

Expected config content:

```text
provider id = proliferate
baseURL = https://gateway.proliferate.ai/openai/v1
apiKey = <runtime-grant-token>
```

Gateway support for OpenCode is gated on launch hardening. If project config can
override the managed provider, mark OpenCode gateway auth as
`protocol_not_supported` and use synced path for V1.

### Gemini

Gemini gateway support is deferred. V1 may support Gemini only through
synced-path auth.

## Gateway Runtime

### Request Flow

```text
1. Harness sends request to protocol facade with runtime grant.
2. Gateway validates grant hash, expiry, revocation, selected revision, target
   metadata, sandbox profile, protocol facade, and agent kind.
3. Gateway loads the gateway policy and LiteLLM binding.
4. Gateway validates the requested route and model are allowed for the policy.
5. Gateway forwards the original request body to LiteLLM with the internal
   LiteLLM virtual key for that policy.
6. LiteLLM routes by team + public model name, calls provider, tracks spend,
   and enforces budget.
7. Gateway streams or returns the provider response in the original protocol.
```

Gateway request authorization must reject:

```text
grant used on the wrong protocol facade
unsupported endpoint for that facade
body over configured size limits
model not provisioned/allowed for the grant's policy and agent_kind
policy or budget subject litellm_sync_status not synced
grant issued for an older selection/revision that is no longer allowed
```

Gateway should attach metadata to LiteLLM requests when supported:

```json
{
  "proliferate_org_id": "...",
  "proliferate_user_id": "...",
  "proliferate_target_id": "...",
  "proliferate_sandbox_profile_id": "...",
  "proliferate_session_id": "...",
  "proliferate_agent_kind": "claude",
  "proliferate_policy_id": "..."
}
```

Metadata is for observability and spend slicing. It is not the canonical budget
counter in V1. `proliferate_session_id` is optional and should be attached only
when the harness/runtime grant path can reliably propagate it.

### Gateway Errors

Canonical gateway errors:

```text
invalid_gateway_token
gateway_token_expired
agent_auth_not_configured
provider_auth_failed
provider_rate_limited
model_not_available
credits_exhausted
gateway_route_unavailable
protocol_not_supported
litellm_unavailable
```

The gateway should map LiteLLM/provider errors to these codes as they are
encountered. The initial implementation can map coarsely, but the doc and code
should keep these stable names.

### Budget Exhaustion

For Proliferate managed credits:

```text
agent_gateway_budget_subject.included_budget_usd = org included credits
agent_gateway_budget_subject.budget_duration = "30d"
shared LiteLLM team max_budget = included_budget_usd
shared LiteLLM team budget_duration = "30d"
LiteLLM rejects after spend >= max_budget
Gateway maps to credits_exhausted
UI shows the budget exhausted state
```

No overage invoice is generated.

For usage display, Proliferate can query LiteLLM on demand through the control
plane endpoint. Do not add a persisted spend snapshot table in V1 unless page
latency or LiteLLM load proves it is necessary.

Gateway must not accept managed-credit requests when Proliferate believes the
LiteLLM budget mirror is stale or drifted. It should fail closed with
`gateway_route_unavailable` or `credits_exhausted` depending on the known
state, then reconciliation can repair the mirror out of band.

## UI Surfaces

The UI must keep credential creation distinct from sandbox/workspace
assignment:

```text
Auth library
  creates, validates, revokes, and audits reusable credentials.

Sandbox profile auth selection
  chooses which existing credential each agent harness uses in a personal or
  shared sandbox.

Workspace settings
  may show the effective cloud auth state and deep-link into setup, but should
  not own secret forms or store credential ids directly.
```

This distinction matters because credentials are reused across workspaces,
credentials have owners, revocation affects every sandbox that selected them,
and shared sandboxes can intentionally use a named user's synced native auth.
Workspace pages can still offer an "add/select credential" flow, but that flow
must create the credential in the auth library and then return to a sandbox
profile selection. The saved state remains
`sandbox_agent_auth_selection`, not workspace-local secret state.

If a future product requirement needs per-workspace auth overrides, model that
as a workspace-to-sandbox-profile binding or an explicit profile override. Do
not add direct provider-key or auth-file fields to workspace config.

### Harness-First Selection Model

The auth UI is harness-first, not provider-first. A user should start from the
agent harness they are configuring, then see only credential setup paths that
can actually satisfy that harness.

V1 matrix:

```text
Claude Code
  gateway-backed:
    Proliferate managed credits, if Anthropic-compatible path is validated
  synced-path:
    synced Claude Code native auth files/env
  V2 gateway-backed:
    AWS Bedrock AssumeRole for Anthropic/Claude models
    Anthropic API key
  do not show:
    OpenAI API key
    generic OpenAI-compatible provider

Codex
  gateway-backed:
    Proliferate managed credits, only after Responses facade is validated
  synced-path:
    synced Codex native auth files
  V2 gateway-backed:
    OpenAI API key
    OpenAI-compatible provider, only if compatible with the required OpenAI API
    shape for the selected Codex path
  do not show:
    Anthropic API key
    AWS Bedrock role unless a Codex-compatible gateway path is explicitly
    validated and enabled

OpenCode
  gateway-backed:
    Proliferate managed credits, only if launch hardening is complete
  synced-path:
    synced OpenCode native config/auth files
  V2 gateway-backed:
    OpenAI API key, if AnyHarness can force managed provider config
    OpenAI-compatible provider, if AnyHarness can force managed provider config
  do not show:
    gateway-backed options when project config can override the managed provider

Gemini
  gateway-backed:
    none in V1
  synced-path:
    synced Gemini native files/env
```

The same credential library can contain credentials for all harnesses, but
setup and selection screens must filter by `agent_kind`. Creating a Claude Code
credential should not offer OpenAI key setup. Creating a Codex credential
should not offer Anthropic key setup. The only exception is a deliberately
validated gateway path for that harness, documented in the matrix and gated by
feature flags/capability checks.

Provider setup can be reused internally across harness-specific credential
rows, but the user-facing selection handle is still harness-specific. A shared
Bedrock role may back both a Claude credential and a future Codex-compatible
credential if that path is validated; the UI still renders them under the
appropriate harness and does not expose provider model ids as a catalog.

The shared sandbox/admin UI should call into this surface like:

```text
GET /v1/cloud/agent-auth/credentials
  ?agent_kind=claude
  &sandbox_profile_id=...

PUT /v1/cloud/sandbox-profiles/{id}/agent-auth-selections
  selections:
    agent_kind
    credential_id
```

The response should include enough summary data for the consuming UI to render
without knowing gateway internals:

```text
credential_id
agent_kind
credential_kind
owner_scope
owner display name
display_name
redacted_summary_json
status
revision
compatibility reason / disabled reason
where_used summary
```

### Agent Auth Library

Personal and admin settings should show an auth library grouped by harness:

```text
Claude Code
  Proliferate managed credits
  AWS Bedrock role (V2 gateway BYOK)
  Anthropic API key (V2 gateway BYOK)
  synced Claude Code auth

Codex
  Proliferate managed credits, if Responses support is enabled
  OpenAI API key (V2 gateway BYOK)
  OpenAI-compatible provider (V2 gateway BYOK)
  synced Codex auth

OpenCode
  OpenAI API key (V2 gateway BYOK), if managed config is enforceable
  OpenAI-compatible provider (V2 gateway BYOK), if managed config is enforceable
  synced OpenCode auth

Gemini
  synced Gemini auth
```

Each row should show:

```text
owner
agent compatibility
credential kind
status
last validated/synced
where used
```

No secret values are displayed.

The auth library owns all provider setup forms. Hosted-cloud V1 should expose
only managed credits and synced native auth. Gateway provider setup forms are
V2 and should remain hidden unless the BYOK gateway capability is enabled. The
surface should support:

```text
create provider credential
validate provider credential
resync synced-path credential
revoke credential
show where used
show owner and active org shares
```

Creating or revoking an org-wide share must make the delegation scope explicit:
"admins in this organization can use this synced credential for shared
sandboxes until you revoke it." The owner must be able to see where the share
is currently selected before consenting and after the fact.

Credential creation from another surface should use the same forms and return a
created credential id to the selection flow. That keeps the mental model
"credentials live here, sandboxes choose them" even if the user starts from a
workspace or sandbox page.

### Add AWS Bedrock

Flow:

```text
1. Admin chooses "AWS Bedrock".
2. Proliferate generates External ID and CloudFormation link.
3. Admin launches stack or copies IAM JSON.
4. Admin pastes Role ARN and selects region.
5. Proliferate validates immediately.
6. On success, policy is provisioned in LiteLLM and becomes selectable.
```

### Sandbox Auth Selection

Sandbox profile page should allow admin selection:

```text
Claude Code  -> Proliferate managed credits
Codex        -> Org AWS Bedrock role
OpenCode     -> Alice's synced OpenCode auth
Gemini       -> Alice's synced Gemini auth
```

For shared sandboxes, personal synced credentials must render owner copy:

```text
Using Alice's synced Claude credentials.
If Alice revokes or needs to resync, shared sandbox launches will fail until an
admin selects another credential or Alice resyncs.
```

The selection should be available only after Alice has explicitly shared that
credential with the organization. Admin status alone is not consent to use a
user's personal native auth files.

Saving selection:

```text
updates sandbox_agent_auth_selection
bumps sandbox profile auth revision
queues refresh_agent_auth_config
mints replacement gateway grants when needed
```

Selection UI rules:

```text
filter credentials by agent_kind compatibility
filter credentials by sandbox scope and caller permissions
disable invalid / needs_resync / revoked credentials with a concrete reason
show synced-path owner before allowing shared sandbox selection
require active agent_auth_credential_share for personal synced credentials
show whether the credential is gateway-backed or synced into the sandbox
show all workspaces/sandboxes affected before replacing a credential already in use
```

Personal users may configure their personal sandbox credentials. Shared sandbox
selection is admin-only in V1.

## Backend Placement

### Server Domains

Add a Cloud subdomain:

```text
server/proliferate/server/cloud/agent_auth/
  api.py
  service.py
  models.py
  access.py
  errors.py
  domain/
    policy.py
    validation.py
    desired_state.py
    diff.py
```

`domain/**` must stay pure: ownership checks, compatibility decisions,
desired-state construction, and diffing. LiteLLM/AWS provisioning performs I/O
and belongs in `service.py`, a worker service, and `integrations/**`, not in
domain modules.

Credential ownership during migration:

```text
agent_auth becomes the owner for new credential/provider payloads
CloudCredential remains a legacy source/adapter only until cutover completes
do not add new writes that make both cloud_credentials.py and agent_auth own
the same provider payload
delete or freeze the legacy store path once the new materialization path is
fully switched on
```

Add integrations:

```text
server/proliferate/integrations/litellm/
  client.py
  models.py
  errors.py

server/proliferate/integrations/aws/
  client.py
  models.py
  errors.py
  sts.py
  bedrock.py
```

If AWS remains tiny at implementation time, a single `integrations/aws.py` is
also acceptable. Do not create a one-off Bedrock-only integration shape that
diverges from `docs/server/guides/integrations.md`.

Gateway can live as:

```text
server/proliferate/server/agent_gateway/
  api.py
  service.py
  models.py
  errors.py
  protocols/
    anthropic.py
    openai.py
```

If gateway is deployed as a separate ASGI app, share domain/integration code but
keep public routes mounted only in the gateway process.

Deployment ownership:

```text
gateway service needs explicit deploy/env ownership, health checks, rate-limit
config, and public routing
LiteLLM service is private/internal and needs storage, migrations, admin key
management, health checks, and private networking
local dev profiles need deterministic ports and process wiring for api,
gateway, and LiteLLM
server/deploy and server/infra changes must be included before managed rollout
```

### DB Models And Stores

ORM:

```text
server/proliferate/db/models/cloud/agent_auth.py
```

Stores:

```text
server/proliferate/db/store/cloud_agent_auth/
  budget_subjects.py
  credentials.py
  policies.py
  provider_credentials.py
  selections.py
  target_states.py
  runtime_grants.py
```

Stores return frozen dataclasses and never expose ORM objects.

### Constants

Add command kind:

```text
CloudCommandKind.refresh_agent_auth_config
```

Add it to active worker command kinds. In materialization-only mode, this
command still requires AnyHarness if it writes runtime agent auth state through
AnyHarness. If AnyHarness is unavailable, fail with `anyharness_unavailable`.

## API Sketch

Control-plane user/admin APIs:

```text
GET    /v1/cloud/agent-auth/credentials
POST   /v1/cloud/agent-auth/credentials/bedrock-assume-role
POST   /v1/cloud/agent-auth/credentials/anthropic-api-key
POST   /v1/cloud/agent-auth/credentials/openai-api-key
POST   /v1/cloud/agent-auth/credentials/openai-compatible
POST   /v1/cloud/agent-auth/credentials/{id}/validate
DELETE /v1/cloud/agent-auth/credentials/{id}
POST   /v1/cloud/agent-auth/credentials/{id}/shares
DELETE /v1/cloud/agent-auth/credentials/{id}/shares/{share_id}

GET    /v1/cloud/sandbox-profiles/{id}/agent-auth-selections
PUT    /v1/cloud/sandbox-profiles/{id}/agent-auth-selections
GET    /v1/cloud/sandbox-profiles/{id}/agent-auth-target-states

GET    /v1/cloud/agent-auth/policies/{id}/spend
```

Worker APIs:

```text
GET  /v1/cloud/worker/agent-auth-configs/{sandbox_profile_id}/materialization
POST /v1/cloud/worker/agent-auth-configs/{sandbox_profile_id}/status
```

Gateway APIs:

```text
/anthropic/v1/messages
/anthropic/v1/messages/count_tokens
/anthropic/v1/models
/openai/v1/responses
/openai/v1/chat/completions
/openai/v1/models
```

The exact protocol routes should match what the harness SDKs call.

### Cloud SDK And Frontend Access

Desktop/Web UI must consume these Cloud APIs through the Cloud SDK stack and
the documented frontend access layer.

Add generated or handwritten Cloud SDK helpers for:

```text
listAgentAuthCredentials
createBedrockAssumeRoleCredential
createAnthropicApiKeyCredential
createOpenAiApiKeyCredential
createOpenAiCompatibleCredential
validateAgentAuthCredential
deleteAgentAuthCredential
createAgentAuthCredentialShare
deleteAgentAuthCredentialShare
getSandboxAgentAuthSelections
putSandboxAgentAuthSelections
getAgentAuthPolicySpend
```

Frontend integration should follow `docs/frontend/guides/access.md`:

```text
cloud/sdk
  raw client helpers and request/response types

cloud/sdk-react
  reusable query/mutation hooks and the single query-key/cache owner for Cloud
  resources

apps/desktop/src/hooks/access/cloud/agent-auth/**
  desktop-specific adapters only when desktop adds Tauri/local detection,
  telemetry, or cache invalidation behavior not owned by cloud-sdk-react

apps/desktop/src/lib/domain/**
  compatibility filtering, disabled reasons, status copy, where-used summaries

components
  consume access hooks/view models, not raw endpoint paths
```

Do not create duplicate React Query caches for the same resource. Do not add
components that call raw endpoint paths or construct ad hoc clients.

## Lifecycle

### Add Bedrock BYOK

```text
admin submits role ARN + region
server stores encrypted payload with generated ExternalId
server validates STS/Bedrock
server creates gateway policy
server provisions LiteLLM team/key/model deployments
credential status -> ready
```

### Select Auth For Shared Sandbox

```text
admin saves per-agent selections
server validates selected credentials are usable for shared sandbox
server bumps profile auth revision
server upserts target/profile auth state rows as pending for each affected target
server mints new grants for gateway-backed selections
server queues refresh_agent_auth_config
worker fetches materialization plan
worker applies synced files or gateway env/config
worker calls AnyHarness agent auth config refresh
AnyHarness stores runtime auth revision
worker status marks only that target/profile applied
next session launch uses new auth
```

For selection changes to a different gateway credential or policy, previous
grants should not be revoked before the target reports the replacement revision
`applied`; otherwise an offline/failed refresh could strand the target. After
apply, revoke old grants for that target/profile/agent_kind unless a future
explicit live-grace flag exists. Routine grant rotation for the same
selection/policy can keep old grants valid until natural expiry.

### Update Credential Mechanism

```text
admin/user updates credential payload or synced files
server validates or marks credential needs_resync/invalid
server finds sandbox profiles selecting that credential
server bumps each affected profile auth revision
server marks each affected target/profile state pending for the new revision
server enqueues refresh_agent_auth_config per target/profile/revision
online workers apply immediately
offline/paused targets apply latest revision on reconnect/bootstrap
new launches use the updated agent auth config
live actors keep their launch env until restart unless force_restart is set
```

Use `force_restart` only for security-sensitive changes or explicit admin
actions. Routine provider revalidation, grant rotation, and synced-file refresh
should update target launch config without killing active turns.

### Routine Grant Rotation

```text
control plane detects earliest grant expires within refresh threshold
server bumps profile auth revision with reason = grant_rotation
server enqueues refresh_agent_auth_config
worker applies new launch config with new grants
old routine grants remain valid until natural expiry
```

### Request With Managed Credits

```text
harness sends model request with runtime grant
gateway validates grant
gateway forwards with policy LiteLLM key
LiteLLM checks team budget
if budget remains, LiteLLM calls provider and increments spend
if exhausted, LiteLLM rejects; gateway returns credits_exhausted
```

### Credential Revocation

```text
credential revoked
related policies become revoked/invalid
runtime grants revoked
affected sandbox selections -> invalid
affected target/profile states -> pending or failed with a fail-closed error
  code for the new revision
refresh_agent_auth_config queued
new launches fail closed until admin selects another credential
```

For shared sandboxes using a user's personal synced credential:

```text
source user revokes or needs resync
selection becomes needs_resync / invalid
shared sandbox launches fail closed
admin sees source owner and required action
```

For shared sandboxes using a credential share:

```text
source user revokes the share
related selections become invalid
profile auth revision bumps with force_restart = true
refresh_agent_auth_config queued
gateway requests and new launches fail closed
worker cleanup materialization removes allowlisted synced auth files for the
  revoked share/credential
audit event records share revocation and affected selections
```

## Verification

### Managed-Credits LiteLLM Preflight

Before wiring managed-credit UI broadly, prove:

```text
team spend increments
team max_budget rejects when exhausted
team budget_duration resets as expected for 30d
Proliferate-owned provider credential routes through LiteLLM
managed Claude Code gateway streaming path preserves protocol shape
```

The team-scoped duplicate public-model proof is a V2 BYOK gate. If OSS LiteLLM
cannot route duplicate public model names by team/policy, hosted cloud must keep
BYOK gateway setup disabled and use only Proliferate-owned provider credentials
for managed credits.

### Gateway Tests

```text
invalid token rejected
expired token rejected
revoked token rejected
wrong agent_kind rejected
wrong protocol facade rejected
model not allowed for policy rejected before forwarding
oversized request body rejected before forwarding
drifted LiteLLM mirror fails closed for managed credits
grant issued for old revoked selection/revision rejected
BYOK grant fails closed if global/provider BYOK capability is disabled later
token hash stored as keyed hash, raw token never persisted
valid token forwards to LiteLLM with internal key
LiteLLM budget error maps to credits_exhausted
provider auth error maps to provider_auth_failed
streaming responses preserve protocol shape
request/response body logging disabled by default
logs/status payloads do not contain grants, provider keys, auth headers, or
  synced file contents
```

### Worker/AnyHarness Tests

```text
refresh_agent_auth_config leases and fetches plan
gateway_env materialization applies target auth revision for only the target
  receiving the command
target/profile applied state remains stale for other targets until they apply
synced_files materialization writes only allowed paths
synced_files revocation cleanup removes allowlisted old native auth files
AnyHarness applies protected provider-routing overlay after workspace/session/
  adapter env
worker capability gate prevents old workers from leasing preflight-required
  launch commands
superseded materialization does not mark stale revision applied
AnyHarness persists launchAuthScope on sessions and cold-start prompts use it
AnyHarness status endpoint is redacted and never returns grants/env/config
untrusted env/config override of protected keys is rejected
Claude gateway env clears Bedrock/local provider routing
gateway-backed launch fails if model application is not authoritative
live session keeps existing env until restart
new session uses refreshed env
```

### UI Tests

```text
admin can select org/system credentials for shared sandbox
admin can select personal synced credentials only after owner share exists
non-admin cannot edit shared sandbox auth selections
shared selection shows source owner
owner can revoke credential share and affected shared selections fail closed
credits exhausted state renders distinctly from provider auth failure
hosted-cloud V1 hides Bedrock/OpenAI/Anthropic/OpenAI-compatible BYOK setup
hidden stale BYOK selections render as unavailable instead of disappearing
```

## Implementation Phases

Feature flags/capabilities:

```text
agent_gateway_enabled
agent_gateway_byok_enabled
agent_gateway_anthropic_byok_enabled
agent_gateway_bedrock_byok_enabled
agent_gateway_openai_byok_enabled
agent_gateway_openai_compatible_byok_enabled
agent_gateway_opencode_enabled
agent_gateway_reconciler_enabled
```

Implementation can parallelize within phases, but the correctness gates are
strict: Phase 0B compatibility proof must pass before exposing managed-credit
gateway credentials in UI, launch preflight must land before credential
switching on managed targets, and target/profile applied state must exist
before any worker materialization command reports success. `CloudCredential`
read cutover must not happen until Phase 3 runtime plumbing is live behind a
feature flag. BYOK gateway feature flags stay off in hosted-cloud V1.

### Phase 0A: Contract Alignment

- Index this spec in `docs/README.md`.
- Update adjacent specs to consume `agent_auth_credential`,
  `sandbox_agent_auth_selection`, and `refresh_agent_auth_config` instead of
  defining parallel credential-source models.

End state: the repo has one canonical agent-auth contract and adjacent specs
can depend on it without inventing parallel models.

### Phase 0B: Compatibility Proof

- Validate LiteLLM team-scoped model deployments with duplicate public model
  names and different provider credentials.
- Use `scripts/agent-gateway-phase0-probe.py` and record results in
  `docs/notes/agent-gateway-phase0-compatibility.md`.
- Record the LiteLLM team-scoped model result, but treat failure as a BYOK V2
  blocker, not a managed-credits V1 blocker.
- Validate managed Claude Code -> gateway -> LiteLLM streaming path.
- Validate Codex Responses path or mark Codex managed credits as unavailable
  until the facade is implemented.
- Decide OpenCode gateway availability based on launch/config isolation.

End state: every unproven gateway path is explicitly feature-gated or
unavailable.

### Phase 1: Server Data And LiteLLM Integration

- Add or consume the owning sandbox-profile domain before agent-auth selection
  tables reference it.
- Add DB models/stores for credentials, budget subjects, policies, provider
  credentials, selections, target/profile applied state, and runtime grants.
- Add credential share/delegation rows and required audit events for credential
  create/validate/revoke/share/select actions.
- Implement idempotent `CloudCredential` import/backfill into
  `agent_auth_credential`, but leave launch/materialization reads on the legacy
  path until Phase 3 cutover gates pass.
- Add LiteLLM integration client.
- Add managed-credit LiteLLM provisioning. BYOK provider credential validation
  and provisioning can land only as dormant V2 surface, with hosted-cloud UI
  and selection gates disabled.
- Implement policy provisioning and reconciliation, including fail-closed
  synced/drifted readiness flags for managed-credit budgets.
- Add admin/user API endpoints.

End state: Proliferate can create, list, validate, revoke, share, and audit
agent credentials and gateway policies, with deterministic DB invariants.

### Phase 2: Gateway Service

- Add separate gateway route group/process.
- Implement runtime grant auth.
- Implement Anthropic-compatible facade for Claude Code.
- Implement OpenAI-compatible/Responses facade needed by Codex.
- Add canonical error mapping.
- Add deploy/dev-profile wiring for gateway and private LiteLLM service:
  ports, env vars, health checks, private networking, LiteLLM storage, and
  server/deploy or server/infra changes.

End state: a runtime grant can call the gateway, stream through LiteLLM, map
errors, and fail closed on revocation or budget exhaustion.

### Phase 3: Worker And AnyHarness Materialization

- Add `refresh_agent_auth_config` CloudCommand constants, validation, and worker
  supported-kind wiring plus worker capability/min-version gating for
  preflight-required launch commands.
- Add worker materialization fetch/status APIs.
- Add worker dispatcher/materializer.
- Add AnyHarness runtime agent auth config contract, generated SDK updates, API,
  session launchAuthScope persistence, authoritative model application, and
  launch env merge.
- Add gateway env configs for Claude and exact Codex provider config.
- Enforce protected provider-routing env/config overlays.
- Switch `CloudCredential` launch/materialization reads to the new agent-auth
  path only after the above pieces pass, then disable the legacy injection path
  with the cutover kill switch.

End state: sandbox profile selections bump auth revisions, worker applies auth
config, AnyHarness stores agent auth config, and launch preflight prevents stale
launches.

### Phase 4: UI

- Add Cloud SDK helpers and SDK React/query-key support.
- Add auth library surfaces.
- Add managed-credits status and synced-native credential flows. Do not expose
  Bedrock/OpenAI/Anthropic/OpenAI-compatible BYOK setup in hosted-cloud V1.
- Add sandbox per-agent auth selection.
- Add owner opt-in UI for sharing personal synced credentials with an org.
- Add spend/credits status for Proliferate managed credits.

End state: users/admins configure credentials from harness-specific setup
screens and select credentials per sandbox profile without exposing
incompatible provider forms or unshared personal credentials.

### Phase 5: Hardening

- Add reconciliation worker for LiteLLM drift.
- Add privacy-safe gateway metrics and logs.

End state: drift repair, audit, metrics, redaction, and operational checks are
in place for controlled rollout.

### Phase 6: Manual Provider E2E

Use real provider credentials and a real managed target to prove the system:

```text
Proliferate managed credits exhaust a tiny test budget and fail closed.
Synced Claude/Codex/OpenCode credentials materialize and launch correctly.
Shared sandbox can select a named user's synced credential and shows the owner.
Shared sandbox cannot select personal synced credential without owner share.
Owner share revocation invalidates shared selection and fails closed.
Credential revocation immediately fails gateway requests for affected policies.
Credential update queues refresh_agent_auth_config and updates target launch config.
Routine grant rotation refreshes target config without breaking a live turn.
Offline target applies only the latest auth revision after reconnect/bootstrap.
```

V2 BYOK manual E2E adds:

```text
AWS Bedrock AssumeRole with ExternalId validates and serves Claude-compatible traffic.
Anthropic API key through gateway serves Claude-compatible traffic.
OpenAI API key through gateway serves OpenAI/Responses-compatible traffic.
```

## Ambiguities And Gates

Resolved defaults:

```text
Budget period
  Use LiteLLM-native 30d in V1. Do not implement subscription-aligned ledger
  resets yet.

Grant lifetime
  Use 7-day scoped runtime grants, daily refresh, and immediate server-side
  revocation checks. Do not use sub-hour env tokens in V1.

Live actor updates
  Existing live actors keep their launch env until restart. New launches and
  cold restarts must pass launch preflight. If a credential/policy selection is
  replaced, old grants may be revoked after the replacement applies, so live
  actors using the old grant can fail rather than silently continuing to spend
  the old credential.

Fallback
  Fail closed. Do not silently fall back from BYOK to Proliferate managed
  credits or from one credential to another.

Usage storage
  LiteLLM owns spend counters. Proliferate queries LiteLLM on demand in V1 and
  does not maintain a request ledger or spend snapshot table.

Gemini
  Synced-path only in V1.

OpenCode
  Gateway path disabled unless managed config isolation is proven.
```

Implementation gates:

```text
LiteLLM team-scoped public model routing
  Must be validated in the deployed LiteLLM edition before hosted cloud exposes
  shared BYOK through the gateway.
  If it fails, hosted-cloud V1 still ships managed credits and synced native
  auth only. BYOK through gateway waits for LiteLLM Enterprise, isolated
  LiteLLM routers/instances, or a deliberate Proliferate alias-rewrite design.

Claude Code protocol behavior
  Anthropic-compatible streaming through LiteLLM must be smoke-tested with the
  current Claude Code SDK behavior.

Codex protocol behavior
  Responses compatibility must be smoke-tested before enabling managed credits
  for Codex. If not proven, Codex remains synced-path or OpenAI-key-only via a
  validated OpenAI-compatible path.

Launch config enforcement
  AnyHarness must be able to force gateway env/config for the harness. If a
  project config can override managed gateway config, that harness cannot use
  gateway-backed auth in V1.

Refresh ordering
  Launch preflight must be implemented before UI exposes credential switching
  for managed targets. Background refresh alone is not a correctness guard.

LiteLLM mirror readiness
  Managed-credit credentials cannot be selectable or launchable unless
  budget/policy/model/key reconciliation marks the LiteLLM mirror synced.

Provider coverage
  Proliferate managed credits can use Bedrock only for harness/protocol paths
  that actually work through the gateway. Otherwise use the provider account
  matching the protocol or mark that harness unavailable.
```

Deferred, not V1 blockers:

```text
gateway BYOK/provider-credential setup in hosted cloud
self-hosted gateway/LiteLLM management
BYOK admin dollar caps
overage billing
per-workspace auth overrides
hot token sidecar/file refresh for live actors
request/response body logging
Gemini gateway-backed auth
OpenCode gateway-backed auth if config isolation is not ready
```
