# Workspace Migration v2 — round-trip handoff on the Stack-1 architecture

Status: proposal, 2026-07-02. Evidence-based: every load-bearing claim below was either
verified against the current `main` tree (file:line cites) or **proven by live
experiment today** (probe scripts + transcripts in the session scratchpad `mig-lab/`;
promoted into the repo validation harness in M0).

Product decisions locked with Pablo (2026-07-02):

- **Round-trip handoff**: a workspace has exactly one live home at a time; migration
  transfers state and flips the home; users can bounce local↔cloud freely. No
  continuous sync.
- **State that must survive v1**: (1) working-tree changes — force commit+push is an
  acceptable mechanism *if the UX is clean*; (2) **agent sessions — history displays
  AND sessions natively resume on the other side**; (3) the workspace scratch pad.
  Environment re-setup and in-flight processes/terminals are out of v1 scope.
- **Generic target↔target** design over the target abstraction (SSH personal targets
  slot in later); implement and gate **local↔E2B** only.
- **Symmetric**: both directions first-class from day one.

Implementation decisions locked (2026-07-02, late):

- **Collision** (local→cloud when an *independently created* cloud workspace already
  exists for the same repo+branch, with its own sessions): **block with choice** —
  "open it, or replace it with this local copy" (replace archives the old one).
  Auto re-adopt+merge happens only when the existing cloud workspace is this
  workspace's own prior home (round-trip).
- **Source fate after cutover**: managed worktrees are destroyed; a workspace on the
  user's own plain directory is only marked `remote_owned` — files untouched.
- **PR shape**: the 4-PR stack (A engine / B server+SDK / C desktop local→cloud /
  D mirror+cleanup), each independently green; A∥B.
- **v1 entry surfaces**: workspace context menu verb + the workspace header's
  location chip becomes clickable to move.

## 0. Where migration actually stands today (ground truth, 2026-07-02)

The "migration workflow we in theory have" is literal:

1. **A full product feature existed and shipped** (spec 10, `specs/codebase/features/`
   `workspace-migration.md`, 2026-05-20; hardened by `specs/tbd/workspace-migration-`
   `git-durability-plan.md`, 2026-05-30): mobility identity rows, handoff-op state
   machine with `canonical_side`/`cutover_committed`, per-item cleanup + reconciler,
   desktop overlay/popover/git-prep UI.
