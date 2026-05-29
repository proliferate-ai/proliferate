# Agent Auth Config And Gateway

Status: post-stack implementation reference snapshot for the gateway stack
after PRs #254-#259.

This note assumes these adjacent reference specs are implemented or being merged:

- `reference/sandbox-systems/00-cloud-target-managed-sandbox-foundation.md`
- `reference/sandbox-systems/01-mcp-plugins-skills.md`

It also compares against the terminal gateway PR in the current stack:

- #254 `feat(server): add agent LLM auth gateway foundation`
- #255 `feat(server): add agent auth refresh materialization contract`
- #256 `feat(desktop): add agent auth gateway configuration UI`
- #257 `fix(server): harden agent gateway reconciliation`
- #258 `feat(anyharness): apply agent auth config in worker runtime`
- #259 `build(server): wire agent gateway deployment`

At the time of writing, #254-#258 are merged into `origin/main`; #259 is the
open terminal PR. #259 mostly adds deployment, LiteLLM service wiring,
environment docs, and small hardening changes. The core DB/API/worker/runtime
model already exists in the final stack state.

## Authority And Use

This file lives under `reference/**`, so it is a product/runtime fact sheet and
planning aid, not an authoritative area standard. Area docs still win for code
ownership and style:

```text
server code       -> docs/server/**
AnyHarness code   -> docs/anyharness/**
frontend code     -> docs/frontend/**
deployment        -> docs/ci-cd/** and docs/reference/**
```

Use this note for the post-stack facts that the older architecture spec may not
yet reflect. Do not copy implementation deviations from this note as blessed
patterns. Where this document says "current gap" or "debt," future PRs should
move the code back toward the area docs.

## Mental Model

Agent auth answers one question:

```text
For this sandbox profile, which LLM auth source should each agent harness use?

claude   -> selected credential
codex    -> selected credential
opencode -> selected credential
gemini   -> selected credential
```

This is separate from MCP auth:

```text
MCP auth
  authorizes tools and product integrations.

Agent LLM auth
  authorizes model calls made by Claude Code, Codex, OpenCode, or Gemini.
```

The two runtime materialization modes are:

```text
synced_files
  Worker writes allowlisted native auth files/env into the sandbox.
  This is the bridge for local/synced Claude, Codex, Gemini, and eventually
  OpenCode auth.

gateway_env
  Worker gives AnyHarness protected provider-routing env/config and a
  Proliferate runtime grant.
  The sandbox calls Proliferate Gateway.
  Proliferate Gateway validates the grant.
  Gateway forwards to private LiteLLM with an internal LiteLLM virtual key.
  Provider API keys are never injected into the sandbox.
```

Raw API keys and Bedrock config should normally become gateway-backed provider
credentials. They are not a normal direct sandbox injection mode.

## What The Final Gateway Stack Implements

The final stack is no longer only a target architecture. It has real code for:

```text
Server
  sandbox_profile
  sandbox_profile_agent_auth_revision
  agent_auth_credential
  agent_auth_credential_share
  agent_gateway_budget_subject
  agent_gateway_policy
  agent_gateway_provider_credential
  sandbox_agent_auth_selection
  sandbox_profile_agent_auth_target_state
  agent_gateway_runtime_grant
  agent_auth_audit_event

Cloud APIs
  credential library
  personal/organization sandbox profile ensure
  per-profile per-agent selection
  per-target auth apply status
  managed credits ensure
  worker materialization/status endpoints

Worker
  refresh_agent_auth_config command
  fetch materialization plan
  issue/apply synced files
  build secret-bearing AnyHarness auth config
  report applied/superseded/failed target state

AnyHarness
  PUT /v1/agents/auth-config
  GET /v1/agents/auth-config/status
  encrypted local agent_auth_config table
  session agent auth scope/revision fields
  launch-time fail-closed overlay
  protected env precedence
  Codex managed config file generation

Gateway
  /anthropic/v1/models
  /anthropic/v1/messages
  /anthropic/v1/messages/count_tokens
  /openai/v1/models
  /openai/v1/responses
  /openai/v1/chat/completions
  grant authorization
  protocol facade normalization
  private LiteLLM forwarding
```

