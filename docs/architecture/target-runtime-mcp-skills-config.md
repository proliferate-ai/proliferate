# Target Runtime MCP And Skills Config Spec

Status: proposed workstream 1 implementation spec

Date: 2026-05-17

## Purpose

This spec defines the workstream 1 target model for plugins, MCPs, skills,
target runtime config refresh, and lazy loading across Desktop, Cloud worker,
and AnyHarness.

The core change is:

```text
Plugin package        catalog/UX packaging only, owned by Desktop or Cloud
MCP server            runtime artifact/connection, understood by AnyHarness
Skill                 runtime artifact, understood by AnyHarness
Target runtime config durable target-level manifest in AnyHarness
```

AnyHarness should not receive a Desktop-shaped `SessionPluginBundle` at session
create or resume. It should receive and persist a target-scoped runtime
manifest containing flat MCP server and skill entries. AnyHarness then resolves
missing artifacts and credentials lazily through the caller that is already
allowed to talk to the relevant registry or credential store:

```text
Desktop local target      Desktop fills gaps
Cloud managed/SSH target  proliferate-worker fills gaps
AnyHarness                stores manifest, caches artifacts, holds credentials in memory
```

AnyHarness remains inbound-only. It never calls Proliferate Cloud directly.

## Docs Read For This Spec

This spec is cross-cutting, so the ownership lines below are aligned with:

- `docs/README.md`
- `docs/architecture/cloud-work-launch-model-spec.md`
- `docs/architecture/plugins-and-skills.md`
- `docs/anyharness/README.md`
- `docs/anyharness/contract.md`
- `docs/anyharness/guides/api.md`
- `docs/anyharness/guides/domains.md`
- `docs/anyharness/guides/integrations.md`
- `docs/anyharness/guides/live-runtime.md`
- `docs/anyharness/guides/persistence.md`
- `docs/anyharness/specs/mcp.md`
- `docs/server/README.md`
- `docs/server/guides/auth.md`
- `docs/server/guides/database.md`
- `docs/server/guides/domains.md`
- `docs/server/guides/workers.md`
- `docs/sdk/README.md`
- `docs/frontend/README.md`
- `docs/frontend/guides/access.md`
- `docs/frontend/guides/lib.md`

## Scope

In scope for workstream 1:

- Replace the runtime-facing session plugin bundle model with a flat target
  runtime config manifest.
- Add AnyHarness target runtime config persistence and refresh APIs.
- Add AnyHarness lazy resolution requests for missing artifacts and
  credentials.
- Move the skills MCP server from in-memory session bundle state to the target
  runtime manifest plus artifact cache.
- Extend Desktop and proliferate-worker so they push target runtime config and
  fulfill AnyHarness gap requests.
- Keep Cloud and Desktop as the only resolvers of plugin/package policy.

Out of scope for workstream 1:

- Public/team exposure policy and shared-sandbox UI. That is workstream 2.
- Shared mode, direct user auth to AnyHarness, and claiming. That is
  workstream 3.
- Hot-swapping MCP servers inside an already-running ACP actor. Workstream 1
  applies changes at launch/restart boundaries.
- A generic credential gateway. This model keeps direct MCP transport.

## Decisions

1. The runtime config scope is target-level, not session-level and not
   workspace-level.

   An AnyHarness process represents one target runtime. It should have one
   active MCP/skill manifest shared by every workspace and session in that
   target. Cloud may still have repo/workspace materialization records for
   env vars, files, setup scripts, and worktrees, but MCPs and skills are a
   target runtime concern.

2. Plugins do not cross the AnyHarness boundary.

   A plugin is a packaging and catalog concept. It can group one or more MCP
   server definitions, skill manifests, credential requirements, and UI
   metadata. Before data reaches AnyHarness, Desktop or Cloud flattens plugins
   into `mcpServers[]` and `skills[]`.

3. AnyHarness stores a durable manifest, not a full secret-bearing bundle.

   The manifest contains stable ids, versions, hashes, non-secret connection
   shape, and credential references. It does not persist bearer tokens, API
   keys, OAuth access tokens, stdio secret env values, or full skill bodies.

