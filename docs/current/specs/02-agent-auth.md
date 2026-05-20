# 02 — Agent Auth

Status: implementation-ready spec.

Date: 2026-05-20.

Depends on: [`00-sandbox-foundation.md`](00-sandbox-foundation.md),
[`01-mcp-skills-plugins.md`](01-mcp-skills-plugins.md).

The agent LLM auth gateway stack (PRs #254-#259) is mostly shipped. This
spec documents the shipped state, names the concrete remaining gaps, and
rebinds the agent-auth subsystem to the renamed
`sandbox_profile_target_state` and `cloud_targets.profile_target_role`
foundation from spec 00.

## 1. Purpose & Scope

In scope:

- Per `sandbox_profile`, per agent harness, select one auth source.
- Two runtime materialization modes:
  - `synced_files` — Worker writes native auth files into the sandbox.
  - `gateway_env` — Worker gives AnyHarness protected env + Proliferate
    runtime grant; sandbox calls Proliferate Gateway, which forwards to
    private LiteLLM.
- Rebind to spec 00's renamed `sandbox_profile_target_state` (gain the
  active-slot fence; agent-auth columns become the auth axis of that row).
- Drop `SandboxProfile.managed_target_id` readers — derive primary target
  from `cloud_targets.sandbox_profile_id + profile_target_role='primary'`.
- Close the four shipped-stack gaps:
  1. Proactive runtime grant rotation before TTL expiry.
  2. Cleanup-on-revoke for synced auth files (worker actually executes the
     `cleanup` actions in the materialization plan).
  3. AnyHarness fail-closed when scoped launch has no selection for the
     requested agent kind.
  4. Worker synthesis of `AgentAuthExternalScope` from
     `sandboxProfileId` for `start_session` / `send_prompt` preflight.
- Hosted-cloud capability API so Desktop stops hardcoding
  `AGENT_GATEWAY_BYOK_ENABLED = false`.
- Stricter `protected_env` allowlist per agent + materialization mode.
- Better `needs_resync` detection for native auth expiry.

Out of scope:

- BYOK provider validation (Anthropic API key, OpenAI API key, Bedrock
  STS assume-role, OpenAI-compatible live probing). Deferred to a V2
  product-scope decision.
- LiteLLM Enterprise team-scoped routing for shared BYOK.
- Self-hosted gateway/LiteLLM lifecycle.
- Per-request usage ledger (V1 LiteLLM is the spend authority).
- Gemini through gateway (V1 keeps Gemini on synced auth only).
- OpenCode native sync export in the legacy `CloudCredential` path.
- Subscription/billing entitlement for `included_budget_usd` (→ spec 09).
- Settings/Admin IA layout for agent-auth UI (→ spec 03 owns placement;
  this spec names the components).

## 2. Mental Model

One question per profile per harness:

```text
For sandbox_profile P and agent_kind K, which credential is selected
and how does the worker materialize it into the sandbox?
```

Three families of auth source, two runtime materialization modes:

```text
agent_auth_credential
  family               materialization mode
  ----------------     --------------------
  synced_path          synced_files     (Claude/Codex/Gemini/OpenCode native auth)
  managed_gateway      gateway_env      (Proliferate managed credits + V2 BYOK)
```

The mode is implied by the credential kind. Spec 01's MCP credentials and
this spec's agent LLM credentials are intentionally separate concerns:

```text
MCP credentials authorize tools.            (spec 01)
Agent LLM credentials authorize model calls. (spec 02)
```

Service boundary:

```text
Proliferate Cloud control plane
  owns credential rows, selections, budgets, LiteLLM provisioning, worker
  commands. Source of truth.

Proliferate Gateway
  public endpoint sandboxes call. Validates runtime grant, resolves
  policy, forwards to private LiteLLM. Anthropic + OpenAI protocol facades.

Private LiteLLM
  routes provider deployments, tracks spend, enforces team max_budget.
  Not directly reachable from sandboxes.
```

V1 invariant: **provider secrets never enter the sandbox** in the
`gateway_env` mode. The sandbox holds only a Proliferate runtime grant.

V1 fail-closed: every layer (Cloud command admission, worker apply,
AnyHarness launch, Gateway request) rejects when the selected credential
is missing, stale, revoked, exhausted, or unauthorized.

## 3. Dependencies

Hard:

- [`00-sandbox-foundation.md`](00-sandbox-foundation.md):
  - `sandbox_profile` is the canonical profile root; `managed_target_id`
    is dropped; primary target derived from
    `cloud_targets.sandbox_profile_id + profile_target_role='primary'`.
  - `sandbox_profile_target_state` (renamed from the agent-auth-only
    `sandbox_profile_agent_auth_target_state`) carries both runtime-config
    and agent-auth applied state plus the active-slot fence
    (`active_sandbox_id` + `slot_generation`). Spec 02 owns the agent-auth
    columns of that row.
  - Worker envelope/result fields carry `sandbox_profile_id` and
    `slot_generation`.

- [`01-mcp-skills-plugins.md`](01-mcp-skills-plugins.md):
  - `expected_runtime_config_revision` plus
    `required_agent_auth_revision` on `CreateSessionRequest` /
    `ResumeSessionRequest`. Preflight model is shared.
  - Worker fulfillment endpoint pattern reused for credential
    materialization. The two systems use sibling URL prefixes but their
    payloads do not collapse.

Soft:

- [`09-billing.md`](09-billing.md): managed-credit `included_budget_usd`
  comes from plan/free-trial entitlement; spec 09 replaces the current
  `settings.agent_gateway_default_managed_budget_usd` stand-in.

## 4. Current Repo State

Verified against the current repository worktree on 2026-05-20.

### 4.1 What is shipped and working

**All ten agent-auth tables exist** in
`server/proliferate/db/models/cloud/agent_auth.py`:

