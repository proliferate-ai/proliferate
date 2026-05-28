# Agent Auth / MCPs / Skills

Status: quick-reference study packet for sandbox-scoped auth, runtime config,
MCPs, skills, plugins, and launch preflight.

Canonical sources:

- `docs/current/specs/01-mcp-skills-plugins.md`
- `docs/current/specs/02-agent-auth.md`
- `docs/current/specs/04-cloud-running-alignment.md`
- `docs/anyharness/specs/mcp.md`
- `docs/anyharness/contract.md`

## Mental Model

Agent auth, MCPs, skills, and plugins are sandbox-profile configuration:

```text
Cloud selected config
  -> profile runtime/auth revision
  -> target-scoped apply state
  -> worker materialization
  -> AnyHarness runtime config / auth config
  -> session launch preflight
```

Cloud compiles desired state. Worker applies it to AnyHarness. AnyHarness
launches a session only if the bound runtime config and required auth revision
are present and current.

Important current detail:

- Skills are not primarily installed into the agent filesystem.
- Skills are materialized as runtime config artifacts.
- Skills are exposed through the internal `proliferate_skills` product MCP.
- The coding-agent auth gateway is Bifrost-backed.
- Some DB fields still carry compatibility names from older gateway designs.

## Cloud Agent Auth Models

Models:

```text
server/proliferate/db/models/cloud/agent_auth.py
  SandboxProfile
  SandboxProfileAgentAuthRevision
  AgentAuthCredential
  AgentAuthCredentialShare
  AgentGatewayBudgetSubject
  AgentGatewayFreeCreditEntitlement
  AgentGatewayPolicy
  AgentGatewayProviderCredential
  SandboxAgentAuthSelection
  SandboxProfileTargetState
  AgentGatewayRuntimeGrant
  AgentGatewayRouterMaterialization
  AgentGatewayLlmUsageEvent
  AgentGatewayUsageImportCursor
  AgentAuthAuditEvent
```

Core meanings:

- `SandboxProfile`: config root.
- `SandboxProfileAgentAuthRevision`: immutable selected auth materialization plan.
- `AgentAuthCredential`: stored/global credential record.
- `AgentAuthCredentialShare`: org/team sharing of a credential.
- `SandboxAgentAuthSelection`: selected credential/gateway mode per profile/agent.
- `SandboxProfileTargetState`: per target applied auth/runtime status.
- `AgentGatewayRuntimeGrant`: runtime grant for a specific sandbox/slot.
- `AgentGatewayRouterMaterialization`: Bifrost/router sync status.
- Usage/audit rows track gateway accounting and changes.

API/service:

```text
server/proliferate/server/cloud/agent_auth/api.py
server/proliferate/server/cloud/agent_auth/models.py
server/proliferate/server/cloud/agent_auth/service.py
server/proliferate/db/store/cloud_agent_auth/**
```

Bifrost integration:

```text
server/proliferate/integrations/bifrost/client.py
server/proliferate/integrations/bifrost/models.py
server/proliferate/config.py
```

Config/env includes gateway enablement, Bifrost base/public URLs, admin token,
provider secrets, BYOK flags, free-credit amounts, reconciler interval/batch,
and isolation verification.

## Local Vs Global Credentials

Local desktop discovery/export:

```text
desktop/src-tauri/src/commands/keychain.rs
desktop/src/lib/access/tauri/credentials.ts
desktop/src/hooks/access/tauri/credentials/**
```

Cloud/global credentials:

```text
AgentAuthCredential
AgentAuthCredentialShare
SandboxAgentAuthSelection
AgentGatewayProviderCredential
AgentGatewayPolicy
AgentGatewayRuntimeGrant
```

Rules:

- Local credential discovery is desktop/keychain-owned.
- Cloud credentials are durable server rows.
- Shared/org use must go through explicit share/selection policy.
- Gateway credentials are materialized into Bifrost provider keys/routing/grants.
- Raw provider secrets should not be handed directly to sessions.

## AnyHarness Agent Auth

Contract:

```text
anyharness/crates/anyharness-contract/src/v1/agent_auth_config.rs
```

Important types:

```text
ApplyAgentAuthConfigRequest
AgentAuthExternalScope
AgentAuthSelectionConfig
protectedEnv
supportEnv
protectedConfig
supportConfig
syncedFilePaths
```

AnyHarness service/API:

```text
anyharness/crates/anyharness-lib/src/api/http/agent_auth_config.rs
anyharness/crates/anyharness-lib/src/domains/agents/auth_config.rs
```

Endpoints:

```text
PUT /v1/agents/auth-config
GET /v1/agents/auth-config/status
```

Session launch integration:

```text
anyharness/crates/anyharness-lib/src/api/http/sessions.rs
anyharness/crates/anyharness-lib/src/sessions/runtime/creation.rs
anyharness/crates/anyharness-lib/src/sessions/runtime/startup.rs
anyharness/crates/anyharness-lib/src/sessions/service.rs
```

Launch overlay behavior:

- AnyHarness stores encrypted auth config and needs `ANYHARNESS_DATA_KEY`.
- Required external scope/revision fails closed if missing, stale, inactive,
  expired, or invalid.
- Protected env/config keys are allowlisted per agent.
- `supportEnv` cannot override protected keys.
- Launch overlay supports Claude, Codex, opencode, and Gemini.
- Codex gateway config writes managed `CODEX_HOME` config under runtime
  agent-auth state.

## Cloud Runtime Config / MCP / Skills Models

Runtime config:

```text
server/proliferate/db/models/cloud/runtime_config.py
  SandboxProfileRuntimeConfigRevision
  SandboxProfileRuntimeConfigCurrent
  SandboxProfileRuntimeConfigArtifact
```

MCP:

```text
server/proliferate/db/models/cloud/mcp.py
  CloudMcpConnection
  CloudMcpConnectionAuth
  OAuth flow/client tables
```

Skills/plugins:

```text
server/proliferate/db/models/cloud/skills.py
  CloudSkillConfiguredItem

server/proliferate/db/models/cloud/plugins.py
  CloudPluginConfiguredItem
```

Server APIs:

```text
server/proliferate/server/cloud/runtime_config/**
server/proliferate/server/cloud/mcp_catalog/**
server/proliferate/server/cloud/mcp_connections/**
server/proliferate/server/cloud/mcp_oauth/**
server/proliferate/server/cloud/skills/**
server/proliferate/server/cloud/plugins/**
```

Stores:

```text
server/proliferate/db/store/cloud_runtime_config/**
server/proliferate/db/store/cloud_mcp/**
server/proliferate/db/store/cloud_skills/**
server/proliferate/db/store/cloud_plugins/**
```

Worker materialization:

```text
anyharness/crates/proliferate-worker/src/materialization/agent_auth.rs
anyharness/crates/proliferate-worker/src/materialization/runtime_config.rs
anyharness/crates/proliferate-worker/src/materialization/env.rs
anyharness/crates/proliferate-worker/src/materialization/files.rs
anyharness/crates/proliferate-worker/src/materialization/git.rs
anyharness/crates/proliferate-worker/src/materialization/git_identity.rs
anyharness/crates/proliferate-worker/src/materialization/repo_checkout.rs
```

## AnyHarness Runtime Config

Contract:

```text
anyharness/crates/anyharness-contract/src/v1/runtime_config.rs
```

Important concepts:

```text
RuntimeConfigManifest
RuntimeConfigRevision
RuntimeConfigRevisionExpectation
RuntimeMcpServer
RuntimeMcpLaunch
RuntimeMcpValue
RuntimeSkill
RuntimeArtifactRef
RuntimeDirectAttachAuthConfig
```

AnyHarness service/API:

```text
anyharness/crates/anyharness-lib/src/api/http/runtime_config.rs
anyharness/crates/anyharness-lib/src/domains/runtime_config/service.rs
anyharness/crates/anyharness-lib/src/domains/runtime_config/session_extension.rs
```

Endpoints:

```text
PUT /v1/runtime-config
GET /v1/runtime-config
```

Runtime config rules:

- Inline secret literals are rejected.
- Artifact hash/size are validated.
- Credential refs are resolved at apply time.
- Credential values are memory-only where possible.
- Sessions bind to a runtime config snapshot.
- Running sessions keep their bound snapshot.
- Profile changes affect future launches/materializations.
- Runtime config session extension adds MCP servers and skill prompt/index context.

## MCP Assembly

Paths:

```text
anyharness/crates/anyharness-lib/src/sessions/mcp_bindings/assembly.rs
anyharness/crates/anyharness-lib/src/api/http/product_mcp.rs
anyharness/crates/anyharness-lib/src/domains/plugins/mcp/**
anyharness/crates/anyharness-lib/src/domains/plugins/skills.rs
```

Current invariant:

```text
normal launch MCPs = runtime config + session extensions + product MCP catalog
```

Legacy encrypted user MCP bindings still exist in code, but they are not the
normal launch source for this architecture.

Product MCP endpoint:

```text
/v1/workspaces/{workspace_id}/sessions/{session_id}/mcp/{product_mcp_slug}
```

Skills MCP:

```text
server name: proliferate_skills
tools:
  list_available_skills
  activate_skill
  get_skill_resource
```

## End-To-End Flow