4. Artifacts and credentials have different storage rules.

   Artifacts are content-addressed by hash and may be cached on disk.
   Credentials are resolved by ref, cached only in memory, and expire by TTL or
   explicit refresh.

5. Refresh and lazy loading are separate.

   Refresh pushes the current manifest into AnyHarness. Lazy loading fills
   missing artifact or credential gaps for a manifest revision. Refresh may
   optionally warm artifacts, but correctness cannot depend on every artifact
   being present at refresh time.

6. AnyHarness never pulls from Cloud.

   AnyHarness creates resolution requests and exposes them to its caller.
   Desktop or proliferate-worker uses its own authority to fetch package
   artifacts or credentials, then fulfills the request back into AnyHarness.

7. Running sessions pick up changes at a launch boundary.

   A live actor keeps the MCP servers and skill index it launched with.
   Updating the target runtime config affects the next actor launch, restart,
   or explicit restart-required path. Hot remount can be a later feature.

## Current State To Replace

Today, the runtime path is session-scoped and Desktop-shaped:

- `anyharness-contract/src/v1/plugins.rs` defines `SessionPluginBundle`,
  `SessionPlugin`, and inline `SessionPluginSkill.instructions`.
- `CreateSessionRequest` and `ResumeSessionRequest` accept `pluginBundle`.
- `PluginBundleRegistry` stores bundles in memory by session id.
- `PluginSessionLaunchExtension` reads that registry, mounts plugin MCP
  servers, injects the skill index, and adds the `proliferate_skills` MCP
  server.
- `SkillsProductMcpServer` resolves its context from the same in-memory
  registry and serves inline skill instructions/resources.
- Desktop builds the bundle in
  `apps/desktop/src/lib/domain/plugins/session-plugin-bundle.ts` and sends it from
  session launch workflows.
- Cloud MCP materialization currently returns `pluginPackages` as a sidecar to
  MCP server materialization.

AnyHarness also persists per-session user MCP bindings as encrypted
`mcp_bindings_ciphertext`. That solves one old restart problem for user MCPs,
but it does not solve the new target model:

- it is session-scoped;
- it persists secret-bearing full MCP configs;
- it has no durable skill manifest equivalent;
- it keeps plugin packaging visible to AnyHarness.

There is already useful Cloud substrate:

- `cloud_target_configs` stores encrypted target materialization plans and
  queues `materialize_environment` commands.
- `TargetConfigMaterializationPlan` already has placeholder `mcp` and
  `skills` fields.
- proliferate-worker already fetches those plans, writes
  `.proliferate/mcp/materialization.json`, and writes skill refs.

Workstream 1 should extend that substrate. It should not invent a parallel
Cloud materialization system.

Managed cloud target cardinality is also transitional today:

- `CloudRuntimeEnvironment` is unique by user plus repo plus isolation policy
  for personal cloud environments.
- it has an `active_sandbox_id` and associated managed-cloud target, so the
  current system is closer to "one active sandbox per repo-scoped runtime
  environment" than "one universal cloud sandbox per user."
- org-scoped runtime environment indexes exist, but organization cloud
  workspaces are currently rejected as `org_cloud_not_ready`.

Workstream 2 can change the product cardinality for shared sandboxes. The
workstream 1 AnyHarness manifest should still be target-scoped so either
cardinality works.

## Target Object Model

### Cloud/Desktop Catalog Objects

These never cross into AnyHarness as runtime concepts:

```text
PluginPackage
  id
  version
  display metadata
  skill source refs
  MCP component refs
  credential requirements
  policy metadata
```

Cloud and Desktop use plugin packages to decide which flat runtime entries are
available. The output of that resolver is the target runtime config manifest.

### AnyHarness Runtime Objects

AnyHarness should own these concepts:

```text
TargetRuntimeConfig
  revision
  mcp_servers[]
  mcp_binding_summaries[]
  skills[]
  artifact_refs[]

RuntimeMcpServer
  stable id
  server name
  transport
  non-secret launch shape
  credential refs for secret values

RuntimeSkill
  stable id
  display name
  description
  version/source metadata
  instruction artifact hash/ref
  resource artifact hashes/refs
  required MCP server ids
  credential refs

RuntimeArtifact
  content hash
  content type
  byte size
  source ref
  local cache path after materialization

RuntimeCredential
  credential ref
  secret field values
  expires at
  in-memory only
```

The implementation names can evolve, but the runtime boundary should keep
these concepts distinct.

## Target Runtime Manifest

The manifest is the durable AnyHarness input. It should be OpenAPI-visible
contract state under `anyharness-contract/src/v1/`, with SDK types generated
from Rust.

Sketch:

```text
TargetRuntimeConfigRefreshRequest
  revision: TargetRuntimeConfigRevision
  mcpServers: RuntimeMcpServer[]
  mcpBindingSummaries: SessionMcpBindingSummary[]
  skills: RuntimeSkill[]
  artifacts: RuntimeArtifactRef[]
  source: desktop | worker | test

TargetRuntimeConfigRevision
  id: string              stable opaque revision id
  sequence: i64           monotonic per target when the caller has one
  generatedAt: string
  contentHash: string     hash of canonical manifest payload
  ownerScope: personal | organization | unknown
  externalTargetId?: string

RuntimeMcpServer
  id: string
  connectionId: string
  catalogEntryId?: string
  serverName: string
  transport: http | stdio
  launch: RuntimeMcpLaunch
  credentialRefs: RuntimeCredentialRef[]

RuntimeSkill
  id: string
  packageId?: string
  version?: string
  displayName: string
  description: string
  instructionArtifact: RuntimeArtifactRef
  resources: RuntimeSkillResource[]
  requiredMcpServerIds: string[]
  credentialRefs: string[]
```

Secret-bearing launch values must be typed as references, not plain strings:

```text
RuntimeMcpValue
  literal       non-secret string value
  credential   reference to a runtime credential field
```

Examples:

```text
HTTP Authorization header -> credential ref
stdio API_KEY env var     -> credential ref
MCP URL                   -> literal
stdio command path        -> literal
stdio args                -> literal unless explicitly credential refs
```

AnyHarness validation should reject obviously secret inline values in durable
manifest fields when the field is represented as a credential-capable value.

## AnyHarness Persistence

Add a new AnyHarness domain for target runtime config, following the
AnyHarness domain/store/service split.

Target placement:

```text
anyharness-lib/src/domains/runtime_config/
  model.rs
  store.rs
  service.rs
  artifact_cache.rs
  credentials.rs
  resolution.rs
```

SQLite durable state:

```text
runtime_config_current
  id                 singleton row or external target id
  revision_id
  revision_sequence
  content_hash
  manifest_json      redacted, no secret values
  applied_at
  source

runtime_artifact_cache
  artifact_hash
  content_type
  byte_size
  cache_path
  created_at
  last_used_at
```

In-memory state:

```text
credential_cache
  credential_ref -> values, expires_at, revision_id

pending_resolution_requests
  request_id -> request, status, waiters
```

Pending resolution requests can be in memory for v1. After an AnyHarness
process restart, they are recomputed from the durable manifest the next time a
session launch, MCP activation, or prefetch needs them.

## AnyHarness API Contract

Add target runtime config endpoints under `/v1`. Exact route names can change
during implementation, but the contract shape should be resource-oriented.

Proposed:

```text
GET /v1/runtime-config
  returns current redacted manifest, cache status, and pending gaps

PUT /v1/runtime-config
  validates and stores a new manifest revision
  idempotent by revision id/content hash
  returns applied revision and missing artifact summary

POST /v1/runtime-config/prefetch
  asks AnyHarness to create resolution requests for missing artifacts
  does not require credentials unless explicitly requested

GET /v1/runtime-config/resolution-requests
  lists pending artifact/credential requests

POST /v1/runtime-config/resolution-requests/{requestId}/resolve
  fulfills a request

POST /v1/runtime-config/resolution-requests/{requestId}/reject
  rejects a request with a typed reason
```