```text
SandboxProfile
  id, owner_scope, owner_user_id, organization_id,
  managed_target_id, agent_auth_revision, status,
  created_at, updated_at, deleted_at
  -- managed_target_id will be dropped by spec 00

SandboxProfileAgentAuthRevision
  id, sandbox_profile_id, revision, reason, force_restart,
  created_by_user_id, created_at

SandboxProfileAgentAuthTargetState
  -- being renamed by spec 00 to sandbox_profile_target_state;
  -- agent-auth columns become the auth axis of that row.
  id, sandbox_profile_id, target_id, desired_revision,
  applied_revision, status, force_restart_required,
  last_command_id, last_worker_id, last_attempted_at,
  last_applied_at, last_error_code, last_error_message

AgentAuthCredential
  id, owner_scope (system|personal|organization), owner_user_id,
  organization_id, created_by_user_id, agent_kind (claude|codex|opencode|gemini),
  credential_kind (managed_gateway|synced_path), display_name,
  redacted_summary_json,
  status (pending|ready|needs_resync|invalid|revoked),
  revision, legacy_cloud_credential_id (FK to legacy CloudCredential),
  created_at, updated_at, revoked_at

AgentAuthCredentialShare
  id, credential_id, owner_user_id, organization_id,
  share_scope='organization', shared_by_user_id,
  status (active|revoked), allowed_agent_kind,
  created_at, revoked_at, revoked_by_user_id

AgentGatewayBudgetSubject
  id, budget_kind='proliferate_managed', owner_scope='organization',
  organization_id, litellm_team_id, included_budget_usd (str),
  budget_duration='30d', litellm_sync_status, litellm_sync_fingerprint,
  status, revision, last_provisioned_at, last_litellm_reconciled_at,
  error fields, timestamps

AgentGatewayPolicy
  id, credential_id (FK unique), policy_kind
  (proliferate_managed|org_byok|personal_byok),
  owner_scope, owner_user_id, organization_id, budget_subject_id,
  litellm_team_id, litellm_virtual_key_id,
  litellm_virtual_key_ciphertext, litellm_virtual_key_ciphertext_key_id,
  litellm_sync_status, litellm_sync_fingerprint,
  status (provisioning|ready|invalid|revoked), revision,
  last_provisioned_at, last_litellm_reconciled_at, error fields, timestamps

AgentGatewayProviderCredential
  id, policy_id (FK unique), provider_kind
  (proliferate_bedrock_pool|anthropic_api_key|openai_api_key|
   bedrock_assume_role|openai_compatible),
  payload_ciphertext, payload_ciphertext_key_id, redacted_summary_json,
  validation_status, validated_at, validation_error_code,
  validation_error_message, revision, timestamps

SandboxAgentAuthSelection
  id, sandbox_profile_id, owner_scope, agent_kind,
  credential_id (FK), credential_share_id (FK nullable),
  materialization_mode (gateway_env|synced_files),
  selected_revision (>0), status, error fields, timestamps
  UNIQUE (sandbox_profile_id, agent_kind)

AgentGatewayRuntimeGrant
  id, token_hash (unique), hash_key_id, policy_id, credential_id,
  selection_id, issued_profile_revision, target_id, sandbox_profile_id,
  organization_id, user_id, agent_kind,
  protocol_facade (anthropic|openai), expires_at,
  revoked_at, last_used_at, created_at
  -- TTL = 7 days

AgentAuthAuditEvent
  id, action, actor_user_id, owner_scope, owner_user_id,
  organization_id, credential_id, sandbox_profile_id, target_id,
  metadata_json, created_at
```

**Legacy `cloud_credential`** still exists
(`db/models/cloud/credentials.py`). Bridge column
`AgentAuthCredential.legacy_cloud_credential_id` (unique, nullable) ties
synced personal credentials to the imported source. Worker import path is
implemented and idempotent.

**Cloud APIs** (`server/proliferate/server/cloud/agent_auth/api.py`):

```text
GET    /agent-auth/credentials
POST   /agent-auth/credentials/gateway
DELETE /agent-auth/credentials/{credential_id}
POST   /agent-auth/credentials/{credential_id}/shares
DELETE /agent-auth/credential-shares/{share_id}
POST   /organizations/{org_id}/agent-auth/managed-credits
POST   /sandbox-profiles/personal
POST   /organizations/{org_id}/sandbox-profile
GET    /sandbox-profiles/{profile_id}/agent-auth-selections
PUT    /sandbox-profiles/{profile_id}/agent-auth-selections/{agent_kind}
GET    /sandbox-profiles/{profile_id}/agent-auth-target-states
```

**Worker APIs**:

```text
GET  /v1/cloud/worker/agent-auth-configs/{sandbox_profile_id}/materialization
POST /v1/cloud/worker/agent-auth-configs/{sandbox_profile_id}/status
```

**Service**:
`server/proliferate/server/cloud/agent_auth/service.py` covers
ensure-profile, create-credential, share, revoke, select, issue runtime
grant, list selections/target-states, materialization plan build, worker
status apply, LiteLLM reconciliation
(`reconciler.py:reconcile_agent_gateway_litellm_mirror`).

**Gateway**
(`server/proliferate/server/agent_gateway/api.py` and `service.py`):

```text
GET  /agent-gateway/health
GET  /anthropic/v1/models
GET  /openai/v1/models
POST /anthropic/v1/messages
POST /anthropic/v1/messages/count_tokens
POST /openai/v1/chat/completions
POST /openai/v1/responses
```

`authorize_gateway_request` validates the bearer runtime grant against
`token_hash`, expiry, revocation, policy state, model allowlist
(`agent_gateway/domain/protocols.py:allowed_models_for_agent`), and
LiteLLM sync state.

**Worker `refresh_agent_auth_config`**
(`anyharness/crates/proliferate-worker/src/materialization/agent_auth.rs`):

```text
RefreshAgentAuthConfigPayload { sandbox_profile_id, revision, reason, force_restart }

Allowed native paths per agent (line 10-13):
  claude   .claude/.credentials.json, .claude.json
  codex    .codex/auth.json
  gemini   .gemini/oauth_creds.json, .gemini/settings.json
  opencode .config/opencode/auth.json

Worker flow:
  fetch /worker/agent-auth-configs/{id}/materialization
  for synced_files: write_synced_auth_files(allowlisted only)
  build ApplyAgentAuthConfigRequest with protected_env/support_env/
    protected_config/support_config/synced_file_paths
  PUT /v1/agents/auth-config to AnyHarness
  POST /worker/agent-auth-configs/{id}/status
       applied | superseded | failed (sanitized; no secrets)
```

**AnyHarness contract**
(`anyharness/crates/anyharness-contract/src/v1/agent_auth_config.rs`):

```text
AgentAuthExternalScope { provider, id, target_id? }
AgentAuthSelectionConfig {
  agent_kind, materialization_mode, credential_id, credential_revision,
  credential_share_id?, expires_at?, status, protected_env, support_env,
  protected_config, support_config, synced_file_paths
}
ApplyAgentAuthConfigRequest { external_auth_scope?, revision, selections }
AgentAuthSelectionStatus  -- redacted (key sets only)
AgentAuthConfigStatusResponse
ApplyAgentAuthConfigResponse { applied, revision, selection_count, status }
```

**AnyHarness endpoints**:

```text
PUT /v1/agents/auth-config        secret-bearing
GET /v1/agents/auth-config/status redacted (key arrays, no values)
```

**AnyHarness local SQLite**
(`0046_agent_auth_config.sql`):

