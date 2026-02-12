# Secrets & Environment — System Spec

## 1. Scope & Purpose

### In Scope
- Secret CRUD (create, delete, list, check existence)
- Secret bundles CRUD (list, create, update metadata, delete)
- Bundle target path configuration for automatic env file generation
- Bulk import (`.env` paste flow)
- Secret encryption at rest (AES-256-GCM)
- Per-secret persistence toggle on environment submission
- Data flow: secrets from DB → gateway → sandbox environment variables
- Bundle-based env file spec generation at session boot

### Out of Scope
- `save_env_files` tool schema — see `agent-contract.md` §6
- `request_env_variables` tool schema — see `agent-contract.md` §6
- Sandbox env var injection mechanics (provider `createSandbox`, `writeEnvFile`) — see `sandbox-providers.md`
- Prebuild env file persistence (JSONB `envFiles` on prebuilds table) — see `repos-prebuilds.md`
- S3 for verification file storage (the gateway S3 module handles verification uploads, not secret storage) — see `sessions-gateway.md`

### Mental Model

Secrets are org-scoped encrypted key-value pairs that get injected into sandbox environments at session start. Users manage secrets through the web dashboard; the agent can request missing secrets at runtime via the `request_env_variables` tool (schema owned by `agent-contract.md`).

Secrets can optionally be grouped into **bundles** — named collections with an optional `target_path` that controls where an `.env` file is written inside the sandbox. At session creation, the gateway queries bundles with target paths and passes the resulting env file spec to the sandbox provider, which writes the files before the agent starts.

The encryption model is simple: AES-256-GCM with a single deployment-wide key (`USER_SECRETS_ENCRYPTION_KEY`). Values are encrypted on write and decrypted only when injected into a sandbox — they are never returned through the API.

**Core entities:**
- **Secret** — an encrypted key-value pair scoped to an org (optionally to a repo). Belongs to at most one bundle.
- **Bundle** — a named group of secrets with optional target path for env file generation.

**Key invariants:**
- Secret values are **never** returned by list/check endpoints. Only metadata (key name, type, timestamps) is exposed.
- A secret key is unique per `(organization_id, repo_id, key, prebuild_id)` combination (enforced by DB unique constraint `secrets_org_repo_prebuild_key_unique`). Because PostgreSQL treats NULLs as distinct in unique constraints, the same key name can exist independently at org-wide, repo, and prebuild scopes.
- A bundle name is unique per organization (enforced by DB unique constraint).
- Deleting a bundle sets `bundle_id` to null on associated secrets (ON DELETE SET NULL) — secrets survive bundle deletion.
- Encryption requires `USER_SECRETS_ENCRYPTION_KEY` (64 hex chars / 32 bytes). Writes that encrypt secret values (create, bulk import) fail if this is not configured. Bundle CRUD and secret deletion do not require the encryption key.

---

## 2. Core Concepts

### AES-256-GCM Encryption
Secrets are encrypted using AES-256-GCM with a random 16-byte IV per secret. The ciphertext is stored as `iv:authTag:encryptedText` (all hex-encoded). The encryption key is a 32-byte key read from `USER_SECRETS_ENCRYPTION_KEY` environment variable.
- Key detail agents get wrong: the encryption key is **not** per-org or per-secret — it is a single deployment-wide key. Key rotation requires re-encrypting all secrets.
- Reference: `packages/services/src/db/crypto.ts`

### Secret Scoping
Secrets have two scope dimensions: `organization_id` (required) and `repo_id` (optional). Org-wide secrets (`repo_id = null`) apply to all sessions in the org. Repo-scoped secrets apply only to sessions that include that repo. At session boot, both scopes are fetched and merged.
- Key detail agents get wrong: the runtime uniqueness constraint is on `(organization_id, repo_id, key, prebuild_id)`, not just `(organization_id, key)`. The same key can exist at org-wide scope, repo scope, and prebuild scope simultaneously. Note: the hand-written schema in `packages/db/src/schema/secrets.ts` defines a 3-column constraint but the canonical runtime schema (generated via `drizzle-kit pull`) in `packages/db/src/schema/schema.ts` includes `prebuild_id` as a fourth column.
- Reference: `packages/db/src/schema/schema.ts:492`, constraint `secrets_org_repo_prebuild_key_unique`

