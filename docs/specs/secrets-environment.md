# Secrets & Environment — System Spec

## 1. Scope & Purpose

### In Scope
- Secret CRUD (create, list, delete, existence checks) through `apps/web/src/server/routers/secrets.ts` and `packages/services/src/secrets/`.
- Secret scoping across org-wide, repo-scoped, and configuration-linked contexts (`packages/services/src/secrets/db.ts`).
- Bulk `.env` import into encrypted secret records (`packages/services/src/secrets/service.ts:bulkImportSecrets`, `packages/shared/src/env-parser.ts:parseEnvFile`).
- Runtime environment submission to active sandboxes, including per-secret persistence decisions (`apps/web/src/server/routers/sessions-submit-env.ts`).
- Session boot env var assembly from encrypted secrets (`packages/services/src/sessions/sandbox-env.ts`).
- Configuration env file spec persistence via intercepted `save_env_files` (`apps/gateway/src/hub/capabilities/tools/save-env-files.ts`, `packages/services/src/configurations/db.ts:updateConfigurationEnvFiles`).
- Secret file CRUD (encrypted content at rest, metadata-only reads) for configuration workflows, plus optional live apply to an active session sandbox on upsert and boot-time decrypt/write into sandboxes (`apps/web/src/server/routers/secret-files.ts`, `packages/services/src/secret-files/`, `packages/services/src/sessions/sandbox-env.ts`).
- Org-level secret resolution for connector auth (`packages/services/src/secrets/service.ts:resolveSecretValue`).

### Out of Scope
- Tool schema definitions and sandbox tool injection (`agent-contract.md` §6, `sandbox-providers.md` §6.3).
- Sandbox provider internals for `createSandbox({ envVars, envFiles })` and `writeEnvFile()` (`sandbox-providers.md` §6.4).
- Configuration lifecycle and snapshot orchestration beyond env-file persistence (`repos-prebuilds.md`).
- Action execution policy and approval semantics that consume connector secrets (`actions.md`).
- UI interaction design for Environment panel and tool cards (`sessions-gateway.md` §6.1).

### Mental Models

The subsystem has three distinct planes that agents often conflate:

- **Vault plane (key/value):** `secrets` holds encrypted key/value records, with optional repo scope and optional configuration linkage. Runtime env injection reads from this plane (`packages/services/src/secrets/db.ts`, `packages/services/src/sessions/sandbox-env.ts`).
- **File-spec plane (declarative):** `configurations.envFiles` stores a declarative spec of which env files should be generated at sandbox boot (`apps/gateway/src/hub/capabilities/tools/save-env-files.ts`, `apps/gateway/src/lib/session-creator.ts`).
- **Secret-file plane (content blobs):** `secret_files` stores encrypted file contents and metadata. API reads remain metadata-only, while boot-time services paths decrypt content and materialize files in sandbox workspaces (`packages/services/src/secret-files/db.ts`, `packages/services/src/sessions/sandbox-env.ts`, `apps/web/src/server/routers/secret-files.ts`).

The encryption model is deployment-wide AES-256-GCM (`iv:authTag:ciphertext`) using `USER_SECRETS_ENCRYPTION_KEY` (`packages/services/src/db/crypto.ts`, `packages/shared/src/lib/crypto.ts`).

---

## 2. Core Concepts

### AES-256-GCM Encryption
Both secret values and secret-file contents are encrypted with AES-256-GCM before persistence. Decryption happens server-side only when needed for runtime injection or connector auth resolution.
- Reference: `packages/services/src/db/crypto.ts`, `packages/services/src/secret-files/service.ts`, `packages/services/src/sessions/sandbox-env.ts`.

