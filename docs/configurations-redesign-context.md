# Repos → Configurations Redesign: Complete Codebase Context

## 1. Entity Relationship Map (As-Is)

```
┌─────────────────────┐       ┌──────────────────────────┐
│       repos          │       │    configurations         │
│  (GitHub metadata)   │◄─────►│  (formerly "prebuilds")  │
│                      │  M:N  │                           │
│  id                  │       │  id                       │
│  organizationId      │       │  snapshotId               │
│  githubRepoId        │       │  status (building/ready/  │
│  githubRepoName      │       │          failed)          │
│  githubUrl           │       │  type (manual/managed/cli)│
│  defaultBranch       │       │  name                     │
│  serviceCommands     │       │  notes                    │
│  repoSnapshotId (L2) │       │  serviceCommands          │
│  repoSnapshotStatus  │       │  envFiles                 │
│  source (github/local)│       │  connectors               │
│  isOrphaned          │       │  sandboxProvider          │
│  addedBy             │       │  createdBy                │
└──────────┬───────────┘       │  userId (CLI only)        │
           │                   │  localPathHash (CLI only)  │
           │                   └──────────┬────────────────┘
           │                              │
     ┌─────┴──────────────────────────────┴─────┐
     │        configuration_repos (junction)     │
     │  configurationId ──► configurations.id    │
     │  repoId ──► repos.id                      │
     │  workspacePath ("." or repo-name)         │
     └───────────────────────────────────────────┘
           │                              │
           │                              │
     ┌─────┴───────┐              ┌───────┴──────────────┐
     │   secrets    │              │  configuration_       │
     │              │              │  secrets (junction)    │
     │  repoId (FK) │              │  configurationId (FK)  │
     │  prebuildId  │              │  secretId (FK)         │
     │  (FK)        │              └────────────────────────┘
     └──────────────┘
           │                       ┌────────────────────────┐
           │                       │    secret_files         │
           │                       │  configurationId (FK)   │
           │                       │  filePath               │
           │                       │  encryptedContent       │
           │                       └────────────────────────┘
           │
     ┌─────┴───────────┐
     │    sessions       │
     │  repoId (FK)      │
     │  prebuildId (FK)  │  ← references configuration
     │  snapshotId (L3)  │
     │  sessionType      │
     └──────────────────┘
```

**Key insight**: Configuration is already the first-class entity in the data model. A configuration groups 1+ repos via the junction table, holds the snapshot, service commands, env files, and connectors. The UI just doesn't reflect this yet — it presents repos as the top-level entity with configurations nested underneath.

---

## 2. Three-Layer Snapshot Architecture

```
Layer 1: Base Snapshot (sandbox_base_snapshots)
  └─ OpenCode + services, no repo
  └─ Built by: apps/worker/src/base-snapshots/

Layer 2: Repo Snapshot (repos.repoSnapshotId)
  └─ Base + cloned repo at current commit
  └─ Built by: apps/worker/src/repo-snapshots/

Layer 3: Configuration Snapshot (configurations.snapshotId)
  └─ Repo snapshot + user's working state
  └─ Created by: setup session finalization (repos-finalize.ts)
```

Resolution order at session creation: L3 → L2 → L1 → fresh boot.

---

## 3. Naming Inconsistency Map

