# Configurations & Snapshots — System Spec

## 1. Scope & Purpose

This spec documents the **Configurations & Snapshots** subsystem — the target-state architecture for org-scoped configuration records, first-class snapshot entities, config-scoped secret files, and simplified service commands.

### In Scope
- `configurations` table, all FK columns use `configuration_id`
- First-class `snapshots` table (lifecycle: building → ready → failed)
- `snapshot_repos` table (per-repo commit tracking per snapshot)
- `secret_files` + `configuration_secrets` tables (config-scoped env files)
- `organization_id` on configurations (direct ownership, no traversal through repos)
- `active_snapshot_id` on configurations (direct snapshot reference, no fallback chain)
- Setup commands + service commands on configuration only (no repo-level commands, no precedence logic)
- Secret files CRUD API (web router)

### Out of Scope
- Session creation mechanics (owned by `sessions-gateway.md`)
- Sandbox boot and env apply/scrub (owned by `sandbox-providers.md`)
- Connector credentials in the `secrets` table (unchanged, owned by `secrets-environment.md`)
- Repo CRUD, base snapshot build worker (owned by `repos.md`)

### Mental Model

A **Configuration** is the mapping between an org and one or more repos. It defines how repos should be set up inside a sandbox: which repos, where to clone them (`workspacePath`), what service commands to run, and what env files to inject. Every configuration belongs to an organization directly (`organization_id`).

A **Snapshot** is a captured filesystem state — an artifact produced from a configuration. Snapshots are first-class entities with their own lifecycle (`building` → `ready` → `failed`). A configuration points to an **active snapshot** (`active_snapshot_id`) — the one used when a session boots. Older snapshots are retained for history.

**Secret files** are the equivalent of `.env.local` in a typical dev workflow. Each file is attached to a configuration with a code path (folder + filename). Users create and manage them entirely through the UI — Vercel-like key/value editor with paste support. At boot, secret values are decrypted and written to the sandbox as part of `setupEssentialDependencies`.

**Key simplifications over the old model:**
- No 3-layer snapshot fallback chain. Just: configuration → active snapshot → boot. If `active_snapshot_id` is null, boot from base image + fresh clone.
- No repo-level commands or precedence logic. Configuration is the single source of truth for both setup and service commands.
- No `env_files` JSONB. Secret files are normalized relational storage.
- No user-facing CLI product. The package, backend routes, services, DB tables, contracts, CI/CD workflow, device auth page, and spec are all deleted. The sandbox CLI (`proliferate` commands inside sandboxes) is unaffected.
- No `secret_bundles`. Config-scoped `secret_files` replace bundles entirely.
- No `save_env_files` agent tool. Secret management is user-only through the web UI.

---

## 2. Core Concepts

### Configuration
An org-scoped record that groups one or more repos with setup instructions. Created automatically when repos are added, or manually by users. Links repos via `configuration_repos` junction table with per-repo `workspace_path`.

- Key detail agents get wrong: All FK columns across the schema use `configuration_id` (not `prebuildId`).
- Reference: `packages/db/src/schema/schema.ts:configurations`

### Active Snapshot
A configuration's `active_snapshot_id` points to a `snapshots` row with `status = 'ready'`. Set automatically when `markSnapshotReady()` completes. Only ready snapshots can be active.