### Secret Scope Axes
Secret reads are scope-sensitive:
- Session boot path: org-wide + repo-scoped + configuration-linked secrets, with deterministic precedence (`resolveSessionBootSecretMaterial`).
- Session boot file path: configuration-linked `secret_files` rows are decrypted and returned as file writes.
- Configuration checks: configuration-linked keys + org-wide fallback (`findExistingKeysForConfiguration`).
- Connector auth: org-wide keys only (`getSecretByOrgAndKey` requires `repo_id IS NULL`).
- Reference: `packages/services/src/secrets/db.ts`.

### Configuration Linking Is a Junction Concern
`createSecret` can receive `configurationId`, but linkage is written through `configuration_secrets` junction rows (`linkSecretToConfiguration`), which are then consumed during runtime session boot precedence resolution.
- Reference: `packages/services/src/secrets/service.ts:createSecret`, `packages/services/src/secrets/db.ts:linkSecretToConfiguration`.

### Runtime Submission Is Split-Path
`submitEnvHandler` always writes submitted values to sandbox runtime env (`provider.writeEnvFile`), but persistence and runtime writes are separate operations with different failure behavior.
- Reference: `apps/web/src/server/routers/sessions-submit-env.ts`.

### Env File Specs Are Declarative, Not Secret Storage
`save_env_files` stores a declarative spec on `configurations.envFiles`; providers apply that spec during boot. The spec does not itself store secret values.
- Reference: `apps/gateway/src/hub/capabilities/tools/save-env-files.ts`, `packages/services/src/configurations/db.ts`, `apps/gateway/src/lib/session-creator.ts`.

### Things Agents Get Wrong
- Secret bundles are no longer the active runtime model; current schema comment explicitly marks `secret_files` as replacing bundles (`packages/db/src/schema/schema.ts`).
- `packages/db/src/schema/secrets.ts` still defines bundle-era tables but is not the canonical export path (`packages/db/src/schema/index.ts` exports `schema.ts` + `relations.ts`).
- `request_env_variables` is not gateway-intercepted; it is a sandbox tool surfaced in UI via tool events (`packages/shared/src/opencode-tools/index.ts`, `apps/web/src/components/coding-session/runtime/message-handlers.ts`).
- `save_env_files` is gateway-intercepted and setup-session-only (`apps/gateway/src/hub/capabilities/tools/save-env-files.ts`).
- `checkSecrets` behavior changes when `configuration_id` is present; repo filtering is bypassed in that branch (`packages/services/src/secrets/service.ts:checkSecrets`).
- Session boot secret resolution is centralized in `resolveSessionBootSecretMaterial()` with precedence `configuration > repo > org` (`packages/services/src/sessions/sandbox-env.ts`).
- Secret-file API reads still return metadata only; decrypted file content is only surfaced through the internal boot path (`packages/services/src/secret-files/db.ts`, `packages/services/src/sessions/sandbox-env.ts`).

---

## 5. Conventions & Patterns

### Do
- Encrypt on every write path before DB insert/upsert (`packages/services/src/secrets/service.ts`, `packages/services/src/secret-files/service.ts`).
- Keep routers thin and delegate DB/business logic to services modules (`apps/web/src/server/routers/secrets.ts`, `apps/web/src/server/routers/secret-files.ts`).
- Return metadata only on read endpoints for secrets and secret files.
- Treat runtime env writes (`submitEnv`) and vault persistence (`createSecret`/`bulkImport`) as separate operations with separate error handling.

### Don't
- Do not return `encrypted_value` or `encrypted_content` through API responses.
- Do not log plaintext secret values; logs should only include safe identifiers (for example `secretKey`).
- Do not assume `save_env_files` persists values; it persists only file-generation spec metadata.

### Error Handling
- `DuplicateSecretError` and `EncryptionError` are translated by the secrets router to `409` and `500` respectively (`apps/web/src/server/routers/secrets.ts`).
- `submitEnvHandler` treats duplicate persistence as non-fatal (`alreadyExisted: true`) and continues processing (`apps/web/src/server/routers/sessions-submit-env.ts`).
- Secret file router enforces `admin`/`owner` for upsert/delete and returns `FORBIDDEN` otherwise (`apps/web/src/server/routers/secret-files.ts`).