```text
agent_auth_config (
  scope_key TEXT PRIMARY KEY,
  scope_provider, scope_id, target_id, revision,
  config_ciphertext TEXT,
  created_at, updated_at
)
```

Encrypted via the existing `SessionDataCipher` / `ANYHARNESS_DATA_KEY`.

**Session contract**:
`CreateSessionRequest` carries
`agent_auth_scope: Option<AgentAuthExternalScope>` and
`required_agent_auth_revision: Option<i64>`. Same on `ResumeSessionRequest`.

**Protected env reserved keys** (current shipped set, in cloud constants):

```text
ANTHROPIC_AUTH_TOKEN, ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL,
ANTHROPIC_CUSTOM_HEADERS, CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST,
CLAUDE_CODE_USE_BEDROCK, CODEX_API_KEY, CODEX_HOME, CURSOR_API_KEY,
GEMINI_API_KEY, GOOGLE_API_KEY, OPENAI_API_KEY, OPENAI_BASE_URL
```

`supportEnv` cannot set protected keys. `protectedEnv` accepts any valid
env var name today (the gap in §4.2).

**Desktop UI**:

```text
desktop/src/components/settings/panes/agent-authentication/CloudAgentAuthLibrary.tsx
desktop/src/components/settings/panes/compute/ComputeTargetAgentAuthCard.tsx
desktop/src/hooks/access/cloud/agent-auth/use-agent-auth.ts
  (transitional shim re-exporting from @proliferate/cloud-sdk-react)
desktop/src/lib/domain/agent-auth/agent-auth-presentation.ts
desktop/src/config/agent-auth.ts
  -- AGENT_GATEWAY_BYOK_ENABLED = false   (hardcoded today; gap in §4.2)
```

**Feature flags** (`server/proliferate/config.py`):

```text
agent_gateway_enabled                             default False
agent_gateway_default_managed_budget_usd          default "0"
agent_gateway_reconciler_enabled                  default False
agent_gateway_byok_enabled                        default False
agent_gateway_anthropic_byok_enabled              default False
agent_gateway_openai_byok_enabled                 default False
agent_gateway_bedrock_byok_enabled                default False
agent_gateway_openai_compatible_byok_enabled      default False
agent_gateway_opencode_enabled                    default False
```

### 4.2 What is shipped but incomplete (the gaps)

1. **Proactive runtime grant rotation does not exist.** Grants live 7
   days. Long-lived shared sandboxes will hit `expired_grant` failures
   despite Cloud holding a valid selection. There is no scheduler that
   re-enqueues `refresh_agent_auth_config` before TTL.

2. **Cleanup actions on revoke are parsed but not executed.** The worker
   materialization plan carries a `cleanup` field for synced-file
   selections. In
   `proliferate-worker/src/materialization/agent_auth.rs` line ~195 the
   field is consumed by `let _ = (&synced.credential_share_id,
   &synced.cleanup);` — read and dropped. Revoking a credential / share
   leaves native auth files on disk in the sandbox. The replacement
   selection's files are written but the revoked files remain.

3. **No-selection scoped launch is not strict.** When
   `agent_auth_scope` is set on `CreateSessionRequest` but the local
   `agent_auth_config` row has no selection for the requested
   `agent_kind`, AnyHarness today returns an empty overlay and proceeds.
   Required-scope launches should fail closed with a typed
   `AGENT_AUTH_SELECTION_REQUIRED` error.

4. **Worker does not synthesize `agent_auth_scope` from
   `sandboxProfileId`.** The dispatcher copies the `start_session` /
   `send_prompt` payload through to AnyHarness but does not construct
   `AgentAuthExternalScope { provider: "proliferate-cloud", id:
   sandboxProfileId, targetId: command.targetId }` when Cloud sends only
   `sandboxProfileId` + `requiredAgentAuthRevision`. So Cloud-initiated
   sessions can pass preflight on the Cloud side and still find no
   scoped auth config locally.

5. **`protected_env` accepts any key.** The shipped allowlist blocks
   `supportEnv` from writing protected keys, but `protectedEnv` itself
   is open. Worker-side cleanup of arbitrary unknown protected keys is
   not enforced.

6. **`AGENT_GATEWAY_BYOK_ENABLED` is hardcoded on Desktop.** Server
   config flags exist (`agent_gateway_byok_enabled` and provider-specific
   gates), but Desktop reads from a static `desktop/src/config/agent-auth.ts`.
   Self-hosted operators who enable BYOK on the server cannot reflect
   that in the Desktop UI without recompiling.

7. **`needs_resync` is best-effort.** Auth file mtime change is weak;
   harness-native validity checks and provider 401 detection are not
   uniformly wired. Stale Claude/Codex credentials may pass `ready`
   until launch.

8. **`SandboxProfile.managed_target_id` is still read.** The current
   `agent_auth/service.py` reads `managed_target_id` directly when
   resolving the primary target. Spec 00 drops the column; this spec
   updates the readers.

9. **OpenCode native sync is not exposed by the legacy
   `CloudCredential` export.** The auth-file allowlist for OpenCode
   exists in worker; the Desktop sync API does not yet emit OpenCode
   credentials.

10. **No hosted capability API.** There is no endpoint Desktop can call
    to learn server-side gateway capabilities; it must hardcode them.

## 5. Target Model

### 5.1 Rebind to spec 00's `sandbox_profile_target_state`

The agent-auth columns of the old
`sandbox_profile_agent_auth_target_state` become the auth axis of the new
unified row. Spec 00 owns the rename and data copy; this spec owns the
new column names and the agent-auth service refactor.

After the rename:

```text
sandbox_profile_target_state                       UNIQUE (sandbox_profile_id, target_id)
  sandbox_profile_id                fk sandbox_profile.id
  target_id                         fk cloud_targets.id
  active_sandbox_id                 fk cloud_sandbox.id
  slot_generation                   integer

  desired_agent_auth_revision       integer       -- was: desired_revision
  applied_agent_auth_revision       integer NULL  -- was: applied_revision
  agent_auth_status                 text          -- was: status
                                    'pending'|'materializing'|'applied'|'failed'|'superseded'
  agent_auth_force_restart_required boolean
  last_agent_auth_command_id        fk cloud_commands.id
  last_agent_auth_worker_id         fk cloud_workers.id
  last_agent_auth_attempted_at      timestamptz
  last_agent_auth_applied_at        timestamptz
  last_agent_auth_error_code        text
  last_agent_auth_error_message     text

  + the runtime-config axis owned by spec 01

  updated_at                        timestamptz
```

Validity rule (shared with spec 00 / 01):

```text
applied_agent_auth_revision is valid only when
  sandbox_profile_target_state.active_sandbox_id matches the active slot
  AND
  sandbox_profile_target_state.slot_generation matches the slot's generation

slot replacement clears applied_agent_auth_revision; the next
refresh_agent_auth_config rematerializes on the new slot.
```