#259 adds the deploy/runtime envelope around this:

```text
server/docker-compose.yml
server/deploy/docker-compose.production.yml
server/deploy/ensure-secrets.sh
server/infra/self-hosted-aws/template.yaml
docs/reference/env-vars.yaml
docs/reference/self-hosted-deploy.md
docs/reference/self-hosted-aws.md
Makefile AGENT_GATEWAY=1 profile wiring
```

## Deployment Modes

Merging the stack does not automatically make the gateway active everywhere.

```text
local dev
  make dev PROFILE=<name> AGENT_GATEWAY=1
  starts the private LiteLLM compose service/profile for gateway work

self-hosted Docker Compose
  disabled by default in .env.production.example
  operator must set gateway enabled flags, public gateway URL, LiteLLM master
  key, and a non-zero managed-credit budget if managed credits are offered

self-hosted AWS template
  #259 mirrors the service/env wiring into the template
  operators still provide env overrides and run the update/bootstrap flow

hosted production
  not fully represented by repo-local deployment docs/IaC yet
  treat #259 as infrastructure wiring, not the final hosted rollout plan
```

Important defaults in the stack:

```text
AGENT_GATEWAY_ENABLED = false
AGENT_GATEWAY_DEFAULT_MANAGED_BUDGET_USD = 0
AGENT_GATEWAY_RECONCILER_ENABLED = false
AGENT_GATEWAY_BYOK_ENABLED = false
AGENT_GATEWAY_OPENCODE_ENABLED = false
```

## Ownership And Known Deviations

The final stack is useful and mostly aligned, but it has some intentional or
transitional deviations from repo best practice. Future specs should not repeat
these as target shape.

Server-side deviations:

```text
Pydantic/service boundary
  cloud agent-auth service currently accepts/imports some Pydantic transport
  models. Target shape is API Pydantic -> service dataclasses/internal types.

Runtime grant write boundary
  agent_gateway service reads agent-auth state and updates runtime grant
  last_used_at through the cloud agent-auth store. That is acceptable as a
  narrow bridge for the current stack, but the owning write boundary should be
  made explicit if this grows.

DB defaults
  agent-auth ORM/migrations currently use app-side UUID/timestamp defaults in
  places. Target server DB convention is DB-side UUID/timestamp defaults.

File size/decomposition
  cloud/agent_auth/service.py, db/store/cloud_agent_auth/store.py, and
  db/models/cloud/agent_auth.py are large implementation clusters. Expected
  splits: profiles, credentials/shares, selections/materialization, gateway
  provisioning, runtime grants, and reconciliation.

OpenAI-compatible validation
  URL/private-network checks are security-critical, but the current service
  performs DNS resolution inline. If provider probing expands, move network I/O
  behind an integration helper.
```

AnyHarness-side deviations:

```text
Contract/domain boundary
  domains/agents/auth_config.rs currently uses contract request/response
  structs directly. If the endpoint becomes long-lived, add internal domain
  models plus API mappers.

Secret-bearing auth overlay
  AnyHarness agent auth config is an encrypted LLM auth launch overlay. It is
  not the target runtime MCP/skills manifest, which should avoid persisting
  bearer tokens and secret env values.
```

Frontend/SDK deviations:

```text
Desktop access wrappers
  apps/desktop/src/hooks/access/cloud/agent-auth/** currently mostly initialize the
  Cloud client and re-export cloud-sdk-react hooks. Treat them as compatibility
  shims unless they gain Desktop-specific behavior.

Cloud SDK standards
  cloud/sdk and cloud/sdk-react follow the resource-helper/query-hook pattern,
  but there is not yet a dedicated authoritative Cloud SDK area doc.
```

## Cloud Source Of Truth

### `sandbox_profile`

Configured sandbox capability profile.

