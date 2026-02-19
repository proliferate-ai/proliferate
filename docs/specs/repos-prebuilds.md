# Repos & Prebuilds — System Spec

## 1. Scope & Purpose

### In Scope
- Repo CRUD, search (public GitHub), and available repos (via integration)
- Repo connections (binding repos to GitHub integrations)
- Prebuild CRUD (manual, managed, and CLI types)
- Prebuild-repo associations (many-to-many via `prebuild_repos`)
- Effective service commands resolution (prebuild overrides > repo defaults)
- Legacy prebuild-level connector persistence for gateway-mediated MCP action sources (transitional; migrating to org scope)
- Base snapshot build worker (queue, deduplication, status tracking)
- Configuration snapshot build worker (GitHub token hierarchy, multi-repo cloning)
- Prebuild resolver (resolves prebuild at session start)
- Service commands persistence (JSONB on both repos and prebuilds)
- Env file persistence (JSONB on prebuilds)
- Base snapshot status tracking (building/ready/failed)
- Configuration snapshot status tracking (building/default/ready/failed on configurations table)
- Setup session finalization (snapshot capture + prebuild creation/update)

### Out of Scope
- Snapshot resolution logic (which layer to use at boot) — see `sandbox-providers.md` §6.5
- Session creation that uses prebuilds — see `sessions-gateway.md` §6.1
- Secret values, bundles, and encryption — see `secrets-environment.md`
- Integration OAuth lifecycle — see `integrations.md`
- Org-scoped connector catalog lifecycle and management UI — see `integrations.md`
- Sandbox boot sequence that consumes service commands/env files — see `sandbox-providers.md` §6.4

### Mental Model

**Repos** are org-scoped references to GitHub repositories (or local directories for CLI). They carry metadata (URL, default branch, detected stack) and optional repo-level service commands. Each repo can be linked to one or more GitHub integrations via **repo connections**, which provide the authentication tokens needed for private repo access.

**Prebuilds** group one or more repos (via `prebuild_repos` junction), carry a snapshot ID (saved filesystem state), and store per-prebuild service commands and env file specs. There are three prebuild types: `manual` (user-created), `managed` (auto-created for Slack/universal clients), and CLI (device-scoped via `localPathHash`).

Connector configuration currently exists on prebuilds as a legacy transitional model, consumed by the gateway Actions path (not direct sandbox-native invocation). Planned direction is org-scoped connector catalog ownership in `integrations.md`.

**Snapshots** are pre-built filesystem states at three layers: base (OpenCode + services, no repo), configuration (base + all configuration repos cloned), and finalized (full working state after user setup). This spec owns the *build* side — the workers that create base and configuration snapshots. The *resolution* side (picking which layer to use) belongs to `sandbox-providers.md`.

**Core entities:**
- **Repo** — an org-scoped GitHub repository reference. Lifecycle: create → configure → delete. Every new repo gets an auto-created single-repo configuration via `createRepoWithConfiguration()`.
- **Prebuild** — a reusable snapshot + metadata record linking one or more repos. Lifecycle: building → default → ready/failed.
- **Base snapshot** — a pre-baked sandbox state with OpenCode + services installed, no repo (Layer 1). Built by the base snapshot worker, tracked in `sandbox_base_snapshots`.
- **Configuration snapshot** — a base snapshot + all configuration repos cloned (Layer 2). Built by the configuration snapshot worker, tracked on the `configurations` table (`snapshot_id`, `status`, `error`). Status lifecycle: `"building"` → `"default"` (auto-built) or `"failed"`. User finalization: `"default"` → `"ready"`.

**Key invariants:**
- On the happy path, a prebuild has at least one repo via `prebuild_repos`. Exceptions: CLI prebuild creation treats the repo link as non-fatal (`prebuild-resolver.ts:272`) — a prebuild can briefly exist without `prebuild_repos` if the upsert fails. Setup finalization derives `workspacePath` from `githubRepoName` (e.g., `"org/app"` → `"app"`), not `"."` (`configurations-finalize.ts:166`). The standard service path (`createPrebuild`) uses `"."` for single-repo and repo name for multi-repo.
- Base snapshot deduplication is keyed on `(versionKey, provider, modalAppName)`. Only one build runs per combination.
- Configuration snapshot builds are Modal-only. E2B sessions skip this layer.
- Configuration creation is tightly coupled to snapshot building — `createConfiguration()` always enqueues a snapshot build job via `requestConfigurationSnapshotBuild()`. Any future code creating a configuration with `status: "building"` must also trigger snapshot building.
- Service commands resolution follows a clear precedence: prebuild-level overrides win; if empty, per-repo defaults are merged with workspace context.