Resolution request variants:

```text
RuntimeArtifactRequest
  requestId
  revisionId
  artifactHash
  artifactRef
  kind: skill_instruction | skill_resource | package_metadata
  reason: missing | stale | prefetch

RuntimeCredentialRequest
  requestId
  revisionId
  credentialRefs[]
  mcpServerIds[]
  reason: missing | expired | refresh_requested
```

Artifact fulfillment accepts one of:

```text
contentBase64
localPath
```

AnyHarness validates `sha256` and `byteSize` before moving/copying into its
artifact cache. `localPath` is allowed because Desktop and proliferate-worker
run on the same target filesystem as AnyHarness. `contentBase64` is the
portable fallback.

Credential fulfillment accepts:

```text
credentialRef
values[]
expiresAt
redactedSummary
```

AnyHarness stores credential values only in memory. If the process restarts,
the next launch recomputes the missing credential request.

Launch-blocking API calls should fail with a typed problem detail that includes
the pending request ids when a required credential cannot be resolved
synchronously:

```text
code: RUNTIME_CONFIG_RESOLUTION_REQUIRED
resolutionRequestIds: [...]
```

That lets Desktop/worker fill gaps and retry without guessing.

If no caller is available to fulfill a launch-blocking credential request,
AnyHarness should fail closed with `RUNTIME_CONFIG_RESOLUTION_REQUIRED` rather
than silently launching without the MCP server. In Cloud-mediated flows the
worker is the caller; in Desktop-mediated local flows Desktop is the caller.
Direct bare requests to AnyHarness without either caller can retry after a
caller refreshes or fulfills the missing runtime config.

## Session Launch Assembly

Session launch remains the central place where MCP servers are assembled.
The existing `sessions/mcp_bindings/assembly.rs` path should evolve from
"per-session encrypted MCP bindings plus session extensions" to:

```text
SessionRuntime starts a session
  -> load workspace/session/agent
  -> read current TargetRuntimeConfig
  -> skip external target config if session policy is InternalOnly
  -> resolve required MCP credentials from memory
  -> create credential resolution requests if missing/expired
  -> build concrete ACP MCP server configs
  -> add product MCP servers through existing product MCP selection
  -> add proliferate_skills MCP server if runtime skills exist
  -> render skill index from RuntimeSkill metadata
  -> launch actor
```

This preserves the AnyHarness MCP spec invariant: one assembly boundary answers
which MCP servers and prompt additions should launch with a session.

The actor receives concrete launch config. The actor should not inspect plugin
packages, query artifact caches, or decide which MCPs are enabled.

## Skills MCP Flow

The `proliferate_skills` product MCP server should resolve from the current
target runtime config, not from a session plugin bundle.

Tool behavior:

```text
list_available_skills
  reads RuntimeSkill metadata only
  never needs artifact content

activate_skill
  checks instruction artifact cache
  if present, returns instructions plus resource metadata
  if missing, creates RuntimeArtifactRequest and waits for bounded fulfillment
  if not fulfilled, returns retryable tool error

get_skill_resource
  checks resource artifact cache
  if present, returns resource content
  if missing, creates RuntimeArtifactRequest and waits for bounded fulfillment
  if not fulfilled, returns retryable tool error
```

The bounded wait is important. It lets Desktop/worker satisfy normal misses
without making the agent manually retry every first skill activation, but it
does not hang a turn forever if no caller is available.

The skills MCP capability token can continue to be session-scoped, minted by
AnyHarness, and validated by the product MCP server. The context behind that
token changes from `SessionPluginBundle` to:

```text
workspace id
session id
target runtime config revision id observed at launch
```

Using the launch revision prevents a running actor from observing a different
skill set halfway through a turn.

## Refresh Flow

Refresh means "replace the target runtime manifest stored in AnyHarness."

Desktop refresh:

```text
User changes local MCP/skill/plugin toggles
  -> Desktop resolver flattens enabled plugins into MCPs + skills
  -> Desktop calls PUT /v1/runtime-config
  -> Desktop optionally prefetches artifacts
  -> Desktop watches resolution requests and fulfills local/cloud gaps
```