### Bundle Target Paths
A bundle can have a `target_path` (e.g., `.env.local`, `apps/web/.env`). At session creation, the system queries all bundles with target paths, collects their secret keys, and generates an `EnvFileSpec` array that the sandbox provider uses to write `.env` files on boot.
- Key detail agents get wrong: target paths must be relative, cannot contain `..`, and cannot start with `/` or a drive letter. Validation uses `isValidTargetPath()`.
- Reference: `packages/shared/src/env-parser.ts:isValidTargetPath`

---

## 3. File Tree

```
packages/services/src/secrets/
├── index.ts                  # Module exports (re-exports service + DB functions)
├── service.ts                # Business logic (CRUD, encryption orchestration, bulk import)
├── db.ts                     # Drizzle queries (secrets + bundles tables)
├── mapper.ts                 # DB row → API response type transforms
└── service.test.ts           # Vitest unit tests (mocked DB + crypto)

packages/services/src/db/
└── crypto.ts                 # AES-256-GCM encrypt/decrypt + key retrieval

packages/services/src/types/
└── secrets.ts                # DB row shapes and input types

packages/services/src/sessions/
└── sandbox-env.ts            # Builds env var map for sandbox (decrypts secrets)

packages/shared/src/contracts/
└── secrets.ts                # Zod schemas + ts-rest contract definitions

packages/shared/src/
└── env-parser.ts             # .env text parser + target path validation

packages/db/src/schema/
├── schema.ts                 # Canonical table definitions (generated via drizzle-kit pull)
├── relations.ts              # Drizzle relations (secrets, secretBundles)
└── secrets.ts                # Hand-written table defs (stale — not exported by index.ts)

apps/web/src/server/routers/
├── secrets.ts                # oRPC router (secret + bundle CRUD, bulk import)
└── sessions-submit-env.ts    # Environment submission handler (persist toggle)

apps/gateway/src/lib/
└── session-creator.ts        # Session creation (env var + env file spec assembly)
```

---

## 4. Data Models & Schemas

### Database Tables

```
secrets
├── id                UUID PRIMARY KEY DEFAULT random
├── organization_id   TEXT NOT NULL → organization(id) ON DELETE CASCADE
├── repo_id           UUID → repos(id) ON DELETE CASCADE          -- null = org-wide
├── prebuild_id       UUID → prebuilds(id) ON DELETE CASCADE      -- null = not prebuild-scoped
├── bundle_id         UUID → secret_bundles(id) ON DELETE SET NULL -- null = unbundled
├── key               TEXT NOT NULL
├── encrypted_value   TEXT NOT NULL                                -- iv:authTag:ciphertext
├── secret_type       TEXT DEFAULT 'env'                           -- 'env', 'docker_registry', 'file'
├── description       TEXT
├── created_by        TEXT → user(id)
├── created_at        TIMESTAMPTZ DEFAULT now()
└── updated_at        TIMESTAMPTZ DEFAULT now()

Indexes:
  idx_secrets_org      (organization_id)
  idx_secrets_repo     (repo_id)
  idx_secrets_bundle   (bundle_id)
  UNIQUE secrets_org_repo_prebuild_key_unique (organization_id, repo_id, key, prebuild_id)
```

Note: the canonical schema is `packages/db/src/schema/schema.ts` (generated via `drizzle-kit pull`), which is exported by `packages/db/src/schema/index.ts`. The hand-written `packages/db/src/schema/secrets.ts` defines relations but uses a stale 3-column unique constraint.