```text
owner_scope            personal | organization
owner_user_id          set only for personal
organization_id        set only for organization
managed_target_id      current managed target for this profile
agent_auth_revision    monotonic revision for auth config
status                 active | archived
```

Invariants:

- one active personal profile per user
- one active organization profile per organization
- organization profiles require admin writes
- personal profiles belong only to the owner user

This profile is the same conceptual anchor used by shared sandbox config. Agent
auth does not create a separate "auth profile" abstraction.

### `sandbox_profile_agent_auth_revision`

Append-only revision history for profile auth changes.

```text
sandbox_profile_id
revision
reason
force_restart
created_by_user_id
created_at
```

`force_restart` lives here. Selection writes, credential revokes, share revokes,
and synced credential writes bump this revision. Runtime apply commands carry
the revision and `forceRestart`.

### `agent_auth_credential`

Reusable product-visible auth source.

```text
owner_scope                 system | personal | organization
owner_user_id               personal owner
organization_id             org owner
created_by_user_id
agent_kind                  claude | codex | opencode | gemini
credential_kind             synced_path | managed_gateway
display_name
redacted_summary_json
status                      pending | ready | needs_resync | invalid | revoked
revision
payload_ciphertext          encrypted synced native auth source payload
payload_ciphertext_key_id
revoked_at
```

Examples:

```text
Proliferate managed credits
ACME Bedrock role through gateway
Alice synced Claude auth files
Alice synced Codex auth files
Alice OpenAI API key through gateway
```

Hosted-cloud V1 UI only shows:

```text
synced_path credentials
Proliferate managed credits
```

BYOK gateway credentials are represented in the model, but Desktop hides BYOK
setup with `AGENT_GATEWAY_BYOK_ENABLED = false`, and server feature flags
enforce availability.

### `agent_auth_credential_share`

Explicit owner consent for using personal synced auth in an organization/shared
sandbox.

```text
credential_id
owner_user_id
organization_id
share_scope        organization
shared_by_user_id
status             active | revoked
allowed_agent_kind
revoked_by_user_id
```

Rules:

- only the personal credential owner can create or revoke the share
- only `synced_path` credentials can be shared in V1
- an organization sandbox cannot select another user's personal synced auth
  without an active share
- revoking a share marks affected selections invalid and bumps profile revision
  with `force_restart = true`

### `agent_gateway_budget_subject`

Org-scoped included credits bucket for Proliferate managed credits.

```text
budget_kind          proliferate_managed
owner_scope          organization
organization_id
litellm_team_id
included_budget_usd
budget_duration      30d
litellm_sync_status  pending | synced | drifted | failed
status               ready | exhausted | invalid | revoked
revision
```

There is one active managed budget subject per organization. This prevents
"one budget per harness" drift.

The included budget is not chosen by the customer. Current code reads it from
server settings as an entitlement stand-in:

```text
settings.agent_gateway_default_managed_budget_usd
```

Future billing/subscription state should become the source of that value.

### `agent_gateway_policy`

LiteLLM-backed routing/auth policy for one gateway credential.

```text
credential_id
policy_kind                         proliferate_managed | org_byok | personal_byok
owner_scope
owner_user_id
organization_id
budget_subject_id                   set only for proliferate_managed
litellm_team_id
litellm_virtual_key_id
litellm_virtual_key_ciphertext
litellm_sync_status
status                              provisioning | ready | invalid | revoked
revision
```

Important boundary:

- the sandbox never sees this LiteLLM virtual key
- Proliferate Gateway decrypts it only after validating the sandbox runtime
  grant
- LiteLLM owns provider routing, model call execution, spend tracking, and
  budget enforcement

### `agent_gateway_provider_credential`

Encrypted provider-side credential for BYOK gateway policies.

```text
policy_id
provider_kind        proliferate_bedrock_pool | anthropic_api_key |
                     openai_api_key | bedrock_assume_role |
                     openai_compatible
payload_ciphertext
payload_ciphertext_key_id
redacted_summary_json
validation_status    unvalidated | valid | invalid
revision
```