| Layer | Uses "Prebuild" | Uses "Configuration" | Uses "Snapshot" | Uses "Repo" |
|---|---|---|---|---|
| **DB table** | — (renamed) | `configurations`, `configuration_repos`, `configuration_secrets` | — | `repos` |
| **DB constraints/indexes** | `prebuilds_*` (old names kept) | — | — | `repos_*` |
| **Drizzle schema file** | `prebuilds.ts` (file name) | `configurations` (table var) | — | `repos.ts` |
| **Drizzle relations file** | — | `configurationsRelations` | — | `reposRelations` |
| **Services dir** | `src/prebuilds/` | — | — | `src/repos/` |
| **Services types** | `CreatePrebuildInput`, etc. | — | `SnapshotRow` | `CreateRepoInput`, etc. |
| **oRPC router name** | `prebuildsRouter` | — | — | `reposRouter` |
| **oRPC endpoint paths** | `prebuilds.list`, `.create`, `.update`, `.delete` | — | `repos.listSnapshots` | `repos.list`, `.get`, `.create`, `.delete` |
| **Shared contracts** | `PrebuildSchema`, `RepoPrebuildSchema` | — | `RepoSnapshotSchema` | `RepoSchema`, `CreateRepoInputSchema` |
| **Hooks file** | — | — | — | `use-repos.ts` (has `usePrebuildEnvFiles`, `usePrebuildServiceCommands`) |
| **Dashboard types** | — | — | `Snapshot` interface | — |
| **UI page title** | — | — | — | `"Repositories"` (PageShell), `"Repos"` (header bar) |
| **Sidebar nav** | — | — | — | `"Repos"` |
| **UI component names** | — | `ConfigurationRow`, `ConfigurationsSection`, `RepoConfigurations` | — | `RepoRow`, `RepoDetailPage` |
| **UI user-facing text** | — | `"Configurations"` (column header), `"New configuration"`, `"No configurations yet"`, `"Delete Configuration"` | — | `"Add Repository"`, `"Search repositories"` |
| **URL paths** | — | — | — | `/dashboard/repos`, `/dashboard/repos/[id]` |

---

## 4. Complete File Inventory

### Frontend Pages & Routes

| File | What it is |
|---|---|
| `apps/web/src/app/(command-center)/dashboard/repos/page.tsx` | **Main repos list page** — `RepositoriesPage`, `RepoRow`, `RepoConfigurations`, `ConfigurationRow`, `EnvFileSummary`, `ManageSecretsDialog`, `AddRepoDialog` |
| `apps/web/src/app/(command-center)/dashboard/repos/[id]/page.tsx` | **Repo detail page** — `RepoDetailPage`, `ConfigurationsSection`, `ServiceCommandsSection` |
| `apps/web/src/app/(command-center)/layout.tsx` | Page title mapping: `"/dashboard/repos": "Repos"`, `"/settings/repositories": "Repositories"` |
| `apps/web/src/app/(command-center)/settings/repositories/page.tsx` | Redirects to `/dashboard/repos` |

### Frontend Components

| File | What it is |
|---|---|
| `apps/web/src/components/dashboard/sidebar.tsx` | Nav items — `"Repos"` label, `FolderGit2` icon, routes to `/dashboard/repos` |
| `apps/web/src/components/dashboard/repo-list.tsx` | `RepoList` — displays connected repos with status badges (used in onboarding) |
| `apps/web/src/components/dashboard/repo-picker.tsx` | `RepoPicker` — dialog for adding repos from GitHub |
| `apps/web/src/components/dashboard/repo-selector.tsx` | `RepoSelector` — popover with search across DB repos, available repos, public repos |
| `apps/web/src/components/dashboard/configuration-group.tsx` | `ConfigurationGroup` — displays/manages a configuration (prebuild) |
| `apps/web/src/components/dashboard/snapshot-selector.tsx` | `SnapshotSelector` — selects or creates configurations/snapshots |
| `apps/web/src/components/dashboard/add-snapshot-button.tsx` | Button/modal for creating new configurations |
| `apps/web/src/components/dashboard/environment-picker.tsx` | Environment/configuration picker |
| `apps/web/src/components/repositories/secret-files-editor.tsx` | `SecretFilesEditor` — CRUD for secret files per configuration |
| `apps/web/src/components/settings/tabs/repositories-tab.tsx` | `RepositoriesTab` — settings tab for repo management |
| `apps/web/src/components/settings/tabs/config-tab.tsx` | Admin env status (NOT related to configurations entity) |
| `apps/web/src/components/coding-session/snapshots-panel.tsx` | Snapshot management within coding session |