---

## 2. Core Concepts

### Prebuild Types
Three types determine how a prebuild is created and scoped: `manual` (user-created via UI, explicit repo selection), `managed` (auto-created for Slack/universal clients, includes all org repos or specific subset), `cli` (device-scoped, identified by `userId` + `localPathHash`). The `type` column stores these as `"manual"`, `"managed"`, or `"cli"`. CLI prebuilds are created with `status: "pending"` (`packages/services/src/cli/db.ts:558`), while manual/managed start as `"building"`.
- Key detail agents get wrong: Managed prebuilds use `type = "managed"` in the DB, not a flag. The resolver checks this type to find existing managed prebuilds before creating new ones.
- Reference: `packages/db/src/schema/prebuilds.ts`, `apps/gateway/src/lib/prebuild-resolver.ts`

### Workspace Path
Determines where each repo is cloned inside the sandbox. Single-repo prebuilds always use `"."` (repo is the workspace root). Multi-repo prebuilds derive the path from the last segment of `githubRepoName` (e.g., `"org/my-app"` → `"my-app"`).
- Key detail agents get wrong: Workspace path is set at prebuild creation time, not dynamically. Changing it requires recreating the `prebuild_repos` entry.
- Reference: `packages/services/src/prebuilds/service.ts:createPrebuild`

### Snapshot Version Key
A SHA-256 hash of `PLUGIN_MJS` + `DEFAULT_CADDYFILE` + `getOpencodeConfig(defaultModelId)` + `SANDBOX_IMAGE_VERSION` (fallback `"v1.0.0"`). When this changes, the base snapshot is stale and must be rebuilt. Computed by `computeBaseSnapshotVersionKey()`.
- Key detail agents get wrong: The version key includes both source constants and an explicit runtime cache-buster. Changing `PLUGIN_MJS`, the Caddyfile template, OpenCode config, or `SANDBOX_IMAGE_VERSION` triggers a rebuild.
- Reference: `packages/shared/src/sandbox/version-key.ts`

### Prebuild Connector Config (Deprecated — Migrated to Org Scope)
Connector-backed tool access has been migrated from prebuild-scoped JSONB (`prebuilds.connectors`) to org-scoped relational storage (`org_connectors` table). The gateway now loads connectors by organization, not by prebuild. Legacy JSONB columns remain in the schema for data preservation but are no longer read at runtime.
- Key detail agents get wrong: connector CRUD and management UI are now in `integrations.md` scope. The prebuild router no longer has connector routes.
- Key detail agents get wrong: the backfill migration (`0022_org_connectors.sql`) copied prebuild connectors to `org_connectors`, deduplicating by `(organization_id, url, name)`.
- Reference: `docs/specs/integrations.md`, `packages/services/src/connectors/`

### GitHub Token Hierarchy
Configuration snapshot builds resolve GitHub tokens per-repo with a two-level hierarchy: (1) repo-linked integration connections (prefer GitHub App installation, fall back to Nango OAuth), (2) org-wide GitHub integration. Private repos without a token cause the build to fail.
- Key detail agents get wrong: The token resolution in the snapshot worker is independent from the session-time token resolution in the gateway. They follow the same hierarchy but are separate code paths.
- Reference: `apps/worker/src/github-token.ts:resolveGitHubToken`

---

## 3. File Tree

