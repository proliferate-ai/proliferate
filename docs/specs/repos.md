# Repos & Base Snapshots — System Spec

## 1. Scope & Purpose

### In Scope
- Repo CRUD, search (public GitHub), and available repos (via integration)
- Repo connections (binding repos to GitHub integrations)
- Base snapshot build worker (queue, deduplication, status tracking)
- Base snapshot status tracking (building/ready/failed)

### Out of Scope
- Configuration CRUD, snapshots, secret files, service commands — see `configurations-snapshots.md`
- Configuration resolver (resolves configuration at session start) — see `configurations-snapshots.md` §6.8
- Session creation — see `sessions-gateway.md` §6.1
- Secret values and encryption — see `secrets-environment.md`
- Integration OAuth lifecycle — see `integrations.md`
- Sandbox boot sequence — see `sandbox-providers.md` §6.4
- Setup session finalization — see `configurations-snapshots.md` §6.4

### Mental Model

**Repos** are org-scoped references to GitHub repositories. They carry metadata (URL, default branch, privacy status). Each repo can be linked to one or more GitHub integrations via **repo connections**, which provide the authentication tokens needed for private repo access.

**Base snapshots** are pre-baked sandbox images with OpenCode + services installed, no repo. Built by the base snapshot worker, tracked in `sandbox_base_snapshots`. They speed up session start by pre-installing the sandbox runtime.

**Core entities:**
- **Repo** — an org-scoped GitHub repository reference. Lifecycle: create → configure → delete.
- **Base snapshot** — a pre-baked sandbox state with OpenCode + services installed, no repo. Built by the base snapshot worker, tracked in `sandbox_base_snapshots`.

**Key invariants:**
- Base snapshot deduplication is keyed on `(versionKey, provider, modalAppName)`. Only one build runs per combination.

---

## 2. Core Concepts

### Workspace Path
Determines where each repo is cloned inside the sandbox. Single-repo configurations always use `"."` (repo is the workspace root). Multi-repo configurations derive the path from the last segment of `githubRepoName` (e.g., `"org/my-app"` → `"my-app"`).
- Key detail agents get wrong: Workspace path is set at configuration creation time, not dynamically. Changing it requires recreating the `configuration_repos` entry.
- Reference: `packages/services/src/configurations/service.ts:createConfiguration`

### Snapshot Version Key
A SHA-256 hash of `PLUGIN_MJS` + `DEFAULT_CADDYFILE` + `getOpencodeConfig(defaultModelId)`. When this changes, the base snapshot is stale and must be rebuilt. Computed by `computeBaseSnapshotVersionKey()`.
- Key detail agents get wrong: The version key is computed from source code constants, not runtime config. Changing `PLUGIN_MJS` or the Caddyfile template triggers a rebuild.
- Reference: `packages/shared/src/sandbox/version-key.ts`

### GitHub Token Hierarchy
Session creation and token resolution use a two-level hierarchy: (1) repo-linked integration connections (prefer GitHub App installation, fall back to Nango OAuth), (2) org-wide GitHub integration.
- Reference: `packages/services/src/integrations/`

---

## 3. File Tree

```
apps/web/src/server/routers/
├── repos.ts                         # Repo oRPC routes (list/get/create/delete/search/available)
└── repos-finalize.ts                # Setup session finalization (snapshot + configuration create/update)

apps/worker/src/
└── base-snapshots/
    └── index.ts                     # Base snapshot build worker + startup enqueue

packages/services/src/
├── repos/
│   ├── db.ts                        # Repo DB operations (CRUD)
│   ├── mapper.ts                    # DB row → API type conversion
│   └── service.ts                   # Repo business logic
└── base-snapshots/
    ├── db.ts                        # Base snapshot DB operations (find/insert/mark status)
    └── service.ts                   # Base snapshot business logic (isBuildNeeded, startBuild)

packages/db/src/schema/
└── schema.ts                        # Full schema definitions (repos, configurations, sandbox_base_snapshots)

packages/queue/src/
└── index.ts                         # BullMQ queue/worker factories for base snapshot builds
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
├── is_private                 BOOLEAN DEFAULT false
├── created_at                 TIMESTAMPTZ
└── updated_at                 TIMESTAMPTZ
    UNIQUE(organization_id, github_repo_id)

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
// packages/queue/src/index.ts
interface BaseSnapshotBuildJob {
  versionKey: string;
  provider: string;
  modalAppName: string;
}
```