### Frontend Hooks

| File | Hooks |
|---|---|
| `apps/web/src/hooks/use-repos.ts` | `useRepos`, `useRepo`, `useCreateRepo`, `useDeleteRepo`, `useRepoPrebuilds`, `useRepoSnapshots`, `useAvailableRepos`, `useSearchRepos`, `useServiceCommands`, `useUpdateServiceCommands`, `usePrebuildEnvFiles`, `useCheckSecrets`, `useCreateSecret`, `usePrebuildServiceCommands`, `useEffectiveServiceCommands`, `useUpdatePrebuildServiceCommands` |
| `apps/web/src/hooks/use-prebuilds.ts` | `usePrebuilds`, `useCreatePrebuild`, `useUpdatePrebuild`, `useDeletePrebuild` |
| `apps/web/src/hooks/use-secret-files.ts` | `useSecretFiles`, `useUpsertSecretFile`, `useDeleteSecretFile` |

### Frontend Types

| File | Types |
|---|---|
| `apps/web/src/types/index.ts` | Re-exports `Repo`, `Session`, `CreateRepoInput` from `@proliferate/shared/contracts` |
| `apps/web/src/types/dashboard.ts` | `Snapshot` interface (comment: "In the database this is the 'prebuilds' table") |

### Backend Routers (oRPC)

| File | Router | Procedures |
|---|---|---|
| `apps/web/src/server/routers/index.ts` | `appRouter` | Mounts `repos`, `prebuilds`, `secretFiles`, `secrets`, `sessions`, etc. |
| `apps/web/src/server/routers/repos.ts` | `reposRouter` | `list`, `get`, `create`, `delete`, `available`, `search`, `listPrebuilds`, `listSnapshots`, `getServiceCommands`, `updateServiceCommands`, `finalizeSetup` |
| `apps/web/src/server/routers/prebuilds.ts` | `prebuildsRouter` | `list`, `create`, `update`, `delete`, `getServiceCommands`, `getEffectiveServiceCommands`, `getEnvFiles`, `updateServiceCommands` |
| `apps/web/src/server/routers/repos-finalize.ts` | — | `finalizeSetupHandler` — takes snapshot, stores secrets, creates/updates configuration |
| `apps/web/src/server/routers/secret-files.ts` | `secretFilesRouter` | Secret file CRUD per configuration |

### Services Layer

| File | What it does |
|---|---|
| `packages/services/src/repos/service.ts` | `listRepos`, `getRepo`, `createRepo`, `deleteRepo`, `repoExists`, `getServiceCommands`, `updateServiceCommands`, `requestRepoSnapshotBuild` |
| `packages/services/src/repos/db.ts` | DB queries for repos (CRUD, connections, snapshot status) |
| `packages/services/src/repos/mapper.ts` | Maps DB rows → API response shapes |
| `packages/services/src/prebuilds/service.ts` | `listPrebuilds`, `createPrebuild`, `updatePrebuild`, `deletePrebuild`, `getEffectiveServiceCommands`, `prebuildBelongsToOrg` |
| `packages/services/src/prebuilds/db.ts` | DB queries for configurations (CRUD, junction table ops, ownership checks) |
| `packages/services/src/prebuilds/mapper.ts` | Maps DB rows → API response shapes |
| `packages/services/src/secrets/service.ts` | Encryption orchestration, secret CRUD |
| `packages/services/src/secrets/db.ts` | DB queries for secrets |
| `packages/services/src/sessions/sandbox-env.ts` | `buildSandboxEnvVars` — decrypts secrets for session creation |

### Services Types

| File | Types |
|---|---|
| `packages/services/src/types/repos.ts` | `DbCreateRepoInput`, `CreateRepoInput`, `CreateRepoResult` |
| `packages/services/src/types/prebuilds.ts` | `CreatePrebuildInput`, `CreatePrebuildRepoInput`, `UpdatePrebuildInput`, `CreatePrebuildFullInput`, `CreateManagedPrebuildInput`, `SnapshotRow` |