```
apps/web/src/server/routers/
├── repos.ts                         # Repo oRPC routes (list/get/create/delete/search/available/finalize)
├── configurations-finalize.ts       # Setup session finalization (snapshot + configuration update/create)
└── prebuilds.ts                     # Prebuild oRPC routes (list/create/update/delete/service-commands)

apps/web/src/components/coding-session/
└── settings-panel.tsx               # Settings panel (Info, Snapshots, Auto-start tabs)

apps/worker/src/
├── base-snapshots/
│   └── index.ts                     # Base snapshot build worker + startup enqueue
├── configuration-snapshots/
│   └── index.ts                     # Configuration snapshot build worker (multi-repo)
└── github-token.ts                  # Shared GitHub token resolution utility

apps/gateway/src/lib/
└── prebuild-resolver.ts             # Prebuild resolution for session creation (direct/managed/CLI)

packages/services/src/
├── repos/
│   ├── db.ts                        # Repo DB operations (CRUD, snapshot status, service commands)
│   ├── mapper.ts                    # DB row → API type conversion
│   └── service.ts                   # Repo business logic (create with auto-configuration, service commands)
├── prebuilds/
│   ├── db.ts                        # Prebuild DB operations (CRUD, junction, managed, service commands)
│   ├── mapper.ts                    # DB row → API type conversion
│   └── service.ts                   # Prebuild business logic (create with workspace paths, effective commands)
└── base-snapshots/
    ├── db.ts                        # Base snapshot DB operations (find/insert/mark status)
    └── service.ts                   # Base snapshot business logic (isBuildNeeded, startBuild)

packages/db/src/schema/
├── repos.ts                         # repos table (Drizzle relations, re-exports from schema.ts)
├── prebuilds.ts                     # prebuilds + prebuild_repos tables (Drizzle relations)
└── schema.ts                        # Full schema definitions (repos, prebuilds, sandbox_base_snapshots)

packages/queue/src/
└── index.ts                         # BullMQ queue/worker factories for base + configuration snapshot builds
```

---

## 4. Data Models & Schemas

### Database Tables

```sql
repos
├── id                         UUID PRIMARY KEY
├── organization_id            TEXT NOT NULL (FK → organization, CASCADE)
├── github_url                 TEXT NOT NULL
├── github_repo_id             TEXT NOT NULL
├── github_repo_name           TEXT NOT NULL
├── default_branch             TEXT DEFAULT 'main'
├── setup_commands             TEXT[]
├── detected_stack             JSONB
├── is_orphaned                BOOLEAN DEFAULT false
├── is_private                 BOOLEAN DEFAULT false
├── added_by                   TEXT (FK → user)
├── source                     TEXT DEFAULT 'github'  -- 'github' | 'local'
├── local_path_hash            TEXT                   -- non-null when source='local' (CHECK)
├── repo_snapshot_id           TEXT                   -- inline Layer 2 snapshot
├── repo_snapshot_status       TEXT                   -- 'building' | 'ready' | 'failed'
├── repo_snapshot_error        TEXT
├── repo_snapshot_commit_sha   TEXT
├── repo_snapshot_built_at     TIMESTAMPTZ
├── repo_snapshot_provider     TEXT
├── service_commands           JSONB                  -- repo-level service commands
├── service_commands_updated_at TIMESTAMPTZ
├── service_commands_updated_by TEXT
├── created_at                 TIMESTAMPTZ
└── updated_at                 TIMESTAMPTZ
    UNIQUE(organization_id, github_repo_id)
    CHECK: source='local' → local_path_hash IS NOT NULL

prebuilds
├── id                         UUID PRIMARY KEY
├── snapshot_id                TEXT                   -- NULL = being set up
├── sandbox_provider           TEXT DEFAULT 'modal'
├── status                     TEXT DEFAULT 'building'  -- 'pending' | 'building' | 'ready' | 'failed'
├── error                      TEXT
├── type                       TEXT DEFAULT 'manual'    -- 'manual' | 'managed' | 'cli'
├── name                       TEXT NOT NULL
├── notes                      TEXT
├── created_by                 TEXT (FK → user)
├── user_id                    TEXT (FK → user, CASCADE) -- CLI prebuilds
├── local_path_hash            TEXT                     -- CLI prebuilds
├── service_commands           JSONB
├── service_commands_updated_at TIMESTAMPTZ
├── service_commands_updated_by TEXT
├── env_files                  JSONB
├── env_files_updated_at       TIMESTAMPTZ
├── env_files_updated_by       TEXT
├── connectors                 JSONB                  -- legacy connector configs (gateway-mediated MCP)
├── connectors_updated_at      TIMESTAMPTZ
├── connectors_updated_by      TEXT
└── created_at                 TIMESTAMPTZ
    UNIQUE(user_id, local_path_hash)  -- CLI constraint

prebuild_repos
├── prebuild_id                UUID NOT NULL (FK → prebuilds, CASCADE)
├── repo_id                    UUID NOT NULL (FK → repos, CASCADE)
├── workspace_path             TEXT NOT NULL  -- '.' for single repo, repo name for multi
└── created_at                 TIMESTAMPTZ
    PK(prebuild_id, repo_id)

repo_connections
├── id                         UUID PRIMARY KEY
├── repo_id                    UUID NOT NULL (FK → repos, CASCADE)
├── integration_id             UUID NOT NULL (FK → integrations, CASCADE)
└── created_at                 TIMESTAMPTZ
    UNIQUE(repo_id, integration_id)

sandbox_base_snapshots
├── id                         UUID PRIMARY KEY
├── version_key                TEXT NOT NULL
├── snapshot_id                TEXT
├── status                     TEXT DEFAULT 'building'  -- CHECK: building/ready/failed
├── error                      TEXT
├── provider                   TEXT DEFAULT 'modal'
├── modal_app_name             TEXT NOT NULL
├── built_at                   TIMESTAMPTZ
├── created_at                 TIMESTAMPTZ
└── updated_at                 TIMESTAMPTZ
    UNIQUE(version_key, provider, modal_app_name)
```