Cloud refresh:

```text
Cloud registry or target materialization changes
  -> Cloud stores/updates target runtime manifest inputs
  -> Cloud enqueues materialize_environment or runtime-config refresh command
  -> proliferate-worker fetches worker-authorized materialization plan
  -> worker materializes any filesystem artifacts it already has
  -> worker calls AnyHarness PUT /v1/runtime-config
  -> worker watches resolution requests and fulfills Cloud-authorized gaps
```

For v1, it is acceptable for the existing `materialize_environment` command to
carry the runtime manifest along with repo env/files. The important boundary is
that MCPs and skills are target-scoped once they reach AnyHarness. The existing
repo-scoped `cloud_target_configs` record can remain the command and encrypted
plan carrier, but it should not imply per-workspace MCP/skill state in
AnyHarness.

If a future Cloud path wants direct target runtime refresh without repo env
materialization, add a dedicated CloudCommand kind. That is an additive
optimization, not a prerequisite for workstream 1.

## Lazy Resolution Flow

The lazy resolution loop is the same for Desktop and worker:

```text
AnyHarness needs artifact or credential
  -> create RuntimeResolutionRequest
  -> return typed blocking error or emit/list pending request
  -> caller resolves from its authority
  -> caller fulfills request into AnyHarness
  -> AnyHarness validates and caches
  -> original operation retries or resumes
```

Caller responsibilities:

- Desktop resolves from local package cache, local native credential setup,
  and Cloud APIs it is already authenticated to call.
- proliferate-worker resolves from worker-authenticated Cloud endpoints and
  files/materialization plans already delivered to the target.
- Neither caller sends plugin package objects to AnyHarness.

AnyHarness responsibilities:

- never call Cloud;
- never persist credential secret values;
- validate artifact hashes before caching;
- dedupe concurrent requests for the same artifact hash or credential ref;
- expose typed redacted status so callers can debug misses.

## Cloud Server Responsibilities

Workstream 1 Cloud changes should follow server domain and DB guide rules:
API handlers stay thin, services orchestrate, stores own SQL, and worker routes
authenticate through worker auth.

Cloud should provide:

1. A resolver that turns selected catalog/plugin/MCP state into a flat target
   runtime manifest.

   Target location:

   ```text
   server/proliferate/server/cloud/target_config/service.py
   server/proliferate/server/cloud/target_config/domain/runtime_manifest.py
   ```

   If it grows beyond target config ownership, promote a
   `cloud/runtime_config/` subdomain. Do not put this in route handlers.

2. Worker-facing gap-fill endpoints.

   These endpoints should be worker-authenticated and target-scoped. They
   return only data the worker is authorized to materialize for that target.

   Sketch:

   ```text
   GET  /v1/cloud/worker/runtime-configs/{revisionId}/artifacts/{hash}
   POST /v1/cloud/worker/runtime-configs/{revisionId}/credentials/materialize
   ```

   Exact paths can reuse target-config ids if implementation needs that, but
   the API semantics should be "worker fills AnyHarness runtime config gaps",
   not "AnyHarness calls Cloud."

3. No public/team policy in workstream 1.

   Workstream 1 should support owner scope fields in the manifest so
   workstream 2 can add public org resolution without changing the AnyHarness
   contract again. The actual `public` flag, org-scoped MCP connection
   projection, duplicate-public-MCP policy, and shared sandbox UI are
   workstream 2.

## Worker Responsibilities

proliferate-worker should own target-side Cloud resolution because it already
has:

- worker identity;
- target id;
- Cloud command lease flow;
- AnyHarness bearer token;
- local filesystem access to the sandbox;
- materialization root knowledge.

Required worker changes:

- Extend `TargetConfigMaterializationPlan` with typed runtime manifest fields
  instead of opaque `mcp: Value` and `skills: Vec<Value>`.