### Shared Contracts

| File | Exports |
|---|---|
| `packages/shared/src/contracts/repos.ts` | `RepoSchema`, `Repo`, `CreateRepoInputSchema`, `RepoPrebuildSchema`, `RepoSnapshotSchema`, `FinalizeSetupInputSchema`, `reposContract` |
| `packages/shared/src/contracts/prebuilds.ts` | `PrebuildSchema`, `Prebuild`, `PrebuildRepoSchema`, `CreatePrebuildInputSchema`, `UpdatePrebuildInputSchema` |

### Database Schema

| File | Tables |
|---|---|
| `packages/db/src/schema/schema.ts` | `repos` (L228-284), `configurations` (L286-348), `configurationRepos` (L1496-1525) |
| `packages/db/src/schema/repos.ts` | Original `repos` table + relations |
| `packages/db/src/schema/prebuilds.ts` | Original `prebuilds` + `prebuildRepos` tables + relations (still uses old names) |
| `packages/db/src/schema/relations.ts` | `reposRelations`, `configurationsRelations`, `configurationReposRelations` |

### Key Migrations

| File | What changed |
|---|---|
| `packages/db/drizzle/0000_baseline.sql` | Initial `prebuilds`, `prebuild_repos`, `repos` tables |
| `packages/db/drizzle/0008_repo_snapshots.sql` | Added `repo_snapshot_*` columns to repos |
| `packages/db/drizzle/0010_prebuild_service_commands.sql` | Added `service_commands` to prebuilds |
| `packages/db/drizzle/0021_prebuild_connectors.sql` | Added `connectors` to prebuilds |
| **`packages/db/drizzle/0025_vnext_phase0.sql`** | **CRITICAL**: Renamed `prebuilds → configurations`, `prebuild_repos → configuration_repos`, added `configuration_secrets`, `secret_files`, dropped `secret_bundles` |

### Gateway / Session Creation

| File | What it does |
|---|---|
| `apps/gateway/src/lib/session-creator.ts` | Full session creation flow — resolves configuration, decrypts secrets, creates sandbox |
| `apps/gateway/src/lib/prebuild-resolver.ts` | Resolves configuration by ID, managed, or CLI mode |
| `packages/shared/src/snapshot-resolution.ts` | `resolveSnapshotId` — L3 → L2 → L1 fallback |

### Specs

| File | Covers |
|---|---|
| `docs/specs/repos-prebuilds.md` | Repo CRUD, Prebuild/Configuration CRUD, snapshot builds, service commands |
| `docs/specs/secrets-environment.md` | Secret CRUD, encryption, env files, bundles (deprecated) |
| `docs/specs/feature-registry.md` | Section 9: "Repos, Configurations & Prebuilds" |

---

## 5. Current UI Hierarchy vs. Desired

### Current (Repo-centric)

```
Sidebar: "Repos" → /dashboard/repos
  └─ Page title: "Repositories"
     └─ Table: [Name | Branch | Configurations | Status]
        └─ RepoRow (expandable)
           └─ RepoConfigurations
              └─ ConfigurationRow (per snapshot/prebuild)
                 └─ EnvFileSummary + ManageSecretsDialog
              └─ "New configuration" button
        └─ "Add Repository" button

/dashboard/repos/[id]
  └─ RepoDetailPage
     └─ ConfigurationsSection (lists snapshots for this repo)
     └─ ServiceCommandsSection (repo-level commands)
```

### Desired (Configuration-centric)

Configurations should be the top-level entity. Repos are things you attach to a configuration. Users should be able to:

1. Create configurations independently (without a repo first)
2. Attach repos to a configuration
3. See configurations as the primary list, not repos

---

## 6. Every Place That Needs to Change

### URL/Route changes

- `/dashboard/repos` → needs to become configuration-centric (e.g., `/dashboard/configurations`)
- `/dashboard/repos/[id]` → configuration detail page instead