### Core TypeScript Types

```typescript
// packages/services/src/prebuilds/service.ts
interface CreatePrebuildInput {
  organizationId: string;
  userId: string;
  repoIds: string[];
  name?: string;
}

interface EffectiveServiceCommandsResult {
  source: "prebuild" | "repo" | "none";
  commands: PrebuildServiceCommand[];
  workspaces: string[];
}

// packages/shared/src/connectors.ts
interface ConnectorConfig {
  id: string;                 // UUID (prebuild-local identity)
  name: string;               // display label
  transport: "remote_http";   // V1 scope
  url: string;                // MCP endpoint
  auth: { type: "bearer" | "custom_header"; secretKey: string; headerName?: string };
  riskPolicy?: { defaultRisk?: "read" | "write" | "danger"; overrides?: Record<string, "read" | "write" | "danger"> };
  enabled: boolean;
}

// apps/gateway/src/lib/prebuild-resolver.ts
interface ResolvedPrebuild {
  id: string;
  snapshotId: string | null;
  repoIds: string[];
  isNew: boolean;
}

// packages/queue/src/index.ts
interface BaseSnapshotBuildJob {
  versionKey: string;
  provider: string;
  modalAppName: string;
}

interface ConfigurationSnapshotBuildJob {
  configurationId: string;
  force?: boolean;
}
```

### Key Indexes
- `idx_repos_org` on `organization_id` — org-scoped listing
- `idx_repos_local_path_hash` on `local_path_hash` (filtered: not null) — CLI repo lookup
- `idx_repos_repo_snapshot_status` on `repo_snapshot_status` — snapshot build queries
- `idx_prebuilds_type_managed` on `type` — managed prebuild lookups
- `idx_prebuild_repos_prebuild` / `idx_prebuild_repos_repo` on junction table FKs
- `idx_sandbox_base_snapshots_status` on `status` — build status queries
- `idx_sandbox_base_snapshots_version_provider_app` (unique) — deduplication

---

## 5. Conventions & Patterns

### Do
- Use the services layer (`packages/services/src/repos/`, `packages/services/src/prebuilds/`) for all DB access. Routes should call service functions, not query DB directly.
- Use `prebuildBelongsToOrg()` for authorization — it checks via `prebuild_repos → repos → organization_id`.
- Use `getEffectiveServiceCommands()` to resolve the final command set, not raw `serviceCommands` fields.
- Use BullMQ job ID for deduplication. Base snapshot builds key on `base-snapshot:{provider}:{appName}:{versionKey}`.