2. **All of it was deleted from `main` on 2026-07-01/02** by the Stack-1 cutover
   (#823 "delete parked cloud domains and dead consumers"): DB tables dropped
   (`f8b9c0d1e2f4_drop_parked_cloud_domain_tables.py`; the old table names are now in
   the schema-assertion **MUST-NOT-EXIST** list,
   `server/tests/integration/schema_migration_assertions.py:52-80`), server router
   unmounted and files deleted, the Cloud SDK client and ~90 desktop files removed.
3. **The engine survived intact**: the anyharness mobility domain (~1,900 lines,
   tested) and its HTTP surface are still mounted on every runtime
   (`api/router.rs:132-233` — preflight, runtime-state freeze, export, install,
   destroy-source, prepare-destination). It has zero callers. It also already contains
   the git-durability hardening: **export hard-refuses anything but
   `requireCleanGitState=true` with matching `expectedHandoffOpId` +
   `expectedBaseCommitSha` + `expectedBranchName`** (verified live — §1;
   `validate_expected_export_git_state`, `domains/mobility/service.rs:1124-1165`).

So v2 is not "harden the feature"; it is **rebuild a much smaller product layer on the
new architecture around a proven engine** — and fix the one engine behavior that
violates the locked requirements.

## 1. What the live experiments proved today

Setup: two fully isolated anyharness instances (separate `--runtime-home`, separate
ports, separate git clones at different absolute paths — simulating two machines),
driven over the real HTTP API with real Claude/Codex sessions; plus a real E2B sandbox
from `proliferate-runtime-dev-pablo`.

| # | Claim | Result |
|---|-------|--------|
| E1a | Engine round-trip works end-to-end today (create ws → real Claude turn → freeze → export → prepare-destination → install) | **Pass.** Archive carried the session (16 events) + the Claude transcript artifact; destination worktree created; history renders from imported `session_events`. |
| E1b | Export refuses dirty/unguarded state | **Pass.** `MOBILITY_EXPORT_CLEAN_GIT_REQUIRED` → `..EXPECTED_HANDOFF_REQUIRED` → `..EXPECTED_BASE_REQUIRED` — the full guard chain is live and mandatory. |
| E1c | **Claude sessions natively resume at the destination if `native_session_id` is preserved** | **Pass.** Install already re-slugs the transcript into `~/.claude/projects/<dest-path-slug>/`; after restoring the native id (which install nulls), the migrated session recalled the codeword (`MANGO-42`) at a different path in a different runtime. |
| E1d | **Codex sessions natively resume across a cwd change** | **Pass.** Rollout `.jsonl` is session-id-keyed; installed into the destination codex sessions root; with native id preserved the session recalled `TANGO-77`. Codex tolerates the recorded-cwd mismatch. |
| E2 | E2B leg mechanics | **Pass.** Template pre-bakes anyharness + worker/supervisor/git-credential-helper + agent CLIs; create ≈1s, **pause 1.0s, resume 0.2s, byte-perfect file persistence**; killed clean. |

Engine defects found by experiment (fixed in M0, §5.1):

- **The engine deliberately breaks native resumability**: `install_workspace_archive`
  sets `session.native_session_id = None` (`domains/mobility/service.rs:589`) and
  `relocate_for_mobility` nulls it in raw SQL
  (`domains/sessions/store/mobility.rs:14`). E1c/E1d prove the rest of the machinery
  (artifact re-slug, id-keyed rollout lookup, `LoadNative(id, cwd)` launch strategy)
  already works — preserving the id is the missing move.
- **Destination worktrees are un-purgeable**: `create_mobility_destination` puts them
  under `<runtime_home>/mobility/destinations/<repo_root_id>`
  (`domains/workspaces/runtime/mobility.rs:37-41`) which is *outside*
  `managed_worktrees_root()` (`domains/workspaces/managed_root.rs:5-13`, default
  `runtime_home/../worktrees`), so `retire_worktree_materialization` refuses with
  `refusing to remove worktree outside managed worktrees root`
  (`domains/workspaces/runtime/materialization.rs:22-31`). Observed live as
  `cleanupState: failed`.
- **Round-trip re-import is guarded but too strict**: `validate_install_preconditions`
  (`domains/mobility/service.rs:783-851`) routes a duplicate session id either to the
  relocate path or to a hard `MobilityError::SessionAlreadyExists` (:826-839) —
  `insert_session_row` is a plain `INSERT` (`sessions/store/sessions.rs:548-589`,
  `id TEXT PRIMARY KEY`), so nothing supports "this session is coming home."
- **Duplicate checked-out branch is refused** at prepare-destination (by design) —
  so "move back" must **re-adopt** the original worktree, not mint a fresh
  destination. The reuse machinery partially exists
  (`find_reusable_mobility_destination_workspace`,
  `workspaces/runtime/mobility.rs:218-222`).

## 2. Architecture

### 2.1 Principles

1. **Git is the transfer plane for code; the archive is the transfer plane for
   sessions.** Migration never moves file deltas (the engine now enforces this).
   Source side commits+pushes (clean, explicit UX — reuse the publish workflow, §5.4).
   Destination arrives at the exact SHA via mechanisms each target already has:
   cloud = repo materialization + `create_remote_worktree_workspace`; local = fetch +
   `prepare-destination`/re-adopt.
2. **AnyHarness on each side owns export/import; the server is the ledger + the cloud
   side's arms.** The server already holds `anyharness_base_url` + decrypted bearer
   per sandbox (`cloud_sandboxes/service.py::load_cloud_sandbox_runtime_access`), so
   *no part of the cloud leg needs Desktop to reach the sandbox*.
3. **Symmetric by construction**: no direction enum. A move is
   `{source: RuntimeRef, destination: RuntimeRef}`,
   `RuntimeRef = local(desktop_install_id) | cloud(cloud_sandbox) | ssh(target, M3)`.
   Executors fall out of reachability: Desktop drives the local side; the server
   drives the sandbox side.
4. **One durable row, two cleanup obligations.** Keep spec 10's one good invariant —
   atomic cutover, destination canonical, source cleanup retry-only — and drop the
   heartbeat/repair/six-kind-cleanup machinery. In Stack 1 the post-cutover cleanup is
   exactly (a) retire the source anyharness workspace, (b) archive/create the
   `cloud_workspace` row.
5. **No new identity ledger.** The identity that survives a move is *the repo+branch*,
   and both sides already encode it: the desktop's logical-workspace id is built from
   `(provider, owner, repo, branch)` (`logical-workspace-id.ts:23-36`), and
   `cloud_workspace` is unique per (owner, repo_environment, branch). A moved
   workspace keeps the same logical id by construction — which is also what makes the
   scratch pad free (§2.5).

### 2.2 Data model (server) — one new table

Old names (`cloud_workspace_mobility`, `cloud_workspace_handoff_op`, …) are barred by
the schema assertions; `workspace_move` is a fresh name.

```python
# server/proliferate/db/models/cloud/workspace_moves.py   (new)
class WorkspaceMove(Base):
    __tablename__ = "workspace_move"
    id: Mapped[uuid.UUID]              # pk
    user_id: Mapped[uuid.UUID]         # fk users.id
    repo_config_id: Mapped[uuid.UUID]  # fk repo_config.id  (logical identity, server side)
    branch: Mapped[str]
    source_kind: Mapped[str]           # 'local' | 'cloud' | 'ssh'   (CheckConstraint)
    destination_kind: Mapped[str]      # 'local' | 'cloud' | 'ssh'
    source_ref: Mapped[dict]           # JSONB {desktopInstallId|cloudWorkspaceId|targetId, anyharnessWorkspaceId}
    destination_ref: Mapped[dict]
    base_commit_sha: Mapped[str]       # the pushed SHA the move is pinned to
    phase: Mapped[str]                 # 'started'|'destination_ready'|'installed'|'cutover'|'completed'|'failed'
    canonical_side: Mapped[str]        # 'source'|'destination' — flips atomically at cutover
    failure_code: Mapped[str | None]
    failure_detail: Mapped[str | None]
    idempotency_key: Mapped[str]
    created_at / updated_at / cutover_at / completed_at
    # partial unique: one non-terminal move per (user_id, repo_config_id, branch)
```

No heartbeat, no reconciler, no cleanup-item table. Recovery is re-derivation: a stale
non-terminal row + engine preflight tells Desktop exactly what to offer
("resume or abandon" pre-cutover; "finish cleanup" post-cutover — both idempotent).

### 2.3 The two flows

**local → cloud** (Desktop executes; ~5 calls):

```text
1. Desktop: engine preflight (source) + git-prep UI if dirty/ahead → push → sha
2. Desktop → server: POST /v1/cloud/workspace-moves        {repoConfigId, branch, sha,
                                                            source:{kind:local,...}, destination:{kind:cloud}}
     server (under redis_materialization_lock on the sandbox):
       connect_ready_sandbox → materialize_repo_environment_in_context(repo@sha)
       → create_remote_worktree_workspace(branch, sha)
       → returns {moveId, cloudWorkspaceId, anyharnessWorkspaceId}      phase=destination_ready
3. Desktop: PUT source mobility/runtime-state {frozen_for_handoff, moveId}
            POST source mobility/export {requireCleanGitState, expected*}  → archive
4. Desktop → server: POST /workspace-moves/{id}/install     {archive}
     server → sandbox anyharness: POST /v1/workspaces/{ahid}/mobility/install
       {archive, operationId: moveId, installMode: preserve_native_sessions}   phase=installed
5. Desktop → server: POST /workspace-moves/{id}/cutover     (atomic flip)      phase=cutover
   Desktop cleanup: PUT source runtime-state {remote_owned} → POST destroy-source
   Desktop → server: POST /workspace-moves/{id}/complete                       phase=completed
```

**cloud → local** (mirror; Desktop executes, server operates the sandbox):

```text
1. Desktop: git-prep runs against the *cloud* workspace — the same publish hooks
   already route to the sandbox via the gateway (§5.4) → push → sha
2. Desktop → server: POST /v1/cloud/workspace-moves {source:{kind:cloud,...}, destination:{kind:local}}
     server: freeze cloud ws + export archive from sandbox anyharness → returns
     {moveId, archive}   (sessions-only; size-capped by MAX_MOBILITY_ARCHIVE_BODY_BYTES)
3. Desktop: fetch sha → prepare-destination locally — or RE-ADOPT the original local
   worktree if this branch already has one (round-trip case) → install
   {installMode: preserve_native_sessions}
4. Desktop → server: POST /workspace-moves/{id}/cutover
     server cleanup: destroy sandbox worktree ws (destroy-source via its stored
     runtime access) + archive_cloud_workspace row               phase=completed
```

Locking: the sandbox-side steps run under the existing per-sandbox
`redis_materialization_lock` (`materialization/locks.py:56-103`). Note
`run_cloud_sandbox_operation`'s `operation_key` param is dead (`operation.py:24-40`,
`del operation_key`) and its lock is keyed on sandbox id only — that is sufficient
here (only sandbox-side steps need it); cross-runtime serialization comes from the
partial-unique non-terminal `workspace_move` row.

