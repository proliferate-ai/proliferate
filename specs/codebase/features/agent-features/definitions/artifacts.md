# Artifacts MCP

Status: authoritative target definition for the Artifacts product MCP.

Artifacts are user-visible outputs created by agents and rendered by
Proliferate. Today they are implemented as **cowork artifacts**. The target is
to promote the generic artifact lifecycle into an `artifacts` product domain
and expose it through a reusable product MCP.

## Identity

```text
id: artifacts
owner domain: domains/artifacts
target implementation: anyharness-lib/src/domains/artifacts/mcp/**
current implementation: anyharness-lib/src/domains/cowork/mcp/** artifact tools
visibility: user_selectable
route slug: artifacts
server name: proliferate-artifacts
default injection: attach when artifact capability is enabled for the session,
  workspace, automation, cowork thread, or team policy
```

Current reality:

```text
Artifacts are file-backed objects inside cowork worktree workspaces.
The manifest is .proliferate/artifacts.json.
There is no artifact database table.
The generic manifest, lifecycle, runtime, and protection code lives under
domains/artifacts.
The cowork MCP exposes artifact tools today.
Desktop reads artifacts through normal HTTP endpoints, not through MCP.
```

Target reality:

```text
Artifacts own the generic lifecycle as their own domain.
Cowork becomes one consumer of artifacts.
Artifact tools move from cowork MCP to artifacts MCP.
Artifact lifecycle remains manifest/file-backed unless a separate storage
change is explicitly designed.
```

## Current Code Map

Current artifact lifecycle:

```text
anyharness-lib/src/domains/artifacts/model.rs
  Artifact type, summary/detail read models, create/update inputs, and errors

anyharness-lib/src/domains/artifacts/manifest.rs
  Artifact manifest schema
  .proliferate/artifacts.json constant
  manifest parse/validate/load
  artifact path validation
  artifact type derivation from file extension
  manifest entry enrichment into contract summaries

anyharness-lib/src/domains/artifacts/service.rs
  durable manifest/file-backed lifecycle rules
  create/update plan construction
  normalized manifest/detail read models

anyharness-lib/src/domains/artifacts/runtime.rs
  ArtifactRuntime
  create_artifact
  update_artifact
  delete_artifact
  get_manifest
  get_artifact
  per-workspace artifact locks
  temp-file commit/rollback helpers

anyharness-lib/src/domains/artifacts/protection.rs
  ArtifactProtectionService
  protected artifact manifest path checks
  protected artifact-backed path checks

anyharness-lib/src/domains/cowork/manifest.rs
  CoworkArtifact* compatibility re-exports

anyharness-lib/src/domains/cowork/artifacts.rs
  CoworkArtifactRuntime compatibility wrapper
  cowork workspace-scope check before delegating to ArtifactRuntime

anyharness-lib/src/domains/cowork/mcp/tools.rs
  artifact MCP tool definitions
  cowork delegation tool definitions
  current server instructions

anyharness-lib/src/domains/cowork/mcp/calls.rs
  tools/call implementation for create/update/delete/list/get artifact tools,
    delegated through CoworkArtifactRuntime to ArtifactRuntime
  cowork delegation tools in the same file

anyharness-lib/src/domains/cowork/mcp/mod.rs
  cowork ProductMcpServer implementation
  workspace delegation gating

anyharness-lib/src/domains/cowork/mcp/auth.rs
  cowork MCP capability token wrapper
```

Current injection and prompt text:

```text
anyharness-lib/src/domains/sessions/mcp_bindings/product_catalog.rs
  cowork MCP selection for cowork-surface sessions
  cowork artifact system prompt append
  cowork binding summary
  cowork HTTP MCP server config
  cowork product capability-token minting
```

Current app wiring:

```text
anyharness-lib/src/app/mod.rs
  AppState.artifact_runtime
  AppState.cowork_artifact_runtime
  CoworkArtifactRuntime wrapping ArtifactRuntime for compatibility
  WorkspaceFileProtectionRegistry receives ArtifactProtectionService for write
    protection
```

Current HTTP read APIs:

```text
anyharness-lib/src/api/router.rs
  GET /v1/workspaces/{workspace_id}/cowork/manifest
  GET /v1/workspaces/{workspace_id}/cowork/artifacts/{artifact_id}
  GET/POST /v1/workspaces/{workspace_id}/sessions/{session_id}/mcp/cowork
    fresh cowork product MCP route
  GET/POST /v1/workspaces/{workspace_id}/cowork/sessions/{session_id}/mcp
    legacy cowork MCP compatibility alias for already-launched sessions

anyharness-lib/src/api/http/cowork.rs
  get_cowork_manifest
  get_cowork_artifact
  cowork artifact error mapping

anyharness-lib/src/api/http/product_mcp.rs
  cowork legacy MCP endpoint wrapper
  shared product MCP endpoint dispatch
```

Current file-write protection:

```text
anyharness-lib/src/domains/workspaces/files_runtime.rs
  blocks generic file writes/creates/renames/deletes for cowork artifact
  manifest paths and artifact-backed paths

anyharness-lib/src/adapters/files/service.rs
  generic file operations and FileServiceError::ProtectedPath
```

Current contract types:

```text
anyharness-contract/src/v1/**
  CoworkArtifactType
  CoworkArtifactSummary
  CoworkArtifactManifestResponse
  CoworkArtifactDetailResponse
```

Related current doc:

```text
specs/codebase/features/cowork-artifacts.md
  current cowork artifact behavior
```

## Target Code Map

Target artifact domain:

```text
anyharness-lib/src/domains/artifacts/
  mod.rs
  model.rs
  manifest.rs
  service.rs
  runtime.rs
  protection.rs
  mcp/
    mod.rs
    definition.rs
    auth.rs
    context.rs
    tools.rs
    calls.rs
```

Target responsibilities:

```text
model.rs
  ArtifactId
  ArtifactNamespace
  ArtifactAccessMode
  ArtifactType
  ArtifactSummary
  ArtifactDetail
  create/update/delete input structs
  domain errors

manifest.rs
  .proliferate/artifacts.json schema
  manifest version
  manifest parse/validate/load/write helpers
  artifact type derivation
  relative artifact path validation

service.rs
  pure durable artifact lifecycle rules over the manifest/file-backed store
  create/update/delete/list/read operations
  path immutability
  id stability
  read/write permission checks

runtime.rs
  target/workspace-aware artifact orchestration
  blocking file IO boundaries
  per-workspace locks
  temp-file commit/rollback
  integration with workspace records

protection.rs
  checks used by workspace file operations to prevent generic writes to
  artifact manifests or artifact-backed paths

mcp/definition.rs
  product MCP metadata and prompt policy

mcp/auth.rs
  artifacts capability-token scope

mcp/context.rs
  workspace/session/namespace/access-mode resolution

mcp/tools.rs
  MCP tools/list definitions

mcp/calls.rs
  MCP tools/call implementation delegating to artifacts runtime/service
```

Target API paths:

```text
GET  /v1/workspaces/{workspace_id}/artifacts/manifest
GET  /v1/workspaces/{workspace_id}/artifacts/{artifact_id}
POST /v1/workspaces/{workspace_id}/sessions/{session_id}/mcp/artifacts
GET  /v1/workspaces/{workspace_id}/sessions/{session_id}/mcp/artifacts
```

The old cowork paths may be compatibility aliases during migration, but new
artifact behavior should not be added to cowork-specific routes.

Target AppState wiring:

```text
AppState.artifact_runtime: Arc<ArtifactRuntime>
WorkspaceFilesRuntime receives ArtifactRuntime or ArtifactProtectionService
CoworkRuntime depends on ArtifactRuntime only when cowork needs artifacts
```

## Manifest Contract

Path:

```text
.proliferate/artifacts.json
```

Current/target shape:

```json
{
  "version": 1,
  "artifacts": {
    "art_a3f1b2c4": {
      "id": "art_a3f1b2c4",
      "path": "reports/plan.md",
      "type": "text/markdown",
      "title": "Plan",
      "description": "Optional description",
      "createdAt": "2026-04-10T14:23:00Z",
      "updatedAt": "2026-04-10T14:35:00Z"
    }
  }
}
```

Rules:

- `version` is required and must be `1`.
- `artifacts` is keyed by stable artifact id.
- artifact ids are generated by the artifact lifecycle layer.
- `path` is workspace-relative.
- `path` is immutable after create.
- `path` must not be absolute.
- `path` must not contain `..` escapes.
- `path` must not point into `.proliferate/`.
- `type` is derived from extension, never caller supplied.
- manifest entries must not duplicate paths.
- the manifest and artifact file updates must be committed together or rolled
  back as a unit as much as filesystem semantics allow.