### Don't
- Don't import `@proliferate/db` directly in routes — go through services.
- Don't assume repo snapshots work on E2B — they are Modal-only.
- Don't read `serviceCommands` directly from the prebuild record to get the final commands — always resolve via `getEffectiveServiceCommands()`.

### Error Handling
Services throw errors (not error objects). Routes catch and map to `ORPCError` with appropriate codes:
```typescript
// apps/web/src/server/routers/prebuilds.ts
if (message === "One or more repos not found") {
  throw new ORPCError("NOT_FOUND", { message });
}
```

### Reliability
- **Base snapshot builds**: 3 attempts, exponential backoff (10s initial). Concurrency: 1. `insertBuilding()` uses `ON CONFLICT DO NOTHING` for concurrent workers.
- **Configuration snapshot builds**: 3 attempts, exponential backoff (5s initial). Concurrency: 2. Timestamp-based job IDs prevent failed jobs from blocking future rebuilds. Skips if configuration already has status `"default"` or `"ready"` with a `snapshotId` (unless `force`).
- **Idempotency**: `updateSnapshotIdIfNull()` only sets snapshot ID if currently null.

### Testing Conventions
- No dedicated tests exist for repos, prebuilds, or snapshot build services/workers today. Coverage comes indirectly from route-level and integration tests.
- `prebuildBelongsToOrg()` and `getEffectiveServiceCommands()` are pure query logic — good candidates for unit tests with DB fixtures.
- Snapshot build workers would require Modal credentials for integration testing.

---

## 6. Subsystem Deep Dives

### 6.1 Repo CRUD — `Implemented`

**What it does:** Manages org-scoped GitHub repository references.

**Happy path (create)** (`packages/services/src/repos/service.ts:createRepoWithConfiguration`):
1. Call `createRepo()`: check if repo exists by `(organizationId, githubRepoId)`.
2. If exists: link integration (if provided), un-orphan if needed, return existing.
3. If new: generate UUID, insert record, link integration.
4. Auto-create a single-repo configuration via `configurations.createConfiguration()`, which is tightly coupled to snapshot building — it always enqueues a `CONFIGURATION_SNAPSHOT_BUILDS` job.

**Other operations:**
- `listRepos(orgId)` returns repos with prebuild status computed by `mapper.ts:toRepo` (joins prebuild data).
- `deleteRepo(id, orgId)` hard-deletes; cascades remove `prebuild_repos`, `repo_connections`, and `secrets`.
- `search(q)` hits GitHub public API. Exact `owner/repo` format does direct lookup; otherwise uses search API (`per_page=10`, sorted by stars, public repos only).
- `available(integrationId?)` lists repos accessible via a GitHub App or Nango OAuth connection.

**Files touched:** `packages/services/src/repos/service.ts`, `apps/web/src/server/routers/repos.ts`

### 6.2 Repo Connections — `Implemented`

**What it does:** Links repos to GitHub integrations for private repo access.

**Mechanism:** `repo_connections` is a junction table binding `repo_id` to `integration_id`. Created during `createRepo()` if `integrationId` is provided. Uses upsert (`ON CONFLICT DO NOTHING`) to handle duplicate connections gracefully (`packages/services/src/repos/db.ts:createConnection`).

**Usage:** Repo snapshot builds and session creation resolve GitHub tokens by querying `repo_connections` → `integrations` to find active GitHub App installations or Nango OAuth connections.

**Files touched:** `packages/db/src/schema/integrations.ts:repoConnections`, `packages/services/src/repos/db.ts:createConnection`

### 6.3 Prebuild CRUD — `Implemented`

**What it does:** Manages prebuild records with repo associations.

**Create** (`packages/services/src/prebuilds/service.ts:createPrebuild`):
1. Validate all `repoIds` exist and belong to the same organization.
2. Generate UUID, insert prebuild with `status: "building"`.
3. Compute workspace paths: `"."` for single repo, repo name (last segment of `githubRepoName`) for multi-repo.
4. Insert `prebuild_repos` entries. Rollback (delete prebuild) on failure.

**Update:** Name and notes only (`packages/services/src/prebuilds/service.ts:updatePrebuild`).

