# Repos & Configurations — System Spec

## 1. Scope & Purpose

### In Scope
- Repo CRUD, public GitHub search, and integration-scoped available repo listing.
- Repo connections (`repo_connections`) that bind repos to integrations for token resolution.
- Configuration CRUD (manual, managed, CLI) and configuration-repo associations via `configuration_repos`.
- Managed configuration resolution/creation for universal clients.
- CLI device-scoped configuration resolution/creation keyed by `userId + localPathHash`.
- Effective service command resolution (configuration override, repo fallback).
- Configuration env file spec persistence and gateway-side `save_env_files` interception.
- Base snapshot build worker (Layer 1) with queue + DB deduplication.
- Configuration snapshot build worker (Layer 2) including GitHub token resolution and failure handling.
- Setup finalization (snapshot capture + configuration update/create + optional session stop).

### Out of Scope
- Snapshot resolution at sandbox boot (`resolveSnapshotId`) and provider boot semantics — see `sandbox-providers.md`.
- Session lifecycle orchestration (create/pause/resume/delete, WebSocket runtime) — see `sessions-gateway.md`.
- Secret storage/encryption internals — see `secrets-environment.md`.
- OAuth lifecycle and org-scoped connector management — see `integrations.md`.
- Action runtime behavior using connectors — see `actions.md`.

### Mental Models

**Configuration is the runtime unit (legacy name: prebuild).**
A configuration is the reusable workspace contract used by session creation: repo set + workspace paths + optional snapshot + service/env defaults. The code has broadly migrated from `prebuild` naming to `configuration` entities (`packages/services/src/configurations/service.ts`, `apps/gateway/src/lib/configuration-resolver.ts`).

**Repo records and configuration records are intentionally decoupled.**
A repo can exist without a configuration, and a configuration is only org-authoritative through linked repos (not a direct `organization_id` column). Org checks traverse `configuration_repos -> repos` (`packages/services/src/configurations/service.ts:configurationBelongsToOrg`).

**Snapshot status encodes capability, not just progress.**
`default` means a clone-only configuration snapshot (fast boot, no dependency guarantees). `ready` means a finalized snapshot that includes setup work and should enable service command auto-start. The gateway derives `snapshotHasDeps` from status and snapshot provenance (`apps/gateway/src/lib/session-creator.ts`, `apps/gateway/src/lib/session-store.ts`).

**Service/env persistence is configuration-scoped and setup-session gated.**
`save_service_commands` and `save_env_files` write onto the configuration only during setup sessions (`apps/gateway/src/hub/capabilities/tools/save-service-commands.ts`, `apps/gateway/src/hub/capabilities/tools/save-env-files.ts`).

**Base and configuration snapshots are build-time concerns here; runtime selection is elsewhere.**
This spec owns build workers and status transitions (`apps/worker/src/base-snapshots/index.ts`, `apps/worker/src/configuration-snapshots/index.ts`). Provider-layer snapshot selection is owned by `sandbox-providers.md`.

---

## 2. Core Concepts

### Configuration Types
- `manual`: user-created via web/API create flows (`packages/services/src/configurations/service.ts:createConfiguration`).
- `managed`: auto-created for universal clients (`apps/gateway/src/lib/configuration-resolver.ts:resolveManaged`, `packages/services/src/managed-configuration.ts`).
- `cli`: device-scoped configuration rows (`packages/services/src/cli/db.ts:createCliConfigurationPending`).

### Workspace Path
- Stored in `configuration_repos.workspace_path`, not derived at runtime.
- Single-repo create flows default to `"."`; multi-repo create flows use repo slug (`githubRepoName.split("/").pop()`).
- Resolution and sandbox boot consume persisted `workspacePath` directly (`packages/services/src/configurations/db.ts:getConfigurationReposWithDetails`, `apps/gateway/src/lib/session-creator.ts`).