Hosted-cloud V1 keeps BYOK gated. Shape validation exists:

```text
anthropic_api_key
  apiKey

openai_api_key
  apiKey

bedrock_assume_role
  roleArn
  externalId
  region

openai_compatible
  baseUrl
  apiKey
```

OpenAI-compatible URLs are required to be HTTPS and must not resolve to
localhost or private/link-local/multicast addresses.

### `sandbox_agent_auth_selection`

For one sandbox profile and one agent kind, selects one credential.

```text
sandbox_profile_id
owner_scope
agent_kind
credential_id
credential_share_id
materialization_mode   gateway_env | synced_files
selected_revision
status                 active | needs_resync | invalid
last_error_code
last_error_message
```

Unique key:

```text
sandbox_profile_id + agent_kind
```

Selection determines runtime materialization:

```text
credential_kind = synced_path
  -> materialization_mode = synced_files

credential_kind = managed_gateway, agent_kind = claude
  -> materialization_mode = gateway_env, protocol_facade = anthropic

credential_kind = managed_gateway, agent_kind = codex | opencode
  -> materialization_mode = gateway_env, protocol_facade = openai
  -> opencode requires AGENT_GATEWAY_OPENCODE_ENABLED=true

credential_kind = managed_gateway, agent_kind = gemini
  -> rejected in V1
```

### `sandbox_profile_agent_auth_target_state`

Per target/profile apply status.

```text
sandbox_profile_id
target_id
desired_revision
applied_revision
status                  pending | materializing | applied | failed | superseded
force_restart_required
last_command_id
last_worker_id
last_attempted_at
last_applied_at
last_error_code
last_error_message
```

This is target-scoped because one profile may conceptually be reattached or
applied to different managed targets over time. A profile selection row is not
enough to prove a specific target has the latest auth config.

### `agent_gateway_runtime_grant`

Revocable sandbox token used to call Proliferate Gateway.

```text
token_hash
hash_key_id
policy_id
credential_id
selection_id
issued_profile_revision
target_id
sandbox_profile_id
organization_id
user_id
agent_kind
protocol_facade          anthropic | openai
expires_at
revoked_at
last_used_at
```

The raw token is never stored. The server stores an HMAC hash using
`settings.cloud_secret_key`. Worker receives the raw token only in the
materialization response and passes it to AnyHarness.

Current TTL:

```text
7 days
```

The current grant issue path revokes old overlapping grants for the same
policy/target/profile/agent route and keeps the newest prior grant as short
compatibility grace for already-configured runtimes.

### `agent_auth_audit_event`

Append-only audit trail for credential and selection operations.

```text
action
actor_user_id
owner_scope
owner_user_id
organization_id
credential_id
sandbox_profile_id
target_id
metadata_json
created_at
```

This is especially important for personal synced credential shares into shared
organization sandboxes.

## Synced Native Auth

Agent auth owns synced native auth source payloads directly:

```text
Desktop syncs native auth
  -> /v1/cloud/agent-auth/credentials/synced/{agent_kind}
  -> agent_auth_credential(credential_kind=synced_path) stores encrypted payload
  -> personal sandbox_profile is ensured
  -> sandbox_agent_auth_selection is defaulted for that personal profile
  -> profile agent_auth_revision is bumped
  -> refresh_agent_auth_config is queued if the profile has a target
```

Current legacy sync support:

```text
claude
codex
gemini
```

`opencode` exists as an agent-auth kind, and worker has an allowlisted
OpenCode auth file path, but Desktop does not yet export OpenCode native sync.

## Cloud APIs

User/admin APIs under `/v1/cloud`:

```text
GET    /agent-auth/credentials
POST   /agent-auth/credentials/gateway
PUT    /agent-auth/credentials/synced/{agent_kind}
DELETE /agent-auth/credentials/{credential_id}

POST   /agent-auth/credentials/{credential_id}/shares
DELETE /agent-auth/credential-shares/{share_id}

POST   /sandbox-profiles/personal
POST   /organizations/{organization_id}/sandbox-profile

GET    /sandbox-profiles/{sandbox_profile_id}/agent-auth-selections
PUT    /sandbox-profiles/{sandbox_profile_id}/agent-auth-selections/{agent_kind}

GET    /sandbox-profiles/{sandbox_profile_id}/agent-auth-target-states

POST   /organizations/{organization_id}/agent-auth/managed-credits
```

