## High level notes / mental model broadly

Agent auth is sandbox-scoped, per harness:

- Claude/Codex/OpenCode/Gemini each get one selected auth source for a sandbox.
- Workspaces and sessions inherit the sandbox's selected auth.
- Changing selected auth updates the sandbox before future launches.

There are two auth families:

- `synced_path`: real native auth files/env copied into the sandbox. This is for local Claude/Codex/Gemini/OpenCode auth that we sync.
- `managed_gateway`: sandbox gets Proliferate gateway config only. Provider secrets stay server-side and requests route through Proliferate Gateway -> LiteLLM -> provider.

Do not inject raw Anthropic/OpenAI/Bedrock provider secrets into cloud sandboxes as the normal path. API keys and Bedrock roles back gateway policies. The sandbox gets only a short-ish Proliferate runtime grant/token plus base URL/config.

Services:

```text
Proliferate API/control plane
  owns credentials, selections, budgets, LiteLLM provisioning, worker commands

Proliferate Gateway
  public Anthropic/OpenAI-compatible endpoint used by agent harnesses
  validates sandbox runtime grants
  forwards request to private LiteLLM

Private LiteLLM
  owns provider routing, virtual keys, spend tracking, hard budgets
  not directly exposed to sandboxes
```

## Basic basic UX / high level

How does agent auth relate to sandboxes?

- A sandbox profile has one auth selection per supported harness.
- Personal sandbox can use the user's credentials, org credentials marked usable in personal sandboxes, or system managed credits.
- Shared sandbox can use org/system credentials or org member credentials marked usable in shared sandboxes.

Who can set what?

- Users can add personal synced credentials for their personal sandbox.
- Users can add personal BYOK gateway credentials if enabled.
- Admins can add organization BYOK gateway credentials.
- Admins can select organization/system credentials for shared sandboxes.
- Admins can select an org member's credential for shared sandboxes by org policy.
- Admin-created org credentials can optionally be usable by individual users in their personal sandboxes.

Free/managed credits:

- Every org can receive a managed-credit budget from plan/free-trial/subscription config.
- V1 is hard cap only: included credits until exhausted, no overage ledger.
- LiteLLM enforces the active budget; Proliferate provisions the amount and blocks use if the mirror is stale/failed.
- The exact dollar amount belongs in pricing/plan config, not this auth model.

Hosted cloud V1 exact scope:

```text
enabled:
  Proliferate managed credits through gateway
  synced native auth for personal sandboxes
  synced native auth for shared sandboxes only with explicit owner share/consent

disabled by default:
  personal BYOK through gateway
  organization BYOK through gateway
  Bedrock/OpenAI/Anthropic/OpenAI-compatible provider forms in hosted UI
  tenant-owned provider credentials attached to shared global LiteLLM models
```

The BYOK schema and dormant service code can exist, but hosted cloud must behave
as if BYOK is not launchable unless both gates are true:

```text
agent_gateway_byok_enabled == true
provider-specific gate == true
```

Provider gates:

```text
agent_gateway_anthropic_byok_enabled
agent_gateway_openai_byok_enabled
agent_gateway_bedrock_byok_enabled
agent_gateway_openai_compatible_byok_enabled
```

While BYOK is disabled:

```text
POST create gateway provider credential -> gateway_byok_disabled
select existing BYOK credential -> gateway_byok_disabled
reconciler skips/invalidates BYOK policy -> gateway_byok_disabled
already-issued BYOK runtime grant -> gateway_byok_disabled at request time
missing BYOK provider credential row -> provider_credential_missing
```

Managed credits are different from BYOK:

```text
provider credential owner: Proliferate
LiteLLM deployments: may be global/public in hosted V1
budget isolation: LiteLLM team/key max_budget + Proliferate entitlement checks
sandbox secret exposure: only Proliferate runtime grant/config
```

BYOK V2 needs one of:

```text
preferred:
  LiteLLM Enterprise team-scoped deployments with duplicate public model names
  isolated by team/policy

acceptable fallback:
  isolated LiteLLM router/instance per policy or budget subject

deferred:
  Proliferate-side model alias rewriting across every harness/protocol
```

Do not ship hosted shared BYOK on OSS LiteLLM global public model names. That
would mix tenant-owned provider credentials behind the same harness-visible
model names and break isolation.

## Full DB models + schemas