### Reliability
- Encryption key validation is lazy per operation (`getEncryptionKey()`), not preflight startup validation.
- `buildSandboxEnvVars` tolerates per-secret decryption failures and continues with remaining keys.
- `submitEnvHandler` may persist some secrets before failing the overall request if sandbox write fails.
- Bulk import pre-filters existing org-scoped keys (`repo_id IS NULL`, `configuration_id IS NULL`) before insert, then returns `created` vs `skipped`.
- Tool callback idempotency for intercepted tools is provided in gateway memory by `tool_call_id` caching.

### Testing Conventions
- `packages/services/src/secrets/service.test.ts` validates core CRUD/import behavior with mocked DB+crypto.
- `apps/web/src/test/unit/sessions-submit-env.test.ts` validates per-secret persistence semantics and sandbox write behavior.
- `packages/shared/src/env-parser.test.ts` validates parser and path helper behavior used by bulk import.

---

## 6. Subsystem Deep Dives

### 6.1 Secret CRUD & Existence Checks (`Implemented`)
**What it does:** Manages encrypted key/value secrets and non-sensitive metadata APIs.

**Invariants:**
- Secret create writes must encrypt plaintext before DB insert.
- Secret list/check responses must never include ciphertext or plaintext.
- When `configurationId` is supplied to create, linkage is added through `configuration_secrets`.
- `checkSecrets` with `configuration_id` must resolve against configuration-linked keys plus org-wide fallback; without it, checks are org/repo scoped.

**Rules the system must follow:**
- Keep domain error translation explicit (`DuplicateSecretError`, `EncryptionError`).
- Preserve org isolation on every query predicate.

**Files:** `apps/web/src/server/routers/secrets.ts`, `packages/services/src/secrets/service.ts`, `packages/services/src/secrets/db.ts`.

### 6.2 Bulk Import (`Implemented`)
**What it does:** Converts pasted `.env` text into encrypted secret rows.

**Invariants:**
- Parser accepts `KEY=VALUE`, quoted values, and `export` prefix.
- Invalid/blank/comment-only lines are ignored rather than failing the import.
- Bulk insert must be idempotent for existing org-scoped keys (`repo_id IS NULL`, `configuration_id IS NULL`) via pre-filter + insert.
- API response must expose deterministic `created` count and explicit `skipped` keys.

**Rules the system must follow:**
- Encryption key must be required before bulk encrypting entries.
- Import path must not return secret values back to the caller.

**Files:** `packages/services/src/secrets/service.ts:bulkImportSecrets`, `packages/shared/src/env-parser.ts`, `packages/services/src/secrets/db.ts:bulkCreateSecrets`.

### 6.3 Secret-to-Sandbox Runtime Injection (`Implemented`)
**What it does:** Builds sandbox env vars during session creation and runtime boot.

**Invariants:**
- Runtime env assembly resolves all boot-time secret sources through `resolveSessionBootSecretMaterial({ orgId, repoIds, configurationId })`.
- Precedence is deterministic: configuration-scoped > repo-scoped > org-scoped.
- Boot-time resolver returns both merged env vars and decrypted secret file writes.
- Decrypt failures must not abort the full env assembly; failing keys are skipped and logged.
- Generated env vars merge with non-secret runtime keys (proxy keys, git token fallbacks).

**Rules the system must follow:**
- Secret decryption must happen server-side only.
- Provider invocation receives assembled env vars; provider internals remain out of scope for this spec.

**Files:** `packages/services/src/sessions/sandbox-env.ts`, `apps/gateway/src/lib/session-creator.ts`.

### 6.4 Runtime Submission & Persistence Toggle (`Implemented`)
**What it does:** Accepts environment values during a live session and optionally persists secrets.

