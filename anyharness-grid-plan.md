# AnyHarness Grid — Implementation Plan of Record

Companion to `anyharness-structure.md` (the law + backlog). This plan turns
the 12 known violations into a sequential PR train with checks landing
first. Written 2026-08-05 against `origin/main` @ `1471d4f7e`.

## Operating rules (apply to every PR)

- **Ratchet-first**: PR 1 lands the lints with today's debt seeded as
  allowlist; every later PR proves progress by shrinking the allowlist in
  the same diff. The checker's stale-count detection makes forgetting this
  a CI failure.
- **One bounded area per PR.** Behavior-preserving moves are separate PRs
  from behavior changes (6a vs 6b).
- **Machine limits**: at most one cargo build at a time; Python-only PRs
  (1, 11) never build Rust; recon/review agents never build.
- **Every PR**: labels on create (`release:maintenance` +
  `area:anyharness`; PR 1/11 add `release:skip` judgment call), dedicated
  agent review at a named SHA, negative control where a fix claims to be
  guarded by a test or lint. Pablo merges; the train finishes at
  pushed + ready.
- **Stacking**: PRs that depend on unmerged predecessors branch from the
  predecessor's head and say so in the PR body ("based on #N — merge that
  first"). Independent PRs branch from `origin/main` but merge serially
  because they all touch `scripts/anyharness_boundaries_allowlist.txt`.

## Dependency graph

```text
PR1 (checker) ──┬── PR1.5 (lints/ folder move — lands right after PR 1, before ratcheting)
                ├── PR2 (acp move)      [independent of 3–5, conflicts on allowlist]
                ├── PR3 (store escapes)
                ├── PR4 (ProblemResponse) — STRUCK: already fixed by #640, recon 2026-08-05
                ├── PR5a (workspaces SQL + retention_policy split)
                │     └── PR5b (remaining SQL folds) ── PR5c (probe.rs fetch)
                ├── PR6a (mobility move) ── PR6b (mobility policy)
                ├── PR7 (materialization) ── PR7b (valve stragglers → valve at zero)
                ├── PR8 (workspaces entry)  ── PR9 (lifecycle handler)
                │     [7b's workspaces items coordinate with 8]
                ├── PR10.x (contract ratchet, per-domain series)
                └── PR11 (agents ledger, docs-only, anytime)
PR12 (capability trait)  — design brief first, after 10.x stabilizes
PR13 (crate splits + visibility) — capstone, after valve rules hit zero
```

---

## PR 1 — Boundary checker: six new rules + seeded allowlist

**Branch**: `codex/anyharness-grid-checker` off `origin/main`.
**Touches**: `scripts/check_anyharness_boundaries.py`,
`scripts/anyharness_boundaries_allowlist.txt`,
`scripts/test_check_anyharness_boundaries.py` (new), `.github/workflows/ci.yml`
(add the unittest line, mirroring the frontend checker step).
**No Rust. No build.**

New rules (IDs, semantics, engine placement):

| Rule ID | Semantics | Engine hook |
| --- | --- | --- |
| `DOMAIN_LIVE_VALVE` | `crate::live` (import or inline path) in `domains/**` legal only in `runtime.rs`, `runtime/**`, `live_ports.rs` — **shapes exception**: `crate::live::<area>::model::*` imports are legal anywhere (the sanctioned observer-trait inversion) | import walk + line pattern |
| `LIVE_DOMAIN_STORE_IMPORT` | `live/**` importing any `crate::domains::*::store` or `::service` path | import walk |
| `API_STORE_ESCAPE` | under `api/**`: `.store()` call or `[A-Za-z]+Store::new` or importing `crate::domains::*::store` | line pattern + import walk |
| `POLICY_PURITY` | in `*_policy.rs` under `domains/**`: `Utc::now`, `Local::now`, `SystemTime::now`, `Instant::now`, `Uuid::new_v4`, `rand::`, store/adapters imports. NOT `&self` (measured: over-fires on Display impls / plain data methods — stays judgment) | line pattern per policy file |
| `DOMAIN_STORE_API_IMPORT` / `DOMAIN_STORE_LIVE_IMPORT` | generalize the sessions-store rule to every `domains/*/store{.rs,/}` | import walk, path predicate generalized |
| `DOMAIN_SQL_OUTSIDE_STORE` | SQL text (`INSERT INTO`, `SELECT … FROM`, `ON CONFLICT`, `CREATE TABLE`, `params!`) in `domains/**` outside store modules | line pattern, calibrated against the 8 known files |
| `DOMAIN_CONTRACT_IMPORT` | any `anyharness_contract` use-line in `domains/**` (broader than the existing `*Request/*Response` rule, which stays) | import walk |

Allowlist seeds are measured (recon 2026-08-05), not estimated:

- `DOMAIN_LIVE_VALVE`: 9 power-importing files — mobility/service.rs:32,
  materialization/service.rs:33, workspaces/{retire_preflight:22,
  setup_runtime:8, access_gate:8+test-mod re-import},
  agents/auth/login_terminal.rs:1, agents/model_snapshot/{probe.rs:40,
  entry.rs:20 (inline), test_support.rs}, sessions/{execution_summary.rs:7,
  subagents/hooks.rs:13}. The observer files (goals/plans/activity/loops/
  reviews session_observer.rs etc.) fall under the shapes exception and
  must NOT be seeded.
- `LIVE_DOMAIN_STORE_IMPORT`: 5 live/terminals files (reason: "older
  doctrine, deliberately retained — ratchet only"), live/sessions/probe.rs:19
  (real debt), background_work/mod.rs cfg(test)-mod import (engine can't
  see cfg boundaries — seeded with that reason).
- `API_STORE_ESCAPE`: mobility.rs:330, workspaces_purge.rs:65,
  sessions_pending.rs:197, workspaces_lifecycle.rs:448, hosting.rs:201 +
  :29 import; workspaces_purge.rs test-mod `Store::new` lines seeded as
  cfg-invisible.
- `POLICY_PURITY`: workspaces/retention_policy.rs (Utc::now ×2 + SQL —
  misnamed file, actually a store with a clock).
- `DOMAIN_SQL_OUTSIDE_STORE`: sessions/links/completions.rs (14),
  plans/service.rs (4), workspaces/retention_policy.rs (4),
  workspaces/access_store.rs (3), activity/feeds.rs, plans/decision_op.rs,
  workspaces/inventory.rs, workspaces/access_gate.rs (1 each) +
  workflows/workspace_materialization/test_support.rs.
- `DOMAIN_CONTRACT_IMPORT`: 86 import lines across 85 files (self-seeded
  from the checker's own first run so counts match its parser exactly).

Every seed line's reason names the cleanup PR in this plan.

Tests (`test_check_anyharness_boundaries.py`, unittest, no repo access —
fabricate files in tempdirs the way `test_check_frontend_boundaries.py`
does): one positive + one negative case per new rule, plus allowlist
ratchet behavior (over-count fails, stale-count fails).

**Gates**: `python3 scripts/check_anyharness_boundaries.py` exits 0 on the
seeded tree; unittest suite green; negative control — temporarily delete
one seed line, checker must fail, restore.

---

## PR 1.5 — Move the lint suite to a top-level `lints/` folder

**Branch**: `codex/lints-folder` off PR 1 head (it moves the files PR 1
edits — must land after it). Python/docs only, **no Rust build**.

`scripts/` is 72 mixed entries; the lint family (~20 files and growing) gets
a designated home, allowlists co-located with their checkers:

```text
lints/
  rust/       check_anyharness_boundaries.py + allowlist + test,
              check_anyharness_old_paths.py,
              check_session_mutation_admission.py + txts,
              check_proliferate_worker_structure.py
  frontend/   check_frontend_boundaries.py + allowlist + test,
              frontend_imports.py, report_frontend_structure.py + allowlist,
              check_appearance_scaling.py (+ baseline json + test),
              check_design_attribution.py (+ test), check_toast_copy.py (+ test),
              check_theme_contrast.py, check_mobile_product_client_export.py
  server/     check_server_boundaries.py + allowlist, check_migration_heads.py,
              check_workflow_managed_boundaries.py
  repo/       check_max_lines.py + allowlist, check_docs.py (+ test)
```

Mechanics: `git mv` (history follows); bump each mover's
`REPO_ROOT = parents[1]` → `parents[2]`; fix package-style imports in the
frontend test (`from scripts import …`); update ~15 `ci.yml` lines; update
every doc citing `scripts/check_*` paths (6+ spec files incl. the frontend
README's CI-Enforced Repo Shape section) in the same PR. Deliberately
top-level (not `scripts/lints/`) — enforcement is first-class, like
`specs/`. Must land **before** the cleanup PRs start ratcheting, or every
later PR's allowlist path churns.

---

## PR 2 — Move `acp/` → `integrations/acp/`

**Branch**: `codex/anyharness-acp-into-integrations` off PR 1 head.
**Touches**: `git mv src/acp src/integrations/acp`; `lib.rs` module decl;
all `crate::acp::` importers (mechanical rename to
`crate::integrations::acp::`); `scripts/check_anyharness_old_paths.py`
(ban `src/acp/` re-introduction); checker updates in the same PR:
`LIVE_RUNTIME_ROOTS = {"acp", "live"}` — after the move, `acp` as a crate
root disappears; the api↛acp protection must be re-expressed (either keep
`acp` in the set harmlessly + add an explicit `api ↛ integrations::acp`
check, or accept that `INTEGRATIONS_*` rules now govern acp — decide in
the diff, document in the PR body). Diagram + structure doc footnotes
("on disk still src/acp") flip to done.
**One cargo build** (`cargo check` + the test scope derived from
`git diff --stat`). Zero behavior change; the diff is big but 95% import
lines.

**Gate**: checker green with no new allowlist entries (acp is at zero
domain imports — the move must not create any).

---

## PR 3 — Kill the api store escapes (violation #4)

**Branch**: `codex/anyharness-api-store-escapes` off PR 1 head.
**Touches**: the 4 `state.session_service.store()` call sites + 
`WorkspaceStore::new` in `api/http/hosting.rs` (exact list from recon).
For each: add the narrow facade method the handler actually needs on
`SessionService`/`WorkspaceService` (named for the use case, not
`get_store()`), re-point the handler, delete the escape. Remove the
`API_STORE_ESCAPE` seeds — **allowlist −5, rule now hard**.
**One cargo build.** Tests: existing api handler tests in scope per diff;
add a service-level unit test per new facade method only where the method
does more than delegate.

---

## ~~PR 4 — Fold ProblemResponse into ApiError (violation #12)~~ STRUCK

**Recon 2026-08-05: the violation no longer exists.**
`agents_model_registry.rs`, the ProblemResponse alias, and its routes were
deleted by #640 (`278fb34ff`, 2026-06-11) — two months before this plan's
base commit, which never contained them. The fold already happened:
`agents_errors.rs:1-3` records "wire titles/codes/statuses preserved
exactly from the retired ProblemResponse mechanism," and the surviving
`AgentRuntimeError`/`InstallError` mappings follow the exemplar
`From<DomainError> for ApiError` shape. ProblemResponse was never a
distinct wire format — a local `(StatusCode, Json<ProblemDetails>)` tuple
over the same contract struct `ApiError` serializes. Nothing to do; PR
number retained so cross-references stay stable. Violation #12 marked
stale in `anyharness-structure.md`. Lesson applied to the rest of the
train: every PR's builder re-verifies its target exists at its base
commit before writing code.

---

## PR 5 — SQL-outside-store fold (violation #8) — now a 2-PR series

Recon found 8 non-test offenders across 5 domains (~29 SQL lines), not 2.

**PR 5a** `codex/anyharness-sql-fold-workspaces` off PR 1 head:
the workspaces cluster — `access_store.rs` (3), `inventory.rs` (1),
`access_gate.rs` (1), plus `retention_policy.rs`'s 4 SQL lines **and its
`Utc::now` impurity in the same PR** (violation #15: the file is a store
with a clock wearing a policy name — split into store queries + a pure
policy fn, clock value passed in). This clears both the SQL seeds and the
`POLICY_PURITY` seed for workspaces.

**PR 5b** `codex/anyharness-sql-fold-rest` off 5a head: `plans/service.rs`
(4) + `plans/decision_op.rs` (1), `activity/feeds.rs` (1), and the big one
— `sessions/links/completions.rs` (14 SQL lines) folded into
`sessions/store/`. Move query text + row structs; callers keep signatures;
no query changes.

**One cargo build each.**

## PR 5c — live/sessions/probe.rs fetch (violation #14, small)

**Branch**: rides with PR 5b or stands alone.
`live/sessions/probe.rs:19` imports
`domains/agents/readiness/service::resolve_agent_unrouted` — the single
non-test break in "live never fetches." Remedy per doctrine: pass the
resolved fact in at the call boundary or wire a capability trait in
`app/`. Read the call site first; pick the smaller diff. Allowlist −1;
live/sessions returns to zero.

---

## PR 6a — Mobility valve, move only (violation #1, part 1)

**Branch**: `codex/anyharness-mobility-valve` off PR 1 head.
**The template PR for valve promotions.** Split
`domains/mobility/service.rs` (1520 lines). Recon 2026-08-05 classified
every use case — the split is mechanical now:

| Use case | Layer | Why |
| --- | --- | --- |
| `export_workspace_archive` :453 | SERVICE | durable-only: own store, session store reads, git adapters, subagent service |
| `prepare_repo_root_destination` :101 | RUNTIME | workspace_runtime.create_mobility_destination + live terminal list |
| `preflight_workspace` :159 | RUNTIME | terminal_service.is_setup_running :237 + list :299, workspace_runtime :219 |
| `install_workspace_archive` :523 | RUNTIME | terminal_service via validate_install_preconditions :793/:810 + session_runtime.forget_live_session… :599 (live via facade) |
| `destroy_source_workspace` :658 | RUNTIME | close_terminal_blocking :678, workspace_runtime ×2 |

- `service.rs` keeps `export_workspace_archive` + the durable helpers
  (`collect_workspace_sessions` :707, `load_workspace` :777,
  `can_relocate_existing_archive_session` :853,
  `validate_expected_export_runtime_state` :925), the pure free fns +
  their 5 existing tests (:938-968, :970-1078), and the pure
  size-accounting tail (:1354-1521).
- new `runtime/` gets the 4 RUNTIME use cases, the `terminal_service`
  field, `workspace_runtime`, `session_runtime`, `review_store`, and the
  live helpers (`validate_install_preconditions`,
  `validate_prepared_destination_is_empty`, `active_terminals_*`).
  Runtime wraps the service (`Arc<MobilityService>` field). Direction is
  already clean: preflight (RUNTIME) calls export (SERVICE), never the
  reverse.
- Facade-laundered live counts as live: `session_runtime` wraps
  `LiveSessionManager`, `access_gate` wraps `TerminalService` — a method
  is RUNTIME if its call tree reaches live through ANY facade, not just
  the :32 import. (access_gate's methods used here — `runtime_state`,
  `assert_can_mutate_for_workspace` — are pure store reads, so the gate
  itself may stay on the service.)
- Re-pointing surface is tiny: each pub method has exactly ONE caller —
  4 handlers in `api/http/mobility.rs` (:65/:199/:239/:301) + 1 in
  `repo_roots.rs` (:254). `app/mod.rs` constructs at :514, AppState field
  :164 — construct service then runtime in dependency order; AppState
  exposes the runtime as the facade (service stays reachable for the
  export endpoint or via runtime delegation — pick in the diff).
- The vestigial `workspace_service` field (only `load_workspace` uses
  it) is PR 8's business (it deletes WorkspaceService and re-points to
  workspace_runtime) — do not fix it here; note PR 8 conflicts with this
  file and lands after.

Bodies unchanged — pure relocation; `git diff --color-moved` should show
mostly moved blocks. Delete the mobility `DOMAIN_LIVE_VALVE` allowlist
entry. **One cargo build.**

## PR 6b — Mobility resolve/decide/execute (violation #1, part 2)

**Branch**: `codex/anyharness-mobility-policy` off PR 6a head.
Restructure `destroy_source_workspace` + `preflight_workspace`: gather all
facts first (resolve), extract decisions into `runtime/mobility_policy.rs`
(pure: no store, no clock, no uuid, no `&self`), then execute effects.
Recon baselines: `destroy_source_workspace` = fetch(workspace) →
fetch(branch) → fetch(terminals) → act(close ×N) → fetch(sessions) →
act(delete ×N) → act(destroy materialization) — three fetch/act pairs
with no re-validation between them. `preflight_workspace` = ~10
fetch→decide round trips (git/store/live interleaved line-by-line),
ending with a nested `export_workspace_archive` call as the size-check
fetch. Note: several "decide" steps already live as pure free fns with
tests — extend that file rather than inventing a second policy home.
Policy tests with hand-built facts, no DB — the `launch_policy.rs` 13-test
pattern. The per-item fetch-act interleaving becomes: resolve the full
item set → policy returns a plan → execute the plan, compensations inline.
**Behavior change risk is real here** (ordering of effects vs failures) —
the PR body must state the before/after failure semantics explicitly.
**Gates**: negative control — revert one policy decision, watch its test
fail. **One cargo build.**

---

## PR 7 — Materialization valve (violation #2)

**Branch**: `codex/anyharness-materialization-valve` off PR 6a head (to
reuse the recipe; rebase onto main once 6a merges). Same split as 6a+6b in
one PR (the domain is much smaller). **One cargo build.**

## PR 7b — Remaining valve stragglers (violation #13)

**Branch**: `codex/anyharness-valve-stragglers` off PR 7 head. The 7
non-mobility/materialization power importers, each with its own remedy —
read before moving:

- `workspaces/{retire_preflight,setup_runtime,access_gate}.rs` import
  `live::terminals::TerminalService` → these are workspace use cases that
  drive terminals; they belong behind a workspaces runtime (may fold into
  PR 8's one-entry-surface work — coordinate, don't duplicate).
- `agents/auth/login_terminal.rs` → agents-side terminal driving; promote
  into an agents runtime seam or re-home the use case.
- `agents/model_snapshot/{probe.rs,entry.rs,test_support.rs}` import
  `live::sessions::probe` → probe types are arguably shapes; decide:
  re-export `ProbeSnapshot`/`ProbeOptions` via `live/sessions/model.rs`
  (shapes exception then applies) or valve them. Prefer the re-export —
  smallest diff, honest semantics.
- `sessions/execution_summary.rs` imports
  `live::sessions::handle::LiveSessionExecutionSnapshot` → a shape living
  in handle.rs; re-export via model.rs, fix the import. Trivial.
- `sessions/subagents/hooks.rs` imports `LiveSessionManager` → a real
  power; move the hook wiring to `live_ports.rs` or the runtime.

After this PR the `DOMAIN_LIVE_VALVE` allowlist reaches zero — **flip the
Dependency Direction row from LEAKS to HOLDS AT ZERO in
`anyharness-structure.md` in this PR.** **One cargo build.**

---

## PR 8 — Workspaces: one entry surface (violation #6)

**Branch**: `codex/anyharness-workspaces-one-entry` off PR 1 head.

**Recon 2026-08-05 shrank this PR.** The overlap is exactly 4 methods, and
the surfaces are siblings (each holds its own `WorkspaceStore`; runtime
does NOT wrap service). `WorkspaceService` has ONE live call site in the
whole tree — `MobilityService::load_workspace` → `get_workspace`
(mobility/service.rs:778); its other 3 methods are dead code. Runtime is
the domain's real backbone (AppState field, ~30 consumers). Divergence
map:

| Method | Verdict |
| --- | --- |
| `get_workspace` | DIVERGED — runtime's copy schedules a background branch-refresh (identity.rs:16-23); service's is a pure read |
| `list_workspaces` | DIVERGED — runtime adds branch-refresh batch + latency tracing; service copy has zero callers |
| `set_display_name` | IDENTICAL bodies, incl. two copies of `MAX_WORKSPACE_DISPLAY_NAME_CHARS = 160`; service copy dead |
| `detect_setup` | IDENTICAL; service copy dead |

The fix: delete `WorkspaceService` outright (both files, ~80 lines),
re-point `MobilityService` at `Arc<WorkspaceRuntime>`, drop the
construction at app/mod.rs:209 + the pass at :515. **One named design
call in the PR body**: mobility's `load_workspace` gains the runtime's
branch-refresh side effect — state whether that's wanted (probably yes:
mobility wants fresh branches) or add a pure `find_workspace` read if
not. Also fold the duplicated const into one place. The doctrine note
("runtime wraps service") is satisfied vacuously — this domain's durable
reads live on the runtime today; re-splitting is PR 13-era work, not
this PR. **One cargo build.**

## PR 9 — workspaces_lifecycle out of the handler (violation #5)

**Branch**: `codex/anyharness-lifecycle-service` off PR 8 head.
Move the retire state machine (3 copies in
`api/http/workspaces_lifecycle.rs`) into the now-single workspaces
surface as one use case with one state-transition policy fn. Handler
becomes auth → parse → one call → map. Dedupe the 3 copies against each
other the same way PR 8 deduped layers. **One cargo build.**

Recon 2026-08-05 specifics: `active_path_owner_retire_blocker` is
duplicated byte-for-byte (retire_preflight.rs:511 pub fn vs a private
re-declaration at workspaces_lifecycle.rs:558) — quick win, import the
pub one. The handler re-derives "is this retirable" three times
(`retire_workspace` :71/:138, `retry_retire_cleanup` :307) from raw
record fields instead of trusting `RetirePreflightChecker::check_workspace`
— and re-runs the access-gate + worktree-path checks the checker already
folds into blockers. Canonical home exists; the PR routes all three
call sites through it.

---

## PR 10.x — Contract-import ratchet (violation #3, series)

**Branches**: `codex/anyharness-contract-<domain>` off whatever is merged.
Per-domain mechanical PRs: introduce the domain twin in `model.rs`, map at
the api mapper, delete the `anyharness_contract` import, decrement the
allowlist. Order by count descending **except** the two spec-first cases:

- `runtime_config` (wire types persisted as rows) — needs a data-shape
  ruling + possibly a migration. Short ruling doc before code.
- `agents/auth` (contract structs as the domain model) — needs domain
  twins designed, not just mapped. Ruling doc before code.

Cadence: ride-along, one domain per PR, no deadline. Each is one cargo
build.

## PR 11 — agents/ ledger truth-up (violation #9)

**Branch**: `codex/anyharness-agents-ledger` — docs only, anytime after
PR 1. Name the 8 `agents/` subdomains in the migration ledger with a
one-line role each + a promotion recommendation (concern folder vs
domain). No code moves until Pablo rules on the recommendations.

## PR 12 — Harness-capabilities trait (violation #10)

Design brief first (not a PR): trait shape derived from
`session_lifecycle.rs`'s 30 `agent_kind` branches; applied to the top 3
files only (`session_lifecycle.rs`, `user_input.rs`, `process.rs`);
explicitly stops there. Brief goes to Pablo for a ruling; implementation
PR follows the ruling. **One cargo build.**

## Ride-along cleanups (noted by PR 3's review, no PR of their own)

- `WorkspaceRuntime::list_repo_root_workspaces` (repo_metadata.rs:10) has
  zero callers repo-wide — pre-existing dead code; delete in whichever PR
  next touches that file (likely PR 8).
- `SessionService::store()` (sessions/service/mod.rs:150) still exists
  with ~30 callers across `domains/**` (mobility, reviews, plans, loops,
  goals, cowork). Legal today — the escape rule governs `api/**` only —
  but it is the accessor the doctrine dislikes; deleting it is the
  domain-side sequel to PR 3 once those callers get facade methods.
  Candidate for a PR 3b or fold into the 10.x cadence.
- (from PR 5a's review) The `INSERT INTO repo_roots` test fixture is
  6×-duplicated; 5a folded 3 copies into `repo_roots/test_support.rs`.
  Remaining inline copies: `workspaces/deletion_tests.rs:74`,
  `sessions/deletion_tests.rs:52`, `api/http/workspaces_purge.rs:505`
  (all checker-invisible test code; deletion_tests uses different
  timestamps so the helper needs a timestamp param to fold them).
  Fold in whichever PR next touches those files.
- (from PR 5a's review) Refactor lesson worth generalizing: when a split
  moves a guard out of the only write path (unbypassable → convention),
  the SAME PR must add a seam test proving the outer layer still rejects
  and the row is unwritten — existing tests won't catch the guard's
  deletion because they were written when it couldn't be bypassed.
  Coda from closing it: the negative control found an independent DB
  CHECK constraint (migration 0040) already guarding the column — the
  review's data-loss scenario was overstated (real exposure: raw SQLite
  constraint error instead of a clean 400). Lesson on the lesson: run
  the negative control before believing a reviewer's failure scenario;
  and check migrations for CHECK constraints when auditing guard moves.

## PR 13 — Crate splits + visibility ratchet (violation #7, capstone)

After valve rules hit zero: extract `observability`, `persistence`,
`adapters`, `integrations` as workspace crates (all at zero violations —
free), delete the checker rules the compiler now owns, then take store
mutation methods `pub(crate)`-scoped to the owning domain — making
foreign-store-reads-only compiler law. Sequenced last; each split is one
cargo build; **do not start before the train is quiet** (splits conflict
with everything).

---

## Execution protocol per PR

1. Recon (if needed) via read-only workflow agents — never building.
2. Implementation via sub-agent(s) in a dedicated worktree, briefed with:
   the plan section above, the structure-doc rules, machine limits
   (no concurrent cargo, no Docker, no subagents-of-subagents without
   explicit sonnet/haiku models).
3. I review the diff inline (Fable, judgment), run the checker + targeted
   tests (one build, serially).
4. Push, open PR with labels, flag "ready for agent review" with PR# +
   SHA, run the dedicated review agent.
5. Fix findings, re-push, hand to Pablo. Never merge.

## Session sequencing (what runs when)

- **Now**: recon workflow (running) → PR 1 build-out → PR 1 up.
- **Right after PR 1 merges**: PR 1.5 (lints/ folder) — path churn must land
  before the allowlist starts shrinking.
- **Then serially** (allowlist conflicts + one-build rule): PR 3 → PR 5 →
  PR 2 (acp last of the mechanical set — biggest rebase surface), each
  rebased onto the previous head. (PR 4 struck — already fixed by #640.)
- **Then**: PR 6a → 6b → 7, the structural core.
- **Then**: PR 8 → 9; PR 11 docs PR anytime; PR 10.x cadence begins.
- PR 12 brief and PR 13 wait for the train to be quiet + rulings.

## Merge choreography — EXECUTED 2026-08-05 (Pablo authorized: "ensure all clean then squash merge")

All four PRs squash-merged to main, in order. Each stacked PR needed a
post-squash main-sync (squash rewrites history, so branches carrying the
pre-squash base commits go CONFLICTING): plain merge of origin/main,
scripts resolved to main's copies, the branch's earned allowlist shrink +
anchor-test edits re-applied on top, gates re-run (checker exit 0, 90/90,
max-lines, negative control), plain push.

1. **#1651** checker — merged from 87147cce2 → squash **5fd51a614**.
2. **#1654** API store escapes — main-synced to e0ea31c51 → squash
   **734c61edb**.
3. **#1657** workspaces SQL folds — main-synced to 27d3e6412 (anchor
   repoint to completions.rs:128 re-applied) → squash **3aa6c9366**.
4. **#1658** mobility valve — main-synced to 5ff57f5a4 (DOMAIN_LIVE_VALVE
   shrink 12/21 → 11/20 re-applied; anchor test
   `test_a_live_holding_service_is_valved` → agents/auth/login_terminal.rs
   + two assertNotIn; app/mod.rs auto-merged and held its exact 693-line
   pin; mobility/service.rs pinned 851) → squash **c8cd66447**.
   Adversarial review CLEAN — the disclosed service.rs reconstruction
   audited 48/48 items accounted, all deltas forced-by-move; PathBuf
   equivalence proven. Nits parked: 9-arg MobilityRuntime::new should
   become a wiring-deps struct; vestigial Clone derive on MobilityService
   (pre-existing).

Post-merge allowlist state on main: DOMAIN_LIVE_VALVE 11 files/20;
API_STORE_ESCAPE 2 rows (health.rs benign, workspaces_purge.rs cfg-test);
POLICY_PURITY 1 row (workflows/control/policy.rs); DOMAIN_SQL_OUTSIDE_STORE
6 files/38.

## Wave 2 — open PRs (state 2026-08-05 evening, Pablo merges)

Both built off post-squash main; independent of each other (no allowlist-row
or file overlap); merge in either order, no retarget needed.

1. **#1665** `codex/anyharness-mobility-policy` @ dc70e43c4 — PR 6b,
   mobility resolve/decide/execute. New `runtime/mobility_policy.rs` (pure,
   POLICY_PURITY-policed) + 26 hand-built-fact tests; destroy_source and
   preflight restructured. All 26 CI checks green. Adversarial review
   CLEAN (2 nits, both PR-body wording — fixed in body): TWO benign
   ordering improvements (local-park default-branch rejection moved before
   effects; session-list resolution moved before terminal closes), preflight
   blocker order byte-identical and pinned by test, TOCTOU no-regression
   (handler holds exclusive lease + admission permits), policy-home single
   (is_supported_agent_kind one definition). No allowlist/pin/anchor
   changes. service.rs untouched at 851.
2. **#1668** `codex/anyharness-sql-fold-rest` @ d0cf13738 — PR 5b+5c.
   SQL folds: plans/service.rs → PlanStore `_in_tx` methods (byte-equal
   queries, same tx); decision_op + activity/feeds fixtures →
   SessionStore::insert (column-by-column equivalence proven vs migration
   defaults); sessions/links/completions.rs → store/link_completions.rs
   byte-identical with a load-bearing re-export shim (proven: deleting it
   breaks 5 callers). 5c: probe.rs fetch closed by passing
   `ProbeOptions.resolved: ResolvedAgent` in (shape, not power).
   catalog_probe.rs split 606→196+428 (never raise a pin).
   DOMAIN_SQL_OUTSIDE_STORE 6/38 → 2/2; LIVE_DOMAIN_STORE_IMPORT 7/19 →
   6/18; 3 anchor repoints, suite 90. All CI green (builder was
   compile-blind by machine constraint; review compiled + ran targeted
   tests). Review CLEAN, 2 P2s closed at **2a6d6b92d** (CI green,
   state CLEAN): all three ProbeOptions builders converged on
   `resolve_agent_unrouted_by_kind` (error string now single-homed;
   `find_descriptor_by_kind` split out so the not-in-registry arm is
   testable against a hand-built registry slice — the bundled registry
   always has all kinds), and the resolve's blocking FS scan +
   `node --version` subprocess moved onto the probe's dedicated thread
   (still ahead of materialize_for_probe, so a bad kind fails before
   scratch is touched). Ride-along find: pre-existing
   timezone-dependent sweep test → issue #1669 (touch -t fed a UTC
   stamp; fails west of UTC, green in CI).

