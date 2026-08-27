# CI/CD — the machine

```toml
# machine identity — engineering specs carry no allowed_importers
name = "ci-cd"
owns = "the machine that executes testing's contract and ships artifacts: lanes, merge train, release train, deploys"
```

Status: current for the lanes, the merge train, and the constitution
mechanics; the lane census, `make gate`, nightly, and the staging CD line
are ruled targets in flight (※). Grade: A — rulings 2026-08-26 (see
[Decisions](#decisions)); wording pends Pablo's read-through. Renamed from
`shipping/` 2026-08-26.

**This spec owns zero norms.** What must be proven and what gates what is
[testing](../testing/README.md)'s, whole. Every sentence here is
meaningless without CI — that is the membership test. Its two products:
**verdicts** (green/red per pipeline) and **artifacts** (candidates,
releases, deploys).

**Doc map:**

| File | Expands | What's in it |
| --- | --- | --- |
| this README | — | the census, the lanes, the merge train, the CD line |
| [pipelines.md](pipelines.md) | [The lane census](#2--the-lane-census) | the wiring diagram: seven pipelines, one block each |
| [release-delivery.md](release-delivery.md) | [The CD line](#5--the-cd-line) | artifact identities + the release train as checked in today |
| [desktop-updates.md](desktop-updates.md) | [The CD line](#5--the-cd-line) | the desktop update channel + release notices |

## 1 · Purpose

The path from a commit to a verdict, and from a verdict to running
software, for a multi-agent operating reality: many forks build in
parallel from one `main`, one coordinator runs one merge train,
fresh-context refuters are the review layer. This spec makes that
throughput safe — process weight where the blast radius is, generated
artifacts regenerated rather than hand-merged, and lanes that cannot
silently lie.

## 2 · The lane census

※ Target — the checker is in flight. The law it mechanizes: **a check lives in exactly one pipeline, and every
pipeline has an honest trigger — a dispatch-only lane is a lane that
doesn't exist.**

Every CI job carries a `[[lane]]` record (in the lints tree): job →
pipeline → cadence → gate-mirrored?. The checker (※ `check_lanes.py`)
fails: a job in no pipeline · a dispatch-only cadence with no sunset date ·
`continue-on-error` outside a quarantine row · a quarantine row past its
expiry · a census row naming a job that no longer exists — both
directions, as everywhere. **Flake policy is the same mechanism**: a flaky
test gets a quarantine row (owner + expiry, expired = red), never a
skip-comment.

The records are the job→pipeline truth; this README deliberately carries
no mirror table.

## 3 · The lanes today

Merge-gating: `ci.yml` (~6 min wall) + `server-ci.yml` (~5) + CodeQL ×3
(~4) + `pr-metadata.yml`, all parallel — verdict in ~6 minutes.
Deploy/release: `deploy-staging.yml`, `release.yml` (the 09:00 UTC prod
cron), the reusable `_build-server` / `_deploy-*` lanes,
`release-desktop`, `release-runtime`, `release-e2e*`, catalog lanes,
`self-host-smoke`, the three Windows lanes (path-filtered, outside every
rollup). Deleted 2026-08 (#2253, on
record): `intent-tests.yml`, `ci-heavy-lanes.yml`,
`release-e2e-hard-cancel-cleanup.yml`, the broken managed-cloud job, the
retired T3-SH-1 references.

**Only rollups are required.** Branch protection lists `ci-ok`,
`server-ci-ok`, CodeQL ×3, and the metadata check — never an individual
lane. Each rollup `needs:` every job in its file, runs `if: always()`,
and carries a drift guard: a job added without a `needs:` entry fails the
rollup. A required check that stops reporting counts as satisfied, so only
rollups that fail on `skipped` belong on the list. **Lanes no-op green,
never skip** — a job-level `if:` skip would read as satisfied and vanish
from the rollup.

## 4 · The merge train

The protocol, every law pinned to an observed failure on the 2026-08
trains:

- **One train at a time, serial**: merge → next PR rebases + goes green →
  merge. Budget ~10 minutes per merge when generated files are in play.
- **A conflicting PR has no CI.** GitHub fires no `pull_request` workflow
  on a head that cannot merge; "CI didn't trigger" means "rebase."
- **Generated files are regenerated, never hand-merged** — the generated
  SDK types, lockfiles, and every `ratchets.toml` are the conflict engine;
  take either side, run the generator, commit the output. Ratchets resolve
  to the *observed* count, never a hand-pick.
- **Migration ids are minted, never authored**; parallel migrations parent
  on the same main head and re-parent serially at merge turn; cross-branch
  id uniqueness is checked before each merge
  (`scripts/ci-cd/check-migration-ids-across-branches.sh`).
- **Only the branch owner pushes.** A merge and a branch delete are two
  commands; delete only after the merge API reports success.
- **Touching `.github/workflows/**` needs the `workflow` OAuth scope** on
  the pushing token; verify before dispatching a fork that edits lanes.
- **Review**: at least one completed fresh-context refuter per non-trivial
  PR (testing law 11); grep-gates on deletions cover display names, not
  just slugs; spec disagreements are raised, never silently absorbed.
- Draft PRs are metadata-exempt; readiness is the gate. A red metadata
  check seconds after opening is usually a label race — re-check after
  labels settle.

## 5 · The CD line

Ruled 2026-08-26. **Merge is the only test gate · deploy is not a gate · staging is the
standing e2e world · e2e green is prod's door.**

- **One artifact base**: build once per green main — one candidate set
  (server images · web · desktop binaries · runtime) from one commit.
  Staging consumes it pointed at staging **by config, not by build**; prod
  promotes the *identical* artifacts. The release train is extra
  qualification on the same candidates, never a second build. Requires
  endpoint-agnostic artifacts (config at runtime; today's lanes each build
  their own image — the artifact-handoff slice closes this, Known gaps).
- **main → staging**: push:main green → staging deploys immediately, no
  additional tests; staggered latest-wins (concurrency groups; a newer
  green supersedes a queued deploy, never cancels one mid-flight);
  migrations run inside the deploy; deploy failure → Slack; rollback =
  re-promote the previous artifact. ※ In flight — supersedes #2140's
  "merging to main deploys nothing" doctrine and rewrites its two
  enforcement tests.
- **prod**: manual promote; nothing new runs at prod time. Doors: the
  battery verdict (observe mode during fix week — red informs, Pablo's
  judgment decides) and artifact identity. **WHO**: Pablo, or an agent he
  instructs *per promote* — never standing authority; rollback inherits
  the same authority. **WHEN**: daily digest-then-promote rhythm, prod
  trailing main ≤1 day; demo-critical fixes may promote same-day after an
  on-demand battery run — soak is one battery pass, not wall-clock.
  **Transitional**: the daily 09:00 UTC prod cron stays until the staging
  pipeline + battery stand, then dies in the same PR that makes promote
  deliberate.

## 6 · Consumes / Emits

Consumes: testing's gate rule and block definitions · the worlds datasheet
([release.md](../testing/release.md)) and its evidence contract ·
observability's alert routes (red main / red nightly → Slack, only
"actually quite broken"). Emits: rollup verdicts (branch protection) ·
rule-record diagnostics in CI logs (the id is the lookup key) · candidate
artifacts · deploy events · the merged commit on `main`.

## 7 · Fences

- **[Testing](../testing/README.md)** owns every norm; this spec never
  decides what a lane must prove.
- **[Infra](../../areas/infra.md)** owns Terraform and topology — the deploy
  *targets*; this spec owns what deploys *when*.
- **[Observability](../observability/README.md)** owns what the lanes
  report to, event names, and alert policy.
- **Product and runtime systems** own their tests and Proof sections; this
  spec schedules, never names product tests as its own.

## 8 · Code map

```text
.github/workflows/            every lane; rollups carry the drift guards
scripts/ci-cd/                pr metadata + census tests + release tooling
scripts/gate ※                the pre-push gate (pipelines.md)
lints/**/lanes.toml ※         the lane census records
guides/process/pull-requests.md   the contributor procedure
guides/deploying/             operator runbooks (consumed, not owned)
```

## 9 · Proof

- `scripts/ci-cd/*.test.mjs` — workflow census, rollup drift, metadata
  grammar, server-release build separation.
- The `ci-ok` / `server-ci-ok` drift guards, live in every run.
- ※ lane-census checker tests · ※ gate unit tests.

## Decisions

Ruled 2026-08-26: the CD line whole (staging auto-deploy · one artifact
base · prod WHO/WHEN + transitional cron · observe mode) · the lane census
+ quarantine mechanism · ghost-lane deletions · the gate (pipelines.md) ·
change detection deferred (a cost optimization, not a fix; it adds a
"didn't run = didn't check" failure mode we don't take on launch week).

> [!decision] PABLO DECIDES: the stale `server/infra` Terraform lane. State
> last written 2026-03; a plan proposes 21 destroys including prod ALB/ECS;
> nobody may apply. Rec: cull `main.tf` + the validate lane for launch
> week; re-import later if Terraform becomes the deploy path again.

> [!decision] PABLO DECIDES: the three Windows lanes — path-filtered,
> outside every rollup, gate nothing. Rec: keep as scheduled canaries;
> decide properly when Windows matters.

> [!decision] PABLO DECIDES: required reviewers. Branch protection requires
> no review; refuters are the review layer. Rec: keep as policy while the
> merge train is a single actor.

> [!decision] PABLO DECIDES: the reshape beyond this rename (`lints/` →
> `specs/lints/` with the engines, `fixtures/` → `tests/contracts/`,
> `delivery/` → `specs/delivery/`) — tonight vs behind the spec pass.

## Known gaps — the build list, in blocking order

Each gap is frozen as a delivery spec under
[delivery/testing-cicd/](../../../delivery/testing-cicd/) before its code
lands.

- [ ] Staging fix ladder (audited 2026-08-26): rewrite the two
      trigger-doctrine tests + wire push:main
      ([staging-pipeline](../../../delivery/testing-cicd/delivery-spec-staging-pipeline.md))
      → re-mint the e2e session credential *with a durable rotation
      write-back* → map the ~9 provisioned-but-unmapped env vars → strip
      `continue-on-error` → restore the nightly cron as the battery
      ([e2e-observable](../../../delivery/testing-cicd/delivery-spec-e2e-observable.md))
      → **artifact handoff** (the digest e2e validates must be the digest
      prod runs; not yet frozen).
- [ ] The lane census + checker and `nightly-checks.yml` do not exist
      ([lane-census](../../../delivery/testing-cicd/delivery-spec-lane-census.md)).
- [ ] `make gate` + the hooks do not exist
      ([make-gate](../../../delivery/testing-cicd/delivery-spec-make-gate.md));
      the rust lint job and the hollow vitest suites are unwired
      ([lint-wiring](../../../delivery/testing-cicd/delivery-spec-lint-wiring.md)).
- [ ] Staging has no background plane (worker/beat services unset) and no
      staleness detection; the E2B webhook 401s on staging.