```
secret_bundles
├── id                UUID PRIMARY KEY DEFAULT random
├── organization_id   TEXT NOT NULL → organization(id) ON DELETE CASCADE
├── name              TEXT NOT NULL
├── description       TEXT
├── target_path       TEXT                                         -- relative path for .env file
├── created_by        TEXT → user(id)
├── created_at        TIMESTAMPTZ DEFAULT now()
└── updated_at        TIMESTAMPTZ DEFAULT now()

Indexes:
  idx_secret_bundles_org         (organization_id)
  UNIQUE (organization_id, name)
```

### Core TypeScript Types

```typescript
// packages/shared/src/contracts/secrets.ts
interface Secret {
  id: string;
  key: string;
  description: string | null;
  secret_type: string | null;
  repo_id: string | null;
  bundle_id: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface SecretBundle {
  id: string;
  name: string;
  description: string | null;
  target_path: string | null;
  secret_count: number;       // computed via LEFT JOIN COUNT
  created_at: string | null;
  updated_at: string | null;
}
```

### Key Indexes & Query Patterns
- **List secrets by org** — `idx_secrets_org` on `organization_id`, ordered by `created_at` DESC.
- **Check existence** — `findExistingKeys` queries by `(organization_id, key IN [...])` with optional repo scope.
- **Session injection** — `getSecretsForSession` fetches by `organization_id` + `repo_id IN [...]` OR `repo_id IS NULL`, returning `(key, encrypted_value)`.
- **Bundle target path query** — `getBundlesWithTargetPath` joins `secret_bundles` with `secrets` where `target_path IS NOT NULL`.

---

## 5. Conventions & Patterns

### Do
- Always encrypt via `packages/services/src/db/crypto.ts:encrypt` before DB insert — never store plaintext.
- Validate bundle ownership (`bundleBelongsToOrg`) before any cross-entity operation (create secret with bundle, update secret bundle, bulk import with bundle).
- Use the `SecretListRow` shape (no `encrypted_value`) for all read paths.
- Validate target paths with `isValidTargetPath()` before saving to bundles.

### Don't
- Never return `encrypted_value` through any API endpoint. The list/check queries explicitly select only metadata columns.
- Never import `@proliferate/db` directly in the router — use `@proliferate/services` functions.
- Never log secret values or encrypted values. Log only `secretKey` (the key name) for debugging.

### Error Handling

```typescript
// packages/services/src/secrets/service.ts
// PostgreSQL unique violation → domain error
if (err.code === "23505") {
  throw new DuplicateSecretError(input.key);
}

// Router translates domain errors to HTTP:
// DuplicateSecretError    → 409 CONFLICT
// EncryptionError         → 500 INTERNAL_SERVER_ERROR
// BundleOrgMismatchError  → 400 BAD_REQUEST
// BundleNotFoundError     → 404 NOT_FOUND
// InvalidTargetPathError  → 400 BAD_REQUEST
// DuplicateBundleError    → 409 CONFLICT
```

### Reliability
- No timeouts or retries — all queries are simple single-table reads/writes.
- Encryption key availability is checked on first encrypt call, not at startup. If missing or invalid, `getEncryptionKey()` throws synchronously with no fallback (`packages/services/src/db/crypto.ts:53-61`).
- Bulk import is not transactional — partial inserts are possible if the process crashes mid-batch. Duplicates are idempotent via `ON CONFLICT DO NOTHING` (`packages/services/src/secrets/db.ts:bulkCreateSecrets`).
- Session injection: decryption failures for individual secrets are logged but do not abort session creation — remaining secrets are still injected (`packages/services/src/sessions/sandbox-env.ts:91-96`).
- Idempotency: secret creation is not idempotent — duplicate keys return 409. Upsert is available only via `upsertByRepoAndKey` (internal path).

### Testing Conventions
- Service tests mock `./db` and `../db/crypto` modules via `vi.mock`.
- Encryption is mocked to return `"encrypted-value"` with a fixed 64-char hex key.
- Tests cover: CRUD happy paths, duplicate key handling, cross-org bundle rejection, bulk import with skips, bundle target path env file generation.
- Reference: `packages/services/src/secrets/service.test.ts`

---

## 6. Subsystem Deep Dives

### 6.1 Secret CRUD

**What it does:** Create, list, delete, and check existence of org-scoped secrets. **Status: Implemented.**

