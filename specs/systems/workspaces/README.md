# Workspaces

Status: current (grade B). System spec in the Organization Standard anatomy. The runtime system that owns *where execution happens*: the durable identity of a checkout (local clone or managed worktree), the repo root it belongs to, the per-workspace surfaces layered on that checkout (files, git, hosting, setup, process runs), and the lifecycle verbs that create, archive, checkpoint, restore, move, and purge it. Archiving, checkpoints, worktree restore, repo roots, and mobility are **sections of this spec**, not systems: each has code locality but no owned state or public surface that outlives a workspace ([granularity test](../../README.md)).

Depth references (all banner-linked back here): [workspaces.md](anyharness-workspaces.md) (flows, archive, checkpoints), [files.md](files.md), [git.md](git.md), [mobility.md](mobility.md), [workspace-command-environment.md](command-environment.md), and the client-side [workspaces system docs](../workspace-surface/README.md).

## 1. Purpose

Give every session, terminal, subagent, review, and workflow one durable, canonical execution surface — a `WorkspaceRecord` pointing at exactly one repo root and one path — and guarantee that nothing destructive ever runs on a guess about that path. The product outcome: a user can open a repo, spin worktrees per task, archive them when done, undo cheaply, and never lose a checkout the runtime did not explicitly get permission to delete.

## 2. Owned state

All rows live in the AnyHarness SQLite database ([schema](../../areas/anyharness-db-schema.sql)); only this system writes them.

| Table | Meaning | Written by |
| --- | --- | --- |
| `workspaces` | `WorkspaceRecord`: kind (`local`/`worktree`), surface (`standard`/`cowork`), repo_root_id, path, branches, lifecycle (`active`/`archived`), archive snapshot columns, origin + creator context | [store/](../../../anyharness/crates/anyharness-lib/src/domains/workspaces/store/mod.rs) |
| `repo_roots` | `RepoRootRecord`: canonical repo path, default branch, parsed remote | [repo_roots/store.rs](../../../anyharness/crates/anyharness-lib/src/domains/repo_roots/store.rs) |
| `workspace_access_modes` | target-local runtime mode: `normal` / `frozen_for_handoff` / `remote_owned` / `repair_blocked` | [store/access.rs](../../../anyharness/crates/anyharness-lib/src/domains/workspaces/store/access.rs) |
| `workspace_checkpoints` | turn-start git captures (row = metadata truth; refs = bytes truth) | [store/checkpoints.rs](../../../anyharness/crates/anyharness-lib/src/domains/workspaces/store/checkpoints.rs) |
| `workspace_setup_state` | last setup-script run pointer per workspace — **owned by [terminals](terminals.md)** (its store writes the row); this system's [setup_runtime.rs](../../../anyharness/crates/anyharness-lib/src/domains/workspaces/setup_runtime.rs) decides *when* | terminals store |
| `worktree_retention_policy` | **vestigial**: table exists ([0040](../../../anyharness/crates/anyharness-lib/src/persistence/sql/0040_worktree_retention_policy.sql)) but no runtime code reads or writes it on `main` — its server-side twin died in the cull (Track A-a part 1); drop with the next migration | nobody |
| `mobility_archive_installs` | replay ledger for idempotent mobility installs | [mobility/store.rs](../../../anyharness/crates/anyharness-lib/src/domains/mobility/store.rs) |

Outside the database this system is the **sole writer** of two private git ref namespaces: `refs/proliferate/archive-*` ([archive/refs.rs](../../../anyharness/crates/anyharness-lib/src/domains/workspaces/archive/refs.rs)) and `refs/proliferate/checkpoints/<workspace>/<checkpoint>/{head,worktree,index}` ([checkpoints/refs.rs](../../../anyharness/crates/anyharness-lib/src/domains/workspaces/checkpoints/refs.rs)), plus the managed worktree directories it materializes under the runtime home and `<runtime-home>/mobility/destinations/<repo-root-id>/`.

