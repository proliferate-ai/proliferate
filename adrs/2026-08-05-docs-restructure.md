# Docs structure (target)

Description: the target model and live slice registry for restructuring this repo's documentation system into the AGENTS.md-routed tree.
Date: 2026-08-05

One authority rule replaces the current five-lifecycle model: **if it's not current, it's not in this repo.** Current means current behavior, current policy including its exact exceptions, current procedures, and current evidence. Approved-but-unbuilt designs are not current: delivery specs and multi-PR plans live outside the canonical read path - PRs, issues, and the Implementation sections of `adrs/` records (below). When a delivery spec or program retires, its surviving decisions graduate in that same retiring PR: mechanical rules → lint records, rejected approaches → tried-and-rejected rows, cross-plane invariants → feature-doc laws. Nothing valuable dies in a PR body. Anything in the tree is operating truth, updated in the same PR that changes behavior. The tree serves agents and humans alike - it is the reference for both, not an agent-only artifact.

Two independent questions decide where a learning goes - placement and verification, never conflated:

**1. Where do the semantics live?**

- Is it **component-local**? → a comment block colocated with the component. No doc.
- Does it **change what you'd design** in one area? → that source owner's dir (`ANYHARNESS/`, `SERVER/`, `FRONTEND/`, or a thin one for the small owners).
- Does the system **span planes** (client ↔ server ↔ runtime ↔ infra) so no code location can host the story? → `FEATURE_DOCS/`.
- Is it **cross-product judgment** (style, copy, naming, tone)? → `PRODUCT_SENSE.md`.
- Is it **a workflow, not a design input** (releasing, debugging, setup)? → `guides/`.
- None of the above? → don't write it down. Deliberately.

**2. How is it verified?**

Every rule names its enforcement mode: `compiler | lint | test | review`. Mechanical rules become records in `lints/` with the why inside the record - the record replaces the doc. Review is a legitimate mode for judgment calls, not debt. `GAP - #issue` marks only rules that COULD be mechanical and aren't yet - that is the debt.

## The tree

- `AGENTS.md` - THE routing table of contents. The one and only router: every "touching X → read Y" fact lives here and nowhere else
    - Super high level description of what Proliferate is and how it works (10 lines max)
    - Who owns what:
        - AnyHarness owns the harness-agnostic runtime: session/workspace execution, adapter + protocol contracts, and the runtime-side product domains. Never hosted control-plane policy.
        - Server owns the hosted control plane: durable product state, policy, orchestration, auth, integrations, background work - not just "crud"
        - Frontend packages own presentation and interaction: clients of the server's contracts. Desktop Native owns OS integration and local process lifecycle (supervisor/worker converge the managed runtime)
    - Trying to on-ramp to the codebase / comprehend how Proliferate is structured? `ARCHITECTURE.md` lists out how every component fits together.
    - Are you building something? Best practices per SOURCE OWNER (owners, not languages - "Rust" is a compiler, not an owner):
        - `specs/anyharness/` - the runtime lib, mental model in `README.md`, specifics in distinct top level files
        - `specs/server/` - same shape
        - `specs/frontend/` - same shape
        - Thin single-file standards for the small owners: supervisor, worker, desktop-native, sdk. Supervisor and worker do distinct work with distinct standards even though they run in tandem - the tandem story itself lives in `FEATURE_DOCS/MANAGED_RUNTIME.md`.
    - Touching a cross-plane system (sandbox, billing, model routing, ...)? The "touching `<globs>` → read `<doc>`" rows live right here, pointing into `specs/FEATURE_DOCS/`. No CI ceremony attached.
    - Want to deeply understand a specific architectural decision? → `adrs/` (grep for `Description:` to get the one-line summary of each record)
    - Looking to do something that doesn't have to do with writing / editing code? (releasing, debugging prod, local setup) → `guides/`
    - Keeps the existing path-glob source router table, retargeted at this tree
    - Keeps repository-wide rules (no barrels, delete dead code, attribution lint, etc.)