### Snapshot Layers
- Base snapshot (Layer 1): OpenCode + shared tooling, tracked in `sandbox_base_snapshots` (`packages/services/src/base-snapshots/*`).
- Configuration snapshot (Layer 2): base + repos cloned, tracked on `configurations.snapshot_id/status` (`apps/worker/src/configuration-snapshots/index.ts`).
- Finalized snapshot (Layer 3): setup-captured workspace state promoted to `status = "ready"` (`apps/web/src/server/routers/configurations-finalize.ts`, `apps/gateway/src/hub/session-hub.ts:saveSnapshot`).

### GitHub Token Hierarchy
Both gateway runtime and worker build paths prefer repo-linked integrations, then fall back to org-wide integrations. They are independent implementations and can drift if edited separately (`apps/gateway/src/lib/session-creator.ts:resolveGitHubToken`, `apps/worker/src/github-token.ts:resolveGitHubToken`).

### Things Agents Get Wrong
- Calling this subsystem "prebuilds" as if that is still the active domain model. Runtime creation/resolution is configuration-based.
- Assuming configuration authorization is direct; it is relation-derived from linked repos.
- Assuming every configuration has repos at all times. Creation/rollback paths create transient repo-less states.
- Assuming one repo maps to one configuration. Repo-to-configuration is many-to-many via `configuration_repos`.
- Assuming `status = "default"` implies dependencies are installed. Gateway treats `default` as clone-only.
- Assuming service commands should be read from `repos.service_commands` directly; runtime must use shared resolver precedence.
- Assuming env file specs are API-only. The primary write path is intercepted agent tools in gateway setup sessions.
- Assuming configuration snapshots build for E2B. Non-Modal providers are marked default with no snapshot.
- Assuming managed configuration lookup is org-indexed in DB. Current implementation loads managed rows then filters in memory.
- Assuming CLI path uses distinct "prebuild" tables. It uses `configurations` plus compatibility naming in some clients/docs.
- Assuming `workspacePath` self-heals when repos are attached/detached. It does not normalize existing entries.
- Assuming public GitHub search is authenticated. It currently uses unauthenticated API calls from the web router.

---

## 5. Conventions & Patterns

### Do
- Route all DB access through services (`packages/services/src/repos`, `packages/services/src/configurations`, `packages/services/src/base-snapshots`).
- Use org checks that traverse repo ownership (`configurationBelongsToOrg`, `repoExists`) before serving configuration/repo data.
- Use shared command parsing/resolution from `@proliferate/shared/sandbox` (`parseServiceCommands`, `resolveServiceCommands`).
- Treat snapshot job dispatch as fire-and-forget; make queue failures non-fatal to repo/config creation (`requestConfigurationSnapshotBuild`).
- Use status transition helpers in `packages/services/src/configurations/db.ts` rather than ad-hoc updates in worker code.

### Don’t
- Don’t bypass services and query Drizzle directly in routers.
- Don’t infer org ownership from configuration row fields; no direct org FK exists on `configurations`.
- Don’t assume snapshot availability implies dependency availability (`default` vs `ready` semantics differ).
- Don’t persist service/env tool output outside setup sessions.
- Don’t assume Managed/CLI flows have identical status semantics.

### Error Handling
- Services throw `Error`; routers map to `ORPCError` codes (`apps/web/src/server/routers/repos.ts`, `apps/web/src/server/routers/configurations.ts`).
- Non-critical side effects are often best-effort with logging (repo connection insert, auto-config creation, CLI configuration-repo upsert).

### Reliability
- Base snapshot queue: attempts `3`, exponential backoff `10s`, worker concurrency `1` (`packages/queue/src/index.ts`).
- Configuration snapshot queue: attempts `3`, exponential backoff `5s`, worker concurrency `2` (`packages/queue/src/index.ts`).
- Base snapshot dedupe is dual-layer: BullMQ `jobId` + unique DB key `(versionKey, provider, modalAppName)`.
- Configuration snapshot jobs intentionally use timestamped `jobId` to avoid stale failed-job dedupe (`packages/services/src/configurations/service.ts:requestConfigurationSnapshotBuild`).

### Testing Conventions
- There is no dedicated, focused test suite for repos/configurations/base-snapshot services today.
- Existing coverage is indirect (route/integration flows and worker tests in adjacent subsystems).
- High-value candidates: configuration org auth, workspace-path behavior on attach/detach, status transition guards.