### 2.4 Engine v2 semantics (anyharness — exact changes in §5.1)

1. **`installMode: fresh_native | preserve_native_sessions`** on install: preserve
   `native_session_id` for `agent_kind ∈ {claude, codex}` (proven safe by E1c/E1d).
   Other harnesses keep null-and-fresh and the UI labels those sessions
   "history moved; conversation restarts fresh."
2. **Re-adopt on install**: a session id that already exists on the destination
   (round-trip coming home) updates-in-place instead of erroring; a workspace that was
   the original source of a prior move re-activates instead of demanding a fresh
   worktree.
3. **Destination placement fix**: destinations move under `managed_worktrees_root()`
   so retire/purge works.
4. **Codex extras (v1.1, flagged)**: goals live in `~/.codex/goals_1.sqlite`, outside
   the rollout — an active Codex goal does not survive a move today. Extend the
   collector once the goals feature lands (coordinate with
   `specs/tbd/goals-and-workflows-v1.md`).

### 2.5 Scratch pad — zero migration needed (verified)

The scratch key is **already the logical workspace id**: `ScratchPadPanel` receives
`workspaceUiKey` which `resolveWorkspaceUiKey` sets to `selectedLogicalWorkspaceId`
(`lib/domain/workspaces/selection/workspace-ui-key.ts:7-12`), and the Rust side just
SHA-256s that opaque string (`commands/workspace_scratch.rs:58-66`). Because the
logical id is built from (provider, owner, repo, branch) — stable across a move — the
same notes file resolves before and after migration with **no code change**. v2 adds
only a regression test pinning this (key stability across local↔cloud materialization
of the same logical workspace).