## 3. Public surface

HTTP, all under `/v1` ([api/http](../../../anyharness/crates/anyharness-lib/src/api/http/mod.rs)):

| Route family | Module | Verbs |
| --- | --- | --- |
| `/workspaces`, `/workspaces/resolve`, `/workspaces/{id}`, `/workspaces/{id}/display-name` | [workspaces.rs](../../../anyharness/crates/anyharness-lib/src/api/http/workspaces.rs) | list (`?lifecycle=active|archived|all`), create, resolve-by-path, get, rename |
| `/workspaces/worktrees` | [workspaces_worktrees.rs](../../../anyharness/crates/anyharness-lib/src/api/http/workspaces_worktrees.rs) | create a managed worktree |
| `/workspaces/{id}/archive`, `/unarchive` | [workspaces_lifecycle.rs](../../../anyharness/crates/anyharness-lib/src/api/http/workspaces_lifecycle.rs) | archive at the flip, undo |
| `DELETE /workspaces/{id}` | [workspaces_purge.rs](../../../anyharness/crates/anyharness-lib/src/api/http/workspaces_purge.rs) | purge |
| `/workspaces/{id}/worktree/restore` | [workspaces_restore.rs](../../../anyharness/crates/anyharness-lib/src/api/http/workspaces_restore.rs) | re-materialize a missing worktree |
| `/workspaces/{id}/detect-setup`, `/setup-status`, `/setup-start`, `/setup-rerun` | [workspaces_setup.rs](../../../anyharness/crates/anyharness-lib/src/api/http/workspaces_setup.rs) | setup-script lifecycle |
| `/worktrees/inventory`, `/worktrees/orphans/prune` | [worktrees.rs](../../../anyharness/crates/anyharness-lib/src/api/http/worktrees.rs) | git-registration inventory + prune |
| `/workspaces/{id}/files/*` | [files.rs](../../../anyharness/crates/anyharness-lib/src/api/http/files.rs) | entries, file read/write, stat, search |
| `/workspaces/{id}/git/*` | [git.rs](../../../anyharness/crates/anyharness-lib/src/api/http/git.rs) | status, diff, branches, stage/unstage(+patch), revert, commit, push |
| `/workspaces/{id}/hosting/pull-requests*`, `/repo-roots/{id}/hosting/pull-requests` | [hosting.rs](../../../anyharness/crates/anyharness-lib/src/api/http/hosting.rs) | PR read model |
| `/workspaces/{id}/processes/run` | [processes.rs](../../../anyharness/crates/anyharness-lib/src/api/http/processes.rs) | one-shot process in the workspace env |
| `/repo-roots`, `/repo-roots/resolve`, `/repo-roots/{id}`, `/repo-roots/{id}/git/branches`, `/files/file`, `/detect-setup`, `/repo-roots/materializations`, `/repo-roots/{id}/workspace-materializations` | [repo_roots.rs](../../../anyharness/crates/anyharness-lib/src/api/http/repo_roots.rs) | repo-root registry + materialization listings |
| `/workspaces/{id}/mobility/preflight`, `/runtime-state`, `/export`, `/install`, `/destroy-source`; `/repo-roots/{id}/mobility/prepare-destination` | [mobility.rs](../../../anyharness/crates/anyharness-lib/src/api/http/mobility.rs) | cross-runtime handoff |

Wire shapes: [workspaces.rs](../../../anyharness/crates/anyharness-contract/src/v1/workspaces.rs), [workspaces_lifecycle.rs](../../../anyharness/crates/anyharness-contract/src/v1/workspaces_lifecycle.rs), [worktrees.rs](../../../anyharness/crates/anyharness-contract/src/v1/worktrees.rs), [repo_roots.rs](../../../anyharness/crates/anyharness-contract/src/v1/repo_roots.rs), [files.rs](../../../anyharness/crates/anyharness-contract/src/v1/files.rs), [git.rs](../../../anyharness/crates/anyharness-contract/src/v1/git.rs), [hosting.rs](../../../anyharness/crates/anyharness-contract/src/v1/hosting.rs), [processes.rs](../../../anyharness/crates/anyharness-contract/src/v1/processes.rs), [mobility.rs](../../../anyharness/crates/anyharness-contract/src/v1/mobility.rs).