### Key Indexes
- `idx_repos_org` on `organization_id` — org-scoped listing
- `idx_sandbox_base_snapshots_status` on `status` — build status queries
- `idx_sandbox_base_snapshots_version_provider_app` (unique) — deduplication

---

## 5. Conventions & Patterns

### Do
- Use the services layer (`packages/services/src/repos/`) for all DB access. Routes should call service functions, not query DB directly.
- Use BullMQ job ID for deduplication. Base snapshot builds key on `base-snapshot:{provider}:{appName}:{versionKey}`.

### Don't
- Don't import `@proliferate/db` directly in routes — go through services.

### Error Handling
Services throw errors (not error objects). Routes catch and map to `ORPCError` with appropriate codes.

### Reliability
- **Base snapshot builds**: 3 attempts, exponential backoff (10s initial). Concurrency: 1. `insertBuilding()` uses `ON CONFLICT DO NOTHING` for concurrent workers.
- **Idempotency**: `insertBuilding()` won't create duplicates due to unique constraint.

### Testing Conventions
- No dedicated tests exist for repos or base snapshot services/workers today. Coverage comes indirectly from route-level and integration tests.
- Snapshot build workers would require Modal credentials for integration testing.

---

## 6. Subsystem Deep Dives

### 6.1 Repo CRUD

**What it does:** Manages org-scoped GitHub repository references.

**Happy path (create)** (`packages/services/src/repos/service.ts:createRepo`):
1. Check if repo exists by `(organizationId, githubRepoId)`.
2. If exists: link integration (if provided), return existing.
3. If new: generate UUID, insert record, link integration.

**Other operations:**
- `listRepos(orgId)` returns repos with configuration status.
- `deleteRepo(id, orgId)` hard-deletes; cascades remove `configuration_repos`, `repo_connections`, and `secrets`.
- `search(q)` hits GitHub public API. Exact `owner/repo` format does direct lookup; otherwise uses search API (`per_page=10`, sorted by stars, public repos only).
- `available(integrationId?)` lists repos accessible via a GitHub App or Nango OAuth connection.

**Files touched:** `packages/services/src/repos/service.ts`, `apps/web/src/server/routers/repos.ts`

### 6.2 Repo Connections

**What it does:** Links repos to GitHub integrations for private repo access.

**Mechanism:** `repo_connections` is a junction table binding `repo_id` to `integration_id`. Created during `createRepo()` if `integrationId` is provided. Uses upsert (`ON CONFLICT DO NOTHING`) to handle duplicate connections gracefully (`packages/services/src/repos/db.ts:createConnection`).

**Usage:** Session creation resolves GitHub tokens by querying `repo_connections` → `integrations` to find active GitHub App installations or Nango OAuth connections.

**Files touched:** `packages/db/src/schema/schema.ts:repoConnections`, `packages/services/src/repos/db.ts:createConnection`

### 6.3 Base Snapshot Build Worker

**What it does:** Builds reusable base sandbox snapshots so new sessions start without relying on `MODAL_BASE_SNAPSHOT_ID` env var.

**Happy path** (`apps/worker/src/base-snapshots/index.ts`):
1. On worker startup, `enqueueIfNeeded()` computes the current version key and checks `baseSnapshots.isBuildNeeded()`.
2. If needed, enqueues a `BASE_SNAPSHOT_BUILDS` job with `jobId` = `base-snapshot:{provider}:{appName}:{versionKey[:16]}` for deduplication.
3. Worker picks up job, calls `baseSnapshots.startBuild()` — inserts a `"building"` record (idempotent via `ON CONFLICT DO NOTHING`).
4. If `alreadyReady` → skip. Otherwise, calls `ModalLibmodalProvider.createBaseSnapshot()`.
5. On success: `baseSnapshots.completeBuild(id, snapshotId)`. On failure: `baseSnapshots.failBuild(id, error)` + rethrow for BullMQ retry.