**Invariants:**
- Every submitted secret/env var is written to sandbox runtime env map for the active session.
- Per-secret `persist` overrides the global `saveToConfiguration` fallback.
- Duplicate persistence attempts are non-fatal and surfaced as `alreadyExisted`.
- Sandbox write failure fails the request, even if some persistence already succeeded.

**Rules the system must follow:**
- Session ownership and active sandbox presence must be validated before writes.
- Persistence and runtime injection outcomes must be observable in returned `results`.

**Files:** `apps/web/src/server/routers/sessions.ts:submitEnv`, `apps/web/src/server/routers/sessions-submit-env.ts`.

### 6.5 Setup Finalization Secret Upsert (`Implemented`)
**What it does:** Stores repo-scoped secrets during setup finalization flows.

**Invariants:**
- Finalization secrets are encrypted before upsert.
- Upsert path targets repo-scoped secret records keyed by org/repo/key.
- Multi-repo finalization must require explicit repo disambiguation when secret payload is present.

**Rules the system must follow:**
- Finalization must fail hard if secret persistence fails.

**Files:** `apps/web/src/server/routers/configurations-finalize.ts`, `packages/services/src/secrets/db.ts:upsertByRepoAndKey`.

### 6.6 Env File Spec Persistence via `save_env_files` (`Implemented`)
**What it does:** Persists configuration-level env file generation spec in setup sessions.

**Invariants:**
- Only setup sessions may call `save_env_files`.
- A valid configuration ID is required to persist the spec.
- File spec validation enforces relative paths, `format: "dotenv"`, `mode: "secret"`, and bounded file/key counts.
- Persisted spec is read during session creation and passed to provider as `envFiles`.

**Rules the system must follow:**
- The stored spec must remain declarative (no secret plaintext).
- Tool callback idempotency must use `tool_call_id` for retry safety.

**Files:** `apps/gateway/src/hub/capabilities/tools/save-env-files.ts`, `apps/gateway/src/api/proliferate/http/tools.ts`, `packages/services/src/configurations/db.ts`, `apps/gateway/src/lib/session-creator.ts`.

### 6.7 Secret Files (`Implemented`)
**What it does:** Stores encrypted file-content blobs keyed by configuration and path.

**Invariants:**
- Upsert encrypts content before persistence.
- Upsert can optionally apply file content to a live sandbox when `sessionId` is provided by the caller.
- Live apply path validation requires a relative workspace path (no absolute/traversal paths).
- List endpoint returns metadata only (ID/path/description/timestamps), never content.
- Delete is org-scoped by `secret_files.id` + `organization_id`.
- Upsert/delete require org `owner` or `admin`.
- Upsert validates that `configurationId` belongs to the authenticated org before write.
- Session boot decrypts configuration-linked `secret_files` and injects them as file writes.

**Rules the system must follow:**
- Secret file content may only be decrypted in internal runtime paths (boot resolver and optional live apply); API responses remain metadata-only.
- Runtime live-apply uses provider `execCommand` without logging file content.

**Files:** `apps/web/src/server/routers/secret-files.ts`, `packages/services/src/secret-files/service.ts`, `packages/services/src/secret-files/db.ts`.

### 6.8 Connector Secret Resolution (`Implemented`)
**What it does:** Resolves org-level secrets for connector auth at runtime.

**Invariants:**
- Resolution targets org-wide keys (`repo_id IS NULL`) and returns decrypted plaintext or `null`.
- Resolution failures degrade gracefully to `null` and callers decide fallback behavior.

**Rules the system must follow:**
- Connector secret values must never be exposed in API responses or logs.