In-process surface for sibling domains (the only legal way in — see Fences): `WorkspaceRuntime` ([runtime/mod.rs](../../../anyharness/crates/anyharness-lib/src/domains/workspaces/runtime/mod.rs)) for resolution/creation/restore/materialization; `WorkspaceAccessGate` ([access_gate.rs](../../../anyharness/crates/anyharness-lib/src/domains/workspaces/access_gate.rs)) as the single carrier of "is this workspace mutable right now"; `WorkspaceOperationGate` ([operation_gate.rs](../../../anyharness/crates/anyharness-lib/src/domains/workspaces/operation_gate.rs)) for per-workspace leases; `WorkspaceFileProtection` in [files_runtime.rs](../../../anyharness/crates/anyharness-lib/src/domains/workspaces/files_runtime.rs) as the hook artifacts uses to protect paths; the derived env in [env.rs](../../../anyharness/crates/anyharness-lib/src/domains/workspaces/env.rs).

## 4. Consumes

- `adapters/files`, `adapters/git`, `adapters/hosting`, `adapters/processes`
  ([adapters/](../../../anyharness/crates/anyharness-lib/src/adapters/mod.rs)) —
  the local-capability layer; workspaces decides *meaning*, adapters perform.
  The one carve-out is the two private ref namespaces above, which shell
  `git update-ref`/`show-ref`/`for-each-ref` directly.
- `terminals` — setup and archive-script runs execute through
  `TerminalService` ([manager.rs](../../../anyharness/crates/anyharness-lib/src/live/terminals/manager.rs)); see [terminals.md](terminals.md).
- `sessions` — quiesce, purge, mobility preflight and destroy-source read
  session state and close live sessions through session-owned facades.
- `agents` (harnesses) — mobility and setup consult agent kind and native
  artifact locations; see [harnesses.md](../harnesses/README.md).
- `cowork`, `reviews` — the `WorkspaceSurface::Cowork` gate and review-active
  checks (baseline edges, both slated to invert; see Fences).
- `process_kill` (crate root) — the `PlaneKills` census every destructive step
  awaits.

## 5. Laws

**One workspace, one repo root, one stable path.** `WorkspaceRecord.repo_root_id` is mandatory and `path` is reserved for the row's lifetime; creation refuses any path an archived row still claims for every kind ([store/lookups.rs](../../../anyharness/crates/anyharness-lib/src/domains/workspaces/store/lookups.rs)). Without it native chat resume — keyed on the absolute worktree path — silently attaches to the wrong checkout.

**Nothing destructive runs on a guess.** Every path comparison resolves both sides through [path_identity.rs](../../../anyharness/crates/anyharness-lib/src/domains/workspaces/path_identity.rs) (`same_path` fails closed for claim gates, `same_path_strict` fails closed for "is this registration ours?"), and every destructive step re-reads its row under the workspace lease. The leftover predicate ([archive/phase2.rs](../../../anyharness/crates/anyharness-lib/src/domains/workspaces/archive/phase2.rs)) requires `Worktree ∧ Archived ∧ archived_head_sha ∧ dir present ∧ no other row claims the path`; drop any term and the sweep deletes a live checkout.

**The runtime never deletes a checkout the user did not ask it to delete.** There is no backstop retention pass for local or worktree workspaces. Checkpoint refs are exempt: they are runtime-made copies, not the user's tree ([checkpoints/retention.rs](../../../anyharness/crates/anyharness-lib/src/domains/workspaces/checkpoints/retention.rs)).