```text
sandbox_profile
  id
  owner_scope: personal | organization
  owner_user_id
  organization_id
  managed_target_id
  agent_auth_revision
  status

agent_auth_credential
  id
  owner_scope: system | personal | organization
  owner_user_id
  organization_id
  created_by_user_id
  agent_kind: claude | codex | opencode | gemini
  credential_kind: managed_gateway | synced_path
  display_name
  usable_in_personal_sandboxes
  usable_in_shared_sandboxes
  redacted_summary_json
  status: pending | syncing | ready | needs_resync | needs_reauth | invalid_config | invalid | revoked
  last_synced_at
  last_verified_at
  last_error_code
  revision

sandbox_agent_auth_selection
  id
  sandbox_profile_id
  agent_kind
  credential_id
  materialization_mode: gateway_env | synced_files
  selected_revision
  status: active | needs_resync | invalid

sandbox_profile_agent_auth_target_state
  id
  sandbox_profile_id
  target_id
  desired_revision
  applied_revision
  status: pending | materializing | applied | failed | superseded
  force_restart_required
  last_command_id
  last_error_code
```

Gateway-specific rows:

```text
agent_gateway_budget
  id
  organization_id
  included_budget_usd
  budget_duration: 30d
  litellm_team_id
  litellm_sync_status
  status: ready | exhausted | invalid | revoked

agent_gateway_config
  id
  credential_id
  provider_kind: proliferate_bedrock_pool | bedrock_assume_role | anthropic_api_key | openai_api_key | openai_compatible
  encrypted_provider_payload
  redacted_summary_json
  validation_status
  budget_id
  litellm_team_id
  litellm_virtual_key_ciphertext
  litellm_sync_status
  status
  revision

agent_gateway_runtime_grant
  id
  token_hash
  credential_id
  target_id
  sandbox_profile_id
  agent_kind
  protocol_facade: anthropic | openai
  expires_at
  revoked_at
```

Key invariants:

- Unique active selection per `sandbox_profile_id + agent_kind`.
- Personal sandbox can use the user's credential, org credentials marked usable in personal sandboxes, or system managed credits.
- Shared sandbox can use org credentials, system managed credits, or org member credentials marked usable in shared sandboxes.
- Provider secrets and LiteLLM keys are encrypted server-side.
- Runtime grant raw token is never stored, only keyed hash.
- Target applied state is per target, not only per profile.
- Selection writes bump `agent_auth_revision` and enqueue sandbox refresh.

## End to end flows through the product

Creating synced auth and applying to personal sandbox:

1. User enables syncing for a native harness auth source.
2. Desktop continuously syncs allowlisted auth files/env snapshots to Cloud.
3. Server stores encrypted latest snapshot on an `agent_auth_credential` with `credential_kind = synced_path`.
4. Desktop/server marks status from real checks when available: `syncing`, `ready`, `needs_resync`, `needs_reauth`, `invalid_config`.
5. User/admin selects it for a sandbox/harness.
6. Server bumps `agent_auth_revision`.
7. Worker receives `refresh_agent_auth_config`.
8. Worker writes the latest allowlisted native auth files/config into sandbox.
9. AnyHarness launches harness with native config.

Creating gateway auth and applying to sandbox:

1. User/admin adds provider credential or chooses Proliferate managed credits.
2. Server validates provider credential if BYOK.
3. Server creates/updates LiteLLM team, virtual key, model deployments, and budget.
4. User/admin selects credential for sandbox/harness.
5. Server mints or reuses a runtime grant for the target.
6. Worker applies base URL, headers/token, and harness-specific config.
7. Harness calls Proliferate Gateway; gateway validates token and forwards to LiteLLM.

Hosted V1 gateway auth creation is narrower:

1. Org receives entitlement for managed credits.
2. Server creates org budget subject with `budget_duration = 30d`.
3. Server provisions/updates LiteLLM team/key budget.
4. Server creates one managed-credit credential for each supported harness.
5. User/admin selects managed credits for a sandbox/harness.
6. Worker applies gateway base URL, auth header/token, and harness config.
7. Gateway validates runtime grant and budget state on every request.
8. If budget is exhausted or mirror is stale, the request fails closed.

No user/provider API key or Bedrock role is accepted on this hosted V1 path.

Synced credential becomes stale or invalid:

1. Desktop stops syncing recently enough, file shape becomes invalid, a harness-native auth check fails, or a real harness/provider request returns auth failure.
2. Server marks credential `needs_resync`, `needs_reauth`, or `invalid_config`.
3. Affected selections become `needs_resync` or invalid.
4. Sandbox refresh removes/replaces stale files where safe.
5. UI routes the CTA to the credential owner.
6. Admins/users of affected sandboxes see that the sandbox is blocked on that credential owner.
7. Any sandbox using that credential fails closed until resync/reauth.

Gateway credential becomes stale or invalid:

1. A named validation check, LiteLLM reconciliation, budget check, runtime grant check, or real gateway request detects failure.
2. Credential or gateway config becomes `invalid`, `drifted`, or `failed`.
3. Affected selections require refresh and launch preflight fails closed.
4. Admin/user fixes provider credential.
5. Server reprovisions LiteLLM and queues `refresh_agent_auth_config`.

Onboarding credits:

1. Org is created or trial starts.
2. Server creates `agent_gateway_budget` for included credits.
3. Server creates managed-credit credentials/configs for supported harnesses.
4. UI defaults personal/shared sandbox to managed credits where allowed.
5. LiteLLM enforces the hard budget.

Subscription credits:

1. Plan changes set the org included-credit amount.
2. Server updates gateway budget.
3. Server reconciles LiteLLM team budget.
4. If budget is exhausted, gateway returns budget-exhausted until reset/update.

## Specific hooks

`refresh_agent_auth_config`:

```text
selection/credential/gateway config changed
  -> bump sandbox_profile.agent_auth_revision
  -> enqueue refresh_agent_auth_config for target/profile/revision
  -> worker fetches materialization plan
  -> worker applies synced files or gateway env/config
  -> worker reports applied_revision
```

Updating managed auth in LiteLLM:

```text
provider credential or budget changed
  -> validate provider
  -> create/update LiteLLM team
  -> create/update LiteLLM virtual key
  -> create/update team-scoped model deployments
  -> mark litellm_sync_status = synced
```

Authenticating a gateway request:

```text
harness request hits Proliferate Gateway
  -> validate runtime grant hash, expiry, revocation, target/profile metadata
  -> resolve grant -> gateway config -> LiteLLM virtual key
  -> check gateway policy is still launchable
  -> for BYOK, check global/provider BYOK flags even if grant was issued earlier
  -> for managed credits, check budget subject is synced and not exhausted
  -> forward request model unchanged to LiteLLM
  -> LiteLLM routes, tracks spend, enforces budget
```

Launch preflight:

```text
session launch requires agent_auth_revision R
  -> target state must have applied_revision >= R
  -> AnyHarness config must be applied
  -> otherwise worker refreshes first or launch fails
```

Synced credential sync/verification:

```text
Desktop startup/login
file watcher on allowlisted auth paths
periodic background sync
manual "sync now"
pre-launch ensure-latest if Desktop is reachable
```

Reliable synced-auth indicators:

```text
strong ready signal:
  harness-native auth check passes
  cheap provider/model-list/test request succeeds
  real harness call succeeds

strong failure signal:
  harness says not logged in
  provider returns 401/403 invalid auth
  OAuth invalid_grant/token revoked

weak signal:
  auth file exists
  auth file mtime changed
  file contains an expires_at field
```

Weak signals can update freshness metadata, but should not alone mark a
credential `ready` for shared/team work.

Gateway validation checks:

```text
Bedrock:
  STS AssumeRole succeeds with ExternalId
  GetCallerIdentity returns expected account
  Bedrock test invocation works in selected region
  LiteLLM deployment sync succeeds
  runtime request does not return auth/permission error

Anthropic/OpenAI API key:
  validation call succeeds
  LiteLLM deployment sync succeeds
  runtime request does not return invalid_api_key, permission, or quota error

OpenAI-compatible:
  base URL passes SSRF validation
  GET /models or configured test request succeeds
  LiteLLM deployment sync succeeds
  runtime request succeeds

Managed credits:
  LiteLLM team/key/model mirror is synced
  budget is not exhausted
  runtime grant is valid
```

## Specific one offs

V1 provider/auth options:

- Proliferate managed credits: no user input; backed by Proliferate provider credentials, preferably Bedrock where compatible.
- AWS Bedrock AssumeRole: V2 BYOK only. Ask for region and role ARN; Proliferate supplies ExternalId, trust policy, permissions, and CloudFormation link.
- Anthropic API key: V2 BYOK only. Ask for key and label; server-side only.
- OpenAI API key: V2 BYOK only. Ask for key, label, optional org/project; server-side only.
- OpenAI-compatible: V2 BYOK only. Ask for base URL, optional key, label; validate with SSRF protections.
- Synced native auth files: Claude, Codex, OpenCode, Gemini as supported by their native config formats.