**Delete:** Hard-delete; cascades remove `prebuild_repos` (`packages/services/src/prebuilds/db.ts:deleteById`).

**List:** Filters by org via `prebuild_repos → repos → organizationId`, optionally by status. Returns prebuilds with associated repos and setup sessions (`packages/services/src/prebuilds/service.ts:listPrebuilds`).

**Authorization:** `prebuildBelongsToOrg(prebuildId, orgId)` traverses `prebuild_repos → repos` to verify org membership.

**Files touched:** `packages/services/src/prebuilds/service.ts`, `apps/web/src/server/routers/prebuilds.ts`

### 6.4 Service Commands Resolution — `Implemented`

**What it does:** Resolves the effective set of auto-start commands for a prebuild by merging prebuild-level overrides with repo-level defaults.

**Resolution logic** (`packages/services/src/prebuilds/service.ts:getEffectiveServiceCommands`):
1. If prebuild has non-empty `serviceCommands` → return them (source: `"prebuild"`).
2. Otherwise, for each repo in the prebuild, get repo-level `serviceCommands` and annotate with `workspacePath` → return merged set (source: `"repo"`).
3. If no commands anywhere → return empty (source: `"none"`).

**Return shape:** `{ source: "prebuild" | "repo" | "none", commands: PrebuildServiceCommand[], workspaces: string[] }`.

**Persistence:** Service commands are stored as JSONB on both `repos.service_commands` and `prebuilds.service_commands`. Updates track `updatedBy` (user ID) and `updatedAt` timestamps.

**Files touched:** `packages/services/src/prebuilds/service.ts`, `apps/web/src/server/routers/prebuilds.ts`, `apps/web/src/server/routers/repos.ts`

### 6.5 Base Snapshot Build Worker — `Implemented`

**What it does:** Builds reusable base sandbox snapshots (Layer 1) so new sessions start without relying on `MODAL_BASE_SNAPSHOT_ID` env var.

**Happy path** (`apps/worker/src/base-snapshots/index.ts`):
1. On worker startup, `enqueueIfNeeded()` computes the current version key and checks `baseSnapshots.isBuildNeeded()`.
2. If needed, enqueues a `BASE_SNAPSHOT_BUILDS` job with `jobId` = `base-snapshot:{provider}:{appName}:{versionKey[:16]}` for deduplication.
3. Worker picks up job, calls `baseSnapshots.startBuild()` — inserts a `"building"` record (idempotent via `ON CONFLICT DO NOTHING`).
4. If `alreadyReady` → skip. Otherwise, calls `ModalLibmodalProvider.createBaseSnapshot()`.
5. On success: `baseSnapshots.completeBuild(id, snapshotId)`. On failure: `baseSnapshots.failBuild(id, error)` + rethrow for BullMQ retry.

**Deduplication:** Unique DB constraint on `(versionKey, provider, modalAppName)` prevents duplicate records. BullMQ `jobId` prevents duplicate jobs.

**Files touched:** `apps/worker/src/base-snapshots/index.ts`, `packages/services/src/base-snapshots/service.ts`

### 6.6 Configuration Snapshot Build Worker — `Implemented`

**What it does:** Builds configuration snapshots (Layer 2) — base snapshot + all configuration repos cloned — for near-zero latency session starts.

**Happy path** (`apps/worker/src/configuration-snapshots/index.ts`):
1. Load configuration info via `configurations.getConfigurationSnapshotBuildInfo(configurationId)`.
2. Skip if already `"default"` or `"ready"` with `snapshotId` (unless `force`).
3. Mark `"building"` via `configurations.markConfigurationSnapshotBuilding(configurationId)`.
4. For each repo in the configuration: resolve GitHub token (see §2: GitHub Token Hierarchy). Fail if private repo lacks token.
5. Call `ModalLibmodalProvider.createConfigurationSnapshot({ configurationId, repos, branch })`.
6. On success: `configurations.markConfigurationSnapshotDefault(configurationId, snapshotId)`.
7. On failure: `configurations.markConfigurationSnapshotFailed(configurationId, error)` + rethrow for retry.

