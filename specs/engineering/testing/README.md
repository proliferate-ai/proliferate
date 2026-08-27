# Testing and Linting

```toml
# machine identity — engineering specs carry no allowed_importers (nothing imports a norm)
name = "testing"
owns = "every testing and linting norm: the two blocks, what gates what, the lint constitution"
```

Status: current for the two blocks, the laws, and the lint constitution; the
proof trailer and proof-coverage gate are target (※). Grade: A — every
decision herein was ruled by Pablo 2026-08-26 (see [Decisions](#decisions));
wording pends his read-through.

**Doc map** — the whole folder, in reading order:

| File | Expands | What's in it |
| --- | --- | --- |
| this README | — | the two blocks, the laws, where a change's tests go |
| [lints.md](lints.md) | [Purpose](#1--purpose) | the read-half constitution: families, the closed grid, the bar |
| [release.md](release.md) | [The worlds](#4--the-worlds) | the worlds datasheet: what's real in each, evidence |

Everything else this folder used to hold moved 2026-08-26: the per-PR
standard was absorbed here (`standard.md` deleted); the four release
contracts and the desktop-update and self-hosting notes are archived under
[delivery/testing-cicd/archive/](../../../delivery/testing-cicd/archive/);
manual release QA is a runbook at
[guides/deploying/manual-release-qa.md](../../../guides/deploying/manual-release-qa.md);
`flows.md` and `scenarios.md` (legacy, self-declared non-canonical) are gone.

## 1 · Purpose

Testing and linting decides **what a change must prove before it merges or
ships, and proves it mechanically**. One split organizes the whole system:

- **Lints prove a law by *reading* the code** — total (every site, including
  future ones), instant, cannot flake. The read half is [lints.md](lints.md).
- **Tests prove a promise by *running* it** — sampled, costly, the only way
  to see what execution alone reveals. The run half is this document.

If a law is statically visible in the text of the code, it is a lint, never
a test. Run code only for what can only be seen by running.

This spec owns every **norm**, including *when each kind of proof applies* —
a block's definition includes what it gates; that is one indivisible
statement. The litmus for whether a sentence belongs here or in
[ci-cd](../ci-cd/README.md): *if CI vanished tomorrow, is it still true?*
Yes → here. No → ci-cd (lanes, cadences, deploys — the machine). Event
names and correlation ids are
[observability's](../observability/README.md).

## 2 · The two blocks

The four-tier ladder is dead (ruled 2026-08-26). Two blocks, one question
each:

| Block | Question | Contents | Gates |
| --- | --- | --- | --- |
| **the merge block** | may this merge? | all lint engines + bought tools + unit + integration + contract fixtures — hermetic to the internet | **merges** |
| **the worlds block** | may this ship? | full e2e scenarios in named worlds — everything real | **releases** |

**Evals** stay separate: agent outcomes scored against checked-in baselines;
they gate definition releases and catalog pin bumps, never merges (future
`tests/evals/`).

The mocked-intent middle tier was **deleted** 2026-08-26 (the 24 Playwright
specs, the fakes layer, its lane): too slow to gate merges, too fake to
qualify releases, and already dispatch-only behind `continue-on-error` —
a gate that gated nothing. UI-flow regression coverage rides the real worlds
at release; the accepted trade is on record. Legacy `T3-*`/`T4-*` scenario
ids survive as historical names in the registry; the *concepts* they came
from retire — "world" carries the meaning.

## 3 · Inside the merge block

Hermetic to the internet: local Postgres/Redis containers are fine
(deterministic, fast); no LLM, no sandbox, no third party. Stripe test mode
is the one explicit real-network exception, required and fail-closed in
trusted CI.

| Kind | Proves | Touches | Speed |
| --- | --- | --- | --- |
| **unit** | one system's logic in isolation | own code + at most own tables | ms–s, serial |
| **integration** | a seam: systems through real wiring (route → service → db → task) | real local Postgres/Redis, real transactions | s–min, sharded |
| **contracts** | both sides of a wire parse the same golden shape | `fixtures/contracts/` (→ `tests/contracts/`, reshape pending), asserted from Rust, Python, and TypeScript suites; a shape change is made by changing the fixture, which mechanically breaks the unmoved side | ms |

Where each plane's merge-block tests live and run:

| Plane | Location | Invocation |
| --- | --- | --- |
| Rust | colocated `*_tests.rs` / `tests.rs` next to the module | `cargo test --workspace` (CI: nextest) |
| Python | `server/tests/unit/` · `server/tests/integration/` | `cd server && uv run pytest -q` |
| TypeScript | colocated `*.test.ts(x)` per package | `pnpm --filter <pkg> test` |

**The author's rule** — where does my test go: one system's law → unit,
next to that system · a seam → integration · a wire format → a contract
fixture · "does the product actually work" → a **world**, never the merge
block. Tests live with their owning systems and are named in that system's
spec `## Proof` section — there is no central catalog; this spec audits,
it never relocates.

Honest caveat (ruled): ~115 server "unit" tests need live services, so
operationally the unit/integration split is serial-vs-sharded, a **speed
split, not a purity claim**. No re-sort, no marker system. The
going-forward rule self-corrects it: needs-no-services → unit;
crosses-a-seam-or-needs-services → integration.

## 4 · The worlds

A world is a **setup contract**: it declares what is real inside it, what
credentials it needs, how it is provisioned and torn down. Worlds are few
and named — staging (the standing e2e world for everything that deploys),
local-real, packaged-upgrade, self-host — and adding one is a change to
[release.md](release.md), the worlds datasheet. Scenario cells and their
evidence live with the runner (`tests/release/`); the datasheet points,
never enumerates.

## 5 · Laws

1. **The gate rule.** The merge block gates merges; the worlds block gates
   releases; nothing else gates anything. Enforced by construction: the
   merge lanes carry no provider credentials.
2. **Never delete or weaken a test to make CI green.** Removing a pinning
   test is founder review; tests die only in the same PR as their surface,
   listed in that PR's deletion grep-gates.
3. **Baselines equal reality exactly.** Exception ledgers, edge baselines,
   and ratchets only shrink; a stale row fails the same as a new violation.
   Violations are named sites, never counts.
4. **Rules are data.** Every mechanical rule is a record with a live engine
   ([lints.md](lints.md)); prose cites ids and never restates them.
5. **The postmortem rule.** Any bug caught in a world or in production gets
   an answer to "should the merge block have owned this," and that test
   lands with the fix.
6. **※ The issue→test loop is one step.** A regression test born from
   production carries a two-line trailer in its docstring/doc-comment:

   ```text
   Spec: specs/systems/sessions/README.md#5--laws
   Surfaced-by: sentry:PROLIFERATE-SERVER-1K3 · session:ses_01J…
   ```

   Name: `test_<law-in-words>_<surfaced-id>`. The test goes where the
   author's rule puts it — never a central `regressions/` folder. Checked
   by ※ `check_proof_trailers.py` (`PROD-PROOF-001`): spec path and anchor
   resolve, `Surfaced-by:` tokens match the grammar
   (`sentry:<id>` · `session:<id>` · `honeycomb:<query>` · `PRO-<n>` ·
   `pr:<n>`). Opt-in per test; becomes a grow-only ratchet at the first
   trailered test. The owning spec's Proof section gains the test in the
   same PR.
7. **Real-LLM tests assert outcomes, not transcripts.** "Run reached
   `completed`, artifact exists, meter ticked" — never "the agent said X."
8. **No wall-clock day boundaries in assertions.** Assert by the event's
   own timestamp, never "today" (the 00:00–00:05 UTC flake class, fixed
   #2224; ※ lint candidate `SRV-TEST-001`).
9. **Migrations ship a reversible downgrade or pin their own revision.**
   The two sanctioned shapes: a structure-recreating downgrade, or the
   downgrade test pinned to its own revision. Revision ids are minted, and
   verified unique across in-flight branches before merge (two forks minted
   `d7e8f9a0b1c2` on the same day).
10. **Local parallelism is bounded; CI is authoritative.** Local Postgres
    at defaults exhausts locks under `pytest -n 4`; run `-n 2` or serial
    locally and treat a mass local red as environmental until CI agrees.
11. **A review gate needs a completed independent refuter.** Adversarial
    review counts only when at least one fresh-context refuter ran to
    completion; an inline pass is a fallback, not a pass.

## 6 · Writing tests — the short version

The structure decides for you (author's rule, §3). Beyond it: fake nothing
above the internet line and everything below it; seed through the product's
own API where one exists; name tests after the law they pin; carry a
trailer when production surfaced the bug. One hard rule binds agents and
humans alike: **never `--no-verify`**
([BUILDING.md](../../BUILDING.md)).

## 7 · Consumes / Emits

Consumes every product and runtime spec's **Proof** section — the input it
gates on; the ※ proof-coverage checker (not a prose table) reports which
specs have unpinned laws. Emits: rule diagnostics (rendered from records),
ratchet deltas in PR diffs, world evidence (via [release.md](release.md)),
and ※ the proof-coverage report.

## 8 · Fences

- **[ci-cd](../ci-cd/README.md)** owns all wiring: lanes, triggers,
  cadences, budgets-as-implemented, the merge train, deploys. This spec
  states what must be proven; it never edits a workflow.
- **Product and runtime systems** own their tests, named in their Proof
  sections. The harness launch-option authority gate lives with
  [harnesses](../../systems/harnesses/launch-options.md).
- **[Observability](../observability/README.md)** owns event names, Sentry
  configuration, and the correlation ids trailers cite.
- **`lints/`** (→ `specs/lints/`, reshape pending) owns the records and
  will own the engines; [lints.md](lints.md) is its legible index.
- **[Support](../../systems/support/README.md)** owns capturing a
  user-reported bug; this spec owns what happens once it becomes a test.

## 9 · Proof

- `scripts/test_check_manifests.py` · `scripts/test_check_anyharness_fences.py`
  · `scripts/test_check_frontend_fences.py` — baselines equal reality, both
  directions.
- `server/tests/unit/test_mypy_baseline_checker.py` — census identity,
  shrink-only, stale-baseline failure.
- `scripts/test_check_docs.py` — the link/anchor resolution the Proof
  contract and trailers ride on.
- `scripts/ci-cd/core-release-scenario-manifest.test.mjs` — manifest ↔
  registry parity (the manifest lives at
  `tests/release/core-release-scenario-manifest.json`).
- `scripts/ci-cd/*.test.mjs` — rollup drift guard and workflow census.
- ※ `scripts/test_check_proof_trailers.py` — trailer grammar and opt-in
  semantics.

## Decisions

All ruled by Pablo 2026-08-26, in session (the alignment ledger is the
Testing Linting CICD vault folder): two blocks, not four tiers · intent
suite deleted · "unit" purity fiction dropped (speed split only) · the
gate (contents, loud-skip, ≤2-min budget) · e2e shape (desktop spine ·
API body · outcome assertions + per-run budget · nightly + digest ·
fix-adds-journey · observe mode) · Biome + the hook story · clippy
allow-as-data + rustfmt into CI · ruff over `scripts/` · gaps.toml deleted
· component-library record.

> [!decision] PABLO DECIDES: Evals gate definition releases and catalog pin
> bumps, never merges — confirm (forced by law 1 as written; changing it is
> a seam change with ci-cd).

> [!decision] PABLO DECIDES: mypy baseline identity across file moves.
> A pure move reports moved diagnostics as growth (precedents #1656, #2222
> admin-merged with proven censuses). Rec: a `--moved old=new` rename-map
> argument — explicit, auditable, no loss of strictness; the spec-driven
> code moves will hit this weekly.

> [!decision] PABLO DECIDES: trailer ratchet timing. Rec: ratchet from the
> first trailered test — from 1, never from 0.

> [!decision] PABLO DECIDES: the self-host battery posture. Parked (tagged
> out of gating, kept; smoke stays on push:main) vs culled. Rec: parked.

## Known gaps

- [ ] The proof trailer and `check_proof_trailers.py` do not exist (law 6 ※).
- [ ] The proof-coverage gate does not exist; five specs still have
      prose-only Proof sections.
- [ ] The hollow vitest suites (desktop · web · `@anyharness/sdk`) are not
      yet wired into the PR pipeline; mobile awaits its retire ruling.
- [ ] `anyharness/tests` (13 files) is homeless until the nightly pipeline
      exists (ci-cd's build list).
- [ ] Law 8 has no lint; law 9's cross-branch id check is a manual
      coordinator step.