**Happy path (create):**
1. Router (`apps/web/src/server/routers/secrets.ts:create`) validates input via `CreateSecretInputSchema`.
2. Service (`packages/services/src/secrets/service.ts:createSecret`) calls `getEncryptionKey()` then `encrypt(value, key)`.
3. If `bundleId` is provided, validates bundle ownership via `secretsDb.bundleBelongsToOrg`.
4. Inserts via `secretsDb.create` with encrypted value. Returns metadata (no value).

**Happy path (list):**
1. Router calls `secrets.listSecrets(orgId)`.
2. DB query selects all columns **except** `encrypted_value`, ordered by `created_at` DESC.

**Happy path (check):**
1. Router receives array of key names + optional `repo_id` / `prebuild_id`.
2. `secretsDb.findExistingKeys` queries matching keys with scope filtering.
3. Returns `{ key, exists }` for each requested key.

**Edge cases:**
- Duplicate key on create → `DuplicateSecretError` → 409 CONFLICT.
- Missing encryption key → `EncryptionError` → 500.
- Bundle from different org → `BundleOrgMismatchError` → 400.

**Files touched:** `apps/web/src/server/routers/secrets.ts`, `packages/services/src/secrets/service.ts`, `packages/services/src/secrets/db.ts`, `packages/services/src/db/crypto.ts`

### 6.2 Bundle CRUD

**What it does:** Create, list, update metadata, and delete named secret groups with optional target paths. **Status: Implemented.**

**Happy path (create):**
1. Router validates input via `CreateBundleInputSchema` (name 1-100 chars, optional targetPath/description).
2. Service validates `targetPath` via `isValidTargetPath()` if provided.
3. Inserts via `secretsDb.createBundle`. Returns bundle with `secret_count: 0`.

**Happy path (list):**
1. `secretsDb.listBundlesByOrganization` performs `LEFT JOIN` on secrets + `GROUP BY` to compute `secret_count`.
2. Returns bundles ordered by `created_at` DESC.

**Happy path (update metadata):**
1. `updateBundleMeta` validates targetPath, calls `secretsDb.updateBundle`.
2. Fetches updated `secret_count` in a separate query.

**Happy path (delete):**
1. `secretsDb.deleteBundle` deletes the bundle row. Associated secrets have `bundle_id` set to null automatically (ON DELETE SET NULL).

**Edge cases:**
- Duplicate bundle name → `DuplicateBundleError` → 409.
- Invalid target path (absolute, `..` traversal, empty) → `InvalidTargetPathError` → 400.
- Bundle not found on update → `BundleNotFoundError` → 404.

**Files touched:** `apps/web/src/server/routers/secrets.ts`, `packages/services/src/secrets/service.ts`, `packages/services/src/secrets/db.ts`, `packages/shared/src/env-parser.ts`

### 6.3 Bulk Import

**What it does:** Parses pasted `.env`-format text, encrypts each value, and bulk-inserts secrets (skipping duplicates). **Status: Implemented.**

**Happy path:**
1. Router validates input via `BulkImportInputSchema` (non-empty `envText`, optional `bundleId`).
2. Service calls `parseEnvFile(envText)` to extract `{ key, value }[]`.
3. If `bundleId` is provided, validates bundle ownership.
4. Encrypts all values with the deployment encryption key.
5. `secretsDb.bulkCreateSecrets` uses `INSERT ... ON CONFLICT DO NOTHING` to skip existing keys.
6. Returns `{ created: N, skipped: ["KEY_A", ...] }`.

**Parser behavior (`parseEnvFile`):**
- Handles `KEY=VALUE`, `KEY="quoted"`, `KEY='quoted'`, `export KEY=VALUE`.
- Strips inline `# comments` from unquoted values (preserves `#` inside quotes).
- Skips blank lines and lines starting with `#`.
- Lines without `=` are silently skipped.

**Files touched:** `apps/web/src/server/routers/secrets.ts`, `packages/services/src/secrets/service.ts`, `packages/shared/src/env-parser.ts`