---

## 6. Subsystem Invariants & Rules

### 6.1 Repo Lifecycle Invariants
- Repo identity is unique per org by `(organization_id, github_repo_id)` (`packages/db/src/schema/schema.ts:repos`).
- `createRepo` must be idempotent on that key; existing rows are returned instead of duplicated (`packages/services/src/repos/service.ts:createRepo`).
- Repo connection linking must be safe under retries (`onConflictDoNothing`) (`packages/services/src/repos/db.ts:createConnection`).
- `createRepoWithConfiguration` must not roll back repo creation if configuration auto-create fails; the repo remains valid (`packages/services/src/repos/service.ts:createRepoWithConfiguration`).

### 6.2 Configuration Lifecycle Invariants
- Configuration creation requires at least one repo ID and org ownership validation before inserts (`packages/services/src/configurations/service.ts:createConfiguration`).
- Configuration records are write-first, link-second; failed link insertion triggers explicit rollback delete.
- Configuration creation must always trigger snapshot build request (or default-without-snapshot fallback when Modal is unavailable).
- Configuration org authorization is relation-based and depends on at least one linked repo in the org.
- Managed and CLI creation paths must converge on the same tables (`configurations`, `configuration_repos`) even if naming differs externally.

### 6.3 Workspace Path Invariants
- `workspacePath` is immutable configuration metadata until explicitly rewritten in DB.
- Single-repo initial creation uses `"."`; multi-repo initial creation uses repo slug.
- CLI linkage always uses `"."` (`packages/services/src/cli/db.ts:upsertConfigurationRepo`).
- Attach/detach operations do not retroactively normalize other repo paths.

### 6.4 Service Command Invariants
- Stored command JSONB is untrusted and must be parsed/validated via shared schemas before runtime use.
- Resolution precedence is fixed: configuration-level commands win when non-empty; otherwise merge repo defaults with workspace context (`packages/shared/src/sandbox/config.ts:resolveServiceCommands`).
- Setup tooling may persist commands only when `session_type = "setup"` and configuration context exists (`apps/gateway/src/hub/capabilities/tools/save-service-commands.ts`).

### 6.5 Env File Invariants
- Env file specs are configuration-scoped JSONB and can be absent/null.
- Setup tooling may persist env file specs only in setup sessions (`save_env_files`).
- Env specs used during snapshotting must be scrubbed before snapshot and re-applied afterward when provider command execution is available (`apps/gateway/src/hub/session-hub.ts:saveSnapshot`).
- Env file spec paths are constrained to safe relative paths by tool input validation.

### 6.6 Base Snapshot Invariants
- Base snapshot freshness is keyed by `computeBaseSnapshotVersionKey()` plus provider/app-name dimensions.
- At most one canonical row exists per `(versionKey, provider, modalAppName)`; failed rows are reset to building on retry (`packages/services/src/base-snapshots/service.ts:startBuild`).
- Base snapshot builds are Modal-provider operations invoked by worker code only.

### 6.7 Configuration Snapshot Invariants
- Worker must skip rebuild when snapshot already exists and status is `default` or `ready`, unless `force = true`.
- Non-Modal configurations must be marked `default` without snapshot instead of failing.
- Private repos without a resolved GitHub token must fail the configuration build.
- Successful worker builds transition configuration to `status = "default"` with snapshot set, guarded by `status = "building" AND snapshot_id IS NULL`.
- Snapshot build requests are best-effort queue writes; queue failure must not fail configuration creation paths.

### 6.8 Resolver Invariants (Gateway)
- Exactly one resolution mode is valid: direct ID, managed, or CLI (`apps/gateway/src/lib/configuration-resolver.ts:resolveConfiguration`).
- Managed resolution without explicit repo IDs prefers an existing managed configuration for org, preferring one that already has a snapshot.
- CLI resolution is device-scoped by `(userId, localPathHash)` and may create both a CLI configuration and a local repo.
- CLI configuration-repo link failure is currently non-fatal in resolver flow; session creation may proceed with partial setup.