Supported v1 types:

```text
.md           -> text/markdown
.html         -> text/html
.svg          -> image/svg+xml
.jsx, .tsx    -> application/vnd.proliferate.react
```

Out of scope unless separately designed:

- binary blobs
- multi-file artifact bundles
- artifact rename/move
- artifact version browsing outside git history
- artifact publishing/sharing
- artifact-initiated tool calls

## Auth

Current fresh auth while artifact tools live under the cowork product MCP:

```text
header: x-anyharness-product-mcp-token
secret file: cowork-mcp-token.key
ttl: 12 hours
scope: workspace_id + session_id + product_mcp_id: cowork
signature: hmac_sha256
route: /v1/workspaces/{workspace_id}/sessions/{session_id}/mcp/cowork
```

Current legacy auth accepted only for already-launched cowork sessions:

```text
header: x-cowork-session-token
secret file: cowork-mcp-token.key
ttl: 12 hours
scope: workspace_id + session_id
signature: legacy sha256-dot
route: /v1/workspaces/{workspace_id}/cowork/sessions/{session_id}/mcp
```

Target artifact auth:

```text
header: x-anyharness-product-mcp-token
secret file: product-mcp-token.key or artifacts-mcp-token.key
ttl: 12 hours unless the shared product MCP policy changes it
scope:
  workspace_id
  session_id
  product_mcp_id: artifacts
  artifact_namespace
  access_mode: read | read_write
```

Read-only artifact contexts must be able to list/read but must reject create,
update, and delete.

## Selection And Injection

Attach when:

- a cowork thread requires artifacts
- a session explicitly enables artifact tools
- a workspace/team/org policy enables artifact tools
- an automation template requests artifact tools
- the target compute can persist/read artifact files

Do not attach when:

- the session has no artifact namespace
- artifact writes are disabled and the MCP would expose write tools
- the workspace cannot support artifact backing files
- policy disables artifact creation for the session

Injection output:

```text
url: /v1/workspaces/{workspace_id}/sessions/{session_id}/mcp/artifacts
headers:
  authorization: Bearer <runtime token> when runtime auth is enabled
  x-anyharness-product-mcp-token: scoped artifact token
binding summary:
  productMcpId: artifacts
  namespace: <artifact namespace>
  accessMode: read | read_write
prompt text:
  use artifact tools for user-visible artifacts
  never edit .proliferate/artifacts.json directly
  do not use generic file writes on artifact-backed paths
  normal file tools are allowed for supporting non-artifact files
  JSX/TSX artifacts must follow the rendering contract
```

Cowork should contribute artifact selection policy when a cowork thread needs
artifact tools. It should not own the generic artifact MCP implementation.

## Context

`mcp/context.rs` resolves:

- workspace id
- session id
- workspace record
- session record
- artifact namespace
- access mode
- backing workspace root
- target compute artifact capability
- optional cowork thread context when selected by cowork

The context type should be explicit:

```text
ArtifactMcpContext {
  workspace,
  session,
  namespace,
  access_mode,
  backing_root,
  source,
}
```

`source` examples:

```text
cowork_thread
user_selected_session
workspace_policy
team_policy
automation_policy
```

The artifact domain may know that a context came from cowork, but generic
artifact behavior must not depend on cowork-only state unless the context
explicitly requires it.

## Tools

Initial tools:

```text
create_artifact
  path: string
  content: string
  title: string
  description?: string

update_artifact
  id: string
  content?: string
  title?: string
  description?: string

delete_artifact
  id: string

list_artifacts
  no arguments

get_artifact
  id: string
```

Read-only contexts expose only:

```text
list_artifacts
get_artifact
```

Read-write contexts expose all tools.

Tool names remain generic because the MCP id scopes them. With MCP namespacing,
agents should see names like:

```text
mcp__artifacts__create_artifact
mcp__artifacts__update_artifact
```

## Calls

`mcp/calls.rs` delegates to `ArtifactRuntime` / `ArtifactService`.

Required call behavior:

```text
create_artifact
  validate read_write access
  validate path
  derive type from path
  reject duplicate manifest path
  generate stable art_<uuid> id
  write content temp file
  write manifest temp file
  commit both
  return ArtifactSummary

update_artifact
  validate read_write access
  find artifact by id
  keep path immutable
  update content/title/description only
  bump updatedAt
  commit content/manifest with rollback
  return ArtifactSummary

delete_artifact
  validate read_write access
  remove manifest entry
  delete file if present
  commit manifest with rollback
  return id + deleted true

list_artifacts
  load manifest or empty
  validate entries
  enrich summaries from filesystem metadata
  sort updatedAt desc

get_artifact
  load manifest
  validate id exists
  validate backing file exists
  read text content
  return ArtifactDetail
```

Required invariants:

- generic file write/edit/delete cannot mutate `.proliferate/artifacts.json`.
- generic file write/edit/delete cannot mutate artifact-backed paths.
- artifact paths are immutable in v1.
- artifact ids remain stable.
- manifest type is derived from path extension.
- unsupported file extensions are rejected.
- all paths stay inside workspace root.
- read-only contexts cannot call write tools.
- cowork-specific workflow logic must not be added to generic artifact calls.

## File Protection Integration

Current protection path:

```text
domains/workspaces/files_runtime.rs
  owns WorkspaceFileProtection and WorkspaceFileProtectionRegistry
  asks registered file-protection participants about protected paths
  returns FileServiceError::ProtectedPath

domains/artifacts/protection.rs
  ArtifactProtectionService::is_protected_relative_path(...)
  ArtifactProtectionService::is_protected_relative_path_or_ancestor(...)
  implements WorkspaceFileProtection for current artifact-backed surfaces
```

Protection must cover:

- `.proliferate/artifacts.json`
- ancestors of the manifest path when deleting/renaming directories
- artifact-backed files
- ancestors of artifact-backed files when deleting/renaming directories

## HTTP Read API

Current HTTP read API:

```text
GET /v1/workspaces/{workspace_id}/cowork/manifest
GET /v1/workspaces/{workspace_id}/cowork/artifacts/{artifact_id}
```

Target HTTP read API:

```text
GET /v1/workspaces/{workspace_id}/artifacts/manifest
GET /v1/workspaces/{workspace_id}/artifacts/{artifact_id}
```

These routes are for clients such as desktop/web/mobile. Agents should use the
MCP tools. Desktop should not call MCP directly for artifact rendering.

## UI Exposure

Artifacts are user-selectable when used outside internal cowork flows.

UI should expose:

- artifact capability enabled/disabled state
- read vs read-write mode
- artifact namespace
- warning that write access lets agents create/update/delete artifact files
- attached MCP binding summary
- rendered artifact list/detail through artifact HTTP APIs

UI should not expose:

- capability token values
- raw MCP headers
- manifest editing

## Tests

Domain tests:

- manifest rejects invalid version
- manifest rejects absolute paths
- manifest rejects `..` escapes
- manifest rejects `.proliferate/**`
- type derives from `.md`, `.html`, `.svg`, `.jsx`, `.tsx`
- duplicate paths are rejected
- create writes file and manifest
- create rolls back file if manifest commit fails
- update preserves path and id
- delete is idempotent
- list sorts by `updatedAt desc`

Protection tests:

- manifest path is protected
- manifest ancestor is protected
- artifact path is protected
- artifact ancestor is protected
- sibling prefix is not protected

MCP tests:

- read-only context exposes only list/get
- read-write context exposes all tools
- token rejects wrong workspace/session/namespace/access mode
- create/update/delete reject read-only access
- tool calls delegate to artifact runtime/service
- cowork can select artifacts without owning artifact tool calls

API tests:

- artifact manifest route returns manifest response
- artifact detail route returns content and summary
- missing artifact maps to 404
- invalid manifest maps to 409

## Acceptance

Done when:

- generic artifact lifecycle is no longer owned by
  `domains/cowork/artifacts.rs`.
- generic artifact manifest logic is no longer owned by
  `domains/cowork/manifest.rs`.
- generic artifact MCP tools are no longer owned by
  `domains/cowork/mcp/**`.
- `domains/artifacts/**` owns artifact model, manifest, service/runtime,
  protection, and MCP behavior.
- cowork delegates to artifacts when it needs artifact tools.
- `WorkspaceFilesRuntime` depends on artifact protection, not cowork artifact
  runtime.
- artifact MCP is selectable/injectable through
  `domains/sessions/mcp_bindings/**`.
- shared JSON-RPC dispatch lives in `integrations/mcp/product_server/**`.
- desktop/web/mobile artifact reads can use artifact HTTP routes instead of
  cowork-specific routes.