- Key detail agents get wrong: `active_snapshot_id` stores the UUID of the `snapshots` row, not the provider snapshot ID string. The `providerSnapshotId` (e.g., Modal's snapshot reference) is a field on the `snapshots` row itself.
- Reference: `packages/services/src/snapshots/db.ts:markReady`, `packages/services/src/snapshots/db.ts:getActiveSnapshot`

### Service Auto-Start (Simplified)

**Invariant:** Snapshots can only be created from running sessions where setup has completed (setup finalize or agent `save_snapshot`). This means every snapshot has dependencies installed by definition — there is no code path that creates a snapshot before setup commands have run. This invariant is enforced structurally: the only callers of `snapshots.createSnapshot()` are the setup finalization flow and the agent's `save_snapshot` tool, both of which execute after the full setup sequence.

Given this invariant, auto-start is gated purely on snapshot existence:
- If `active_snapshot_id` is set → auto-start services (deps are guaranteed installed).
- If null → don't auto-start (no snapshot, fresh clone — setup commands will install deps).

No `has_deps` column needed. No heuristic needed.

### Snapshot Resolution (Simplified)
```
1. Look up configuration for the session
2. Read active_snapshot_id
3. If set → boot from that snapshot (use snapshot.provider_snapshot_id), auto-start services
4. If null → boot from base image + fresh clone, no service auto-start
```

No fallback chain. No repo snapshot layer. No `resolveSnapshotId()`. No `has_deps` flag.

### Commands (Two Types)
A configuration stores two distinct sets of commands. Both live only on the configuration — no repo-level commands, no precedence resolution.

**Setup commands** prepare the workspace. They run sequentially at the start of every session boot (after clone/snapshot restore, before services start). Examples: `npm install`, `git pull`, `pip install -r requirements.txt`, database migrations. These ensure the workspace is up-to-date even if the snapshot is stale.

**Service commands** run ongoing background processes. They're managed by the sandbox's service manager and kept alive for the duration of the session. Examples: `npm run dev`, `redis-server`, `docker compose up`. These only auto-start when the configuration has an active snapshot (deps are guaranteed installed per the snapshot invariant — see §2 Service Auto-Start).

- Key detail agents get wrong: These are two separate fields on the configuration, not one. Setup commands are one-shot sequential steps. Service commands are long-running managed processes. Don't conflate them.
- Key detail agents get wrong: There is no `getEffectiveServiceCommands()` merging logic. Just read from the configuration directly.
- Reference: `packages/db/src/schema/schema.ts:configurations`

### Secret Files
The equivalent of `.env.local` in a typical engineer's dev workflow — nothing more, nothing less. All other external service access is intermediated through the action gateway.

**Structure:** A secret file is associated with a configuration and a code path (workspace folder + filename, e.g., `app/.env.local`). Each file contains distinct encoded secret values (`KEY=value` pairs). Users manage secret files entirely through the UI — the agent has no involvement.

**Injection:** Secret files are attached as part of `setupEssentialDependencies` to the relevant code path. At session boot, only secrets with non-null encrypted values are decrypted and written.

- Key detail agents get wrong: `configuration_secrets` is a separate table from `secrets`. The `secrets` table stores connector credentials (org-scoped). `configuration_secrets` stores per-env-file key/value pairs (config-scoped).
- Key detail agents get wrong: There is no `save_env_files` agent tool. Secret management is user-only.
- Reference: `packages/services/src/secret-files/service.ts`, `apps/web/src/server/routers/secrets.ts:secretFilesRouter`

### Secret Files UX

**During setup session** — users are given the option to create new secret files:
1. File browser UI to choose the target folder (e.g., `app/`) and specify the filename (e.g., `.env.local`).
2. Vercel-like key/value editor: paste newline-separated `KEY=value` rows that auto-populate the respective fields, then save.

**Editing existing secret files** — a configuration editing view (Vercel-like) where users can view, add, update, and remove secret values. Same key/value editor.

### Env Injection Flow
```
Boot-time (part of setupEssentialDependencies):
  1. Fetch secret_files for configuration
  2. For each secret_file, fetch configuration_secrets with encrypted_value IS NOT NULL
  3. Decrypt values → build file contents (KEY=VALUE per line)
  4. Write each .env file directly via provider filesystem API
     e.g. write to /workspace/app/.env.local

Snapshot scrub (still uses sandbox CLI):
  Before snapshot: `proliferate env scrub` deletes secret files from sandbox filesystem
  After snapshot boot: gateway re-writes secret files via provider filesystem API (same as boot-time)
```

---

## 3. File Tree

```
packages/db/src/schema/
├── schema.ts                        # Tables: configurations, configurationRepos, snapshots, snapshotRepos,
│                                    # secretFiles, configurationSecrets
└── relations.ts                     # Relations for all configuration/snapshot tables

packages/db/drizzle/
├── 0024_configurations_snapshots_expand.sql   # Expand: add new tables + columns
└── 0025_configurations_snapshots_contract.sql # Contract: rename tables, drop old columns/tables

packages/services/src/
├── configurations/                  # Configuration CRUD, service commands
│   ├── db.ts                        # Configuration DB operations (CRUD, service commands)
│   ├── mapper.ts                    # DB row → API type conversion
│   └── service.ts                   # Configuration business logic
├── snapshots/
│   ├── db.ts                        # Snapshot DB operations (create, markReady, markFailed, find, list)
│   ├── service.ts                   # Snapshot business logic
│   └── index.ts                     # Re-exports
├── secret-files/
│   ├── db.ts                        # Secret files DB operations (CRUD, boot queries)
│   ├── service.ts                   # Secret files business logic (encrypt/decrypt)
│   └── index.ts                     # Re-exports
└── index.ts                         # Exports: configurations, snapshots, secretFiles modules

apps/gateway/src/
├── hub/
│   ├── session-hub.ts               # save_snapshot → snapshots.createSnapshot + markSnapshotReady
│   └── capabilities/tools/
│       └── save-service-commands.ts  # Agent tool: writes to configurations service
└── lib/
    ├── configuration-resolver.ts    # Configuration resolver (no CLI path)
    ├── session-creator.ts           # Reads active_snapshot_id directly, no fallback chain
    └── session-store.ts             # Service auto-start gated by snapshot existence

apps/web/src/server/routers/
├── configurations.ts                # Configuration oRPC routes
├── secrets.ts                       # secretFilesRouter: list, createFile, deleteFile, upsertSecret, deleteSecret
├── repos-finalize.ts                # Setup finalization → snapshot + configuration update
└── index.ts                         # Registers routers

apps/web/src/components/
├── secret-files/
│   ├── secret-file-editor.tsx       # Vercel-like key/value editor (paste support, auto-populate)
│   ├── secret-file-list.tsx         # List of secret files for a configuration
│   └── file-path-picker.tsx         # File browser UI to choose folder + filename
└── configuration/
    └── configuration-settings.tsx   # Configuration editing view (includes secret files section)

apps/web/src/hooks/
└── use-secret-files.ts              # TanStack Query hooks for secret files CRUD

apps/worker/src/
└── base-snapshots/                  # Base snapshot worker (unchanged)
    └── index.ts
# NOTE: repo-snapshots/ directory deleted (no repo snapshot layer)

# DELETED — Full CLI product removal:
# packages/cli/                      # Entire Deno CLI package
# packages/services/src/cli/         # CLI service + DB layer
# packages/db/src/schema/cli.ts      # CLI DB tables (user_ssh_keys, cli_device_codes, cli_github_selections)
# packages/shared/src/contracts/cli.ts  # CLI Zod schemas
# apps/web/src/server/routers/cli.ts    # CLI oRPC router (6 sub-routers)
# apps/web/src/app/api/cli/            # CLI API routes
# apps/web/src/app/device/             # Device code auth page
# .github/workflows/release-cli.yml    # CLI release pipeline
# docs/specs/cli.md                     # CLI spec
```

---

## 4. Data Models & Schemas

### Database Tables

```sql
configurations
├── id                         UUID PRIMARY KEY
├── organization_id            TEXT NOT NULL (FK → organization)
├── name                       TEXT NOT NULL
├── description                TEXT
├── active_snapshot_id         UUID (FK → snapshots, ON DELETE SET NULL)
├── sandbox_provider           TEXT DEFAULT 'modal'   -- CHECK: modal/e2b
├── setup_commands             JSONB                  -- sequential one-shot commands (npm install, git pull, etc.)
├── service_commands           JSONB                  -- long-running managed processes (npm run dev, redis-server, etc.)
├── created_at                 TIMESTAMPTZ
└── updated_at                 TIMESTAMPTZ
    UNIQUE(organization_id, name)
    INDEX ON organization_id
    CHECK sandbox_provider IN ('modal', 'e2b')

configuration_repos
├── configuration_id           UUID NOT NULL (FK → configurations, CASCADE)
├── repo_id                    UUID NOT NULL (FK → repos, CASCADE)
├── workspace_path             TEXT NOT NULL           -- '.' for single-repo, repo name for multi
└── created_at                 TIMESTAMPTZ
    PK(configuration_id, repo_id)
    UNIQUE(configuration_id, workspace_path)

snapshots
├── id                         UUID PRIMARY KEY
├── configuration_id           UUID NOT NULL (FK → configurations, CASCADE)
├── provider_snapshot_id       TEXT                    -- Modal/E2B snapshot reference (null while building)
├── sandbox_provider           TEXT                    -- CHECK: modal/e2b (provider that built this snapshot)
├── status                     TEXT NOT NULL DEFAULT 'building'  -- CHECK: building/ready/failed
├── error                      TEXT
├── created_at                 TIMESTAMPTZ
└── updated_at                 TIMESTAMPTZ
    INDEX ON configuration_id
    CHECK sandbox_provider IN ('modal', 'e2b')

snapshot_repos
├── snapshot_id                UUID NOT NULL (FK → snapshots, CASCADE)
├── repo_id                    UUID NOT NULL (FK → repos, CASCADE)
├── commit_sha                 TEXT                    -- Git commit captured in this snapshot
└── created_at                 TIMESTAMPTZ
    PK(snapshot_id, repo_id)

secret_files
├── id                         UUID PRIMARY KEY
├── configuration_id           UUID NOT NULL (FK → configurations, CASCADE)
├── workspace_path             TEXT NOT NULL DEFAULT '.'
├── file_path                  TEXT NOT NULL            -- e.g. '.env.local', '.env'
├── mode                       TEXT NOT NULL DEFAULT 'secret'
├── created_at                 TIMESTAMPTZ
└── updated_at                 TIMESTAMPTZ
    UNIQUE(configuration_id, workspace_path, file_path)
    INDEX ON configuration_id

configuration_secrets
├── id                         UUID PRIMARY KEY
├── secret_file_id             UUID NOT NULL (FK → secret_files, CASCADE)
├── key                        TEXT NOT NULL            -- e.g. 'DATABASE_URL'
├── encrypted_value            TEXT                     -- null = placeholder (not yet filled in)
├── required                   BOOLEAN NOT NULL DEFAULT false
├── created_at                 TIMESTAMPTZ
└── updated_at                 TIMESTAMPTZ
    UNIQUE(secret_file_id, key)
    INDEX ON secret_file_id

secrets (connector credentials only)
  -- Org-scoped connector credentials. No bundle_id, no secret_bundles table.

sessions
  -- configuration_id UUID (FK → configurations, ON DELETE SET NULL)

automations
  -- default_configuration_id UUID (FK → configurations, ON DELETE SET NULL)
```

### Core TypeScript Types

```typescript
// packages/services/src/snapshots/service.ts
interface CreateSnapshotInput {
  configurationId: string;
  sandboxProvider: string;
}

interface MarkSnapshotReadyInput {
  snapshotId: string;
  providerSnapshotId: string;
  repoCommits?: Array<{ repoId: string; commitSha: string }>;
}

// packages/services/src/snapshots/db.ts
type SnapshotRow = InferSelectModel<typeof snapshots>;

interface SnapshotWithReposRow extends SnapshotRow {
  snapshotRepos: Array<{ repoId: string; commitSha: string | null }>;
}

// packages/services/src/secret-files/db.ts
type SecretFileRow = InferSelectModel<typeof secretFiles>;
type ConfigurationSecretRow = InferSelectModel<typeof configurationSecrets>;

interface SecretFileWithKeysRow extends SecretFileRow {
  configurationSecrets: Array<{
    id: string;
    key: string;
    encryptedValue: string | null;  // "[encrypted]" for listing, null for unfilled
    required: boolean;
  }>;
}

// packages/services/src/secret-files/service.ts
interface DecryptedBootSecrets {
  workspacePath: string;
  filePath: string;
  mode: string;
  vars: Record<string, string>;  // Decrypted key-value pairs
}

// apps/gateway/src/lib/configuration-resolver.ts
interface ResolvedConfiguration {
  id: string;
  activeSnapshotId: string | null;
  repoIds: string[];
  isNew: boolean;
}
```

---

## 5. Conventions & Patterns

### Do
- Use `packages/services/src/configurations/` for all configuration DB access.
- Use `packages/services/src/snapshots/` for all snapshot DB access.
- Use `packages/services/src/secret-files/` for all secret file DB access.
- Use `configurations.organization_id` for authorization checks (direct column, no traversal).
- Use ownership-scoped functions (`deleteSecretFileByConfiguration`, `findSecretFileByConfiguration`, `deleteSecretByConfiguration`) for API CRUD — never delete by bare ID.
- Read `active_snapshot_id` directly. If null, boot without snapshot.
- Auto-start services when a snapshot exists. No `has_deps` flag or heuristic.

### Don't
- Don't add service commands to repos. Configuration is the single source of truth.
- Don't implement snapshot fallback chains. If no active snapshot, boot clean.
- Don't use the old `secrets` table for session env files. Use `secret_files` + `configuration_secrets`.
- Don't add user-facing CLI fields or code paths. The user-facing CLI product is removed.
- Don't skip `requireConfigurationAccess()` in secret files routes.

### Error Handling
Routes map service errors to oRPC error codes:
```typescript
const deleted = await secretFiles.deleteSecretFileByConfiguration(input.id, input.configurationId);
if (!deleted) {
  throw new ORPCError("NOT_FOUND", { message: "Secret file not found" });
}
```

### Security
- **Authorization**: `orgProcedure` → `requireConfigurationAccess(configurationId, orgId)` checks `configurations.organization_id` directly (no repo traversal needed).
- **IDOR prevention**: All secret file and configuration secret mutations use ownership-scoped DB functions that verify the target row belongs to the specified configuration.
- **Encryption**: `upsertSecretValue()` encrypts plaintext with `AES-256-GCM` before storing. `getSecretsForBoot()` decrypts at boot time. Never log decrypted values.
- **Listing**: `listByConfiguration()` replaces encrypted values with `"[encrypted]"` sentinel — actual ciphertext never leaves the services layer.

---

## 6. Subsystem Deep Dives

### 6.1 Configuration CRUD

**What it does:** Manages org-scoped configuration records. Lives in `packages/services/src/configurations/`.

**Create** (from repo add flow):
1. Auto-create configuration with `name` derived from repo name, `organization_id` from org.
2. Insert `configuration_repos` entry with `workspace_path: "."` (single-repo) or repo name (multi-repo).
3. Trigger base snapshot build if needed.

**Update:** Name, description, setup commands, service commands.

**Delete:** Hard-delete; cascades remove `configuration_repos`, `snapshots`, `secret_files`.

**Authorization:** Check `configurations.organization_id = orgId` directly. No repo traversal.

**Key constraints:** No `status`, `error`, `type`, `user_id`, `local_path_hash`, `env_files`, `connectors` columns. No CLI type. No managed type differentiation in schema (managed is just a configuration with all org repos).

### 6.2 Snapshots Service

**What it does:** Manages first-class snapshot entities with lifecycle tracking.

**Create** (`packages/services/src/snapshots/service.ts:createSnapshot`):
1. Generate UUID.
2. Insert into `snapshots` with `status: 'building'`.

**Mark Ready** (`packages/services/src/snapshots/db.ts:markReady`):
1. Update snapshot: set `status: 'ready'`, `providerSnapshotId`.
2. Insert `snapshot_repos` entries with commit SHAs.
3. Set `active_snapshot_id` on the parent configuration.

**Mark Failed** (`packages/services/src/snapshots/db.ts:markFailed`):
1. Update snapshot: set `status: 'failed'`, `error` message.

**Active Snapshot Query** (`packages/services/src/snapshots/db.ts:getActiveSnapshot`):
1. Read `active_snapshot_id` from configuration.
2. Fetch snapshot row, verify `status = 'ready'`.
3. Return null if not set or not ready.

**Integrity:** `active_snapshot_id` must point to a snapshot with matching `configuration_id` and `status = 'ready'`. Enforced at the service layer in `markSnapshotReady()`.

**Files touched:** `packages/services/src/snapshots/db.ts`, `packages/services/src/snapshots/service.ts`

### 6.3 Secret Files Service

**What it does:** Manages config-scoped env file definitions and their encrypted key/value pairs.

**List** (`packages/services/src/secret-files/db.ts:listByConfiguration`):
1. Query `secret_files` for configuration with `configurationSecrets` relation.
2. Strip encrypted values — replace with `"[encrypted]"` or `null`.

**Create File:**
1. Insert `secret_files` row with `configurationId`, `filePath`, `workspacePath`, `mode`.

**Upsert Secret Value** (`packages/services/src/secret-files/service.ts:upsertSecretValue`):
1. Get encryption key from env.
2. Encrypt plaintext value with AES-256-GCM.
3. Upsert `configuration_secrets` row (insert or update by `secret_file_id + key`).

**Boot Secrets** (`packages/services/src/secret-files/service.ts:getSecretsForBoot`):
1. Query `secret_files` + `configuration_secrets` where `encrypted_value IS NOT NULL`.
2. Decrypt each value.
3. Return `DecryptedBootSecrets[]` — files with `vars: Record<string, string>`.

**Ownership-scoped operations:**
- `deleteSecretFileByConfiguration(id, configurationId)`: Deletes only if ownership matches.
- `findSecretFileByConfiguration(id, configurationId)`: Finds only if ownership matches.
- `deleteSecretByConfiguration(secretId, configurationId)`: Joins through `secret_file` to verify ownership.

**Files touched:** `packages/services/src/secret-files/db.ts`, `packages/services/src/secret-files/service.ts`

### 6.4 Snapshot Save (Agent Tool)

**What it does:** When the agent calls `save_snapshot`, captures the sandbox state and creates a snapshot record.

**Flow** (`apps/gateway/src/hub/session-hub.ts`):
1. Call provider to snapshot the sandbox → get `providerSnapshotId`.
2. `snapshots.createSnapshot({ configurationId, sandboxProvider })` → inserts building row.
3. `snapshots.markSnapshotReady({ snapshotId, providerSnapshotId, repoCommits })` → marks ready, sets `active_snapshot_id`.

Snapshots table is the sole destination.

### 6.5 Session Boot (Snapshot + Secrets)

**What it does:** At session creation, resolves the snapshot and secrets from the configuration.

**Snapshot resolution** (`apps/gateway/src/lib/session-creator.ts`):
1. Read `configurations.active_snapshot_id`.
2. If set: fetch snapshot, use `snapshot.provider_snapshot_id` for sandbox boot. Auto-start services.
3. If null: boot from base image + fresh clone. No service auto-start.

**Secret injection:**
1. `secretFiles.getSecretsForBoot(configurationId)` → `DecryptedBootSecrets[]`.
2. For each file: build dotenv contents (`KEY=VALUE` per line).
3. Write each `.env` file directly to the sandbox via provider filesystem API (no `proliferate env apply`).

`proliferate env scrub` still runs inside the sandbox before snapshot to clean secret files. Other sandbox CLI commands (service management, etc.) are unaffected.

Connector credentials (`resolveSecretValue(orgId, key)`) remain in the `secrets` table — untouched.

### 6.6 Secret Files API

**What it does:** CRUD endpoints for managing config-scoped env files via the web app.

**Router:** `apps/web/src/server/routers/secrets.ts:secretFilesRouter`

**Endpoints:**
| Endpoint | Input | Output | Notes |
|----------|-------|--------|-------|
| `list` | `{ configurationId }` | `{ files: SecretFile[] }` | Lists files with keys, encrypted values masked |
| `createFile` | `{ configurationId, filePath, workspacePath?, mode? }` | `{ id }` | Creates a new secret file definition |
| `deleteFile` | `{ id, configurationId }` | `{ deleted: boolean }` | Ownership-scoped delete |
| `upsertSecret` | `{ configurationId, secretFileId, key, value, required? }` | `{ id }` | Encrypts value before storing |
| `deleteSecret` | `{ id, configurationId }` | `{ deleted: boolean }` | Ownership-scoped via join |

**Authorization chain:** `orgProcedure` → `requireConfigurationAccess(configurationId, orgId)` → ownership-scoped DB functions.

### 6.7 Secret Files UI — `Not Yet Implemented`
> **Note:** This section describes the target-state UI. The backend API (§6.6) is complete; the frontend components have not been built yet.

**What it does:** Lets users create and manage `.env` files for their configurations through a Vercel-like interface.

**Setup session flow** (creating new secret files):
1. User is prompted to create secret files during setup.
2. **File path picker**: browse/select target folder in the workspace (e.g., `app/`), then specify the filename (e.g., `.env.local`). Creates a `secret_files` row with the configuration + code path.
3. **Key/value editor**: Vercel-like form. Paste newline-separated `KEY=value` rows — fields auto-populate with parsed keys and values. Individual add/edit/remove for single entries. Save encrypts all values.

**Configuration editing view** (editing existing secret files):
1. Configuration settings page has a secret files section.
2. Lists all secret files for the configuration with their code paths.
3. Each file opens the same Vercel-like key/value editor for viewing, adding, updating, and removing values.
4. Delete a file removes the `secret_files` row and all its `configuration_secrets` (CASCADE).

**Paste UX:**
- User pastes multi-line text like `DATABASE_URL=postgres://...\nAPI_KEY=sk-...`
- Parser splits on newlines, splits each line on first `=`
- Auto-populates key/value fields in the editor
- User reviews, optionally edits, then saves

**Components:**
- `secret-file-editor.tsx` — Vercel-like key/value editor with paste support
- `secret-file-list.tsx` — list of secret files for a configuration
- `file-path-picker.tsx` — folder browser + filename input
- `use-secret-files.ts` — TanStack Query hooks for CRUD

### 6.8 Configuration Resolver

**What it does:** Resolves a configuration record for session creation. Lives in `apps/gateway/src/lib/configuration-resolver.ts`.

**Modes:**
- **Direct ID**: Look up by `configurationId`. Verify org membership.
- **Managed**: Find or create a configuration with all org repos (for Slack/universal clients).

No CLI path. CLI support is removed.

**Returns:** `ResolvedConfiguration { id, activeSnapshotId, repoIds, isNew }`.

### 6.9 CLI Deletion

The entire user-facing CLI product has been removed. All user interaction is through the web app. The sandbox CLI (`proliferate` commands inside sandboxes) is unaffected.

**Deleted artifacts:**

| Layer | Artifact |
|-------|----------|
| Package | `packages/cli/` (full Deno-based CLI) |
| Web routers | `apps/web/src/server/routers/cli.ts` (6 sub-routers, ~23 procedures) |
| API route | `apps/web/src/app/api/cli/sessions/route.ts` |
| Device auth UI | `apps/web/src/app/device/page.tsx`, `apps/web/src/app/device-github/page.tsx` |
| Services | `packages/services/src/cli/` (service.ts, db.ts) |
| DB tables | `user_ssh_keys`, `cli_device_codes`, `cli_github_selections` |
| DB schema file | `packages/db/src/schema/cli.ts` |
| Contracts | `packages/shared/src/contracts/cli.ts` |
| Gateway auth | CLI token verification removed from `apps/gateway/src/middleware/auth.ts` |
| CI/CD | `.github/workflows/release-cli.yml` |
| Spec | `docs/specs/cli.md` |

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| `repos.md` | This extends | `configurations` table | This spec owns configuration/snapshot concerns. `repos.md` covers repo CRUD + base snapshots only. |
| `sessions-gateway.md` | Gateway → This | `snapshots.getActiveSnapshot()` | Session creation reads active snapshot directly |
| `sessions-gateway.md` | Gateway → This | `active_snapshot_id` presence | Service auto-start gated by whether active snapshot exists |
| `secrets-environment.md` | This ← Secrets | `encrypt()`, `decrypt()`, `getEncryptionKey()` | Secret files service uses same AES-256-GCM encryption |
| `secrets-environment.md` | This → Secrets | `secrets` table | Connector credentials stay in `secrets` table (untouched). `secret_bundles` dropped. |
| `agent-contract.md` | Agent → This | `save_snapshot`, `save_service_commands` | Agent tools write to snapshots/configurations. No agent involvement in secrets. |
| `sandbox-providers.md` | Provider ← This | Snapshot ID + env vars | Session boot passes snapshot + decrypted secrets to provider |
| `cli.md` | Deleted | N/A | CLI product removed. `cli.md` deleted, spec #8 removed from boundary-brief registry. |

### Observability
- Snapshot lifecycle: `log.info({ snapshotId, configurationId, status }, "Snapshot state change")`
- Secret file operations: `log.info({ configurationId, fileCount }, "Env file spec saved")`
- Boot secrets: `log.info({ configurationId, fileCount, keyCount }, "Secrets loaded for boot")` (never log values)

---

## 8. Acceptance Gates

- [ ] All `prebuild` references renamed to `configuration` in code
- [ ] Migration runs cleanly (`pnpm -C packages/db db:migrate`)
- [ ] No snapshot fallback chain — direct `active_snapshot_id` read only
- [ ] No repo-level service commands — configuration only
- [ ] Secret files CRUD has ownership-scoped authorization
- [ ] Service auto-start gated by snapshot existence (no `has_deps` flag)
- [ ] CLI fully deleted (package, routes, services, DB tables, contracts, CI/CD, device auth page, spec)
- [ ] Repo snapshot worker deleted
- [ ] `secret_bundles` table dropped
- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm build`

---

## 9. Known Limitations & Tech Debt

- [ ] **Connector credentials still in old `secrets` table**: The `secrets` table is kept for org-scoped connector credentials (`resolveSecretValue(orgId, key)`). Migrating connectors to a dedicated table is a separate future effort.
- [ ] **`snapshot_repos` commit tracking is best-effort**: Commit SHAs are recorded when available (from sandbox snapshot results) but may be empty for snapshots taken without git context.
- [ ] **No webhook-driven snapshot rebuilds**: Snapshots are only rebuilt via setup sessions or agent tools. Push events to `defaultBranch` don't auto-trigger rebuilds. Git freshness pull at session start compensates.

---

## 10. Implementation Status

### Completed

The core refactor is complete (migrations `0024` expand + `0025` contract):

- Tables renamed: `prebuilds` → `configurations`, `prebuild_repos` → `configuration_repos`
- All FK columns renamed: `prebuild_id` → `configuration_id` across sessions, snapshots, secret_files, automations, secrets
- New tables: `snapshots`, `snapshot_repos`, `secret_files`, `configuration_secrets`
- `organization_id` and `active_snapshot_id` on configurations
- Services: `configurations/`, `snapshots/`, `secret-files/` modules
- Secret files CRUD API: `secretFilesRouter` in `apps/web/src/server/routers/secrets.ts`
- Gateway reads `active_snapshot_id` directly — no fallback chain, no dual-write
- Configuration resolver: `configuration-resolver.ts` (no CLI path)
- CLI product fully deleted (package, routes, services, DB tables, contracts, CI/CD, device auth page, spec)
- Repo snapshot worker and queue deleted
- `save_env_files` agent tool deleted (`save-env-files.ts` handler + `saveEnvFileSpec()` service function)
- `snapshot-resolution.ts` deleted (replaced by direct `active_snapshot_id` read)
- `secret_bundles` table and `secrets.bundle_id` column dropped
- Legacy columns dropped from configurations (snapshot_id, status, error, type, env_files, connectors, etc.)
- Repo snapshot columns and service command columns dropped from repos
- CLI DB tables dropped (user_ssh_keys, cli_device_codes, cli_github_selections)

### Not Yet Implemented

- Secret files UI: file path picker, Vercel-like key/value editor, paste support
- Configuration settings view with secret files section
- Wire secret files into `setupEssentialDependencies` (write .env files to sandbox at boot)
- Env injection at boot via provider filesystem API (replaces `proliferate env apply`; `proliferate env scrub` still used)