Worker APIs under `/v1/cloud/worker`:

```text
GET  /agent-auth-configs/{sandbox_profile_id}/materialization
POST /agent-auth-configs/{sandbox_profile_id}/status
```

SDK surface:

```text
cloud/sdk/src/client/agent-auth.ts
cloud/sdk-react/src/hooks/agent-auth.ts
apps/desktop/src/hooks/access/cloud/agent-auth/use-agent-auth.ts   // transitional shim
```

Desktop product surfaces in the final stack:

```text
CloudAgentAuthLibrary
  credential library, sharing, revoke, BYOK form hidden in hosted V1

ComputeTargetAgentAuthCard
  ensure target sandbox profile
  select credential per harness
  show per-target apply status
```

## Worker Refresh Path

Selection or credential changes queue a command:

```text
kind = refresh_agent_auth_config
payload = {
  sandboxProfileId,
  revision,
  reason,
  forceRestart
}
```

The worker flow:

```text
worker leases refresh_agent_auth_config
worker reports agent-auth status = materializing
worker GETs materialization plan
worker validates target/profile/revision
worker writes synced native files if needed
worker builds AnyHarness ApplyAgentAuthConfigRequest
worker PUTs /v1/agents/auth-config
worker reports agent-auth status = applied | superseded | failed
worker reports command result = accepted | rejected | failed_delivery
```

Important command behavior:

- workers that cannot reach AnyHarness do not advertise
  `refresh_agent_auth_config`
- command leasing withholds `start_session` and `send_prompt` commands carrying
  agent-auth preflight fields from workers that do not support
  `refresh_agent_auth_config`
- command result payload for auth refresh is sanitized so secrets never appear
  in command status

## Worker Materialization Plan

Server returns:

```text
WorkerAgentAuthMaterializationPlan {
  applied
  reason
  currentRevision
  targetId
  sandboxProfileId
  revision
  selections[]
}
```

Each selection contains:

```text
agentKind
materializationMode
credentialId
credentialRevision
credentialShareId
gateway?       // for gateway_env
syncedFiles?   // for synced_files
```

For `synced_files`:

```text
envVars
files[] {
  relativePath
  content
}
cleanup[]  // parsed in the current stack, not yet acted on
```

Worker writes files only to allowlisted native paths:

```text
claude
  .claude/.credentials.json
  .claude.json

codex
  .codex/auth.json

gemini
  .gemini/oauth_creds.json
  .gemini/settings.json

opencode
  .config/opencode/auth.json
```

Current worker writes these files under the sandbox process `HOME`. It falls
back to the materialization root only if `HOME` cannot be resolved. The managed
sandbox contract therefore needs `HOME` to be the intended sandbox/user home.

For `gateway_env`, server issues a runtime grant and returns protocol-specific
protected config.

Claude:

```text
protocolFacade = anthropic
baseUrl         = {gateway}/anthropic

protectedEnv:
  CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST = 1
  ANTHROPIC_BASE_URL = {gateway}/anthropic
  ANTHROPIC_CUSTOM_HEADERS = Authorization: Bearer {runtime_grant}
  ANTHROPIC_AUTH_TOKEN = ""
```

Codex:

```text
protocolFacade = openai
baseUrl         = {gateway}/openai/v1

protectedEnv:
  CODEX_API_KEY = {runtime_grant}

protectedConfig.codex:
  model_provider = "proliferate"
  model_providers.proliferate.base_url = {gateway}/openai/v1
  model_providers.proliferate.env_key = "CODEX_API_KEY"
  model_providers.proliferate.wire_api = "responses"
  model_providers.proliferate.requires_openai_auth = false
```

OpenCode:

```text
protocolFacade = openai
baseUrl         = {gateway}/openai/v1

protectedEnv:
  OPENAI_API_KEY = {runtime_grant}
  OPENAI_BASE_URL = {gateway}/openai/v1
```

OpenCode gateway auth is feature-gated off by default. It should be treated as
available only when `AGENT_GATEWAY_OPENCODE_ENABLED=true`, not as part of
hosted/default V1.

Gemini:

```text
gateway_env rejected in V1
synced_files only
```

## AnyHarness Agent Auth Overlay

AnyHarness contract:

```text
PUT /v1/agents/auth-config
  body = ApplyAgentAuthConfigRequest
  secret-bearing write endpoint

GET /v1/agents/auth-config/status
  redacted status endpoint
  returns keys and metadata, never raw env values or tokens
```

Local SQLite:

```text
agent_auth_config
  scope_key
  scope_provider
  scope_id
  target_id
  revision
  config_ciphertext
```

AnyHarness encrypts the full applied auth config using the existing
`SessionDataCipher` / `ANYHARNESS_DATA_KEY` pattern. Missing data key means the
auth config cannot be applied or read.

Scope shape:

```text
externalAuthScope = {
  provider: "proliferate-cloud",
  id: sandboxProfileId,
  targetId
}
```

This scope is stored in AnyHarness as opaque external metadata. AnyHarness
does not interpret sandbox profile semantics beyond matching provider/id and
target id.

Launch-capable session requests now carry:

```text
agentAuthScope
requiredAgentAuthRevision
```

AnyHarness launch behavior:

```text
if agentAuthScope or requiredAgentAuthRevision is present:
  find matching local auth config
  require local revision >= requiredAgentAuthRevision
  find selection for agent kind
  reject expired selection
  apply support env normally
  apply protected env last
  launch harness

if no scope/revision is present:
  local/default auth config is optional
```

Target behavior for required scoped launches is fail-closed when the requested
agent kind has no active selection. Current stack gap: AnyHarness returns an
empty overlay for "config exists, but no selection for this agent kind." That
is not strong enough for required scoped launches and should be tightened before
relying on auth preflight as a complete guarantee.

Protected env keys are applied after workspace env, session launch env, and
adapter override env. This is how gateway routing wins over untrusted project
or spawn config.

Current reserved/protected set:

```text
ANTHROPIC_AUTH_TOKEN
ANTHROPIC_API_KEY
ANTHROPIC_BASE_URL
ANTHROPIC_CUSTOM_HEADERS
CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST
CLAUDE_CODE_USE_BEDROCK
CODEX_API_KEY
CODEX_HOME
CURSOR_API_KEY
GEMINI_API_KEY
GOOGLE_API_KEY
OPENAI_API_KEY
OPENAI_BASE_URL
```

Current stack nuance: this set blocks `supportEnv` from setting protected keys,
but `protectedEnv` itself accepts any valid env var name. A stricter follow-up
should make `protectedEnv` an allowlisted surface per agent/materialization
mode.

Codex special case:

```text
AnyHarness writes runtime_home/agent-auth/codex/config.toml
It sets CODEX_HOME to runtime_home/agent-auth/codex
```

This matches Codex's provider config shape:

```toml
model_provider = "proliferate"

[model_providers.proliferate]
name = "Proliferate Gateway"
base_url = "https://.../openai/v1"
env_key = "CODEX_API_KEY"
wire_api = "responses"
requires_openai_auth = false
```

## Launch Preflight

Cloud command validation supports an optional agent-auth preflight on
`start_session` and `send_prompt`.

Payload fields:

```text
sandboxProfileId
requiredAgentAuthRevision
```

Worker must map the Cloud preflight fields into the AnyHarness launch contract:

```text
Cloud command payload:
  sandboxProfileId
  requiredAgentAuthRevision

AnyHarness start_session body:
  agentAuthScope = {
    provider: "proliferate-cloud",
    id: sandboxProfileId,
    targetId: command.targetId
  }
  requiredAgentAuthRevision
```