Cloud agent-auth service stops reading
`SandboxProfile.managed_target_id`. It loads the profile's primary
target with:

```python
load_primary_target_for_profile(sandbox_profile_id) -> CloudTargetSnapshot | None
  SELECT * FROM cloud_targets
   WHERE sandbox_profile_id = :id
     AND profile_target_role = 'primary'
     AND archived_at IS NULL
```

### 5.2 Worker scope synthesis (gap #4)

Worker dispatcher
(`anyharness/crates/proliferate-worker/src/commands/dispatcher.rs`),
when handling `start_session` and `send_prompt` payloads from Cloud:

```text
let scope = AgentAuthExternalScope {
    provider: "proliferate-cloud".into(),
    id: payload.sandboxProfileId?.to_string(),
    target_id: Some(command.target_id.to_string()),
};

CreateSessionRequest {
    ...
    agent_auth_scope: Some(scope),
    required_agent_auth_revision: payload.requiredAgentAuthRevision,
    ...
}
```

`send_prompt` is admission-only on the Cloud side (the session was
created earlier with the scope persisted on AnyHarness). The worker does
not re-attach scope on prompts; AnyHarness uses the scope persisted on
the session row.

Cloud-side, command admission
(`server/proliferate/server/cloud/commands/service.py`) populates
`sandboxProfileId` and `requiredAgentAuthRevision` in the command payload
from `sandbox_profile_target_state.desired_agent_auth_revision` (read inside
the same transaction that creates the command). The worker reads these from the
payload, not from top-level `CloudCommandEnvelope` fields.

Worker and Cloud ship in the same PR. No "supports_scope_synthesis"
feature flag and no worker-version gating. The wire contract is the
contract.

### 5.3 AnyHarness fail-closed for no-selection (gap #3)

Add a typed error to the contract:

```text
AGENT_AUTH_SELECTION_REQUIRED
  message: "No agent auth selection for {agent_kind} under scope {scope}"
  resolutionScope: AgentAuthExternalScope
  agentKind: string
  selectionStatus: 'missing' | 'expired' | 'invalid' | 'needs_resync'
```

AnyHarness session-launch rules
(`anyharness-lib/src/sessions/runtime/creation.rs`):

```text
if agent_auth_scope is present:
  load agent_auth_config row for (scope.provider, scope.id, scope.target_id)
  if row is missing                  -> AGENT_AUTH_SELECTION_REQUIRED (missing)
  if row.revision < required_revision
                                     -> AGENT_AUTH_SELECTION_REQUIRED (needs_resync)
  decrypt config
  find selection for the requested agent_kind
  if selection is missing            -> AGENT_AUTH_SELECTION_REQUIRED (missing)
  if selection.expires_at < now      -> AGENT_AUTH_SELECTION_REQUIRED (expired)
  if selection.status == 'invalid'   -> AGENT_AUTH_SELECTION_REQUIRED (invalid)
  apply support_env  (any keys allowed)
  apply protected_env (allowlist check; see 5.5)
  launch harness with protected_config (Codex CODEX_HOME, etc.)

if agent_auth_scope is absent:
  legacy behaviour: optional config; local default; no scope check
  (kept for non-Cloud callers; removed when no caller relies on it)
```

The contract gains:

```text
ApplyAgentAuthConfigResponse.no_selection_kinds: Vec<String>
  -- agent_kind values that have no active selection under this scope
  -- so Desktop/admin UIs can surface "needs configuration" early
```

### 5.4 Cleanup-on-revoke (gap #2)

Worker materialization plan already carries `cleanup` per selection. The
spec defines its semantics and makes the worker execute it:

```text
SyncedFilesPlan.cleanup
  relative_paths: list[string]   -- to delete inside HOME
  reason: 'credential_revoked' | 'share_revoked' | 'profile_disabled'
```

Worker enforcement (conservative):

```text
for path in plan.cleanup.relative_paths:
  resolve to absolute path under HOME
  if path is NOT in ALLOWED_NATIVE_AUTH_PATHS[selection.agent_kind]:
    log security warning and abort the apply (do not delete anything)
  if path exists:
    delete file
  emit audit event with selection_id and the credential_id being cleaned
report applied_cleanup_paths in /worker/agent-auth-configs/{id}/status
```

Server constructs `cleanup` only when the intent is unambiguous and the
old paths are clearly orphaned:

```text
- a personal credential is revoked
- a credential share is revoked
- a profile is disabled / blocked

NOT on plain selection replacement. If a user switches between two
synced credentials for the same agent_kind, the new selection writes
its files and any overlapping paths overwrite naturally. Paths that no
longer apply but are not clearly orphaned are left in place. Aggressive
cleanup on replacement risks destructive removal in edge cases
(shared paths across agents, user-modified files, race with parallel
write); the conservative path is to delete only on explicit revoke.
```

Server fail-closed rule:

```text
For a synced_files selection, the worker must not report applied
unless every cleanup_paths entry succeeded or was already absent.
If any cleanup_path resolves outside the per-agent allowlist, abort
the apply, mark it failed, and emit a security audit event. Never
half-clean.
```

Slot replacement is a separate path (the new sandbox starts empty —
cleanup is unnecessary). Cleanup applies inside an existing sandbox.

### 5.5 Stricter `protected_env` allowlist (gap #5)

Move from a "block protected keys in `supportEnv`" model to an
"allowlist protected keys per agent_kind and materialization_mode" model.

Allowlist (initial; can grow):

```text
claude   + gateway_env
  ANTHROPIC_AUTH_TOKEN, ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL,
  ANTHROPIC_CUSTOM_HEADERS, CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST

claude   + synced_files
  (none expected; synced files carry auth via .claude/.credentials.json)

codex    + gateway_env
  CODEX_API_KEY, CODEX_HOME

codex    + synced_files
  CODEX_HOME

opencode + gateway_env  (gated by AGENT_GATEWAY_OPENCODE_ENABLED)
  OPENAI_API_KEY, OPENAI_BASE_URL

opencode + synced_files
  (none)

gemini   + synced_files
  GEMINI_API_KEY, GOOGLE_API_KEY  (rare; only if synced file format demands it)

gemini   + gateway_env
  rejected in V1
```

`ApplyAgentAuthConfigRequest` validation:

```text
for each selection:
  if any protected_env key is not in
     allowlist[selection.agent_kind][selection.materialization_mode]:
    reject the apply with PROTECTED_ENV_KEY_NOT_ALLOWED
```

Worker / server rejection happens at the apply boundary, not at session
launch — that way bad selections fail before being persisted on the
sandbox.

### 5.6 Proactive runtime grant rotation (gap #1)