### Sidebar & navigation

- `sidebar.tsx:608-611` — Label `"Repos"` → `"Configurations"` (or similar)
- `sidebar.tsx:194-205` — Collapsed icon tooltip `"Repos"` → update
- `layout.tsx:24` — `"/dashboard/repos": "Repos"` → update

### Page components

- `repos/page.tsx` — `RepositoriesPage` needs full restructure: configurations as top-level rows, repos nested inside
- `repos/[id]/page.tsx` — `RepoDetailPage` → should become configuration detail
- `repos/page.tsx:141` — Column header already says "Configurations" (good!)

### Components

- `configuration-group.tsx` — Already uses "Configuration" naming (good)
- `snapshot-selector.tsx` — Uses "Configuration name" (good)
- `add-snapshot-button.tsx` — Uses "New Configuration" (good)
- `repo-list.tsx` — Used in onboarding, may need updates
- `repo-picker.tsx` — Will change from "add repo to org" to "attach repo to configuration"
- `repo-selector.tsx` — Same

### Hooks

- `use-repos.ts` — Most hooks are repo-centric; need configuration-centric equivalents
- `use-prebuilds.ts` — Already has `usePrebuilds` (org-wide list), `useCreatePrebuild`, `useUpdatePrebuild`, `useDeletePrebuild`

### Backend routers

- `reposRouter` — Some procedures are repo-centric and fine (`list`, `get`, `create`, `delete`, `available`, `search`)
- `reposRouter.listPrebuilds` and `.listSnapshots` — These get configurations **via repo ID**; may need standalone endpoints
- `reposRouter.finalizeSetup` — Currently scoped to repo ID; may need to work from configuration ID
- `prebuildsRouter` — Already has configuration-centric CRUD; this is the correct model

### Shared contracts

- `RepoSchema` has `prebuildStatus` and `prebuildId` fields — coupling repo to a single configuration
- `RepoSnapshotSchema` — used to list configurations under a repo; needs a standalone version
- `repos.ts` contract paths like `/repos/:id/snapshots` — need configuration-centric alternatives

### Service layer

- `repos/service.ts` — Repo service is fine for repo CRUD
- `prebuilds/service.ts` — Already configuration-centric; this becomes the primary service
- `prebuilds/db.ts` — Already queries `configurations` table; most of this is correct

### DB schema

- `configurations` table already exists and is the correct entity (good!)
- `configuration_repos` junction table already exists (good!)
- `repos` table stays as-is for GitHub metadata
- No schema changes needed — the data model already supports configurations as first-class

### Specs

- `docs/specs/repos-prebuilds.md` — Title and content need to reflect configurations as primary
- `docs/specs/feature-registry.md` — Section 9 header needs update

---

## 7. Key Takeaway

**The backend/data model is already 90% correct.** The DB renamed `prebuilds → configurations` in migration 0025. The services layer already supports configuration-centric CRUD. The main work is:

1. **UI restructure**: Flip the hierarchy — configurations become the top-level list, repos are nested/attached
2. **New UI flows**: "Create configuration" (standalone, without pre-selecting a repo)
3. **Route changes**: `/dashboard/repos` → `/dashboard/configurations`
4. **Contract cleanup**: Add configuration-centric query endpoints (list all configurations for org, not just per-repo)
5. **Naming alignment**: Rename remaining "prebuild" references in services/contracts/hooks to "configuration"
6. **Spec updates**: Reflect the new hierarchy in `repos-prebuilds.md`

---

## Appendix A: Database Table Definitions

### `configurations` table (from `packages/db/src/schema/schema.ts:286-348`)