### 2.6 UI

- **Entry**: "Move to cloud…" / "Move to this Mac…" in the workspace context menu +
  sidebar actions. Hidden while a non-terminal `workspace_move` exists, a turn is
  running, or the destination is unreachable.
- **Git prep**: the durability plan's dialog semantics (editable commit message,
  "Include unstaged" default-on, "Commit, push, and move"), built on the existing
  publish workflow pieces — which are already source-neutral (§5.4).
- **Progress**: one compact modal (Prepare → Transfer sessions → Switch over → Clean
  up), each step re-runnable. Pre-cutover failure: "Source untouched — retry/cancel."
  Post-cutover: "Moved. Cleanup pending — retry."
- **After**: same sidebar entity (same logical id), location chip flips, sessions
  list identical, prompting a moved Claude/Codex session continues the native
  conversation.

### 2.7 Explicit non-goals (v1)

No headless/worker-driven moves; no environment migration (setup_script re-runs on
worktree creation; secrets materialize per-target); no in-flight process/terminal/loop
migration (preflight blockers); no MCP/agent-auth transfer (destination capability
state applies; ciphertext is machine-keyed anyway); no shared/claimed directions; no
cross-org.

## 3. Build order & gates (each gate = real harnesses, real keys, zero mocks)

| Phase | Scope | Gate |
|-------|-------|------|
| M0 | Engine v2 (§5.1) + dead-code re-point/delete (§5.5) | Promoted E1 scripts as a black-box scenario in `anyharness/tests/`: Claude+Codex codeword recall post-move, A→B→A re-adopt, destination purge works |
| M1 | Server domain + SDK (§5.2–5.3); local→cloud flow; Desktop git-prep + progress UI (§5.4) | Real repo, dirty tree → "Commit, push, and move" → session resumes in cloud workspace from pdev desktop; kill Desktop mid-move pre-cutover → source unfrozen on reattach |
| M2 | cloud→local (mirror) + logical-merge stale-type cleanup + scratch regression test | Bounce the same workspace local→cloud→local; original worktree re-adopted; scratch notes intact; session still recalls context |
| M3 | SSH targets (after #881–#886): `ssh` RuntimeRef over the tunnel | Same E1 suite against an SSH box |

## 4. Open questions / risks

1. **Claude same-machine round-trip**: the source slug's transcript still exists on
   re-adopt; decide overwrite-vs-freshest-wins for the session dir on install.
2. **Codex old-cwd text in replayed history**: resume works (E1d); tool-call text
   references old paths — cosmetic.
3. **Archive size**: sessions-only archives are small (E1: ~30KB/session); the
   existing `MAX_MOBILITY_ARCHIVE_BODY_BYTES` cap stays; add per-session trimming only
   if real data demands.
4. **Sandbox pause mid-move**: resume-on-connect is 0.2s (E2) and all sandbox steps go
   through `connect_ready_sandbox` under the lock — handled by construction.
5. **Spec hygiene**: fold spec 10 + the durability plan into a rewritten
   `specs/codebase/features/workspace-migration.md` on ratification (PR #890's
   rewritten primitives are the substrate to cite).

---

## 5. Exact code map

Everything below was verified against the current tree (line numbers as of
2026-07-02).

### 5.1 AnyHarness engine (Rust) — modify in place

`anyharness/crates/anyharness-lib/` unless noted. Tests run
`cargo test -p anyharness-lib` from repo root (workspace root `Cargo.toml:3`).

**Contract (new wire field)** — `anyharness-contract/src/v1/mobility.rs`:

```rust
// add next to WorkspaceMobilityRuntimeMode (:10-17)
#[derive(..., Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum MobilityInstallMode { FreshNative, PreserveNativeSessions }

// InstallWorkspaceMobilityArchiveRequest (:93-99) gains:
pub install_mode: Option<MobilityInstallMode>,   // default FreshNative = today's behavior
```

Mapping glue must follow in `api/http/mobility_contract.rs` (`to_contract_*`) and
`api/http/mobility_archive_contract.rs` (`from_contract_*`) — every wire field needs
both directions. Handler: `api/http/mobility.rs:210`
(`install_workspace_mobility_archive`); route already registered with the body-size
layer at `api/router.rs:226-230`.

**Preserve native ids** — `domains/mobility/service.rs`:

- `install_workspace_archive` (:523-528) takes the mode; the null at **:589**
  (`session.native_session_id = None;` inside the `for bundle in &archive.sessions`
  loop at :584) becomes:

```rust
match install_mode {
    MobilityInstallMode::PreserveNativeSessions
        if is_supported_agent_kind(&session.agent_kind) => { /* keep id */ }
    _ => session.native_session_id = None,
}
```

- `is_supported_agent_kind` (:1100-1102) stays `matches!(agent_kind, "claude" | "codex")`.
  Adding a harness later touches this **and** the per-kind match in
  `domains/agents/portability/mod.rs` (collect :23-37 / install :39-53 /
  validate :55-88 / delete :90-133) — double-gated on purpose.
- Relocate path: `domains/sessions/store/mobility.rs:8-62`
  (`relocate_for_mobility`) — the `native_session_id = NULL` at **:14** gets a
  `preserve_native: bool` parameter (keep nulling
  `mcp_bindings_ciphertext`/`mcp_binding_summaries_json` at :27-28 — machine-keyed,
  must not survive). Thin wrapper `relocate_session_for_mobility`
  (`domains/sessions/service/mobility.rs:54-56`) threads it; call site
  `domains/mobility/service.rs:598-603`.

**Re-adopt on install** — `validate_install_preconditions`
(`domains/mobility/service.rs:783-851`): the duplicate-id branch at :826-839 currently
allows relocate or throws `MobilityError::SessionAlreadyExists`. Extend
`can_relocate_existing_archive_session` to also accept the coming-home case (existing
session row whose workspace is `remote_owned`/retired for this repo+branch), routing
it to an update-in-place import. Store side: `import_bundle`
(`domains/sessions/store/sessions.rs:379-411`) is a plain-INSERT tx
(`insert_session_row` :548-589, `id TEXT PRIMARY KEY` per
`persistence/sql/0001_initial.sql:18`) — add an upsert variant used only by the
re-adopt path (replace events above the destination's high-water seq, refresh
artifacts). Export-side idempotency already exists via `find_completed_install`
(service.rs:535-538, backed by `persistence/sql/0028_mobility_archive_installs.sql`).

**Destination placement fix** — `domains/workspaces/runtime/mobility.rs:37-41` owns
`base_dir = runtime_home/mobility/destinations/<repo_root_id>` (duplicated at
:218-222 in `find_reusable_mobility_destination_workspace`). Re-root it under
`managed_worktrees_root(&self.runtime_home)` (`domains/workspaces/managed_root.rs:5-13`,
env override `ANYHARNESS_WORKTREES_ROOT` at :3) so
`retire_worktree_materialization`'s guard
(`domains/workspaces/runtime/materialization.rs:22-31`) stops refusing. If a schema
note is needed, next sqlite migration slot is `persistence/sql/0052_*.sql` registered
in the `MIGRATIONS` array (`persistence/migrations.rs:5-193`); likely not needed —
this is a path policy change, not schema.

**Tests** — extend the existing inline mods and add the black-box scenario:

- `domains/mobility/service.rs` `mod tests` (:971-1520) — add preserve-mode +
  re-adopt cases beside `relocation_requires_matching_source_to_be_frozen` (:1005)
  and the export-guard tests (:1020-1059).
- `domains/workspaces/runtime/tests.rs` — destination-placement + purge tests beside
  `create_mobility_destination_adopts_clean_existing_destination_path` (:72).
- `domains/agents/portability/mod.rs` `mod tests` (:426-547) — add a Claude
  slug-rewrite round-trip test (today only Codex collection is covered).
- New: `anyharness/tests/scenarios/workspaces/mobility-roundtrip.test.ts` — the
  promoted E1 driver (two runtimes, codeword recall, A→B→A) in the existing vitest
  black-box suite (`anyharness/tests/package.json` `test`, `test:cloud:e2b`).

### 5.2 Server (Python) — one new domain, one resurrected integration module

New domain, mirroring the `cloud_sandboxes/` exemplar (api/models/service/transactions
split; api.py restricted-imports + service-through-`session_ops` rules enforced by
`scripts/check_server_boundaries.py`):

```text
server/proliferate/
  db/models/cloud/workspace_moves.py        (new)  WorkspaceMove ORM (§2.2)
  db/store/workspace_moves.py               (new)  create_move / load_active_move_for_identity /
                                                   advance_phase / commit_cutover (atomic flip) / fail_move
  server/cloud/workspace_moves/             (new)
    __init__.py
    api.py          APIRouter; deps: get_async_session + current_product_user
                    (auth/dependencies.py:54-58)
                    POST /workspace-moves                   start (§2.3 step 2)
                    GET  /workspace-moves/{move_id}
                    POST /workspace-moves/{move_id}/install   local→cloud: body = archive
                    POST /workspace-moves/{move_id}/export    cloud→local: returns archive
                    POST /workspace-moves/{move_id}/cutover
                    POST /workspace-moves/{move_id}/complete
                    POST /workspace-moves/{move_id}/fail
    models.py       pydantic, Field(serialization_alias=camelCase) per the exemplar
    service.py      the saga: composes run_cloud_sandbox_operation (operation.py:24-40),
                    connect_ready_sandbox (sandbox_io/connect.py:55-59),
                    materialize_repo_environment_in_context (materialize/repo_environment.py:67-74),
                    create_remote_worktree_workspace (integrations/anyharness/workspaces.py:157-230),
                    load_cloud_sandbox_runtime_access (cloud_sandboxes/service.py) for direct
                    runtime calls, archive_cloud_workspace (db/store/cloud_workspaces.py:170)
    transactions.py thin session_ops wrappers (exemplar: cloud_sandboxes/transactions.py)
```

Mount: `server/cloud/api.py` — include beside cloud_sandboxes_router/workspaces_router
(:41-42; imports :10/:28). Effective path `{api_prefix}/v1/cloud/workspace-moves`
(prefix mechanics `main.py:254,309`).

Anyharness-over-HTTP calls live in the integrations layer (raw `httpx` is banned
elsewhere by check_server_boundaries): **resurrect the dead wrappers** in
`integrations/anyharness/workspaces.py` — `prepare_runtime_mobility_destination`
(:108-154) and `destroy_runtime_mobility_source` (:266-292) become live again — and
add a sibling `integrations/anyharness/mobility.py` with
`export_runtime_mobility_archive`, `install_runtime_mobility_archive`,
`set_runtime_mobility_state`, `preflight_runtime_mobility` following the same
per-call `(runtime_url, access_token)` + `auth_headers` pattern (`client.py:6-7`).
Delete `list_runtime_workspaces` (:233-263, no callers). Careful: shared helpers
`_runtime_status_error_message` (:19-39) and `_parse_resolved_workspace` (:42-71)
serve live functions too.

Alembic: new revision `<12hex>_workspace_move.py` parented on current single head
`c3f7a1e9d2b4` (`c3f7a1e9d2b4_user_token_generation.py:21-22`; heads guard
`scripts/check_migration_heads.py` fails forked history). Update
`schema_migration_assertions.py` must-exist set (:10-51) with `workspace_move`; the
must-not-exist set (:52-80) already bars the four old table names — do not reuse them.

Config: three dead leftovers already sit at `config.py:353-355`
(`workspace_move_cleanup_max_attempts`, `workspace_move_executor_heartbeat_timeout_seconds`,
`workspace_move_cleanup_reconciler_interval_seconds` — zero readers). Delete the
heartbeat/reconciler two (v2 has neither), keep/reuse the location for any new
`workspace_move_*` settings.

Tests: `server/tests/cloud/workspace_moves/` — start/idempotency-key replay, phase
order enforcement, cutover atomic flip (canonical_side + cloud_workspace archive in
one tx), fail-pre-cutover leaves source refs untouched, install/export proxy paths
with a faked runtime.

### 5.3 Cloud SDK

- Regen: `make cloud-client-generate` (Makefile:850-854 → openapi-typescript into
  `cloud/sdk/src/generated/openapi.ts`).
- New handwritten client `cloud/sdk/src/client/workspace-moves.ts` (24th file in
  `src/client/`) and hooks `cloud/sdk-react/src/hooks/workspace-moves.ts`, matching
  the existing per-domain naming. Repo-shape: 600-line cap applies
  (`scripts/check_max_lines.py` CHECK_ROOTS include both SDK src trees; generated/
  exempt).

### 5.4 Desktop

**Reused as-is (verified present + source-neutral):**

- Publish machinery: `hooks/workspaces/workflows/use-workspace-publish-workflow.ts`
  (`useWorkspacePublishWorkflow` :37),
  `lib/workflows/workspaces/run-workspace-publish-workflow.ts` (pure runner :11),
  `lib/domain/workspaces/creation/publish-workflow-steps.ts`
  (`resolvePublishDisabledReason` :11, `buildPublishWorkflowSteps` :98),
  `components/workspace/git/PublishDialog.tsx` (:25).
- Git hooks come from `@anyharness/sdk-react` (`hooks/git.ts` — `useGitStatusQuery`
  :85, `useStageGitPathsMutation` :231, `useCommitGitMutation` :279,
  `usePushGitMutation` :295) and take any workspaceId; routing to a cloud workspace
  happens via `resolveRuntimeTargetForWorkspace`
  (`lib/access/anyharness/runtime-target.ts:29`; cloud branch :58-80 →
  `resolveCloudSandboxGatewayConnectionForCloudWorkspace`,
  `lib/access/cloud/cloud-sandbox-gateway.ts:50`, gateway URL built at :65). **So the
  same git-prep dialog works against the sandbox with no new plumbing.**

**New files (per the frontend guides' placement rules — lib.md:8-10, access.md:9-20):**

```text
apps/desktop/src/
  lib/domain/workspaces/move/
    move-model.ts              MovePhase, MoveRuntimeRef, MoveReadiness types
    move-readiness.ts          pure resolver: git snapshot + preflights →
                               safe | push_required | prepare_required | blocked
                               (the durability plan's four states)
    move-readiness.test.ts
  lib/workflows/workspaces/
    run-workspace-move-workflow.ts        pure step sequencer (pattern:
    run-workspace-move-workflow.test.ts    run-workspace-publish-workflow.ts:11)
  lib/access/anyharness/
    mobility.ts                raw export/install/runtime-state/preflight calls
                               against a resolved RuntimeTarget
  hooks/access/cloud/workspace-moves/
    query-keys.ts
    use-workspace-move.ts
    use-start-workspace-move-mutation.ts
    use-workspace-move-phase-mutations.ts
  hooks/workspaces/workflows/
    use-workspace-move-workflow.ts        React wiring: publish-prep → saga steps
  components/workspace/move/
    MoveWorkspaceDialog.tsx (+test)       reuses PublishDialog's commit-message +
    MoveProgress.tsx                       include-unstaged controls with move copy
```

**Entry points (modify):**

- `hooks/workspaces/ui/use-workspace-sidebar-native-context-menu.ts` — add the move
  item in `buildWorkspaceSidebarNativeContextMenuItems` (:57; existing items
  :89-140), gated on no-active-move/no-running-turn. Test file already sits beside.
- `hooks/workspaces/workflows/use-workspace-sidebar-actions.ts` (:19) — wire the
  action like `handleCreateCloudWorkspace` (:169-187, which composes
  `useCreateCloudWorkspace` from `hooks/cloud/workflows/use-create-cloud-workspace.ts:87`
  + latency flow).

**Logical-merge cleanup (modify):** the merge already keys on
(provider, owner, repo, branch) — a moved workspace keeps its sidebar identity for
free. What's left is deleting the dead mobility inputs:
`providers/AppProviders.tsx` :29 import + :95-97 `getQueryData(cloudMobilityWorkspacesKey())`
+ :109-117 `cloudMobilityWorkspaces` arg; the mobility loop in
`lib/domain/workspaces/cloud/logical-workspaces.ts:267-292`; stale types
`CloudMobilityWorkspaceSummary`/`CloudMobilityHandoffSummary`/`CloudMobilityRepoRef`
(`cloud-workspace-model.ts:187-222`) and `LogicalWorkspace.mobilityWorkspace`
(`logical-workspace-model.ts:19`); the orphan `cloudMobilityWorkspacesKey` in
`hooks/access/cloud/query-keys.ts`. Replace `mobilityWorkspace`-derived location
display with `workspace_move`-driven state from the new hooks.

**Scratch pad:** no change (§2.5). Add a key-stability regression test beside
`lib/domain/workspaces/selection/workspace-ui-key.ts` (resolver :7-12) and keep
`workspace_scratch.rs` untouched (existing tests :102-137).

**Test conventions:** sibling `*.test.ts` for pure lib code, `*.test.tsx` only for
behavior-owning hooks/components (established pattern:
`publish-workflow.test.ts`, `logical-workspaces.test.ts`,
`use-workspace-sidebar-native-context-menu.test.ts`, `PublishDialog.test.tsx`).

### 5.5 Re-point or delete (M0 sweep)

| Item | Action |
|------|--------|
| `integrations/anyharness/workspaces.py:108-154, 266-292` (prepare/destroy mobility wrappers) | **Re-point** — become live in the v2 saga |
| `integrations/anyharness/workspaces.py:233-263` (`list_runtime_workspaces`) | Delete (no callers) |
| `config.py:353-355` dead `workspace_move_*` settings | Delete heartbeat/reconciler; keep slot for v2 settings |
| `anyharness/sdk/src/index.ts:103` + `sdk-react/src/index.ts:105` mobility re-exports | **Re-point** — desktop's new `lib/access/anyharness/mobility.ts` consumes them |
| Desktop `cloudMobilityWorkspaces` plumbing + stale types (§5.4 list) | Delete in M2 with the merge cleanup |
| Stale `__pycache__`-only dirs `db/store/cloud_mobility/`, `db/store/cloud_sync/`, `server/cloud/mobility/` | Remove from disk (untracked; hygiene) |