- After materializing env/files/git, call AnyHarness `PUT /v1/runtime-config`.
- Add an AnyHarness resolution request loop or poll during command execution.
- Fulfill artifact requests from Cloud materialization endpoints or local
  files.
- Fulfill credential requests from Cloud worker endpoints.
- Report target config status as failed if required runtime config refresh
  cannot be applied.

The existing files are the right starting points:

```text
anyharness/crates/proliferate-worker/src/materialization/mod.rs
anyharness/crates/proliferate-worker/src/materialization/mcp.rs
anyharness/crates/proliferate-worker/src/materialization/skills.rs
anyharness/crates/proliferate-worker/src/cloud_client/target_config.rs
anyharness/crates/proliferate-worker/src/anyharness_client/
anyharness/crates/proliferate-worker/src/commands/dispatcher.rs
```

## Desktop Responsibilities

Desktop should stop building `SessionPluginBundle` for session create/resume.
Instead:

- plugin/MCP UI state changes trigger a target runtime config refresh;
- local stdio candidate finalization feeds the target runtime manifest;
- Desktop watches/list-polls AnyHarness resolution requests while it is the
  active local caller;
- session create/resume sends no plugin bundle and no full MCP list after the
  migration bridge is removed.

Ownership should follow the frontend guides:

```text
lib/domain/plugins/**        pure flattening/package decisions
lib/workflows/mcp/**         non-React refresh/gap-fill workflows
lib/access/anyharness/**     raw runtime config endpoint calls only if SDK lacks them
hooks/access/...             React Query wrappers for Cloud/Tauri resources
product hooks                call workflows with explicit deps
```

## AnyHarness Auth Boundary

Workstream 1 does not solve shared-mode user auth or claiming.

For now:

- local/Desktop targets use the existing selected-runtime connection model;
- Cloud worker uses the existing AnyHarness bearer token;
- product MCP capability tokens remain scoped to workspace/session/tool
  surfaces;
- resolution request fulfillment is protected by the same AnyHarness bearer
  boundary as other `/v1` routes.

Workstream 3 will add shared mode and claiming. The workstream 1 contract
should not assume that every human user can call AnyHarness directly.

## Implementation Plan

Implement workstream 1 as one PR. The PR can be developed in ordered internal
slices, but it should land as one coherent change so the repo does not carry
duplicate runtime/plugin models across review boundaries.

### Slice 1: AnyHarness Contract And Store

- Add `runtime_config` contract types.
- Add `/v1/runtime-config` endpoints.
- Add `domains/runtime_config` model/store/service.
- Persist redacted target runtime manifest.
- Add artifact cache and in-memory credential cache.
- Add resolution request model and fulfillment endpoints.
- Generate AnyHarness SDK artifacts.

Verification:

```bash
cargo test -p anyharness-lib runtime_config
cd anyharness/sdk && pnpm run generate && pnpm run build
```

### Slice 2: AnyHarness Session And Skills Integration

- Teach session MCP assembly to read `TargetRuntimeConfig`.
- Convert runtime MCP manifest entries into concrete ACP MCP servers.
- Create credential resolution requests on missing/expired credentials.
- Move `proliferate_skills` from `PluginBundleRegistry` to runtime config.
- Resolve skill instructions/resources from artifact cache.
- Keep a temporary in-PR compatibility bridge for `pluginBundle` only while the
  Desktop slice is being updated.

Verification:

```bash
cargo test -p anyharness-lib mcp
cargo test -p anyharness-lib plugins
```

The end state should delete `PluginBundleRegistry`, the plugin launch
extension, and session bundle validation once Desktop no longer sends the old
shape.

### Slice 3: Cloud Target Runtime Manifest

- Replace opaque target-config `mcp`/`skills` values with typed runtime
  manifest models.
- Generate flat manifest entries from current MCP materialization plus plugin
  package skill refs.
- Add worker-facing artifact and credential materialization endpoints.
- Keep public/shared policy out of this PR.

Verification:

```bash
cd server && uv run pytest -q tests/cloud/test_target_config.py
cd server && uv run pytest -q tests/cloud/test_mcp_materialization.py
```