### 6.4 Secret-to-Sandbox Data Flow

**What it does:** Decrypts org+repo secrets and injects them as environment variables into the sandbox at session creation. **Status: Implemented.**

**Happy path:**
1. Gateway's `createSandbox` (`apps/gateway/src/lib/session-creator.ts`) calls `loadEnvironmentVariables`.
2. `loadEnvironmentVariables` delegates to `sessions.buildSandboxEnvVars` (`packages/services/src/sessions/sandbox-env.ts`).
3. `buildSandboxEnvVars` calls `secrets.getSecretsForSession(orgId, repoIds)` which fetches `(key, encryptedValue)` rows for org-wide + repo-scoped secrets.
4. Each secret is decrypted via `decrypt(encryptedValue, encryptionKey)` and added to the `envVars` map.
5. The merged env vars map is passed to `provider.createSandbox({ envVars })`.

**Bundle target path flow (env file specs):**
1. During `createSandbox`, the session creator calls `secrets.buildEnvFilesFromBundles(organizationId)`.
2. This queries `secretsDb.getBundlesWithTargetPath` — returns bundles with non-null `target_path` and their secret key lists.
3. Each bundle produces an `EnvFileSpec`: `{ workspacePath: ".", path: targetPath, format: "env", mode: "secret", keys: [...] }`.
4. These specs are merged with any prebuild-level env file specs and passed to `provider.createSandbox({ envFiles })`.
5. The sandbox provider (e.g., Modal) executes `proliferate env apply --spec <JSON>` inside the sandbox to write the files.

**Files touched:** `apps/gateway/src/lib/session-creator.ts`, `packages/services/src/sessions/sandbox-env.ts`, `packages/services/src/secrets/db.ts`, `packages/services/src/db/crypto.ts`

### 6.5 Per-Secret Persistence Toggle

**What it does:** When the agent requests environment variables via the `request_env_variables` tool, users submit values through the web dashboard. Each secret can individually opt into org-level persistence. **Status: Implemented.**

**Happy path:**
1. The session router (`apps/web/src/server/routers/sessions.ts:submitEnv`) receives `{ secrets: [{ key, value, persist }], envVars, saveToPrebuild }` and delegates to `submitEnvHandler`.
2. Handler (`apps/web/src/server/routers/sessions-submit-env.ts:submitEnvHandler`) processes each secret:
   - If `persist` is true (or `saveToPrebuild` fallback), calls `secrets.createSecret` to encrypt and store.
   - If duplicate, records `alreadyExisted: true` in results.
   - Regardless of persistence, adds to `envVarsMap`.
3. All values are written to the sandbox via `provider.writeEnvFile(sandboxId, envVarsMap)`.
4. Returns `{ submitted: true, results: [{ key, persisted, alreadyExisted }] }`.

**Edge cases:**
- Session not found or no sandbox → 404 / 400.
- Encryption failure on persist → logs error, sets `persisted: false`.
- Duplicate secret → skips persist, sets `alreadyExisted: true`.

**Files touched:** `apps/web/src/server/routers/sessions-submit-env.ts`, `packages/services/src/secrets/service.ts`

### 6.6 Secret Upsert (Repo-Scoped)

**What it does:** Upserts a secret by `(organization_id, repo_id, key)`. Used internally during repo setup flows. **Status: Implemented.**

**Happy path:**
1. Caller provides `{ repoId, organizationId, key, encryptedValue }`.
2. `secretsDb.upsertByRepoAndKey` uses `INSERT ... ON CONFLICT (organizationId, repoId, key) DO UPDATE SET encrypted_value, updated_at`.

**Caveat:** The conflict target is 3 columns but the runtime unique constraint is 4 columns (includes `prebuild_id`). This works when `prebuild_id` is null but could fail if prebuild-scoped secrets exist for the same key. See Known Limitations §9.