```typescript
export const configurations = pgTable(
  "configurations",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    snapshotId: text("snapshot_id"),
    status: text().default("building"),       // 'building' | 'ready' | 'failed'
    error: text(),
    createdBy: text("created_by"),
    name: text().notNull(),
    notes: text(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
    sandboxProvider: text("sandbox_provider").default("modal").notNull(),
    userId: text("user_id"),                  // CLI only
    localPathHash: text("local_path_hash"),   // CLI only
    type: text().default("manual"),           // 'manual' | 'managed' | 'cli'
    serviceCommands: jsonb("service_commands"),
    serviceCommandsUpdatedAt: timestamp("service_commands_updated_at", { withTimezone: true, mode: "date" }),
    serviceCommandsUpdatedBy: text("service_commands_updated_by"),
    envFiles: jsonb("env_files"),
    envFilesUpdatedAt: timestamp("env_files_updated_at", { withTimezone: true, mode: "date" }),
    envFilesUpdatedBy: text("env_files_updated_by"),
    connectors: jsonb("connectors"),
    connectorsUpdatedAt: timestamp("connectors_updated_at", { withTimezone: true, mode: "date" }),
    connectorsUpdatedBy: text("connectors_updated_by"),
  },
);
```

### `configuration_repos` junction table (from `packages/db/src/schema/schema.ts:1496-1525`)

```typescript
export const configurationRepos = pgTable(
  "configuration_repos",
  {
    configurationId: uuid("configuration_id").notNull(),
    repoId: uuid("repo_id").notNull(),
    workspacePath: text("workspace_path").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.configurationId, table.repoId] }),
    foreignKey({ columns: [table.configurationId], foreignColumns: [configurations.id] }).onDelete("cascade"),
    foreignKey({ columns: [table.repoId], foreignColumns: [repos.id] }).onDelete("cascade"),
  ],
);
```

### `repos` table (from `packages/db/src/schema/schema.ts:228-284`)

```typescript
export const repos = pgTable(
  "repos",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    organizationId: text("organization_id").notNull(),
    githubUrl: text("github_url").notNull(),
    githubRepoId: text("github_repo_id").notNull(),
    githubRepoName: text("github_repo_name").notNull(),
    defaultBranch: text("default_branch").default("main"),
    setupCommands: text("setup_commands").array(),
    detectedStack: jsonb("detected_stack"),
    isOrphaned: boolean("is_orphaned").default(false),
    addedBy: text("added_by"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow(),
    source: text().default("github"),           // 'github' | 'local'
    isPrivate: boolean("is_private").default(false),
    localPathHash: text("local_path_hash"),
    repoSnapshotId: text("repo_snapshot_id"),   // Layer 2 snapshot
    repoSnapshotStatus: text("repo_snapshot_status"),
    repoSnapshotError: text("repo_snapshot_error"),
    repoSnapshotCommitSha: text("repo_snapshot_commit_sha"),
    repoSnapshotBuiltAt: timestamp("repo_snapshot_built_at", { withTimezone: true, mode: "date" }),
    repoSnapshotProvider: text("repo_snapshot_provider"),
    serviceCommands: jsonb("service_commands"),
    serviceCommandsUpdatedAt: timestamp("service_commands_updated_at", { withTimezone: true, mode: "date" }),
    serviceCommandsUpdatedBy: text("service_commands_updated_by"),
  },
);
```

### `secrets` table

```typescript
secrets {
  id: UUID PRIMARY KEY
  organizationId: TEXT (FK → organization, CASCADE)
  repoId: UUID (FK → repos, CASCADE)         // NULL = org-wide
  prebuildId: UUID (FK → configurations, CASCADE) // NULL = not config-scoped
  key: TEXT NOT NULL
  encryptedValue: TEXT                        // iv:authTag:ciphertext (AES-256-GCM)
  secretType: 'env' | 'docker_registry' | 'file'
  description: TEXT
  UNIQUE(organizationId, repoId, key, prebuildId)
}
```

### `configuration_secrets` junction table

```typescript
configuration_secrets {
  configurationId: UUID (FK → configurations, CASCADE)
  secretId: UUID (FK → secrets, CASCADE)
  PRIMARY KEY (configurationId, secretId)
}
```

### `secret_files` table

