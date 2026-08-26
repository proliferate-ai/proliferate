# How our docs work

Why this document exists: our docs kept failing us in three ways. They go stale and
then agents (and people) trust something false. Knowledge evaporates the moment a
project ships — the reasoning lived in a PR body or a chat and died there. And docs
that nothing enforces are lies waiting to happen. The structure below is built
against those three failures, for both humans and agents: support agents, bug-fix
agents, and new teammates all need findable exceptions, legible code, and enough
logging to work a problem end to end. The north star is agents closing the full
SDLC loop — that only works if the written system is true.

Two rules above everything:

1. **If it's not current, it's not in this repo.** Future work lives in PRs, issues,
   and `adrs/`; history lives in git. Anything in the tree is operating truth,
   updated in the same PR that changes behavior.
2. **One router.** Every "touching X → read Y" fact lives in `AGENTS.md` and nowhere
   else. Two routers always diverge, and then nobody can tell which one is true.

## The map

- **`AGENTS.md`** — the routing table of contents. An agent (or person) lands here
  cold and knows in 30 seconds which ONE doc to read next. It routes, it never
  explains — the moment it explains something, that sentence belongs in the target
  doc. Carries the source router (path globs → doc) and the repository-wide rules.

- **`ARCHITECTURE.md`** — how every component fits together and why the seams sit
  where they sit. Deliberately starved (~150 lines): the plane map, ownership
  one-liners, the read order for grokking the repo. Comprehension, not routing.
  Only changes when a plane is added or a seam moves.

- **`specs/`** — everything to do with building in this repository. Four ideas,
  four places: `areas/` = where code goes, `systems/` = what the product does,
  `engineering/` = how we work, `adrs/` (repository root) = what we decided.
  - `areas/` — one doc per source tree (`server.md`, `anyharness.md`,
    `frontend.md`, `infra.md`): layering, dependency direction, conventions
    (owners, not languages — "Rust" is a compiler, not an owner). Each pairs
    with rule data in `lints/<owner>/` that STOPS you. The litmus per sentence:
    could a checker hold this? Yes → lints data. No → prose. Nothing is written
    twice. Generated references (DB schema etc.) live beside their area doc,
    which names the regenerate command; never hand-edited.
  - `systems/<name>/` — one folder per system; `README.md` is the spec in the
    nine-section anatomy, sibling files are its sections and depth references.
    Every source file belongs to exactly one spec's code map. A feature is a
    section of its owner's spec, never a spec of its own.
  - `engineering/<name>/` — how we test, observe, ship, secure, and support;
    these own no product state and consume every system's `Emits` and `Proof`.
    The per-PR standards are `engineering/testing/standard.md` and
    `engineering/observability/standard.md` (state the tier(s) or why none is
    feasible; state the observability delta or "none") — review-mode, no
    body-parsing CI ceremony.
  - `DESIGN_SYSTEM.md` — the design system, whole: the why behind every token,
    component + styles library references, ratchet pointers.
  - `product-sense.md` — sparse cross-product judgment primitives: the taste calls
    a competent model would get wrong, each with a good/bad example. Enforced by
    review — legitimately, not as debt.

- **`adrs/`** — architectural decision records. The specing doc IS the record:
  every non-trivial feature is specced as an ADR up front (orientation / current
  context / design options / implementation slices / validation), immutable once
  approved, and it stays forever as the permanent why. `grep 'Description:' adrs/`
  is the index — no index file to rot. Multi-PR orchestration lives in the ADR's
  own Implementation section; there is no separate programs directory. Outside the
  normal read path: you come here for the why behind a decision, or to execute one.
  Format contract: [`adrs.md`](adrs.md).

- **`guides/`** — the daily stuff that isn't writing code: `local/` (machine
  setup), `debugging/` (incidents, support reports), `deploying/` (THE release
  runbook, ci-cd, self-hosted), `operating/` (prod runbooks, operator tasks,
  analytics), `process/` (pull requests, ADRs, this doc). Task-shaped, always the
  same anatomy: safety contract first → steps with expected output → symptom /
  meaning / action failure table → rollback.

- **`lints/`** — rules as data, by owner. For any best practice that would STOP
  something you write: it becomes a lint or a pinning test. The TOML record is
  canonical — id, scope, rule, legal alternative, the why (dated incident),
  good/bad example, exact exceptions, owner. The CI diagnostic is GENERATED from
  the record: a bare "error: banned" teaches nothing; the message is a remediation
  prompt. Violations are never counted — a rule is clean or carries exact named
  exception fingerprints. Agents may not amend the constitution (weaken a lint,
  add a net-new exception, delete a pinning test) without flagging and stopping;
  CODEOWNERS backs it mechanically.

## Where does a new learning go?

Two independent questions, never conflated:

1. **Placement.** Component-local? → a comment next to the code, no doc. Changes
   what you'd design in one source tree? → that `areas/` doc. System behavior,
   any plane? → the owning `systems/<name>/` spec (a depth file beside its
   README if it is deep). Cross-product judgment? → `product-sense.md`. A
   workflow, not a design input? → `guides/`. None of the above? → don't write
   it down. Deliberately.
2. **Verification.** Every rule names its enforcement mode:
   `compiler | lint | test | review`. Mechanical rules become `lints/` records.
   Review is a legitimate mode for judgment calls. `GAP - #issue` marks the only
   real debt: rules that COULD be mechanical and aren't yet.

Write it in the same PR as the learning, or the knowledge evaporates.

## Scheduled enforcement

Ratchet re-measurement, generated-doc freshness, and tombstone sweeps are carried
by the checkers themselves plus the operating runbooks — they are not a separate
directory or system.
