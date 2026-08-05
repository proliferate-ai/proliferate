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
PR1 (checker) ──┬── PR2 (acp move)      [independent of 3–5, conflicts on allowlist]
                ├── PR3 (store escapes)
                ├── PR4 (ProblemResponse)
                ├── PR5 (stray SQL)
                ├── PR6a (mobility move) ── PR6b (mobility policy)
                ├── PR7 (materialization)   [after 6a proves the recipe]
                ├── PR8 (workspaces entry)  ── PR9 (lifecycle handler)
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
| `DOMAIN_LIVE_VALVE` | `crate::live` (import or inline path) in `domains/**` legal only in `runtime.rs`, `runtime/**`, `live_ports.rs` | import walk + line pattern |
| `LIVE_DOMAIN_STORE_IMPORT` | `live/**` importing any `crate::domains::*::store` or `::service` path | import walk |
| `API_STORE_ESCAPE` | under `api/**`: `.store()` call or `[A-Za-z]+Store::new` or importing `crate::domains::*::store` | line pattern + import walk |
| `POLICY_PURITY` | in `*_policy.rs` under `domains/**`: `Utc::now`, `Local::now`, `SystemTime::now`, `Instant::now`, `Uuid::new_v4`, `&self`/`&mut self` in fn sigs, store/live/adapters imports | line pattern per policy file |
| `DOMAIN_STORE_API_IMPORT` / `DOMAIN_STORE_LIVE_IMPORT` | generalize the sessions-store rule to every `domains/*/store{.rs,/}` | import walk, path predicate generalized |
| `DOMAIN_CONTRACT_IMPORT` | any `anyharness_contract` use-line in `domains/**` (broader than the existing `*Request/*Response` rule, which stays) | import walk |

Allowlist seeds come from the recon workflow measurements (exact per-file
counts): mobility + materialization under `DOMAIN_LIVE_VALVE`; the api
`.store()`/`Store::new` sites under `API_STORE_ESCAPE`; per-file
`DOMAIN_CONTRACT_IMPORT` counts (~81 lines); any stray-SQL-adjacent store
findings under the generalized store rules. Every seed line carries a
reason string that names the target PR in this plan.

Tests (`test_check_anyharness_boundaries.py`, unittest, no repo access —
fabricate files in tempdirs the way `test_check_frontend_boundaries.py`
does): one positive + one negative case per new rule, plus allowlist
ratchet behavior (over-count fails, stale-count fails).

**Gates**: `python3 scripts/check_anyharness_boundaries.py` exits 0 on the
seeded tree; unittest suite green; negative control — temporarily delete
one seed line, checker must fail, restore.

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

## PR 4 — Fold ProblemResponse into ApiError (violation #12)

**Branch**: `codex/anyharness-one-error-doctrine` off PR 1 head.
**Touches**: `api/http/agents_model_registry.rs` (+ its `_errors`/mapper
siblings). Replace the bespoke ProblemResponse mechanism with the standard
one-`From<DomainError> for ApiError` impl per the `sessions_errors.rs`
exemplar. Wire shape of responses must not change (same status codes +
bodies) — this is an internal doctrine fold, verified by the existing
endpoint tests; if body shape is load-bearing and differs from ApiError's
rendering, stop and surface instead of silently changing the wire.
**One cargo build.**

---

## PR 5 — Stray workspaces SQL into `store/` (violation #8)

**Branch**: `codex/anyharness-workspaces-sql-fold` off PR 1 head.
**Touches**: the 2 SQL-bearing files in `domains/workspaces` outside
`store/` (exact list from recon). Move query text + row structs into the
store module; callers keep their signatures; no query changes. Allowlist
−(their seeds) under the generalized store rules.
**One cargo build.**

---

## PR 6a — Mobility valve, move only (violation #1, part 1)

**Branch**: `codex/anyharness-mobility-valve` off PR 1 head.
**The template PR for valve promotions.** Split
`domains/mobility/service.rs` (~1.5k lines):

- `service.rs` keeps durable-only use cases (own store, foreign reads,
  adapters).
- new `runtime/` gets: the `TerminalService` field, every use case that
  touches live or a second domain's facade, cross-domain reach. Runtime
  wraps the service (`Arc<MobilityService>` field) per the entry rules.
- `app/` wiring updated: construct service, then runtime, in dependency
  order; `AppState` exposes the runtime as the facade.
- api handlers re-point to the runtime for promoted use cases; entry
  stays per-use-case (durable-only endpoints keep calling the service).

Bodies unchanged — pure relocation; `git diff --color-moved` should show
mostly moved blocks. Delete the mobility `DOMAIN_LIVE_VALVE` allowlist
entry. **One cargo build.**

## PR 6b — Mobility resolve/decide/execute (violation #1, part 2)

**Branch**: `codex/anyharness-mobility-policy` off PR 6a head.
Restructure `destroy_source_workspace` + `preflight_workspace`: gather all
facts first (resolve), extract decisions into `runtime/mobility_policy.rs`
(pure: no store, no clock, no uuid, no `&self`), then execute effects.
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
one PR (the domain is much smaller). Deletes the last
`DOMAIN_LIVE_VALVE` allowlist entry — **valve rule reaches zero; flip the
Dependency Direction row from LEAKS to HOLDS AT ZERO in
`anyharness-structure.md` in this PR.** **One cargo build.**

---

## PR 8 — Workspaces: one entry surface (violation #6)

**Branch**: `codex/anyharness-workspaces-one-entry` off PR 1 head.
Diff the duplicated `WorkspaceService`/`WorkspaceRuntime` bodies use case
by use case; for each: pick the survivor **deliberately** (the diverged
lines are the whole point — each divergence is either a bug in one copy or
an intentional difference that must be named in the PR body), keep one
body at the correct layer, delegate from the other or delete it. The diff
review is the work; the code change is small. **One cargo build.**

## PR 9 — workspaces_lifecycle out of the handler (violation #5)

**Branch**: `codex/anyharness-lifecycle-service` off PR 8 head.
Move the retire state machine (3 copies in
`api/http/workspaces_lifecycle.rs`) into the now-single workspaces
surface as one use case with one state-transition policy fn. Handler
becomes auth → parse → one call → map. Dedupe the 3 copies against each
other the same way PR 8 deduped layers. **One cargo build.**

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
- **Then serially** (allowlist conflicts + one-build rule): PR 3 → PR 4 →
  PR 5 → PR 2 (acp last of the mechanical set — biggest rebase surface),
  each rebased onto the previous head.
- **Then**: PR 6a → 6b → 7, the structural core.
- **Then**: PR 8 → 9; PR 11 docs PR anytime; PR 10.x cadence begins.
- PR 12 brief and PR 13 wait for the train to be quiet + rulings.