Current stack gap: the PR head copies the `start_session` payload through to
AnyHarness, but does not synthesize `agentAuthScope` from `sandboxProfileId`.
If Cloud sends only `sandboxProfileId`, AnyHarness will not find the scoped
auth config. `send_prompt` preflight is Cloud admission only unless the session
already persisted an auth scope at creation.

Server-side command creation rejects when:

```text
profile missing
profile not attached to this target
profile owner/org does not match command actor/target
required revision is stale
target state is missing
target state is not applied
applied revision < required revision
```

This is the control-plane fail-closed gate before a command ever reaches a
worker. AnyHarness also fails closed at launch if local config is missing,
stale, or expired. As noted above, the no-selection case still needs a runtime
fix to be fully fail-closed per agent kind.

## Gateway Request Path

Sandbox/harness calls:

```text
Claude Code -> {gateway}/anthropic/v1/messages
Codex       -> {gateway}/openai/v1/responses
OpenCode    -> {gateway}/openai/v1/chat/completions or /responses
```

Gateway behavior:

```text
extract Bearer runtime grant
hash token and load agent_gateway_runtime_grant
verify not revoked and not expired
verify protocol facade matches URL
verify profile exists and revision matches issued_profile_revision
verify selection still active and credential revision still selected
verify credential ready and not revoked
verify policy ready and LiteLLM mirror synced
verify managed budget not exhausted
verify requested model is allowed for agent kind
decrypt internal LiteLLM virtual key
forward to private LiteLLM
```

Allowed model IDs currently live in gateway protocol rules:

```text
claude   -> us.anthropic.claude-sonnet-4-6
codex    -> gpt-5.5
opencode -> opencode/big-pickle
gemini   -> no gateway models in V1
```

Proliferate does not rewrite the request model at runtime. It provisions
LiteLLM so the public model names the harness sends are valid for that policy.

Gateway error mapping:

```text
budget exhausted       -> 402 credits_exhausted
provider 401/403       -> 502 provider_auth_failed
provider 404           -> 404 model_not_available
provider 429           -> 429 provider_rate_limited
LiteLLM unavailable    -> 503 litellm_unavailable
```

## LiteLLM Relationship

LiteLLM is private infrastructure behind Proliferate Gateway.

```text
sandbox
  holds Proliferate runtime grant only

Proliferate Gateway
  validates grant and business state
  decrypts internal LiteLLM virtual key
  forwards to LiteLLM

LiteLLM
  routes public model name to provider deployment
  calls provider
  tracks usage/spend
  enforces team budgets
```

Admin provisioning client:

```text
LiteLLMAdminClient.ensure_team
LiteLLMAdminClient.generate_key
LiteLLMAdminClient.create_model_deployment
```

Runtime forwarding client:

```text
LiteLLMRuntimeClient.forward
LiteLLMRuntimeClient.open_stream
```

Managed credits use Proliferate-owned Bedrock credentials and global LiteLLM
model deployments in hosted V1. Budget isolation comes from LiteLLM teams and
virtual keys.

BYOK is modeled but not launchable in hosted/default V1. Current creation
shape-validates provider payloads, stores encrypted payloads, and leaves BYOK
credentials/policies unvalidated or invalid until live validation and the
server feature flags are enabled. The intended target remains per-credential
LiteLLM teams/deployments or an equivalent isolated-router topology.

## Refresh And Expiry

Triggers that already refresh/apply:

```text
personal cloud credential sync changed
legacy cloud credential deleted/revoked
personal/organization sandbox profile attached to target
agent auth credential selected for profile
credential revoked
credential share revoked
managed credits ensured/reconciled
```

The refresh path is push-based:

```text
server updates source of truth
server bumps profile revision
server marks profile/target state pending
server queues refresh_agent_auth_config
worker applies to sandbox/AnyHarness
```

Runtime grants:

```text
TTL = 7 days
raw token never stored
new materialization gets a fresh token
gateway rejects expired token
```

Important current gap:

```text
The stack has LiteLLM mirror reconciliation, but it does not yet have a
dedicated proactive grant-rotation scheduler that queues refresh_agent_auth_config
before the current runtime grant expires.
```

That means launch/preflight and manual/config-triggered refresh are correct,
but long-lived sandboxes need a small follow-up freshness worker:

```text
find active grants expiring within threshold
group by sandbox_profile_id + target_id
queue refresh_agent_auth_config for current profile revision
```

Provider credentials:

```text
BYOK provider payloads are shape-validated.
Live provider validation is currently deferred.
Unvalidated BYOK credentials remain invalid/not selectable in hosted V1.
LiteLLM mirror reconciliation keeps budget/policy mirror state up to date.
```

Synced native auth:

```text
Desktop sync changes write agent_auth_credential payloads directly.
If a native auth file expires but Desktop has not resynced it, the harness or
provider will fail. Product should surface needs_resync/invalid when detection
is available, but current code is mostly best-effort for native expiry.
```

## UI Model

There are two reusable UI concepts.

Credential library:

```text
What auth sources exist?
Who owns them?
Can they be shared?
Are they ready?
```

Selector:

```text
For this sandbox profile and harness, which visible credential is selected?
What is the target apply status?
```

This maps to current components:

```text
CloudAgentAuthLibrary
  lives in cloud settings
  lists credentials grouped by harness
  lets users share personal synced credentials with an organization
  lets credential owner/admin revoke
  hides BYOK form in hosted V1

ComputeTargetAgentAuthCard
  lives on compute target detail
  ensures personal/org sandbox profile for target
  lists one selector per harness
  shows profile target state
```

Current UI limitations:

```text
CloudAgentAuthLibrary
  no hosted BYOK setup UI
  no detailed managed-credit spend/budget status
  share creation exists for personal synced credentials, but shared-sandbox
  admin UX still needs a clearer consent/revocation flow

ComputeTargetAgentAuthCard
  profile is loaded through a manual Configure action
  profile state is component-local and resets when the target changes
  no force-restart control
  no grant freshness or expiry status
  no managed-credit ensure/onboarding flow
```

Future shared sandbox/admin UI should consume this same library and selector
model instead of creating a new auth model:

```text
organization shared sandbox
  ensure organization sandbox_profile
  select one credential per harness
  require org-owned gateway credential or explicitly shared personal synced credential

personal cloud sandbox
  ensure personal sandbox_profile
  select personal synced credential, organization gateway credential visible to user,
  or Proliferate managed credits where available
```

## Open Follow-Ups

These are the places the reference/spec should still call out as real work:

1. Proactive runtime grant rotation.

2. Live validation for BYOK credentials, especially Anthropic/OpenAI API keys,
   Bedrock STS assume-role, and OpenAI-compatible provider probing.

3. Hosted-cloud capability API so Desktop does not need a hardcoded
   `AGENT_GATEWAY_BYOK_ENABLED = false`.

4. OpenCode native credential sync support in the Desktop agent-auth export
   path, if we want OpenCode synced auth before gateway auth.

5. Gemini gateway support, or a clear statement that Gemini remains
   synced-only for the first hosted release.

6. Subscription/billing entitlement integration for
   `included_budget_usd`. Current settings-based default is only a stand-in.

7. A product decision for how managed credits are offered to personal
   sandboxes. Current managed-credit ensure API is organization-scoped.

8. More user-facing `needs_resync` detection for native auth expiry.

9. Full e2e coverage for Claude streaming, Codex Responses, budget exhaustion,
   grant expiry, and refresh after credential/share revocation in a live
   LiteLLM-backed environment.

10. Worker mapping from Cloud `sandboxProfileId` to AnyHarness `agentAuthScope`
    for `start_session`, plus clear `send_prompt` semantics.

11. Runtime fail-closed behavior when a scoped/revisioned launch requests an
    agent kind with no active local auth selection.

12. Stricter protected-env allowlisting by agent/materialization mode.

13. Cleanup application for synced native auth files.