**Trigger:** Automatically enqueued when a configuration is created via `requestConfigurationSnapshotBuild()` (fire-and-forget, tightly coupled to `createConfiguration()`). Also triggered by managed configuration creation. Uses timestamp-based job IDs to avoid stale deduplication.

**Modal-only:** `requestConfigurationSnapshotBuild()` checks `env.MODAL_APP_NAME` — returns early if not configured.

**Files touched:** `apps/worker/src/configuration-snapshots/index.ts`, `apps/worker/src/github-token.ts`, `packages/services/src/configurations/service.ts:requestConfigurationSnapshotBuild`

### 6.7 Prebuild Resolver — `Implemented`

**What it does:** Resolves a prebuild record for session creation. Owned by the gateway; documented here because it creates prebuild and repo records via this spec's services.

The resolver supports three modes (direct ID, managed, CLI) and returns a `ResolvedPrebuild { id, snapshotId, repoIds, isNew }`. For the full resolution flow and how it fits into session creation, see `sessions-gateway.md` §6.1.

**This spec's role:** The resolver calls `prebuilds.findById()`, `prebuilds.createManagedPrebuild()`, `prebuilds.createPrebuildRepos()`, and `cli.createCliPrebuildPending()` from the services layer to create/query prebuild records. The managed path derives workspace paths using the same single-repo `"."` / multi-repo repo-name convention as `createPrebuild()`.

**Files touched:** `apps/gateway/src/lib/prebuild-resolver.ts`

### 6.8 Setup Session Finalization — `Implemented`

**What it does:** Captures a sandbox snapshot from a setup session and updates/creates a configuration snapshot record.

**Happy path** (`apps/web/src/server/routers/configurations-finalize.ts:finalizeSetupHandler`):
1. Verify session exists and belongs to the repo (via `session.repoId` or `configuration_repos`).
2. Verify session type is `"setup"` and has a sandbox.
3. Take filesystem snapshot via provider (`provider.snapshot(sessionId, sandboxId)`).
4. Store any provided secrets (encryption details — see `secrets-environment.md`).
5. If existing configuration (`updateSnapshotId` or `session.configurationId`): update with new `snapshotId` + `status: "ready"`.
6. If no existing configuration: create a new configuration, create `configuration_repos` link for the repo, and update session `configurationId`.
7. Optionally terminate sandbox and stop session (lifecycle details — see `sessions-gateway.md`).

**Files touched:** `apps/web/src/server/routers/configurations-finalize.ts`

### 6.9 Env File Persistence — `Implemented`

**What it does:** Stores env file generation specs as JSONB on the prebuild record.

**Mechanism:** `prebuilds.env_files` stores a JSON spec describing which env files to generate and their template variables. Updated via `updatePrebuildEnvFiles()` with `updatedBy` + `updatedAt` tracking. At sandbox boot, the provider passes env files to `proliferate env apply` inside the sandbox (see `sandbox-providers.md` §6.4).

**Files touched:** `packages/services/src/prebuilds/db.ts:updatePrebuildEnvFiles`, `packages/db/src/schema/prebuilds.ts`

### 6.10 Prebuild Connector Persistence — `Deprecated` (Migrated to Org Scope)

**What it did:** Previously stored prebuild-scoped connector definitions in `prebuilds.connectors` JSONB. This has been migrated to org-scoped storage in the `org_connectors` table (owned by `integrations.md`).

**Migration:** Backfill migration `0022_org_connectors.sql` copied connector configs from `prebuilds.connectors` to `org_connectors`, deduplicating by `(organization_id, url, name)`. Legacy JSONB columns remain in the schema but are no longer read at runtime.

**Runtime consumption:** Gateway now loads enabled connectors by `session.organizationId` via `connectors.listEnabledConnectors()` (see `actions.md` §6.11).