New reconciler tick:

```text
server/proliferate/server/cloud/agent_auth/grant_rotation.py    (new)

reconcile_runtime_grant_freshness()
  refresh_window = 2 days
  for each active grant where expires_at <= now + refresh_window and
                              policy.status = 'ready' and
                              credential.status = 'ready' and
                              not revoked:
    group by (sandbox_profile_id, target_id)
    enqueue refresh_agent_auth_config for the profile target with
      reason='grant_rotation', force_restart=False
  bound batches; idempotent

scheduling
  reuse the existing agent-auth reconciler tick (already gated by
  agent_gateway_reconciler_enabled).
  add a second pass that runs every 1-6 hours.
```

The worker apply then mints a fresh grant via the existing
materialization plan path. Old grant remains valid until its TTL expires
naturally (or until explicit revocation), giving in-flight requests
graceful drain.

Existing grant overlap behaviour
(`agent_auth/service.py:issue_runtime_grant_for_selection`) keeps one
recent prior grant as compatibility grace; this spec does not change that.

### 5.7 Hosted-cloud capability API (gap #10)

New endpoint:

```text
GET /v1/cloud/capabilities
  -- public, requires auth
  response:
    agent_gateway:
      enabled                              bool
      managed_credits_personal_enabled     bool
      managed_credits_organization_enabled bool
      byok_enabled                         bool
      byok_providers:
        anthropic_api_key                  bool
        openai_api_key                     bool
        bedrock_assume_role                bool
        openai_compatible                  bool
      opencode_gateway_enabled             bool
      default_managed_budget_usd           string
```

Desktop:

```text
desktop/src/hooks/access/cloud/capabilities/use-capabilities.ts   (new)
desktop/src/lib/domain/agent-auth/capability-presentation.ts       (new)
  - runtime-derived selectors over capabilities snapshot

desktop/src/config/agent-auth.ts
  - keep only static local constants; remove hardcoded
    AGENT_GATEWAY_BYOK_ENABLED runtime gate
```

The endpoint stays narrow (gateway-related only) in V1. Spec 03 can add
a broader capabilities surface if needed.

### 5.8 `needs_resync` detection improvements (gap #7)

Strong signals (move credentials to `needs_resync`):

```text
provider 401/403 from a real call            -> needs_resync
harness-native auth check returns logged_out -> needs_resync
oauth invalid_grant / token revoked          -> needs_resync
auth file fails parse                        -> invalid
desktop sync stale beyond threshold          -> needs_resync
```

Weak signals (update freshness metadata only, do not flip status):

```text
auth file mtime changed
expires_at field changed
```

Implementation:

```text
server/proliferate/server/cloud/agent_auth/freshness.py    (new module)
  evaluate_credential_freshness(snapshot, signals) -> CredentialStatus
  apply_signal(credential_id, signal)              -- mutation entrypoint

server/proliferate/server/cloud/credentials/service.py
  on sync event, call apply_signal('desktop_sync_succeeded' | 'desktop_sync_stale')

desktop/src/hooks/access/cloud/credentials/use-credential-sync.ts
  call apply_signal('desktop_sync_succeeded') on successful sync
  surface needs_resync in CloudAgentAuthLibrary
```

Spec 02 ships the framework + the desktop_sync signals. Provider 401
detection and harness-native checks ship as later phases (cheap once the
framework exists).

### 5.9 BYOK gating (deferred to V2 product decision)

The schema and dormant service code exist; UI hides BYOK behind the
capability flag. This spec does NOT make BYOK launchable. The capability
API lets self-hosted operators enable BYOK explicitly.

When BYOK is enabled (future PR):

```text
- live validation per provider (Anthropic /models, OpenAI /models,
  Bedrock STS GetCallerIdentity + test invocation, OpenAI-compatible
  base URL probing with SSRF protection)
- LiteLLM Enterprise team-scoped routing or isolated routers per policy
- BYOK selectors enabled in CloudAgentAuthLibrary
- runtime grant minting refuses unvalidated provider credentials
```

The BYOK validation framework lives in
`server/proliferate/server/cloud/agent_auth/byok_validation/` (new
namespace, populated when the V2 PR lands).

### 5.10 Selection rules

Personal sandbox profile selection:

```text
visible credentials for selection:
  - user's own personal credentials (synced or BYOK gateway)
  - system credentials (Proliferate managed credits) when policy permits
  - organization credentials marked usable in personal sandboxes
    (future policy column; not exposed in V1)
selection picks one credential per agent_kind
```

Organization shared sandbox selection (admin-only):

```text
visible credentials for selection:
  - organization-owned credentials
  - system credentials (managed credits) when policy permits
  - personal credentials of org members that have an active
    agent_auth_credential_share with share_scope='organization' and
    allowed_agent_kind matches
selection picks one credential per agent_kind
```

Selection writes:

```text
PUT /v1/cloud/sandbox-profiles/{id}/agent-auth-selections/{agent_kind}
  body: { credential_id, credential_share_id? }
  server:
    validate visibility for the actor (owner / org admin)
    validate credential.status = 'ready' or accept with warning
    write SandboxAgentAuthSelection
    bump SandboxProfile.agent_auth_revision and write
      SandboxProfileAgentAuthRevision (reason, force_restart=False)
    enqueue refresh_agent_auth_config for all profile targets
    emit AgentAuthAuditEvent
```

Revoking a share or credential mirrors the same flow but with
`force_restart=True` so the worker rotates the runtime in-place.

### 5.11 API surface (post-spec, after rebind)

Unchanged (already shipped):

```text
GET/POST/DELETE /v1/cloud/agent-auth/credentials
POST/DELETE     /v1/cloud/agent-auth/credentials/{id}/shares
POST            /v1/cloud/organizations/{org_id}/agent-auth/managed-credits
POST            /v1/cloud/sandbox-profiles/personal
POST            /v1/cloud/organizations/{org_id}/sandbox-profile
GET/PUT         /v1/cloud/sandbox-profiles/{id}/agent-auth-selections[/{kind}]
GET             /v1/cloud/sandbox-profiles/{id}/agent-auth-target-states
```

Renamed (rebind to spec 00):

```text
GET /v1/cloud/sandbox-profiles/{id}/agent-auth-target-states
  -- response shape unchanged; backed by sandbox_profile_target_state
  -- agent-auth columns (rename inside the response is optional).
```

New:

```text
GET /v1/cloud/capabilities                                       (5.7)
```

Worker (worker token only — unchanged):

```text
GET  /v1/cloud/worker/agent-auth-configs/{profile_id}/materialization
POST /v1/cloud/worker/agent-auth-configs/{profile_id}/status
```

The materialization plan response gains:

```text
plan.selections[].synced.cleanup: SyncedFilesCleanupActions     (5.4)
plan.target_id                                                    (already present)
plan.slot_generation                                              (new — from spec 00)
```

Worker, server, contract, and SDK ship in one PR; there is no capability
flag negotiation.

## 6. Files To Change

Server (Python):

```text
server/proliferate/db/models/cloud/agent_auth.py
  - drop SandboxProfile.managed_target_id  (carried by spec 00)
  - the SandboxProfileAgentAuthTargetState rename is owned by spec 00;
    update the SQLAlchemy class to its new shape

server/proliferate/db/store/cloud_agent_auth/store.py
  - replace managed_target_id reads with load_primary_target_for_profile
  - update FK references after spec 00 rename
  - return SandboxProfileTargetStateSnapshot (agent-auth view)

server/proliferate/server/cloud/agent_auth/service.py
  - derive primary target via cloud_targets.profile_target_role='primary'
  - rebind to sandbox_profile_target_state column names
  - update worker_agent_auth_materialization_plan to populate
    plan.required_runtime_capabilities and plan.slot_generation
  - update record_worker_agent_auth_status to validate
    applied_cleanup_paths report (5.4)
  - update issue_runtime_grant_for_selection to record the rotation
    reason ('selection' | 'rotation' | 'recover') for the audit event

server/proliferate/server/cloud/agent_auth/reconciler.py
  - add grant_rotation pass (5.6)
  - keep LiteLLM mirror reconciliation unchanged

server/proliferate/server/cloud/agent_auth/grant_rotation.py    (new)
  - reconcile_runtime_grant_freshness()
  - integration tests with frozen time

server/proliferate/server/cloud/agent_auth/freshness.py         (new)
  - evaluate_credential_freshness, apply_signal
  - used by credentials/service.py on Desktop sync events

server/proliferate/server/cloud/agent_auth/protected_env_allowlist.py  (new)
  - per (agent_kind, materialization_mode) allowed protected env keys
  - validate_protected_env(selection_plan) -> list[Violation]
  - applied inside worker_agent_auth_materialization_plan before return

server/proliferate/server/cloud/agent_auth/api.py
  - no shape changes for existing endpoints
  - add capabilities endpoint or move to a sibling namespace

server/proliferate/server/cloud/capabilities/                   (new)
  api.py, service.py, models.py

server/proliferate/server/cloud/commands/service.py
  - populate sandboxProfileId and requiredAgentAuthRevision in the
    start_session / send_prompt payloads inside the same transaction that
    reads sandbox_profile_target_state

server/proliferate/server/cloud/credentials/service.py
  - on sync success/failure, call freshness.apply_signal

server/proliferate/config.py
  - no new flags
  - document existing flags in capabilities response
```

Worker (Rust):

```text
anyharness/crates/proliferate-worker/src/commands/dispatcher.rs
  - synthesize AgentAuthExternalScope on start_session  (5.2)
  - thread required_agent_auth_revision into AnyHarness session create

anyharness/crates/proliferate-worker/src/materialization/agent_auth.rs
  - execute cleanup.relative_paths under allowlist check       (5.4)
  - report applied_cleanup_paths in worker status response
  - validate protected_env against per-(agent_kind, mode) allowlist
    (defense-in-depth; server is the primary guard)

anyharness/crates/proliferate-worker/src/cloud_client/commands.rs
  - extend status request body with applied_cleanup_paths list
```

AnyHarness (Rust):

```text
anyharness/crates/anyharness-contract/src/v1/agent_auth_config.rs
  - add typed error AGENT_AUTH_SELECTION_REQUIRED              (5.3)
  - add ApplyAgentAuthConfigResponse.no_selection_kinds        (5.3)

anyharness/crates/anyharness-lib/src/api/http/agent_auth_config.rs
  - validate protected_env allowlist (defense-in-depth)
  - return AGENT_AUTH_SELECTION_REQUIRED when a required configured
    harness has no active selection in the external scope

anyharness/crates/anyharness-lib/src/domains/agents/auth_config.rs
  - load_selection_for_scope_and_kind(scope, kind) -> Option<Selection>
  - returns missing | expired | invalid | needs_resync reason

anyharness/crates/anyharness-lib/src/sessions/runtime/creation.rs
  - implement no-selection fail-closed                          (5.3)
  - emit AGENT_AUTH_SELECTION_REQUIRED with structured reason
```

SDK regeneration:

```text
anyharness/sdk            regenerate after contract change
cloud/sdk                 add capabilities client
```

Desktop:

```text
desktop/src/hooks/access/cloud/capabilities/use-capabilities.ts (new)
desktop/src/lib/domain/agent-auth/capability-presentation.ts (new)
  - selectors over capabilities snapshot

desktop/src/config/agent-auth.ts
  - remove hardcoded AGENT_GATEWAY_BYOK_ENABLED
  - remains static local config only

desktop/src/components/settings/panes/agent-authentication/CloudAgentAuthLibrary.tsx
  - read BYOK from capabilities
  - render unavailable rows for stale selections referencing BYOK
    credentials that are now feature-gated off
  - surface needs_resync from the new freshness signals
  - add 'where used' link per credential

desktop/src/components/settings/panes/compute/ComputeTargetAgentAuthCard.tsx
  - reload profile state from server (not component-local) after
    selection changes
  - show force-restart toggle for admin force-rotate
  - show grant freshness / expiry per selection
  - show managed-credit budget status when policy is managed
  - hook into freshness signals to surface needs_resync

desktop/src/hooks/access/cloud/agent-auth/
  - extend with mutations for force-rotate, freshness signal
```

Tests in §9.

## 7. Implementation Phases

Preferred implementation is one PR per spec. Chunks are review
checkpoints inside that PR and may be split only when the split does
not leave duplicate models, dead paths, partially wired security
checks, or visible inert UI. Phases here describe build-order inside
that PR, not staged rollout.