**Deduplication:** Unique DB constraint on `(versionKey, provider, modalAppName)` prevents duplicate records. BullMQ `jobId` prevents duplicate jobs.

**Files touched:** `apps/worker/src/base-snapshots/index.ts`, `packages/services/src/base-snapshots/service.ts`

### 6.4 Setup Session Finalization

**What it does:** Captures a sandbox snapshot from a setup session and creates/updates a configuration record. See `configurations-snapshots.md` §6.4 for snapshot details.

**Happy path** (`apps/web/src/server/routers/repos-finalize.ts:finalizeSetupHandler`):
1. Verify session exists and belongs to the repo (via `repoId` or `configuration_repos`).
2. Verify session type is `"setup"` and has a sandbox.
3. Take filesystem snapshot via provider (`provider.snapshot(sessionId, sandboxId)`).
4. Store any provided secrets (encryption details — see `secrets-environment.md`).
5. Create snapshot record via `snapshots.createSnapshot()` + `snapshots.markSnapshotReady()`.
6. If existing configuration: update `active_snapshot_id`.
7. If no configuration: create new configuration record, link repo via `configuration_repos`.
8. Optionally terminate sandbox and stop session (lifecycle details — see `sessions-gateway.md`).

**Files touched:** `apps/web/src/server/routers/repos-finalize.ts`

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| `configurations-snapshots.md` | This → Configurations | `configurations` table, `configuration_repos` | Configuration CRUD, snapshots, service commands, secret files all owned by configurations spec |
| `sessions-gateway.md` | Gateway → This | `configurations.getConfigurationReposWithDetails()` | Session store loads repo details for sandbox provisioning |
| `sandbox-providers.md` | Worker → Provider | `ModalLibmodalProvider.createBaseSnapshot()` | Base snapshot workers call Modal provider directly |
| `integrations.md` | This → Integrations | `integrations.getRepoConnectionsWithIntegrations()` | Token resolution for private repo access |
| `secrets-environment.md` | Finalize → Secrets | `secrets.upsertSecretByRepoAndKey()` | Setup finalization stores encrypted secrets |
| `agent-contract.md` | Agent → Configurations | `save_service_commands` tool | Agent persists service commands via gateway → configurations service |

### Security & Auth
- All oRPC routes require org membership via `orgProcedure` middleware.
- Configuration authorization uses `configurations.organization_id` directly (no repo traversal needed).
- GitHub search API calls use `User-Agent: Proliferate-App` header but no auth token (public repos only).
- Setup finalization delegates secret storage to `secrets-environment.md` (encryption handled there).

### Observability
- Structured logging via `@proliferate/logger` in workers (`module: "base-snapshots"`).
- Configurations router uses `logger.child({ handler: "configurations" })`.
- Key log events: build start, build complete (with `snapshotId`), build failure (with error), deduplication skips.

---

## 8. Acceptance Gates

- [ ] Typecheck passes (`pnpm typecheck`)
- [ ] Worker tests pass (`pnpm -C apps/worker test`)
- [ ] This spec is updated (file tree, data models, deep dives)

---

## 9. Known Limitations & Tech Debt

- [ ] **Managed configuration lookup scans all managed configurations** — `findManagedConfigurations()` loads all managed configurations, then filters by org in-memory. Impact: grows linearly with managed configuration count. Expected fix: add org-scoped query with DB-level filter.
- [ ] **Setup finalization lives in the router** — `repos-finalize.ts` contains complex orchestration (snapshot + secrets + configuration creation) that should be in the services layer. Impact: harder to reuse from non-web contexts. Marked with a TODO in code.
- [ ] **GitHub search uses unauthenticated API** — `repos.search` calls GitHub API without auth, subject to lower rate limits (60 req/hour per IP). Impact: may fail under heavy usage. Expected fix: use org's GitHub integration token for authenticated search.