Hosted cloud V1 UI should show only:

```text
Proliferate managed credits
synced Claude auth
synced Codex auth
synced OpenCode auth
synced Gemini auth
shared synced auth rows with source owner and active share
```

Gateway BYOK forms should be hidden unless capability is enabled. If a stale
BYOK credential or selection exists from a private/test environment, hosted UI
should render it as unavailable rather than silently pretending no selection
exists.

Harness compatibility gates:

Do not expose a harness/provider gateway option until its compatibility gate is
proven. Each path is either `proven`, `blocked`, or `not offered`.

Need to verify:

```text
Claude gateway path:
  configure Anthropic-compatible base URL/headers
  run streaming Messages request
  verify cancellation/error mapping
  verify provider env cannot override gateway config

Codex gateway path:
  configure custom provider base_url/env_key/wire_api=responses
  run Responses streaming request
  verify no native OpenAI login requirement blocks it
  verify provider config is forced

OpenCode gateway path:
  configure OpenAI-compatible provider
  run ACP session
  verify selected provider/model cannot drift

Gemini gateway path:
  configure gateway metadata
  run Gemini/GenAI-compatible streaming request
  verify SDK placeholder key/header behavior works
```

Until a gate passes, the UI should not present that gateway option as usable.
Synced path can remain available where native auth sync is implemented.

Bedrock setup:

- Proliferate generates one ExternalId per provider credential setup.
- Customer creates an IAM role trusted by Proliferate with that ExternalId.
- Proliferate validates `AssumeRole`, caller account, region, and a test Bedrock invocation.
- Bedrock role can back multiple harness policies only where the protocol path is validated.

## Deeper concepts

LiteLLM Proxy:

- Private internal router/budget enforcer.
- Stores provider deployment config and team-scoped public model names.
- Tracks spend and enforces hard budgets.
- Should not be directly reachable from sandboxes.

Proliferate Gateway:

- Public endpoint sandboxes call.
- Speaks Anthropic/OpenAI-compatible protocols to harnesses.
- Owns Proliferate auth/business checks.
- Does not remap model IDs at request time; it forwards the requested model unchanged.

Bedrock:

- Preferred managed-credit backend where protocol compatibility works.
- BYOK path uses customer `AssumeRole` plus ExternalId.
- LiteLLM deployment maps harness-visible model names to Bedrock provider params at provisioning time.

Synced path:

- Compatibility bridge and personal-auth option.
- Writes native auth files into sandbox.
- Does not involve LiteLLM or gateway.
- Requires cleanup/replacement on revocation or resync.

## Remaining implementation notes

The existing worker command system is the right delivery mechanism for auth
updates. Auth changes should continue to queue `refresh_agent_auth_config`; we
do not need a separate auth-sync transport.

What matters is the difference between command submission and completed
materialization:

```text
Cloud queues refresh_agent_auth_config
worker leases command
worker fetches materialization plan
worker applies gateway env/config or synced files
worker reports applied / failed / superseded
Cloud records target/profile status
```

For normal gateway-backed managed credits, stale sandbox config is acceptable
as long as gateway requests are live-validated. Revoked grants, exhausted
budgets, disabled BYOK policies, and unsynced LiteLLM mirrors should fail at
the gateway/server boundary.

For synced native auth, revocation needs actual disk cleanup. The current
implementation already invalidates affected selections and queues
`refresh_agent_auth_config` when a credential/share is revoked. The missing
piece is making the materialization plan include cleanup/tombstone actions and
making the worker execute those cleanup actions before reporting the revision
applied. Writing the replacement files is not enough if the revoked selection
has no replacement.

Concrete follow-ups:

- Add cleanup actions to synced-file materialization plans for revoked/replaced
  credential shares.
- Make worker delete only allowlisted harness auth paths for the affected
  `agent_kind`.
- Treat sandbox replacement as needing auth reapply, using the same
  `refresh_agent_auth_config` command.
- Keep target/profile auth status for UI/debugging, but do not require every
  prompt to synchronously prove latest revision if the runtime and gateway fail
  closed.
- Make AnyHarness reject managed-cloud harness starts when no auth config exists
  for the selected harness.