**Archive answers at the flip; undo is cheap.** Everything the user waits for precedes `mark_archived`; script, worktree removal, and branch delete run detached under a generation-tagged cancellation token registered *before* the flip ([archive/tokens.rs](../../../anyharness/crates/anyharness-lib/src/domains/workspaces/archive/tokens.rs)), so unarchive can cancel removal and restore in place. "Leftover" is a derived listing fact, never stored state — nothing needs repair, only convergence ([archive/sweep.rs](../../../anyharness/crates/anyharness-lib/src/domains/workspaces/archive/sweep.rs)).

**Archived means read-only, not gone.** `WorkspaceAccessGate` is the single predicate; every mutation returns `WORKSPACE_ARCHIVED`, every read succeeds, and chat history, file tree and git state keep rendering. An unarchive whose path is occupied is a scenario 409 ([archive/tiers.rs](../../../anyharness/crates/anyharness-lib/src/domains/workspaces/archive/tiers.rs)), never a relocation.

**Refs before row on capture, row before refs on delete.** A checkpoint's bytes are durable and verified before its metadata exists; deletion marks `expired_at` first. A crash between the two leaves an orphan the sweep reaps by row-absence, never an unexpired row without bytes ([checkpoints/capture.rs](../../../anyharness/crates/anyharness-lib/src/domains/workspaces/checkpoints/capture.rs)).

**One lease per prompt flow.** Prompt dispatch, checkpoint capture, actor dispatch and settlement share one `SessionPrompt` workspace-operation lease; under-lease entrypoints never reacquire it. This prevents the nested-read deadlock behind a queued exclusive writer and stops retention/purge/archive from observing the refs-before-row interval.

**Mobility moves nothing without external authority.** Export requires the exact frozen handoff id, base commit and branch; `destroy-source` requires `remote_owned`; the runtime cannot choose a destination or prove another runtime canonical ([mobility/runtime/mobility_policy.rs](../../../anyharness/crates/anyharness-lib/src/domains/mobility/runtime/mobility_policy.rs)).

## 6. Emits

- Workspace availability signal — `checkout_directory_missing()` on the record
  ([model.rs](../../../anyharness/crates/anyharness-lib/src/domains/workspaces/model.rs)) drives the
  "worktree no longer exists" UI and refuses session starts; fails open to
  "available" on ambiguous I/O.
- Setup-run status and the setup terminal (consumed by the client setup pane).
- Telemetry: `checkpoint.capture.skipped` (`reason="busy_will_queue"`), the
  archive sweep pass counters, `QuiesceReport` kill census.
- `fork_operations.checkpoint_id` — a lookup-only reference the sessions system
  reads at fork boundaries; NULL means "no checkpoint sat here" and must be
  disclosed, never treated silently.

## 7. Fences

| Not owned | Owner |
| --- | --- |
| Session records, actors, prompt queues | sessions (`domains/sessions/**`, [sessions.md](../sessions/anyharness-sessions.md)) |
| PTY lifecycle and command-run records | [terminals.md](terminals.md) |
| Agent kinds, install, readiness | [harnesses.md](../harnesses/README.md) |
| Artifact manifest and write protection *policy* (workspaces only calls the hook) | [artifacts.md](../sessions/artifacts.md) |
| File path safety, git parsing, PR fetching, process spawning mechanics | runtime `adapters` capability ([adapters.md](../../areas/anyharness.md)) |
| Cloud-side workspace rows, materialization, sandbox placement | environments (control plane; formerly `server/cloud/workspaces`, culled) |
| Client presentation: file tree, git pane, repo-setup flow, sidebar recency | client workspace surface ([workspaces/README.md](../workspace-surface/README.md)) |

Declared domain edges (AH-FENCE-001 baseline in [fences.toml](../../../lints/anyharness/fences.toml)): `workspaces → agents, cowork, repo_roots, reviews, sessions, terminals`. The `workspaces → cowork` and `workspaces → reviews` edges are core-depends-on-surface inversions tolerated by the baseline; they shrink when the Cowork gate and review-active check become extension ports. Twenty-two of the forty-two grandfathered AH-FENCE-002 store-reach sites are inside this domain ([exceptions.toml](../../../lints/anyharness/exceptions.toml)) — the largest ledger share in the runtime.