```text
Chunk A  Rebind to spec 00
  - drop SandboxProfile.managed_target_id readers
  - load_primary_target_for_profile helper using
    cloud_targets.profile_target_role = 'primary'
  - update all agent-auth store/service references to the renamed
    sandbox_profile_target_state columns

Chunk B  Worker scope synthesis + AnyHarness no-selection fail-closed
  - Cloud command builder populates sandboxProfileId +
    requiredAgentAuthRevision on start_session / send_prompt
  - worker dispatcher synthesizes AgentAuthExternalScope on start_session
  - AnyHarness AGENT_AUTH_SELECTION_REQUIRED typed error
  - end-to-end test: scoped launch fails closed when no selection

Chunk C  Cleanup-on-revoke (conservative)
  - server emits cleanup_paths in plan ONLY on revoke / share-revoke /
    profile-disabled
  - worker executes cleanup under allowlist; aborts apply on
    out-of-allowlist paths
  - status report includes applied_cleanup_paths
  - tests for revoke -> file removed; share revoke -> file removed;
    selection replacement -> no cleanup emitted

Chunk D  Protected env allowlist
  - per (agent_kind, materialization_mode) allowlist module
  - server validates before persisting plan
  - worker validates defense-in-depth
  - AnyHarness validates on apply
  - tests for valid combos pass; invalid combos rejected

Chunk E  Proactive grant rotation
  - reconciler tick reconcile_runtime_grant_freshness
  - refresh_window = 2 days; refresh when expires_at <= now + refresh_window
  - reuses existing reconciler-enabled gate

Chunk F  Capability API + Desktop selector cleanup
  - GET /v1/cloud/capabilities
  - Desktop hooks + selectors over capabilities snapshot
  - remove hardcoded AGENT_GATEWAY_BYOK_ENABLED
  - operator runbook update (docs/reference/deployment-self-hosting.md)

Chunk G  Freshness framework + Desktop sync signals
  - freshness.py module
  - apply_signal hooks at Desktop sync sites
  - CloudAgentAuthLibrary surfaces needs_resync

Follow-ups (separate PRs, scope additions, not migration ceremony)
  - provider 401 detection at the gateway (feeds freshness signals)
  - OpenCode native sync via legacy CloudCredential export
  - BYOK enablement (V2 product decision; live validation, LiteLLM
    team-scoped routing or isolated routers)
```

## 8. Acceptance Criteria

1. `SandboxProfile.managed_target_id` is no longer read by agent-auth
   code. Primary target lookup uses
   `cloud_targets.sandbox_profile_id + profile_target_role='primary'`.
2. Agent-auth target state lives on `sandbox_profile_target_state`
   (renamed by spec 00). All store/service references updated.
3. Cloud command builder populates `sandboxProfileId` and
   `requiredAgentAuthRevision` on `start_session` and `send_prompt`
   commands.
4. Worker dispatcher synthesizes
   `AgentAuthExternalScope { provider: "proliferate-cloud", id:
   sandboxProfileId, targetId: command.target_id }` on `start_session`
   and attaches it to the AnyHarness `CreateSessionRequest`.
5. AnyHarness session launch fails closed with
   `AGENT_AUTH_SELECTION_REQUIRED { selectionStatus }` when
   `agent_auth_scope` is set but no active selection exists for the
   requested agent_kind, or the selection is expired/invalid/needs_resync.
6. (was: worker capability gating; removed — worker, server, and
   contract ship in one PR; no version negotiation.)
7. The materialization plan's `cleanup.relative_paths` is executed by
   the worker. Files are deleted only when the path is in the allowlist
   for the selection's `agent_kind`. Unallowlisted cleanup paths cause
   the apply to fail (not silently skip) with a security audit event.
8. Worker reports `applied_cleanup_paths` in the status response. If expected
   cleanup is absent, the server records the target-state status as `failed`
   with a typed cleanup error and does not mark
   `applied_agent_auth_revision` complete.
9. Revoking a credential, revoking a share, or disabling a profile
   enqueues `refresh_agent_auth_config` with `force_restart=true` and
   `plan.cleanup` listing every previously-written path for the
   affected agent_kind. Plain selection replacement does NOT emit
   cleanup; overlapping paths overwrite naturally.
10. `protected_env` keys are validated per
    `(agent_kind, materialization_mode)` allowlist. Server rejects
    invalid plans before persistence; worker rejects them
    defense-in-depth; AnyHarness rejects them at apply.
11. Proactive grant rotation runs (when
    `agent_gateway_reconciler_enabled=true`) and re-enqueues
    `refresh_agent_auth_config` for grants whose `expires_at <= now + 2 days`.
    With 7-day grants this refreshes at roughly five days old. Old grants
    drain naturally.
12. `GET /v1/cloud/capabilities` returns server-side gateway flags.
    Desktop reads from this endpoint; `desktop/src/config/agent-auth.ts`
    has no hardcoded `AGENT_GATEWAY_BYOK_ENABLED` value.
13. Stale BYOK selections from earlier test environments render as
    `unavailable in hosted cloud` (or self-hosted equivalent) and can
    be replaced; they cannot be re-saved while the capability flag is
    false.
14. The Desktop `CloudAgentAuthLibrary` surfaces `needs_resync` triggered by
    Desktop sync signals via the new freshness framework.
15. `ComputeTargetAgentAuthCard` reloads profile state from the server
    after selection changes (component-local cache no longer drops on
    target switch).
16. BYOK provider credential paths remain feature-gated and unreachable
    when `agent_gateway_byok_enabled=false`. The schema is unchanged.
17. Gemini gateway requests remain rejected
    (`gateway_byok_disabled`, `gateway_not_supported_for_agent`, or
    `gateway_route_unavailable` depending on the failing layer).
    Gemini synced auth continues to work.
18. OpenCode gateway is reachable only when
    `agent_gateway_opencode_enabled=true`. Default is false; capability
    API exposes the current value.
19. Slot replacement clears
    `sandbox_profile_target_state.applied_agent_auth_revision`. Next
    `refresh_agent_auth_config` re-applies on the new slot before the
    next scoped launch.
20. Worker materialization plan carries `target_id` and `slot_generation`
    so the worker fences applies against the active slot. No capability
    flag negotiation; worker/server/contract are version-locked by the
    PR that ships them.

## 9. Verification / Tests

Server:

```bash
cd server
uv run pytest -q
```

Targeted server tests:

```text
server/tests/cloud/agent_auth/test_primary_target_derivation.py
server/tests/cloud/agent_auth/test_target_state_rebind_after_spec00.py
server/tests/cloud/agent_auth/test_command_carries_profile_and_revision.py
server/tests/cloud/agent_auth/test_grant_rotation_reconciler.py
server/tests/cloud/agent_auth/test_protected_env_allowlist.py
server/tests/cloud/agent_auth/test_cleanup_paths_in_plan.py
server/tests/cloud/agent_auth/test_revoke_credential_emits_cleanup.py
server/tests/cloud/agent_auth/test_share_revoke_emits_cleanup.py
server/tests/cloud/agent_auth/test_freshness_apply_signal.py
server/tests/cloud/capabilities/test_capabilities_endpoint.py
server/tests/cloud/agent_auth/test_byok_remains_gated.py
server/tests/cloud/agent_auth/test_opencode_gated.py
server/tests/cloud/agent_auth/test_gemini_gateway_rejected.py
```

AnyHarness:

```bash
cargo test -p anyharness-contract
cargo test -p anyharness-lib agent_auth
cargo test -p proliferate-worker agent_auth
```

