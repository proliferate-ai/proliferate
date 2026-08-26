# Testing and Linting

Status: describes `main` for the tiers, the checkers, and the ratchets; the
issue→test loop and the proof-coverage gate are target (※). Grade B — see
[Known gaps](#known-gaps).

Read before touching: [`specs/engineering/testing/standard.md`](standard.md) (the per-PR
standard — this spec does not restate it), [`lints/README.md`](../../../lints/README.md)
(rules as data), `scripts/check_*.py`, `server/scripts/check_mypy_baseline.py`,
`tests/intent/**`, `tests/release/**`, `fixtures/contracts/**`.

## 1. Purpose

Testing and linting is the cross-cutting system that decides **what a change
must prove before it merges or ships, and proves it mechanically**. It owns no
product state. It consumes every product and runtime spec's Proof section
(the tests that pin that system's laws) and turns them into gates: the four
tiers of [`TESTING.md`](standard.md), the rule records under
`lints/`, the ratchets, and the checkers that read them.

Two outcomes it exists for:

- **Legibility of proof.** For any law in any spec, one can name the test that
  pins it; for any production failure, one can name the test that now
  prevents it. Both directions are links a machine can follow.
- **The issue→test loop in one step.** A bug seen in a session replay, a
  Sentry issue, or a Honeycomb query becomes a pinning test through one
  convention — where it goes, what it is called, what it links to — so the
  demo agent that triages production can close the loop without a human
  deciding structure each time.

Everything else (tiers, worlds, evidence) already exists and is better than
its reputation; this spec names it, fences it, and adds the two missing
links.

## 2. Owned state

All of it is data in the repository; nothing lives in a database.

```text
specs/engineering/testing/standard.md · specs/engineering/testing/**            the tier contract and its depth
specs/engineering/testing/core-release-scenario-manifest.json
                                               machine-owned Tier 3/4 guarantee inventory
lints/<owner>/*.toml                           rule records ([[rule]]), edge baselines ([[edge]])
lints/<owner>/exceptions.toml                  grandfathered sites, one (path, site) per row
lints/<owner>/ratchets.toml                    measured shrink-only debt (max_lines)
server/scripts/mypy_baseline.json              the strict-mypy diagnostic census
fixtures/contracts/**                          cross-language golden shapes (49 fixtures)
tests/intent/**                                Tier 2 stack, fakes, specs (24)
tests/release/**                               Tier 3/4 runner, worlds, scenarios (40), evidence schema
apps/packages/product-client/qualification/**  browser-engine suites (scroll-physics, workflow-canvas)
scripts/check_*.py (22) · scripts/lint_records.py
                                               the enforcement engines
※ the proof trailer in test files                the issue→test link (section 5, law 6)
```

Written only through ordinary PRs; the ledgers and baselines have one
reader each (`lints/README.md` names it per record), and the constitution
(founder review on net-new exceptions, on ratchet growth, on removing a
pinning test) governs the writes.

## 3. Public surface

| Surface | What it is | Consumer |
| --- | --- | --- |
| The tier contract | [`TESTING.md`](standard.md): which state is real per tier, the gate rule, "deciding where a change's tests go" | every PR author, every spec's Proof section |
| The gate commands | the deterministic list in TESTING.md's launch-option gate; per plane: `cargo test --workspace`, `cd server && uv run pytest -q`, `pnpm --filter <pkg> test`, `python3 scripts/check_*.py` | CI lanes (owned by the building loop), local pre-push |
| Rule ids | `AH-*`, `SRV-*`, `FE-*`, `PROD-*` — citable forever, diagnostics generated from the record | PR descriptions, exception rows, prose docs (cite, never restate) |
| Ratchet API | `--write-baseline` on `check_mypy_baseline.py`; `max_lines` rows in `ratchets.toml` read only by `check_max_lines.py` | the PR that shrinks debt (same PR updates the baseline) |
| Edge-baseline API | `[[edge]]` rows in `fences.toml`; `--warn` = introduction mode, dropped to enforce | checkers `check_anyharness_fences.py`, `check_frontend_fences.py`, `check_manifests.py` |
| The Proof-section contract | every system spec's `## 9. Proof` names real test paths (relative links, resolved by `check_docs.py`) | this system's coverage audit (section 4) |
| ※ The proof trailer | a two-line trailer in a test's docstring/comment: `Spec:` and `Surfaced-by:` (section 5, law 6) | the triage agent, `check_proof_trailers.py`, spec Proof sections |
| Contract fixtures | `fixtures/contracts/<name>/*.json` — producer asserts it produces, consumers assert they parse | Rust, Python, TypeScript Tier 1 suites |
| Evidence | Tier 3/4 evidence JSON per scenario cell; ※ Tier E evidence per suite | delivery (release gate), runs/triage (target) |

## 4. Consumes

- **Every product and runtime spec's Proof section** — the input this system
  gates on. Audit of the 30 specs under `specs/systems/{product,runtime}/`
  on 2026-08-25 (paths resolved from the spec's own links):

  | Proof section | Systems |
  | --- | --- |
  | Names real tests, all resolve | accounts, agent_auth, billing, chat, environments, github, integration_gateway, model_gateway, organizations, runs-triage, seam, sessions; runtime: desktop-host, harnesses, subagents, terminals, workspaces |
  | Names tests via glob/brace patterns that `check_docs` cannot resolve (fine for a reader, invisible to a machine) | agent_auth (`route_auth/{…}_tests.rs`), automations (`domains/workflows/*_tests.rs`), onboarding and settings (`test_auth_flow*`), workspaces (`test:file-viewer` script name) |
  | Names tests that do not exist at the stated path | billing (`BillingSettingsSurface.test.tsx`, `SidebarConsumptionCard.test.tsx`) |
  | Prose only — zero test paths | api, runs, slack, support; runtime: artifacts |
  | No Proof section (pre-anatomy docs) | agents (folder index), auth, clients, workflows |

  A spec with an empty Proof section has unpinned laws; it is the testing
  system's job to make that visible, and the owning system's job to fill it.
- **Every spec's Emits section** — the event names a `Surfaced-by:` trailer
  may cite. A system whose Emits is empty cannot be surfaced by production
  telemetry; the observability spec lists those gaps.
- **Observability** ([../observability/README.md](../observability/README.md))
  — Sentry issue ids, the session id, and Honeycomb query names are the
  identifiers the trailer links to.
- **Building loop** — the CI lanes that run the gates (`ci.yml`,
  `server-ci.yml`, `ci-heavy-lanes.yml`) and the merge-train protocol.
- **Delivery** ([../delivery/README.md](../shipping/release-delivery.md)) — the release
  train that consumes Tier 3/4 evidence and (※) Tier E evidence.

## 5. Laws

1. **The gate rule.** Merge gate = Tiers 1–2 only. No real LLM, no real
   sandbox at merge; Stripe test mode is the one network exception. Tier 3/4
   block releases; ※ Tier E (evals) blocks definition releases and pin bumps,
   never merges. (Enforced by construction: the merge lanes have no provider
   credentials; `ci-ok`'s drift guard fails when a job is added without a
   `needs:` entry.)
2. **Never delete or weaken a test to make CI green.** Removing a pinning
   test is founder review. Tests die only in the same PR as their surface,
   listed in that PR's grep-gates (deletion completeness).
3. **Baselines equal reality exactly.** Edge baselines, exception ledgers,
   and ratchets may only shrink; a stale row fails the same as a new
   violation. Violations are named sites, never counts.
4. **Rules are data.** A mechanical rule exists as a `[[rule]]` record with
   an `enforced_by` checker that exists; prose cites the id. A ratchet table
   with no reading checker enforces nothing (`lints/README.md`).
5. **The postmortem rule.** Any bug caught at Tier 3/4 or in production gets
   an answer to "which lower tier should have owned this," and that test
   lands with the fix.
6. **※ The issue→test loop is one step.** A regression test born from
   production carries a trailer, in the test's docstring (Python), doc
   comment (Rust), or leading block comment (TypeScript):

   ```text
   Spec: specs/systems/sessions/README.md#5-laws
   Surfaced-by: sentry:PROLIFERATE-SERVER-1K3 · session:ses_01J…
   ```

   - **Where:** the tier "deciding where a change's tests go" gives (TESTING.md
     steps 1–6), inside the owning system's test tree — never a central
     `regressions/` folder (bugs are filed against the owning spec, not the
     discovering surface).
   - **Name:** `test_<law-in-words>_<surfaced-id>` — e.g.
     `test_history_replay_stops_at_first_seq_hole_pro352`; Rust
     `fn <law>_<id>()`; TypeScript `it("<law> (<id>)")`. The id is the
     tracker/Sentry/session token, lowercased, non-alphanumerics dropped.
   - **Links:** `Spec:` is a repo-relative path plus the heading anchor of
     the law it pins; `Surfaced-by:` is one or more of
     `sentry:<issue-short-id>`, `session:<session-id>`,
     `honeycomb:<query-name>`, `PRO-<n>`, `pr:<number>`.
   - **Checked:** ※ `scripts/check_proof_trailers.py` (rule `PROD-PROOF-001`)
     validates every trailer it finds: the spec path exists, the anchor
     exists (same resolver as `check_docs.py`), the `Surfaced-by:` tokens
     match the grammar. Files without a trailer are not violations; the rule
     is opt-in per test and becomes a ratchet ("count of trailered tests may
     only grow") once the demo agent produces them.
   - **Closes the loop:** the owning spec's Proof section gains the test in
     the same PR (`check_docs` resolves the link), so a reader of the spec
     sees the incident that pinned the law.
7. **Real-LLM tests assert outcomes, not transcripts.**
8. **No wall-clock day boundaries in assertions.** A test asserts by the
   event's own timestamp, never by "today" — the 00:00–00:05 UTC flake of
   `test_usage_timeseries_kind_filter_excludes_other_meter` (fixed #2224) is
   the incident. ※ lint candidate `SRV-TEST-001`.
9. **Migrations ship a reversible downgrade or pin their own revision.** An
   irreversible `NotImplementedError` downgrade breaks the head-to-history
   downgrade test for everyone after it; the two sanctioned shapes are a
   structure-recreating downgrade or a test pinned to its own revision.
   Revision ids are verified unique across all in-flight branches before
   merge (two forks minted `d7e8f9a0b1c2` on the same day).
10. **Local parallelism is bounded; CI is authoritative.** Local Postgres at
    default `max_locks_per_transaction` exhausts under `pytest -n 4` and reds
    unrelated suites; run `-n 2` or sequential locally, and treat a mass
    local red as environmental until CI agrees.
11. **A review gate needs a completed independent refuter.** Adversarial
    review counts only when at least one fresh-context refuter ran to
    completion; an inline pass is a fallback, not a pass (session-limit kills
    on 2026-08-25 produced "reviews" that never finished).

## 6. Emits

- `ci-ok` / `server-ci-ok` rollups (one per workflow; a job outside the
  `needs:` list fails the drift guard) — consumed by branch protection.
- Rule diagnostics generated from the record (`<ID>: <rule> — <alternative>`)
  — consumed by PR authors and the triage agent.
- Ratchet deltas (`max_lines`, mypy census) in the PR diff — consumed by the
  founder-review rule.
- Tier 3/4 evidence JSON per scenario cell (`tests/release/`) — consumed by
  delivery.
- ※ The proof-coverage report: per system, laws with/without a pinning test,
  trailered tests, unresolvable Proof links — consumed by the spec pass and
  the observability gap list.
- ※ Tier E evidence per suite `{score, recall, precision, cost}` — consumed by
  definition releases and the public benchmark projection.

## 7. Fences

- **Building loop** owns `.github/workflows/**`, change detection, the merge
  train, branch protection, and lane budgets. This spec states what a lane
  must run and what gates; it never edits a workflow.
- **Delivery** ([../delivery/README.md](../shipping/release-delivery.md)) owns the
  release train, candidate promotion, and the template/catalog lanes; Tier
  3/4 are its inputs, not its property.
- **Observability** ([../observability/README.md](../observability/README.md))
  owns event names, Sentry configuration, and the session-id correlation
  key; this spec only links to them.
- **Product and runtime systems** own their tests: a system's behavior tests
  live with the system and are named in its Proof section (Organization
  Standard amendment). This spec audits; it never relocates.
- **Native tools** (Clippy, tsc, Ruff, rustfmt, mypy config) are outside the
  rule records today — `lints/native-tools.md` is the ledger.
- **Support** (`specs/systems/support/`) owns the capture of
  a user-reported bug; this spec owns what happens once it becomes a test.

## 8. Code map

```text
specs/
├── TESTING.md                                   the standard (unchanged by this spec)
└── TESTING/                                     depth: worlds, contracts, manifest, manual QA
lints/
├── README.md · native-tools.md
├── anyharness/  server/  frontend/  product/    rule records, exceptions, ratchets, edge baselines
scripts/
├── lint_records.py                              record loader (id uniqueness, enforced_by exists)
├── check_docs.py                                link + anchor resolver (Proof links ride on it)
├── check_manifests.py · check_anyharness_fences.py · check_frontend_fences.py
│                                                edge-baseline checkers (warn → enforce, PR below)
├── check_max_lines.py                           the only reader of ratchets.toml
├── check_*_boundaries.py · check_*_structure.py · check_migration_heads.py · …
└── ※ check_proof_trailers.py                     PROD-PROOF-001
server/scripts/
├── check_mypy_baseline.py · mypy_baseline.json  strict-mypy census, --compare-ref origin/main
fixtures/contracts/                              49 golden shapes
tests/intent/                                    Tier 2 (stack/, fakes/, specs/)
tests/release/                                   Tier 3/4 runner, scenarios, evidence
apps/packages/product-client/qualification/      scroll-physics, workflow-canvas
anyharness/tests/                                runtime standalone suite (13 files; CI home: agent-runtime-compat.yml, dispatch)
```

## 9. Proof

- [scripts/test_check_manifests.py](../../../scripts/test_check_manifests.py),
  [scripts/test_check_anyharness_fences.py](../../../scripts/test_check_anyharness_fences.py),
  [scripts/test_check_frontend_fences.py](../../../scripts/test_check_frontend_fences.py)
  — baseline-equals-reality in both directions.
- [server/tests/unit/test_mypy_baseline_checker.py](../../../server/tests/unit/test_mypy_baseline_checker.py)
  — census identity, shrink-only, stale-baseline failure.
- [scripts/test_check_docs.py](../../../scripts/test_check_docs.py) —
  link and anchor resolution the Proof-section contract depends on.
- [scripts/ci-cd/core-release-scenario-manifest.test.mjs](../../../scripts/ci-cd/core-release-scenario-manifest.test.mjs)
  — manifest ↔ contract parity.
- `scripts/ci-cd/*.test.mjs` (`ci-cd-config` job) — rollup drift guard and
  workflow census.
- ※ `scripts/test_check_proof_trailers.py` — trailer grammar, anchor
  resolution, opt-in semantics.

## Minimum tonight

Small, cull-grade PRs that make the system legible for tomorrow's triage.
Each is independently revertible.

1. **Flip the three fence checkers from warn to enforce.** All three already
   pass in enforce mode on `main` (verified 2026-08-25: manifests,
   anyharness fences, frontend fences each report "matches reality
   exactly"). Change: drop `--warn` from three `ci.yml` steps; update the
   three record-file headers that say "introduced in warn mode." Proof: the
   repo-shape job green; the three checker unit suites unchanged.
2. **The proof trailer + its checker.** `scripts/check_proof_trailers.py`
   with `PROD-PROOF-001` in `lints/product/proof.toml`, unit tests, a
   repo-shape step. Opt-in (no baseline to build), so it lands green and is
   ready the moment the triage agent writes its first trailered test.
3. **Proof-section fixes in the owning specs** (one docs PR): the two
   billing paths that do not resolve; convert the four glob patterns to
   explicit links. Prose-only Proof sections (api, runs, slack, support,
   artifacts) get a `> [!warning] unpinned` callout naming the laws without
   tests — visible debt, not silent.

Deliberately **not** tonight: change detection, re-gating the demoted lanes,
`nightly-checks.yml`, Tier E machinery, the mypy identity change. Those are
the building-loop spec's and this spec's Target.

## Target

- **Proof-coverage gate.** `check_docs.py` (or a sibling) fails a system spec
  whose `## 9. Proof` has zero resolvable test links, with an
  exception-ledger row per grandfathered spec that shrinks to zero.
- **Trailer ratchet.** Count of trailered regression tests may only grow;
  the triage agent's output is measured by it.
- **Tier E (evals)** as specified in the raw draft: `tests/evals/` runner as
  a client of the public `/v1` API, outcome-matching scorers, checked-in
  baselines, gating definition releases and catalog pin bumps — never
  merges. Lands after the `/v1` run verbs.
- **Runtime standalone suite gets a home.** `anyharness/tests` (13 files)
  runs nowhere automatically; it belongs in the nightly lane the building
  loop spec designs.
- **Tier 2 returns to a cadence** (nightly or per-seam-PR) once change
  detection exists; until then it is dispatch-only by the 2026-08 cull.
- **Native tools into records**: Clippy/Ruff/tsc/mypy configs get rule ids
  per `lints/native-tools.md`.

## Decisions

> [!decision] PABLO DECIDES: mypy baseline identity across file moves.
> `DiagnosticIdentity` is `(path, code, message)`, so a pure move reports the
> moved diagnostics as growth (failure mode 7; precedents #1656, #2222 were
> admin-merged with a proven census). Options: (a) keep path identity and
> ritualize the admin-merge with an exact census in the PR body; (b) add a
> `--moved old=new` rename map argument the PR supplies; (c) identity on
> `(module basename, code, message)` — looser, tolerates moves, tolerates
> duplicates less well. Recommendation: (b) — explicit, auditable, no loss of
> strictness; the sweep waves (moves without behavior change) will hit this
> weekly.

> [!decision] PABLO DECIDES: the trailer becomes a ratchet when?
> Recommendation: the day the triage agent lands its first trailered test —
> ratchet from 1, never from 0.

> [!decision] PABLO DECIDES: `self-hosting.spec.ts` and the self-host battery.
> Parked (tagged out of gating, kept) vs culled. Recommendation: parked —
> self-host is deprioritized, not ruled dead; the smoke stays on `push:main`.

> [!decision] PABLO DECIDES: Tier E gates only releases, never merges —
> confirm (forced by law 1 as written; changing it is a seam change with the
> building loop).

## Known gaps

- [ ] The proof trailer and `check_proof_trailers.py` do not exist (PR 2
      above).
- [ ] Fence checkers run in warn mode in CI though their baselines are exact
      (PR 1 above).
- [ ] Five specs have prose-only Proof sections; four legacy docs have none
      (section 4 table).
- [ ] `anyharness/tests` has no automatic CI route.
- [ ] No Tier 2 lane runs on any cadence since the cull.
- [ ] Law 8 has no lint; law 9's cross-branch revision-id check is manual.
- [ ] `server/tests/e2e` (20 files) reaches CI only via hand dispatch of
      `make test-cloud-e2b`.