> [!decision] PABLO DECIDES: repo roots. `domains/repo_roots` is a 260-line
> single-concern domain with its own table and routes. Options: (a) keep it a
> section of this spec and eventually fold the folder in (`workspaces/roots/`);
> (b) promote to its own spec. Recommendation: (a) — it has owned state but no
> laws an uninformed change would violate beyond "one root per workspace".

> [!decision] PABLO DECIDES: mobility. `domains/mobility` (4.2K lines, 7
> store-reach sites) is on the Cull Plan's list but no cull track deleted it.
> Its only product consumers are the desktop "open in web" remote-access flow
> ([use-workspace-open-in-web-actions.ts](../../../apps/packages/product-client/src/hooks/workspaces/workflows/remote-access/use-workspace-open-in-web-actions.ts))
> and copy metadata — a lane that is dark while cloud is gated. Options: (a)
> delete now (domain, routes, contract, `mobility_archive_installs`, client
> remote-access flow); (b) keep as a frozen section until the environments
> rebuild decides whether cross-runtime handoff survives. Recommendation: (a);
> the environments design moves the *record* to the control plane and forks the
> environment, which makes archive-and-install handoff obsolete.

> [!decision] PABLO DECIDES: checkpoints. Turn-start capture is behind
> `ANYHARNESS_CHECKPOINT_CAPTURE` (default off) as a cost-observation rung, and
> the revert/modal consumers it was built for never landed. Options: (a) keep
> dark as the substrate for the demo's "undo a turn" story; (b) cull. Recommendation:
> (a) only if turn-revert is on the launch-week roadmap, otherwise (b).

## 8. Code map

```text
anyharness/crates/anyharness-lib/src/
├── domains/workspaces/                      the system (23K lines)
│   ├── model.rs · types.rs · store/         WorkspaceRecord, lifecycle enums, SQL
│   ├── runtime/                             WorkspaceRuntime: identity, lifecycle,
│   │                                        worktrees, restore, exact_ref, env,
│   │                                        materialization, mobility, workflow_placement
│   ├── resolver.rs · detector.rs            path → repo root/workspace resolution
│   ├── path_identity.rs                     same_path / same_path_strict
│   ├── access_gate.rs · access_model.rs     the archived/frozen predicate
│   ├── operation_gate.rs · checkout_gate.rs per-workspace leases
│   ├── creator_context.rs · options.rs      creation inputs and validation
│   ├── env.rs · exclude.rs                  derived workspace env, ignore rules
│   ├── files_runtime.rs                     file ops + artifact protection hook
│   ├── setup_runtime.rs · worktree_runtime.rs · worktree_names.rs · worktree_checkout.rs
│   ├── inventory.rs · branch_refresh.rs · managed_root.rs · restore_runtime.rs
│   ├── archive/                             SECTION: archive/unarchive, phase2,
│   │                                        tiers, tokens, inflight, quiesce, sweep, refs
│   ├── checkpoints/                         SECTION: capture, refs, retention, flags
│   └── deletion/                            SECTION: purge
├── domains/repo_roots/                      SECTION: model/store/service
├── domains/mobility/                        SECTION (cull candidate): preflight,
│                                            export, install, destination, destroy-source
├── api/http/{workspaces,workspaces_lifecycle,workspaces_purge,workspaces_restore,
│             workspaces_setup,workspaces_worktrees,worktrees,files,git,git_task,
│             hosting,processes,repo_roots,mobility}.rs   transport only
├── app/workspaces.rs · app/mobility.rs     composition of archive/checkpoint/purge
└── (adapters/files, adapters/git, adapters/hosting, adapters/processes → adapters capability)
anyharness/crates/anyharness-contract/src/v1/{workspaces,workspaces_lifecycle,worktrees,
    repo_roots,files,git,hosting,processes,mobility}.rs   wire shapes
```