**Files:** `packages/services/src/secrets/service.ts:resolveSecretValue`, `apps/gateway/src/api/proliferate/http/actions.ts`, `apps/web/src/server/routers/integrations.ts`.

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| Sessions / Gateway | This → Sessions | `buildSandboxEnvVars()` | Resolves boot secret material (env vars + file writes) with precedence and decrypts values |
| Sessions / Gateway | This → Sessions | `submitEnvHandler()` | Writes runtime env values and optional persistence results |
| Gateway Tool Callbacks | This ← Gateway | `save_env_files` intercepted tool | Persists declarative env file spec to `configurations.envFiles` |
| Sandbox Providers | This → Providers | `provider.createSandbox({ envVars, envFiles, secretFileWrites })` | Providers receive assembled env vars, declarative env specs, and decrypted file writes |
| Sandbox Providers | This → Providers | `provider.writeEnvFile(sandboxId, envVarsMap)` | Runtime env submission path |
| Sandbox Providers | This → Providers | `provider.execCommand(sandboxId, ["sh","-lc", ...])` | Secret-file upsert optional live apply into active sandbox workspace |
| Actions / Integrations | Other → This | `resolveSecretValue(orgId, key)` | Connector auth resolves org-level secret by key |
| Configurations | This ↔ Configurations | `updateConfigurationEnvFiles`, `getConfigurationEnvFiles` | Env file spec persistence and retrieval |
| Config: `packages/environment` | This → Config | `USER_SECRETS_ENCRYPTION_KEY` | Required for all encrypt/decrypt paths |

### Security & Auth
- Secret and secret-file routes use `orgProcedure`; secret-file writes additionally require `owner`/`admin`.
- Ciphertext is persisted in DB; plaintext is only materialized in memory for runtime injection and connector resolution.
- List/check APIs intentionally omit secret plaintext and ciphertext fields.

### Observability
- `sandbox-env.ts` logs fetch/decrypt timings and per-key decrypt failures without values.
- `sessions-submit-env.ts` logs request counts, persistence stats, and sandbox write timings.
- Gateway tool callback route logs tool execution and deduplicates retries by `tool_call_id`.

---

## 8. Acceptance Gates

- [ ] Typecheck passes (`pnpm typecheck`)
- [ ] `packages/services/src/secrets/service.test.ts` passes
- [ ] `apps/web/src/test/unit/sessions-submit-env.test.ts` passes
- [ ] `packages/shared/src/env-parser.test.ts` passes
- [ ] Spec deep dives are invariant/rule based (no imperative execution recipes)
- [ ] Spec no longer documents bundle-era file-tree/data-model snapshots as source of truth

---

## 9. Known Limitations & Tech Debt

- [ ] **Stale bundle-era schema file remains in tree** — `packages/db/src/schema/secrets.ts` still models `secret_bundles`, while canonical exports point to `schema.ts`/`relations.ts`. Impact: easy agent confusion and wrong imports.
- [ ] **Potential duplicate-key ambiguity with nullable scope columns** *(inference from PostgreSQL NULL uniqueness semantics)* — uniqueness constraints that include nullable scope columns may permit duplicates where scope columns are null, and runtime query order does not define deterministic winner for duplicate keys. Impact: nondeterministic secret value selection in `buildSandboxEnvVars()` / `resolveSecretValue()`.
- [ ] **`createSecret` + configuration link is non-transactional** — secret insert and junction insert are separate operations. Impact: linkage can fail after secret row is created.
- [ ] **`submitEnv` can return failure after partial persistence** — secret persistence happens before sandbox write, and write failure aborts request. Impact: DB and runtime state may temporarily diverge.
- [ ] **Snapshot scrub/re-apply does not yet cover `secretFileWrites`** — snapshot scrub currently targets `configurations.envFiles` spec only. Impact: file-based secrets materialized from `secret_files` may persist in snapshots until scrub parity is added. Tracking: `TODO(secretfilewrites-snapshot-scrub-parity)` (see ISSUE-####).
- [ ] **No first-class secret value update endpoint** — users rotate by add/delete workflows instead of direct update.
- [ ] **No dedicated audit trail for secret mutations** — `created_by` exists but no append-only audit table records secret read/write/delete intent.