```typescript
secret_files {
  id: UUID PRIMARY KEY
  organizationId: TEXT
  configurationId: UUID (FK → configurations)
  filePath: TEXT
  encryptedContent: TEXT
  UNIQUE(organizationId, configurationId, filePath)
}
```

---

## Appendix B: Shared Contract Schemas

### `RepoSchema` (from `packages/shared/src/contracts/repos.ts:97-112`)

```typescript
export const RepoSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string(),
  githubRepoId: z.string(),
  githubRepoName: z.string(),
  githubUrl: z.string(),
  defaultBranch: z.string().nullable(),
  createdAt: z.string().nullable(),
  source: z.string(),
  isPrivate: z.boolean(),
  prebuildStatus: z.enum(["ready", "pending"]),  // ← couples repo to config
  prebuildId: z.string().nullable(),              // ← couples repo to config
  isConfigured: z.boolean(),
});
```

### `PrebuildSchema` (from `packages/shared/src/contracts/prebuilds.ts`)

```typescript
export const PrebuildSchema = z.object({
  id: z.string().uuid(),
  snapshotId: z.string().nullable(),
  status: z.string().nullable(),
  name: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string().nullable(),
  createdBy: z.string().nullable(),
  sandboxProvider: z.string().nullable(),
  prebuildRepos: z.array(PrebuildRepoSchema).optional(),
  setupSessions: z.array(SetupSessionSchema).optional(),
});
```

### `RepoSnapshotSchema` (from `packages/shared/src/contracts/repos.ts:49-76`)

```typescript
export const RepoSnapshotSchema = z.object({
  id: z.string(),
  snapshotId: z.string().nullable(),
  status: z.string().nullable(),
  name: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  createdBy: z.string().nullable(),
  setupSessions: z.array(z.object({
    id: z.string(),
    sessionType: z.string().nullable(),
  })).optional(),
  repos: z.array(z.object({
    id: z.string(),
    githubRepoName: z.string(),
  })).optional(),
  repoCount: z.number().optional(),
});
```

---

## Appendix C: Session Creation Data Flow

```
1. Client requests session
   ↓
2. resolvePrebuild(prebuildId | managedPrebuild | cliPrebuild)
   ↓
   ├─ Direct: fetch configuration by ID
   ├─ Managed: find existing or create with all org repos
   └─ CLI: find existing or create device-scoped
   Result: ResolvedPrebuild { id, snapshotId, repoIds, isNew }
   ↓
3. createSession(prebuildId, repoIds)
   ├─ Resolve snapshotId (Layer 3 ← Layer 2 ← Layer 1)
   ├─ Fetch configuration + configuration_repos details
   ├─ Load GitHub tokens for each repo
   ├─ Decrypt secrets for (org_id, repo_ids, [prebuild_id])
   ├─ Build env file specs from configuration.envFiles
   └─ Create sandbox with snapshot + secrets
   Result: SessionResult { sessionId, prebuildId, snapshotId }
   ↓
4. Agent runs in sandbox
   ├─ Accesses decrypted env vars (INJECTED AT BOOT)
   ├─ Can request more secrets via request_env_variables tool
   │   └─ User persists → encrypted + stored in secrets table
   └─ Modifies files in workspace
   ↓
5. Session finalization (setup type)
   ├─ Take filesystem snapshot → snapshotId (Layer 3)
   ├─ Store any new secrets (encrypted)
   ├─ Create or update configuration with snapshotId
   ├─ Create configuration_repos entries
   └─ Update session.prebuildId
   Result: FinalizeSetupResult { prebuildId, snapshotId }
```

---

## Appendix D: Service Command Resolution

Service commands can be set at both repo level and configuration level. Resolution priority:

1. **Configuration-level** overrides (stored in `configurations.serviceCommands`)
2. **Repo-level** defaults (stored in `repos.serviceCommands`)
3. **None** — no commands configured

This is implemented in `packages/services/src/prebuilds/service.ts:getEffectiveServiceCommands()`.