- `ARCHITECTURE.md` - what the high level workings are and why. Deliberately starved (~100-150 lines); the moment it explains internals, that sentence belongs in an area doc.
    - The plane map: clients (desktop/web/mobile) → server control plane → supervisor/worker + sandbox plane → anyharness runtime, model gateway off to the side
    - Ownership one-liners (same as AGENTS.md, one level deeper)
    - The seams: where the cross-plane boundaries are and WHY they sit there (server↔runtime, desktop↔sidecar, ...). Explanation lives here; routing lives in `AGENTS.md` only.
    - Read order for grokking the repo (the three area READMEs, in order)
    - Only changes when a plane is added or a seam moves

- `specs/` - everything to do with building in this repository
    - `DESIGN_SYSTEM.md` - the design system, whole: the why behind every token, component + styles library references, ratchet pointers
    - `PRODUCT_SENSE.md` - sparse cross-product judgment primitives: the taste calls a competent model could get wrong (style, copy, naming, tone), each with a good/bad example. System-specific taste lives with that system. Enforced by review - legitimately, not as a GAP.
    - `TESTING.md` - how we engineer with tests. Must be considered in every single PR (where feasible). ≤150 lines: the 4-tier model, the no-fake-sandbox / no-mock-LLM ruling, per-PR expectations. Depth (tier contracts, release worlds, release validation) lives in `specs/TESTING/`
    - `OBSERVABILITY.md` - how we keep everything observable. Must be considered in every single PR. ≤150 lines: instrumenting-a-new-feature table, scrubber asymmetries, the incident that motivates the rules
    - Enforcement of both per-PR obligations (ruled 2026-08-07): review-mode backed by the PR template - required Testing and Observability sections in the PR body (state the tier(s) added or why none is feasible; state the observability delta or an explicit "none"). No mechanical body-parsing check unless a `GAP - #issue` later earns one. The template edit is constitution-adjacent (`.github/`) and gets its own slice.
    - `GENERATED/` - reproducible checked-in references (DB schema etc.), regenerate command + owning test named in its README, never hand-edited
    - `FEATURE_DOCS/` - cross-plane systems that are core and required to understand deeply
        - `README.md` - a plain index of the folder, plus the admission bar stated harshly at the top: a feature doc exists only when the system spans planes and no code location could host the knowledge. If a comment, lint, or test could carry it, it does not get a doc. (Routing lives in `AGENTS.md`; each doc's own header carries its `Read before touching` globs.)
        - `SANDBOX/` - client ↔ server ↔ E2B ↔ gateway (lifecycle, access, content, gateway, github-auth - kept fenced: each names its neighbors' ownership)
        - `BILLING.md` - Stripe ↔ server ↔ gateway ↔ meters; named laws each with the failure mode + the enforcing pinning test
        - `MANAGED_RUNTIME.md` - server ↔ supervisor ↔ worker: one convergence story (mailbox state machine, binary-swap-is-catalog-update, enrollment/identity)
        - `AGENT_AUTH.md` - client ↔ server ↔ runtime ↔ credential vaults
        - `MODELS.md` - catalog + gateway: probes ↔ server ↔ LiteLLM ↔ providers
        - `WORKFLOWS.md` - server ↔ runtime ↔ workspace placement: race laws + ownership, no wire shapes
        - `DESKTOP_HOST.md` - web bundle ↔ native shell ↔ sidecar seam
    - Each owner dir (`anyharness/`, `server/`, `frontend/`; the thin owners follow the same pattern in one file) is exactly TWO artifacts - one teaches you to think, one stops you:
        - `README.md` - the one prose doc per area. The compression (server: "the grid - legality is a pure function of coordinates"), why each rule exists as problem → solution → what-you-get, target shape for orientation, placement judgment (what owns what, proportionality, "ceremony is earned"), failure-mode table, change discipline. Exemplars: `grid-ownership-model.md` + the judgment half of frontend README / `anyharness-structure.md`
        - `lints/<owner>/` (top-level, see below) - everything mechanical as data: edges, path licenses, grades, named exceptions (never counts), ratchet config
        - The litmus per sentence: could a checker hold this? Yes → data in `lints/`. No → prose in the doc. Nothing qualifies for both, so nothing is written twice.
        - Plus the few deep judgment guides that earn a separate file: live-runtime, hooks, styling, database transactions. Everything else in today's guides dissolves into the pair.
        - Exactly ONE prose doc per area claiming "how to think about this". Two always diverge and agents can't tell which is true (this already happened: anyharness had three, and `system-architecture.md` rotted).
        - Enforcement grades live in the lint data as fields (`status = law | holds | leaks`, measured date, exact exception fingerprints - never counts) - a rule is falsifiable or it's named debt on a ratchet. "Status: target" ceases to exist as a category.
    - `TESTING/` - the depth behind `TESTING.md`: core release validation, release worlds, tier-3/tier-4 contracts

- `guides/` - specific non-building workflows in / at Proliferate. Human / agent consumed (both). Task-shaped: safety contract first, steps with expected output, symptom → meaning → action failure table, rollback. Everything below exists today under `specs/developing/` and moves 1:1 - nothing invented; delivery-artifact stragglers (the WDU rollout plan, frozen testing contracts) do NOT come along.
    - `local/` - getting a working machine: `dev-profiles` (running the profile itself), `feature-worktree-auth`, `stripe-local-testing`, `github-app-manual-qa`, `mobile`
    - `debugging/` - working an incident or report: `issue-triage`, `support-reports`, `performance-profiling`
    - `deploying/` - shipping: `releases` (THE runbook - read before any prod deploy), `ci-cd`, `hosted`, `self-hosted-aws`, `self-hosted-deploy`
    - `operating/` - prod runbooks and operator tasks. Failure runbooks: `cloud-provisioning-failure`, `stripe-webhook-failure`, `worker-enrollment-failure`, `production-alerts`. Operator tasks: `e2b-template-operations`, `agent-catalog-update`, `catalog-probe`, `gateway-models`, `billing-pro-promo-codes`, `operator-security-posture`. Plus `analytics/` (posthog, metabase, customerio, sentry)
    - `process/` - `pull-requests` (labels, review flow, agent review)
    - NOT guides: `developing/testing/*` depth → `specs/TESTING/`; the two `reference/` tables are reference, not task-shaped - `environment-sources` folds into `dev-profiles`' config section, `workspace-command-environment` belongs to the ANYHARNESS owner docs

- `adrs/` - architectural decision records. The specing doc IS the record (ruled 2026-08-07): every non-trivial feature is specced as an ADR up front (the spec format and the ADR format are one thing) (Orientation / Current context / Design options / Implementation slices / Validation derived from the grid), immutable once approved, and it STAYS after ship as the permanent why. Every record opens with a one-line `Description:` header so `grep 'Description:' adrs/` is the index - no separate index file to rot. Current behavior still graduates into owner docs / feature docs at ship; the ADR keeps the rationale and the rejected options.
    - There is NO separate `programs/` dir (removed 2026-08-07): multi-PR orchestration lives in the ADR's own Implementation section - the slice registry / dependency graph and per-slice state (base SHA, approval), amended as slices ship so slice N+1 reconciles against what slice N actually shipped. The decision sections freeze at approval; the Implementation registry is the one part that stays live until the work ships.
    - Outside the normal read path: nothing routes here for day-to-day work - you come here when you want the why behind a decision, or you're executing one

- `lints/` - rules as data, by owner (`lints/server/`, `lints/frontend/`, `lints/anyharness/`, ...): rule records + exception ledgers, consumed by the checkers (one engine shape = one shared rule schema; native tools like Clippy/ESLint are fine behind shared rule IDs; checkers live in `scripts/` per existing convention). Rule IDs (SRV-STORE-3) are citable vocabulary. Exemplar: `server-grid-rules.md` → `lints/server/*.toml`
    - **The record IS the doc.** The rule record (TOML) is canonical: id, scope, the rule, the legal alternative, the why (with the incident, dated, if there was one), a good/bad example, exact exceptions, owner. The CI diagnostic is GENERATED from the record - a bare "error: banned" teaches nothing; the message is a remediation prompt. Family-level rationale lives in the owner README.
    - Written in the same PR as the learning, or the knowledge evaporates
    - Every prose law names its enforcement mode (`compiler | lint | test | review`); `GAP - #issue` is reserved for rules that could be mechanical and aren't yet - public debt, not a footnote
    - **Violations are never counted.** A rule is either clean or carries exact named exceptions (file + symbol fingerprints, individually trackable). CI diffs the list, it never trusts a number.
    - **Carrying a fingerprint forward is legal.** Renaming, moving, or splitting a grandfathered file moves its exception fingerprint with it - that is maintenance, not an amendment. Only NET-NEW exceptions require asking.
    - **Agents may not amend the constitution.** Weakening a lint, adding a net-new exception, deleting a pinning test, or rewriting a normative rule is banned without asking us first - stated here as written law, which frontier models are smart enough to follow. Asking means: flag it in the PR description and STOP. Backed mechanically: `CODEOWNERS` on `lints/**` and the pinning tests requires founder approval. Making CI green by changing the rules is never a fix.

## Migration order (enforcement before deletion)

Per owner: 1) measure the baselines (forces honesty about what actually holds), 2) split the draft standards docs: mechanical rules → `lints/<owner>/` data, judgment → the owner README, 3) stand up the checker seeded with the named-exception list, 4) only then delete the old guides whose content moved. Deleting first and linting later is how learnings get lost.