Target layout (Wave 3 rename, **not current**): `domains/` → `systems/`; `repo_roots/` folds into `workspaces/roots/`; `mobility/` deleted or folded per the decision above. Nothing in this PR moves.

Client-plane presentation of this system's state (owned by the client workspace surface, listed here so the bijection closes): [components/workspace/files](../../../apps/packages/product-client/src/components/workspace/files), [components/workspace/git](../../../apps/packages/product-client/src/components/workspace/git), [components/workspace/repo-setup](../../../apps/packages/product-client/src/components/workspace/repo-setup), [hooks/workspaces](../../../apps/packages/product-client/src/hooks/workspaces), [lib/domain/workspaces](../../../apps/packages/product-client/src/lib/domain/workspaces), [stores/workspaces](../../../apps/packages/product-client/src/stores/workspaces).

## 9. Proof

Pinning suites (all in-crate, run with `cargo test -p anyharness-lib`):

- Archive: [archive/tests/](../../../anyharness/crates/anyharness-lib/src/domains/workspaces/archive/tests/mod.rs)
  — admission, branches, head_mismatch, idempotency, paths, quiesce,
  restore_interlocks, scenarios, sweep, undo; [archive/refs_tests.rs](../../../anyharness/crates/anyharness-lib/src/domains/workspaces/archive/refs_tests.rs).
- Checkpoints: [checkpoints/tests.rs](../../../anyharness/crates/anyharness-lib/src/domains/workspaces/checkpoints/tests.rs),
  [retention_tests.rs](../../../anyharness/crates/anyharness-lib/src/domains/workspaces/checkpoints/retention_tests.rs),
  [gc_tests.rs](../../../anyharness/crates/anyharness-lib/src/domains/workspaces/checkpoints/gc_tests.rs).
- Purge: [deletion/tests/](../../../anyharness/crates/anyharness-lib/src/domains/workspaces/deletion/tests/mod.rs).
- Runtime: [runtime/tests.rs](../../../anyharness/crates/anyharness-lib/src/domains/workspaces/runtime/tests.rs),
  [worktree_tests.rs](../../../anyharness/crates/anyharness-lib/src/domains/workspaces/runtime/worktree_tests.rs),
  [restore_tests.rs](../../../anyharness/crates/anyharness-lib/src/domains/workspaces/runtime/restore_tests.rs),
  [exact_ref_tests.rs](../../../anyharness/crates/anyharness-lib/src/domains/workspaces/runtime/exact_ref_tests.rs),
  [store/tests.rs](../../../anyharness/crates/anyharness-lib/src/domains/workspaces/store/tests.rs).
- Mobility: [mobility_policy_tests.rs](../../../anyharness/crates/anyharness-lib/src/domains/mobility/runtime/mobility_policy_tests.rs),
  [destroy_source_tests.rs](../../../anyharness/crates/anyharness-lib/src/domains/mobility/runtime/destroy_source_tests.rs).
- Cross-plane: workspace-entry.spec.ts pinned the client entry flow over a
  live runtime until the `tests/intent` suite was deleted (2026-08 cull).
- Fence: [check_anyharness_fences.py](../../../scripts/check_anyharness_fences.py)
  holds this domain's edge set; the sole-writer rule for the two ref
  namespaces is review-enforced (grep `update-ref|show-ref|for-each-ref`
  against `refs/proliferate/`).

## Known gaps / follow-ups

- `WorkspaceService` vs `WorkspaceRuntime` duplicated bodies and a ~25-file
  flat root remain the migration exception recorded in
  [domains.md](../../areas/anyharness.md); target is concern folders behind one
  entry surface.
- Queue-drain turn starts are not checkpointed (disclosed conformance
  shortfall of the dispatch-seam hook).
- The two `workspaces → cowork/reviews` edges should become extension ports.