### Slice 4: Worker Refresh And Gap Fill

- Parse typed runtime manifest fields.
- Call AnyHarness runtime config refresh after materialization.
- Poll or process AnyHarness resolution requests.
- Fulfill artifacts and credentials via Cloud worker endpoints.
- Fail materialization when required refresh or required credentials cannot be
  applied.

Verification:

```bash
cargo test -p proliferate-worker materialization
cargo test -p proliferate-worker anyharness_client
```

### Slice 5: Desktop Refresh And Gap Fill

- Replace session-launch plugin bundle assembly with target runtime config
  refresh.
- Keep pure plugin flattening under `lib/domain/plugins/**`.
- Put refresh/gap-fill workflows under `lib/workflows/mcp/**` or a tighter
  runtime-config workflow folder.
- Stop sending `pluginBundle` on create/resume once compatibility is no longer
  needed.

Verification:

```bash
cd apps/desktop && pnpm test session-mcp-launch
cd apps/desktop && pnpm test session-runtime
```

### Slice 6: Remove Legacy Runtime Plugin Boundary

- Remove `SessionPluginBundle` from create/resume request handling.
- Remove `PluginBundleRegistry`.
- Remove the plugin session launch extension.
- Remove inline skill body runtime handling.
- Keep Cloud/Desktop plugin catalog objects because those remain product
  packaging.

Verification:

```bash
cargo test
cd anyharness/sdk && pnpm run build
```

## Backward Compatibility

During migration, AnyHarness may temporarily accept both:

```text
legacy session pluginBundle
new target runtime config
```

Rules for the bridge:

- New target runtime config wins when present.
- Legacy `pluginBundle` is translated at the API boundary or rejected with a
  clear compatibility error. Do not pass `SessionPluginBundle` deeper into new
  runtime config services.
- The bridge is an in-PR scaffolding step only. The final PR state should not
  leave duplicate runtime paths permanently unless review explicitly chooses a
  staged compatibility window.

## Security Rules

- Durable AnyHarness manifest state must be redacted.
- Credential values are memory-only and TTL-bound.
- Artifact content is hash-validated before caching.
- `SessionMcpBindingSummary` remains redacted: no URLs, headers, env values,
  command args, absolute paths, raw tokens, or raw error strings.
- Cloud worker gap-fill endpoints must authenticate worker identity and target
  authorization.
- AnyHarness resolution request status must expose refs and redacted labels,
  not secret values.

## Relationship To Workstream 2

Workstream 2 will decide and implement:

- `public` flags or org-visible projections for MCP connections and skills;
- shared sandbox target config resolution;
- admin UI for shared sandbox MCPs/skills;
- duplicate publicized MCP resolution policy;
- public skill/plugin curation visibility;
- whether shared sandbox MCP/skill refresh is automatic on every publication
  change or gated behind admin apply.

Workstream 1 should make this easy by accepting `ownerScope`,
`externalTargetId`, stable runtime ids, and flat manifests. It should not embed
personal-only assumptions in AnyHarness.

## Relationship To Workstream 3

Workstream 3 will decide and implement:

- AnyHarness shared mode;
- worker-only pre-claim access;
- claim grants;
- user/session/target authorization in AnyHarness;
- direct Desktop attach to a shared target after claim.

Workstream 1 should keep using existing bearer auth and should not add
human-user policy checks to runtime config endpoints yet.

## Open Implementation Choices

These are implementation choices, not product-domain blockers:

- Whether the Cloud command kind remains `materialize_environment` for v1 or a
  new `refresh_runtime_config` command is added immediately.
- Whether AnyHarness resolution request delivery is initially polling-only or
  also exposed through SSE.
- Whether artifact fulfillment prefers local path or base64 in each caller.
- Whether skill activation waits 5 seconds, 10 seconds, or uses a configurable
  timeout before returning a retryable tool error.

The model is decided enough to write code: target-scoped flat manifest, plugin
as packaging only, artifacts on disk by hash, credentials in memory by ref,
caller-filled gaps, no AnyHarness-to-Cloud pull.