Repointing: `AGENTS.md` (the one router) retargets FIRST; owners move behind it stage by stage. Every old path keeps a one-line tombstone ("moved to X") until `check_docs.py` reports zero inbound references, then the tombstones are deleted.

Known collision to resolve during migration: the server currently has two prose docs - old `architecture.md` and new `grid-ownership-model.md`. Pick the grid doc (its claims are tied to checker-enforced rule IDs, so it can't silently drift), fold the old doc's unique content into it (type pipeline rationale, transaction discipline), delete the old one. Same split applies to `anyharness-structure.md` and the frontend README: their rule tables and baselines are `lints/` seed data, their judgment sections are the area README.

## File anatomy (section names are an API - identical across every doc of a type)

- Feature doc:
    - Header: `Read before touching: <globs>` + `Owns / Does not own (→ neighbor doc)` fence
    - `Mental model` - ≤2 paragraphs, how to think about it
    - `How it works` - only cross-plane choreography (state machine / causes table); anything derivable from one file is banned
    - `Laws` - stable IDs (B1, S3...), imperative statement first, then the failure mode (dated if incident-born), then `Enforced by: <compiler/lint/test/review>` or `GAP - #issue` (could be mechanical, isn't yet)
    - `Tried and rejected` - table: approach / why it failed / when
    - `Gaps` - honest, each with an issue link
- Best-practices doc: repeating unit of rule → one-line litmus question → good/bad pair → smells list
- Guide/runbook: safety contract (access required, read-only vs mutating boundary, stop conditions + escalation) → steps with expected output per command → failure table → rollback
- Use the code's exact names everywhere (grep is how agents travel between doc and code)
- No copied payload/schema dumps - point at the source path instead. Interface SEMANTICS are welcome: optionality, compatibility windows, typed errors, producer/consumer responsibilities
- No "last updated" stamps or changelogs - git owns history; dates live only inside laws and rejections

## Structure alignment rulings (2026-08-07)

Founder-ruled against the live AGENTS.md-TOC sketch: `adrs/` added with ADR-as-the-spec semantics
and `programs/` REMOVED outright (second ruling, same day - orchestration lives in the ADR's
Implementation section; this file moved from `programs/docs-restructure/OUTLINE.md` to
`adrs/docs-restructure.md` accordingly, becoming the first record); per-PR
testing/observability enforcement = review-mode + PR template (applied above; slice D16);
`DESIGN_SYSTEM.md` naming (slice D4); `FEATURE_DOCS/` home confirmed as already ruled. Owner-dir
placement re-ruled explicitly 2026-08-07 (second pass): `specs/anyharness|server|frontend`,
lowercase, under specs/ — supersedes the CAPS/top-level readings. ADR bar ruled: every
non-trivial feature is specced as an ADR, not only decision-weight work.

## Slice registry (execution plan, 2026-08-06)

Every slice ends at pushed + CI green + agent-reviewed; the founder merges. Distill slices get an
adversarial verify pass (refuters per moved/deleted doc — the method validated on PR #1667).
`AGENTS.md` retargets FIRST inside each slice; moved paths keep one-line tombstones until
`check_docs.py` reports zero inbound, deleted in D14.

### Wave 0 — unblocked (theatre deletion #1667 merged @3ff09e50a was the precondition)

- **D1 — land this ADR.** Rebase this branch onto main, append this registry, mark ready. Lands as `adrs/docs-restructure.md`, the first record. No
  canonical-path changes. State: this PR.
- **D2 — `guides/`.** 1:1 move of `specs/developing/` into `guides/{local,debugging,deploying,operating,process}`
  per the inventory above. `reference/environment-sources.md` folds into `dev-profiles`' config
  section; `reference/workspace-command-environment.md` tombstones toward D7 (ANYHARNESS owner
  content); `testing/*` stays put for D3. Script/Makefile citations retargeted.
- **D3 — `specs/TESTING.md` + `specs/TESTING/`.** Distill `developing/testing/README.md` to the
  ≤150-line per-PR doc; depth (core-release-validation, release-worlds-and-fixtures, tier-3/4
  contracts, the scenario manifest) moves to `specs/TESTING/`. Constitution-class: the manifest
  parity test hardcodes doc paths — flagged, founder-reviewed. Open rulings carried in the PR:
  fate of legacy `flows.md`/`scenarios.md`; `manual-release-qa.md` placement (proposal:
  `specs/TESTING/`). Gate: D2 (shared router rows).
- **D4 — `specs/DESIGN_SYSTEM.md`** (renamed from DESIGN.md, ruled 2026-08-07). Promote
  `specs/codebase/platforms/product/design-system.md`; retarget theme-checker scripts + inbound
  links. Gate: the in-flight branch editing that file lands (pro-76-streaming-micro-bumps).
- **D5 — `specs/OBSERVABILITY.md`.** ≤150-line distill (instrumenting-a-new-feature table,
  scrubber asymmetries, motivating incident); system depth stays with the observability docs.
- **D15 — ADR format contract.** The dir itself lands with D1 (this file). D15 adds the format
  contract (section anatomy incl. the grid-derived Validation section, `Description:` header
  convention) + the AGENTS.md router row. Backfill only the workflow-V1 ADR as the worked
  exemplar; no mass backfill. Gate: D3 + D5 pushed (router-row contention).
- **D16 — PR template: Testing + Observability sections.** `.github/` edit implementing the
  review-mode enforcement ruled 2026-08-07. Constitution-adjacent: founder-reviewed personally.
  Gate: D3 + D5 merged (the sections cite both docs).

### Wave 1 — owner dirs, gated on the in-flight structure programs (they ARE steps 1–3)

- **D6 — constitution machinery.** Shared TOML rule schema, `lints/` scaffold, `CODEOWNERS` on
  `lints/**`, record→diagnostic generator. Founder-reviewed personally. Gate: first owner's rule
  data exists (D7 ready to consume it).
- **D7 — `specs/anyharness/` + `lints/anyharness/`.** Gate: anyharness-grid program merged. Per the
  migration order above: baselines → split (guides + anyharness-structure → TOML + one README) →
  checker seeded with named exceptions → delete old guides. `live-runtime` survives as a deep guide.
- **D8 — `specs/server/` + `lints/server/`.** Gate: server-grid landed. Executes the ruled collision:
  grid-ownership-model wins; old architecture.md's unique content folds in, then deletes.
- **D9 — `specs/frontend/` + `lints/frontend/`.** Gate: frontend fold stack + slice 5 merged.
- **D10 — thin owners.** Single-file standards: supervisor, worker, desktop-native, sdk. Gate: D7.

### Wave 2 — router, feature docs, taste

- **D11 — `AGENTS.md` target shape + `ARCHITECTURE.md`.** Final router consolidation (waves
  already retargeted their own rows — no big-bang) + the starved ~150-line architecture doc.
- **D12a–g — `FEATURE_DOCS/` carve, one PR per doc.** SANDBOX/ (quartet re-fenced), BILLING,
  MANAGED_RUNTIME, AGENT_AUTH, MODELS, WORKFLOWS, DESKTOP_HOST — each reshaped to the file
  anatomy above.
- **D13 — `PRODUCT_SENSE.md`.** Drafted, then a live founder taste ruling.
- **D14 — tombstone sweep.** Delete tombstones + `specs/codebase` residue at zero inbound; this
  ADR stays (records are permanent); its Implementation registry gets a final all-shipped state.
  Preconditions surfaced by the D2 review round:
  a live Grafana re-apply must land first (alert runbook URLs currently traverse tombstones), and
  `check_docs.py` gains a `guides/` root guard when the `specs/developing` guard retires.