**Files touched:** `packages/db/drizzle/0022_org_connectors.sql` (migration), `packages/services/src/connectors/` (new org-scoped module)

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| `sessions-gateway.md` | Gateway → This | `resolvePrebuild()` → `prebuilds.*`, `cli.*` | Session creation calls resolver which creates/queries prebuild records via this spec's services. Resolver logic owned by `sessions-gateway.md` §6.1. |
| `sessions-gateway.md` | Gateway → This | `prebuilds.getPrebuildReposWithDetails()` | Session store loads repo details for sandbox provisioning |
| `actions.md` | Actions ↔ Integrations | `org_connectors` table via `connectors.listEnabledConnectors()` | Connector-backed action sources migrated to org-scoped catalog in `integrations.md`. Legacy `prebuilds.connectors` JSONB retained for data preservation only. |
| `sandbox-providers.md` | Worker → Provider | `ModalLibmodalProvider.createBaseSnapshot()`, `.createConfigurationSnapshot()` | Snapshot workers call Modal provider directly |
| `sandbox-providers.md` | Provider ← This | `resolveSnapshotId()` consumes configuration snapshot | Snapshot resolution reads `configurationSnapshotId` from configuration record |
| `integrations.md` | This → Integrations | `integrations.getRepoConnectionsWithIntegrations()` | Token resolution for repo snapshot builds |
| `secrets-environment.md` | Finalize → Secrets | `secrets.upsertSecretByRepoAndKey()` | Setup finalization stores encrypted secrets |
| `agent-contract.md` | Agent → This | `save_service_commands` tool | Agent persists service commands via gateway → services |

### Security & Auth
- All oRPC routes require org membership via `orgProcedure` middleware.
- Prebuild authorization uses `prebuildBelongsToOrg()` — traverses `prebuild_repos → repos → organizationId`.
- GitHub search API calls use `User-Agent: Proliferate-App` header but no auth token (public repos only).
- Setup finalization delegates secret storage to `secrets-environment.md` (encryption handled there).

### Observability
- Structured logging via `@proliferate/logger` in workers (`module: "base-snapshots"`, `module: "configuration-snapshots"`).
- Prebuilds router uses `logger.child({ handler: "prebuilds" })`.
- Key log events: build start, build complete (with `snapshotId`), build failure (with error), deduplication skips.

---

## 8. Acceptance Gates

- [ ] Typecheck passes (`pnpm typecheck`)
- [ ] Worker tests pass (`pnpm -C apps/worker test`)
- [ ] This spec is updated (file tree, data models, deep dives)

---

## 9. Known Limitations & Tech Debt

- [ ] **Configuration snapshots are Modal-only** — E2B sessions cannot use Layer 2 snapshots. `requestConfigurationSnapshotBuild()` returns early if `MODAL_APP_NAME` is unset. Impact: E2B sessions always do a live clone. Expected fix: implement E2B template-based configuration snapshots.
- [ ] **Legacy repo snapshot columns remain on repos table** — `repo_snapshot_id`, `repo_snapshot_status`, `repo_snapshot_commit_sha`, `repo_snapshot_built_at`, `repo_snapshot_provider`, `repo_snapshot_error` columns exist on the `repos` table but are no longer written to. Impact: dead columns consuming space. Expected fix: schema migration to drop these columns.
- [ ] **Managed prebuild lookup scans all managed prebuilds** — `findManagedPrebuilds()` loads all `type = "managed"` prebuilds, then filters by org in-memory. Impact: grows linearly with managed prebuild count. Expected fix: add org-scoped query with DB-level filter.
- [ ] **Setup finalization lives in the router** — `configurations-finalize.ts` contains complex orchestration (snapshot + secrets + configuration mutation) that should be in the services layer. Impact: harder to reuse from non-web contexts.
- [ ] **GitHub search uses unauthenticated API** — `repos.search` calls GitHub API without auth, subject to lower rate limits (60 req/hour per IP). Impact: may fail under heavy usage. Expected fix: use org's GitHub integration token for authenticated search.
- [ ] **No webhook-driven configuration snapshot rebuilds** — Configuration snapshots are only built on configuration creation. Subsequent pushes to `defaultBranch` don't trigger rebuilds. Impact: configuration snapshots become stale over time; git freshness pull compensates at session start. Expected fix: trigger rebuilds from GitHub push webhooks.
- [x] **Connector scope is prebuild-scoped (legacy path)** — resolved. Connectors migrated to org-scoped `org_connectors` table. UI moved to Settings → Tools. See `integrations.md` §6.14.