1. User/admin configures credentials, MCP connections, skills, and plugins.
2. Cloud stores durable selected state on owner-scoped rows.
3. Cloud compiles profile runtime config revision and/or agent auth revision.
4. `SandboxProfileTargetState` records desired/current revision status per target.
5. Cloud queues `materialize_environment` or `refresh_agent_auth_config`.
6. Worker fetches materialization plan, artifacts, credentials, and fragments.
7. Worker applies runtime config:

```text
PUT /v1/runtime-config
```

8. Worker applies auth config:

```text
PUT /v1/agents/auth-config
```

9. Worker reports apply status back to Cloud.
10. Launch commands carry required runtime/auth revision expectations.
11. AnyHarness create/start fails closed if expected runtime/auth state is absent or stale.

## Launch Preflight

Cloud side:

- Stamp `sandboxProfileId`.
- Stamp `requiredAgentAuthRevision`.
- Stamp required runtime config revision/sequence/content hash.
- Check target state applied/current.
- Block/reject command if runtime config or auth is missing/stale.

Worker side:

- Materialize environment/auth before launch.
- Map runtime expectations into AnyHarness request.
- Include `agentAuthScope` for session start.

AnyHarness side:

- Validate expected runtime config against bound/current snapshot.
- Build auth launch overlay for the agent.
- Fail closed if external auth scope/revision is missing or stale.
- Bind session to runtime config snapshot.

## Important Invariants

- One sandbox profile root owns MCP/skill/plugin/auth config.
- Target applied state is tracked per profile-target.
- AnyHarness stores applied runtime/auth projections, not product policy.
- Product policy stays in Cloud/Desktop.
- Running sessions use their bound runtime config snapshot.
- Credential refs are materialized at apply time.
- Runtime config must not contain inline secrets.
- Product MCP calls require capability-token validation.
- Do not reintroduce parallel plugin-bundle or legacy MCP launch paths.

## Failure Modes

- `ANYHARNESS_DATA_KEY` missing: AnyHarness cannot encrypt/decrypt auth config.
- Required auth revision missing/stale/inactive/expired/invalid.
- Protected env misuse: support config tries to set protected agent keys.
- Bifrost/provider/router materialization error.
- Runtime config has inline secrets.
- Runtime config references missing credentials.
- Runtime config references missing artifacts.
- Artifact hash/size mismatch.
- Target state says runtime config or auth is not current.
- Skills MCP request references unknown skill/resource id.
- Debugger inspects old MCP ciphertext instead of runtime config session context.

## Debugging Entry Points

Agent auth:

```text
server/proliferate/server/cloud/agent_auth/**
server/proliferate/db/models/cloud/agent_auth.py
server/proliferate/db/store/cloud_agent_auth/**
server/proliferate/integrations/bifrost/**
anyharness/crates/anyharness-lib/src/domains/agents/auth_config.rs
anyharness/crates/anyharness-lib/src/api/http/agent_auth_config.rs
```

Runtime config / MCP / skills:

```text
server/proliferate/server/cloud/runtime_config/**
server/proliferate/server/cloud/mcp_catalog/**
server/proliferate/server/cloud/mcp_connections/**
server/proliferate/server/cloud/mcp_oauth/**
server/proliferate/server/cloud/plugins/**
server/proliferate/server/cloud/skills/**
server/proliferate/db/store/cloud_runtime_config/**
server/proliferate/db/store/cloud_mcp/**
server/proliferate/db/store/cloud_plugins/**
server/proliferate/db/store/cloud_skills/**
anyharness/crates/anyharness-lib/src/domains/runtime_config/**
anyharness/crates/anyharness-lib/src/sessions/mcp_bindings/assembly.rs
anyharness/crates/anyharness-lib/src/api/http/product_mcp.rs
anyharness/crates/proliferate-worker/src/materialization/**
```

Frontend:

```text
desktop/src/components/settings/panes/agent-authentication/**
desktop/src/hooks/settings/workflows/use-agent-auth-library-actions.ts
desktop/src/lib/domain/agent-auth/**
desktop/src/hooks/mcp/workflows/**
desktop/src/lib/domain/mcp/**
desktop/src/lib/domain/plugins/**
desktop/src/components/plugins/**
```

Tests:

```text
server/tests/unit/test_agent_auth_domain.py
server/tests/unit/test_agent_gateway_integrations.py
server/tests/e2e/agent_gateway/test_bifrost_live.py
```

## Review Questions

- What state is profile-scoped versus target-scoped?
- How does a selected MCP/skill become available to a session?
- Why does AnyHarness reject inline secrets in runtime config?
- What does `requiredAgentAuthRevision` protect against?
- Why are running sessions bound to a runtime config snapshot?
- What does the `proliferate_skills` MCP server do?
- Why should raw provider secrets not be passed directly to sessions?