**Files touched:** `packages/services/src/secrets/db.ts`

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| Sessions / Gateway | This → Sessions | `buildSandboxEnvVars()` | Secrets decrypted and injected as env vars at session boot |
| Sessions / Gateway | This → Sessions | `buildEnvFilesFromBundles()` | Bundle target paths generate env file specs for sandbox boot |
| Sandbox Providers | This → Providers | `provider.createSandbox({ envVars, envFiles })` | Secrets passed as env vars + env file specs to provider |
| Sandbox Providers | This → Providers | `provider.writeEnvFile(sandboxId, envVarsMap)` | Runtime env submission writes to sandbox |
| Agent Contract | Other → This | `request_env_variables` tool | Agent requests secrets; user submits via `submitEnvHandler` |
| Agent Contract | Other → This | `save_env_files` tool | Agent saves env file spec to prebuild (not secrets themselves) |
| Repos / Prebuilds | Other → This | `prebuildEnvFiles` | Prebuild-level env file specs merged with bundle specs |
| Config: `packages/environment` | This → Config | `USER_SECRETS_ENCRYPTION_KEY` env var | Required for all encrypt/decrypt; defined in `packages/environment/src/schema.ts` |

### Security & Auth
- All secret endpoints use `orgProcedure` middleware — requires authenticated user with org membership.
- Secret values are encrypted with AES-256-GCM before storage. Decryption occurs only in `buildSandboxEnvVars` (gateway-side).
- The API never returns `encrypted_value` — list queries explicitly exclude it.
- Bundle ownership is validated on every cross-entity operation to prevent IDOR.
- Target paths are validated to prevent directory traversal attacks.

### Observability
- Service-level logging uses the injectable logger pattern (`getServicesLogger()`).
- `sandbox-env.ts` logs: secret fetch duration, count, individual decrypt failures (with `secretKey`, not value).
- `sessions-submit-env.ts` logs: persist/duplicate counts, write duration.

---

## 8. Acceptance Gates

- [ ] Typecheck passes (`pnpm typecheck`)
- [ ] `packages/services/src/secrets/service.test.ts` passes
- [ ] `apps/web/src/test/unit/sessions-submit-env.test.ts` passes
- [ ] `packages/shared/src/env-parser.test.ts` passes
- [ ] This spec is updated (file tree, data models, deep dives)

---

## 9. Known Limitations & Tech Debt

- [ ] **Single encryption key** — all secrets across all orgs share one `USER_SECRETS_ENCRYPTION_KEY`. No key rotation mechanism exists. Impact: a compromised key exposes all org secrets. Expected fix: per-org keys with a key versioning scheme.
- [ ] **No secret update** — there is no endpoint to update a secret's value. Users must delete and re-create. Impact: minor friction for key rotation workflows.
- [ ] **`secret_type` unused** — the `secret_type` column (`env`, `docker_registry`, `file`) defaults to `env` and has no behavioral differentiation in the codebase. Impact: dead schema complexity.
- [ ] **`prebuild_id` column unused in queries** — the runtime schema (`packages/db/src/schema/schema.ts`) includes `prebuild_id` and the 4-column unique constraint includes it, but no service-layer query filters or inserts by `prebuild_id`. `CheckSecretsFilter` accepts `prebuildId` but `findExistingKeys` ignores it. The `upsertByRepoAndKey` conflict target uses only 3 columns (`organizationId, repoId, key`), which may conflict with the 4-column unique constraint if `prebuild_id` varies. Impact: potential upsert failures when prebuild-scoped secrets exist; dead schema complexity. Expected fix: align conflict targets with the 4-column constraint or add `prebuild_id` to query filters.
- [ ] **No audit trail** — secret creation/deletion is not logged to an audit table. Only `created_by` is tracked. Impact: no forensic trail for secret management operations.
- [ ] **S3 not used for secrets** (`Planned` / not implemented) — the feature registry and agent prompt list "S3 integration for secrets" as in scope, but `apps/gateway/src/lib/s3.ts` handles verification file uploads only. Secrets are stored exclusively in PostgreSQL with AES-256-GCM encryption. Impact: feature registry entry is misleading. Expected fix: either implement S3-backed secret storage or remove the entry from the feature registry.