### 6.9 Setup Finalization Invariants
- Finalization requires a setup session with sandbox and matching org.
- Repo resolution is deterministic but multi-repo + secrets requires explicit `repoId`.
- Snapshot capture must succeed before configuration promotion.
- Existing configuration update has precedence (`updateSnapshotId` then `session.configurationId`), otherwise a new configuration is created and linked.
- `keepRunning = false` triggers best-effort sandbox termination followed by session stop.

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| `sessions-gateway.md` | Gateway → This | `resolveConfiguration()`, `configurations.getConfigurationReposWithDetails()` | Session creation depends on configuration resolution and repo linkage. |
| `sandbox-providers.md` | Worker/Gateway → Provider | `createBaseSnapshot()`, `createConfigurationSnapshot()`, `snapshot()` | This spec owns when these are called; provider spec owns how. |
| `integrations.md` | This → Integrations | `repo_connections`, installation/OAuth token resolution APIs | Used by worker and gateway GitHub token resolution. |
| `agent-contract.md` | Agent tools → This | `save_service_commands`, `save_env_files` interception | Gateway tools persist configuration runtime metadata. |
| `secrets-environment.md` | Finalize → Secrets | `secrets.upsertSecretByRepoAndKey()` | Finalization stores encrypted secrets out-of-scope here. |
| `actions.md` | Runtime usage | org connector lookup by org/session | Configuration-level connectors are legacy; runtime actions use org connectors. |

### Security & Auth
- Web routers rely on `orgProcedure` membership checks before calling services.
- Configuration access checks are enforced via repo linkage to org.
- Public repo search is unauthenticated against GitHub API with explicit user-agent.

### Observability
- Worker modules emit structured logs (`module: "base-snapshots"`, `module: "configuration-snapshots"`).
- Routers emit handler-scoped logs for create/update/failure paths.
- Critical logs include build start/complete/failure and token-resolution failure cases.

---

## 8. Acceptance Gates

- [ ] Typecheck passes (`pnpm typecheck`)
- [ ] Worker tests pass (`pnpm -C apps/worker test`)
- [ ] Spec terminology is configuration-first and consistent with current code
- [ ] Section 6 remains declarative (invariants/rules), not imperative step-by-step execution

---

## 9. Known Limitations & Tech Debt

- [ ] **Managed configuration lookup is not org-indexed in DB query** — `findManagedConfigurations()` loads all managed rows and filters in memory by org. Impact: linear scan growth.
- [ ] **Configuration listing auth is post-query filtering** — `listConfigurations()` loads rows then filters by repo org in memory. Impact: unnecessary data scan and cross-org exposure risk surface in service layer.
- [ ] **Workspace path normalization is incomplete** — attach/detach flows do not rebalance existing paths (e.g., single `"."` to multi-repo layout). Impact: mixed path semantics across older/newer configs.
- [ ] **Setup finalization orchestration remains router-heavy** — snapshot, secret persistence, config mutation, and session updates are co-located in router code. Impact: reuse/testability friction.
- [ ] **Public GitHub search uses unauthenticated requests** — rate-limited to low default GitHub API quotas. Impact: degraded UX under load.
- [ ] **No webhook-driven automatic configuration snapshot refresh** — snapshots are primarily created on configuration creation/finalization, not on repo pushes. Impact: staleness until session-time git freshness.
- [ ] **Legacy repo snapshot columns still exist** (`repo_snapshot_*`) and are still read as fallback in gateway snapshot/deps heuristics. Impact: model complexity and drift between legacy/current snapshot paths.
- [ ] **Naming drift across layers** — some docs/CLI client APIs still expose `prebuild` terminology while backend entities are configuration-based. Impact: agent/operator confusion and migration friction.
- [ ] **Schema/API drift exists in compatibility shims** — service mappers currently emit compatibility defaults (e.g., `isPrivate: false`, `sandboxProvider: null`) that do not fully represent canonical schema state. Impact: risk of incorrect assumptions by callers.