After both merge: valve debt = the 7 stragglers (PR 7/7b) + materialization;
live/sessions returns to zero non-test fetches; SQL debt = 2 engine-invisible
cfg(test) rows.

3. **#1670** `codex/anyharness-workspaces-one-entry` @ e2b829fcd — PR 8,
   WorkspaceService deleted (80 lines, all call sites verified dead
   except mobility's `load_workspace`, repointed at the runtime).
   Design call adopted: mobility gains the background branch-refresh —
   review proved it safe THREE independent ways (mobility never reads
   DB current_branch; the refresh was already scheduled on these
   workspaces via assert_workspace_not_retired; the sqlite Mutex means
   refresh re-read and destroy delete can't interleave). Review CLEAN
   (2 P2s closed: body disclosure fixed; deleted-row SkippedMissing
   no-op guard now permanently pinned by
   `branch_refresh_skips_a_row_deleted_after_the_snapshot_was_taken`,
   landed as a test-only commit by the reviewer). Pins: app/mod.rs
   693→690, mobility/service.rs 851 unchanged. PR 9 stacks on this
   branch and needs the usual main-sync retarget after #1670
   squash-merges.
4. **#1671** `codex/anyharness-lifecycle-service` @ 82e8b7b0c — PR 9,
   retire state machine out of the handler (workspaces_lifecycle.rs
   644→89; handler now auth → parse → one call → map). STACKED on
   #1670's branch. Builder findings: handler copies A/B were
   byte-identical modulo a binding name → ONE policy fn evaluated
   twice (pre-lease early-out + under-lease re-read); copy C (retry
   admission) is a genuinely different predicate; five copies of
   decision logic total, not three. Structure: lifecycle SERVICE (not
   runtime method — construction-cycle constraint; matches the law
   doc's own table). New app/workspaces.rs wiring family kept
   app/mod.rs at exactly 690; NO pin raised anywhere.
   **NEEDS PABLO'S RULING**: two real pre-existing endpoint
   inconsistencies were preserved (not unified) with pinning tests:
   (a) retired+Complete → retire says AlreadyRetired/success but
   retry says Unavailable (defensible); (b) retired+cleanup_state=None
   → BOTH endpoints dead-end (retire: "cleanup is not complete";
   retry: refuses to resume) — a workspace stuck in this state has no
   API path out. (b) wants a product decision: which endpoint should
   accept it? Review verdict: CLEAN on behavior — reviewer rebuilt the
   full 24-case decision table externally, 0 mismatches; lease scope a
   strict subset of old; no auth-ordering leak (and none existed). Two
   proof-strength P2s closed at **237c33f1d** (CI green, CLEAN):
   LOCK-01 anchor half-2 was vacuous (signature-parameter token) — and
   the reviewer's suggested fix was ALSO insufficient under the
   reviewer's own control (hoisting the lease earlier doesn't violate
   "lease before fence"); the anchor now pins TWO body-resident links,
   each independently negative-controlled. The unobservable-race
   comment rewritten to the true reason (behavior-preservation
   fidelity); 24-case test reformulated with hand-written expectations
   from the pre-refactor predicate (real old==new check, not a
   tautology). session_admission_tests pin LOWERED 660→650 via anchor
   table collapse — no pin raised.

5. **#1672** `codex/anyharness-acp-into-integrations` @ e7335df68 — PR 2,
   `src/acp/` → `src/integrations/acp/`. 4 pure renames (100%
   similarity), 6 import occurrences repointed across 5 files, zero
   references left (`crate::acp` grep empty crate-wide incl. the binary
   crate). Checker re-expression: "acp" dropped from LIVE_RUNTIME_ROOTS
   + DOMAIN_STORE_FORBIDDEN_ROOTS (now {"live"}), new
   `is_acp_runtime_import()` OR'd into the four protecting rules with
   rule IDs stable. Review verdict: no P1 — EXACT parity proven over
   40 shape×layer probes (incl. bare-module import and the
   inline-reference question: inline paths never fired on main either,
   pre-existing limit of the use-line pass) + an undisclosed-but-
   positive coverage gain (moved files now under INTEGRATIONS_* rules,
   clean so counts hold). Old-paths fold: 11 subpath entries → dir ban;
   review P2-1 caught the fold missing the `src/acp.rs` file-module
   resurrection shape (both gates were blind to a resurrected
   crate::acp root — the two gates had been each other's backstop);
   closed by adding the dir+.rs pair entry, negative-controlled both
   ways. P2-2: body count corrected 9→11 (third body-count inaccuracy
   this program — reviewers keep earning their keep). Anchor suite
   stays exactly 90 (one fixture edited in place, proven load-bearing
   by arm-deletion control). No allowlist rows or pins changed. Based
   on main directly — no retarget needed. P3 parked: ~8 stale
   `src/acp/**` doc references (docs deferred program-wide; the specs
   README.md:303 already anticipated "earned integrations/acp/**").

6. **#1673** `codex/anyharness-materialization-valve` @ b2e5c5fc5 — PR 7,
   materialization runtime valve. New `runtime.rs` (290) + wiring
   `app/materialization.rs` (52); service.rs 625→419 (max-lines row
   DELETED — under the 600 cap); DOMAIN_LIVE_VALVE row removed, stanza
   11/20 → 10/19 (measured). Review verdict: no P1 — behavior
   preservation mechanically proven (byte-identical move modulo the
   two intentional call rewires; sessions-before-terminals decision
   order intact; no caller bypasses the admission check — the service
   no longer has the method, so bypass is impossible by construction).
   Shared-state design call verified as PARITY, not new coupling (main
   had one store + one locks map; branch has one of each, shared by
   Clone in app/materialization.rs). New real-PTY test
   `explicit_busy_destination_with_active_terminal_returns_workspace_busy`
   pins the terminal-busy branch (previously untested);
   reviewer's independent structural-deletion control fired. P2
   disposition: the app/mod.rs pin moved 693→694 — reviewer claimed a
   struct rename lands 693, but the builder FALSIFIED that empirically
   three ways (rustfmt wraps the whole 114-char statement, not the
   head; only sub-4-char names collapse it; the unqualified-import
   alternative nets 694 anyway). Ruled: accept 694 as a documented
   exception (allowlist reason text + body carry the full mechanism
   and falsified alternatives). P3 accepted as-is: pub widening on
   MaterializationOperationLocks is warning-driven (private_interfaces
   on the two pub `new()` signatures), disclosed in body.
   **Merge-choreography note: collides with #1670/#1671 on app/mod.rs
   + the max_lines pin row (694 here vs 690 there off different
   bases) — whichever merges second re-measures and re-pins.**
   Flake signature worth remembering: under machine starvation the PTY
   test can panic inside `lock_env()`, poisoning the process-global
   ENV_MUTEX and cascading failures across 7 unrelated test files —
   a whole-suite materialization cascade in CI = starvation, not code.

Notes for the merged future: PR 6a's spec deviation is ruled-in-diff —
the service's `Arc<SessionRuntime>` (held only for `runtime_home()`) was
facade-laundered live power; replaced with a plain `runtime_home: PathBuf`
wired from `app/`. Export endpoint reaches the service via runtime
delegation (kept app/mod.rs at its exact 693-line pin). Known main-level
drift, NOT ours to fix in this train: Cargo.lock pins proliferate 0.3.50
while VERSION says 0.4.2 — any grid PR that runs cargo will see the lock
resync; revert it out of the diff (6a did) and let the release train own
the bump.