Targeted Rust tests:

```text
anyharness/crates/anyharness-contract/src/v1/agent_auth_config.rs#tests
  - cleanup field round-trip
  - AGENT_AUTH_SELECTION_REQUIRED error round-trip
  - no_selection_kinds in ApplyAgentAuthConfigResponse

anyharness/crates/anyharness-lib/src/sessions/runtime/creation.rs#tests
  - scope set + selection present + applied -> launches
  - scope set + selection missing           -> AGENT_AUTH_SELECTION_REQUIRED missing
  - scope set + selection expired           -> AGENT_AUTH_SELECTION_REQUIRED expired
  - scope set + selection invalid           -> AGENT_AUTH_SELECTION_REQUIRED invalid
  - scope set + revision stale              -> AGENT_AUTH_SELECTION_REQUIRED needs_resync
  - scope absent (legacy)                   -> launches with local default

anyharness/crates/anyharness-lib/src/api/http/agent_auth_config.rs#tests
  - protected_env allowlist enforced
  - cleanup_paths reported back to caller

anyharness/crates/proliferate-worker/src/commands/dispatcher.rs#tests
  - synthesize AgentAuthExternalScope on start_session
  - send_prompt does not re-attach scope

anyharness/crates/proliferate-worker/src/materialization/agent_auth.rs#tests
  - cleanup deletes allowlisted paths
  - cleanup rejects unallowlisted paths and reports failure
  - applied_cleanup_paths included in status report
```

SDK regeneration:

```bash
cd anyharness/sdk && pnpm run generate && pnpm run build
cd cloud/sdk    && pnpm run generate && pnpm run build
```

Desktop:

```bash
cd desktop && pnpm test -- --run && pnpm typecheck
```

Targeted Desktop tests:

```text
desktop/src/hooks/access/cloud/capabilities/use-capabilities.test.ts
desktop/src/components/settings/panes/agent-authentication/CloudAgentAuthLibrary.test.tsx
  - BYOK rows hidden when capability flag is false
  - stale BYOK selection shows unavailable + can be replaced
  - needs_resync surfaces from server snapshot
desktop/src/components/settings/panes/compute/ComputeTargetAgentAuthCard.test.tsx
  - profile state reloads from server on target switch
  - force-restart action invalidates target state cache
```

Manual smoke cases:

```text
1. Personal cloud, sync Claude auth
     -> CloudCredential sync writes legacy row
     -> server reconciler imports as AgentAuthCredential(synced_path)
     -> default selection set
     -> sandbox_profile_target_state desired bumped
     -> worker refresh writes .claude/.credentials.json + .claude.json
     -> next session launches via synced auth

2. Personal cloud, switch from synced Claude to managed credits
     -> selection PUT writes new SandboxAgentAuthSelection
     -> bump revision; force_restart=False
     -> worker refresh:
          no cleanup is emitted for plain selection replacement
          managed-credit env/headers are applied as protected routing overlay
     -> next session uses gateway path; old synced files are ignored

3. Admin shares personal synced Codex auth with org
     -> AgentAuthCredentialShare created (status=active)
     -> admin selects it for shared sandbox
     -> shared cloud target rematerializes
     -> shared automation runs successfully

4. Owner revokes share
     -> share status='revoked'
     -> shared selection invalidated
     -> refresh_agent_auth_config with force_restart=true
     -> plan.cleanup includes .codex/auth.json
     -> worker deletes file; next shared launch fails closed until admin
        chooses a replacement

5. Cloud-initiated send_prompt
     -> Cloud command carries sandboxProfileId + requiredAgentAuthRevision
     -> worker dispatcher synthesizes AgentAuthExternalScope
     -> AnyHarness finds scoped config, applies, launches

6. (was: worker version-skew smoke test; removed — worker and server
   ship in the same PR, no version negotiation.)

7. Long-lived shared sandbox
     -> grant expires_at <= now + 2 days
     -> reconciler enqueues refresh_agent_auth_config(reason='grant_rotation')
     -> worker mints new grant; old grant drains naturally
     -> gateway requests never see expired_grant

8. Self-hosted operator enables BYOK
     -> server config flips agent_gateway_byok_enabled=true
     -> /v1/cloud/capabilities reports byok_enabled=true
     -> Desktop CloudAgentAuthLibrary shows BYOK form
     -> no restart of Desktop required (cache invalidates)

9. Provider 401 from Anthropic
     -> credential moves to needs_resync
     -> profile target state apply still 'applied' for that revision but
        the next scoped launch fails closed; UI prompts reconnect
```

## 10. Final Decisions / Deferred Questions

1. **Should `auth_status != 'ready'` on a publicized MCP be blocker or
   warning?** That belongs in spec 01 — answered there. For agent auth,
   credentials with `status != 'ready'` always block selection writes
   in V1.

2. **Should the rename of agent-auth target state columns ship inside
   the spec 00 migration or as a Phase 0 follow-up here?**

   Decision: ship in spec 00's migration so the agent-auth service does not
   live across two table shapes. Spec 02's Phase 0 is purely the
   Python/Rust code path update.

3. **Where does the freshness framework run for provider 401 detection?**

   Deferred to a follow-up PR after this spec ships. When added, the
   integration point will be the gateway response layer
   (`agent_gateway/service.py:forward_gateway_request`) feeding back via
   `freshness.apply_signal` on the credential. Spec 02 ships the
   framework + Desktop sync signals only; the 401 path is a clean
   addition with no rework needed.

4. **Cleanup of revoked synced files in a new sandbox slot?**

   The new slot starts empty, so no cleanup is required there. But the
   `last_applied_at` audit trail should still record that no cleanup ran
   because the slot is fresh.

5. **Should the capability API also expose runtime config flags
   (per-spec-01)?**

   Decision: keep `GET /v1/cloud/capabilities` narrow to gateway/agent-auth
   in V1. Spec 01 can add a sibling endpoint or expand this one in
   Phase 5; either is fine.

6. **Should V1 allow shared sandboxes to select synced files at all?**

   Yes, gated by `agent_auth_credential_share`. The product reason is
   that some orgs only have native CLI auth available; managed credits
   may not cover all harnesses. The share consent flow is the
   user-protection control.

7. **Should we add a `force_restart_required` query parameter on the
   selection PUT for admins?**

   Decision: yes — admin "force rotate" is a known UX need. Default false;
   when true, bump revision and queue `refresh_agent_auth_config` with
   `force_restart=true`.

8. **Should `included_budget_usd` be moved out of
   `settings.agent_gateway_default_managed_budget_usd` in this spec?**

   No — that is spec 09's call (plan/entitlement). This spec keeps the
   stand-in and the capability API reflects whatever value is in
   effect.
