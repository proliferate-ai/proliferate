# Building Loop

Status: target for the multi-agent merge discipline, the alembic id law, and the change-detected PR gate; the constitution (checkers, lint records, rollups, PR metadata) describes `main`. Grade B — see [Known gaps](#known-gaps).

Read before touching: [ci.yml](../../../.github/workflows/ci.yml), [server-ci.yml](../../../.github/workflows/server-ci.yml), [pr-metadata.yml](../../../.github/workflows/pr-metadata.yml), [scripts/ci-cd/pr-metadata.mjs](../../../scripts/ci-cd/pr-metadata.mjs), [lints/README.md](../../../lints/README.md), [specs/README.md](../../../README.md) (authority table), [guides/process/pull-requests.md](../../../guides/process/pull-requests.md).

## 1. Purpose

The building loop is the path from an intent to a commit on `main` that every other system can trust: how a change is scoped, who may write it, what must be proved before it merges, what the repository mechanically refuses, and how many changes can be in flight at once without corrupting each other. It is a cross-cutting engineering system — it owns **no product state** and consumes every product spec's Proof section (the tests it schedules) and Code map (the folders its fences guard).

Its operating reality is multi-agent: many forks build in parallel from one `main`, one coordinator runs one merge train, and fresh-context adversarial refuters are the only review layer. The loop's job is to make that throughput safe: process weight placed where the blast radius is, generated artifacts regenerated rather than hand-merged, and a constitution that stops a wrong change in CI instead of in a reviewer's memory.

## 2. Owned state

No product tables. The loop's state is checked-in data and GitHub settings:

```text
.github/workflows/ci.yml              the PR lanes + the ci-ok rollup + the required-checks ledger (comment)
.github/workflows/server-ci.yml       change-detected server lanes + server-ci-ok
.github/workflows/ci-heavy-lanes.yml  dispatch-only demotions (2026-08 cull)
.github/workflows/pr-metadata.yml     title/label readiness gate (pull_request_target)
lints/<owner>/*.toml                  rule records — the constitution as data
lints/<owner>/exceptions.toml         grandfathered violation sites, one per site
lints/<owner>/ratchets.toml           shrink-only measured debt
server/scripts/mypy_baseline.json     grandfathered mypy diagnostics (path-keyed)
delivery/<program>/*.md               frozen delivery specs — intent for one PR each
GitHub branch protection on main      six required contexts (below); strict mode off; no required reviewers
```

The **required-checks ledger** is written into [ci.yml](../../../.github/workflows/ci.yml) as a comment beside `ci-ok` and mirrored in branch protection; the six live contexts are `ci-ok`, `server-ci-ok`, the three CodeQL `Analyze (…)` checks, and `Validate PR title and labels`. Nothing else is required, on purpose: a required check that stops reporting counts as satisfied, so only rollups that fail on `skipped` belong on the list.

## 3. Public surface

What a contributor (human or agent) interacts with:

| Surface | Contract |
| --- | --- |
| PR title `type(scope): change` + exactly one `release:*` + every affected `area:*` | [pull-requests.md](../../../guides/process/pull-requests.md); enforced by [validate-pr-metadata.mjs](../../../scripts/ci-cd/validate-pr-metadata.mjs) once the PR leaves draft |
| PR body: Summary / Testing / Observability / Readiness / Verification | [pull_request_template.md](../../../.github/pull_request_template.md); proof depth per [TESTING.md](../testing/standard.md) |
| `ci-ok` and `server-ci-ok` | the only merge-gating CI signals; each `needs:` every lane in its file, runs `if: always()`, fails on anything but `success`, and carries a drift guard |
| `python3 scripts/check_*.py` + `lints/**` | the constitution; every diagnostic is rendered from its rule record by [lint_records.py](../../../scripts/lint_records.py) |
| `python3 scripts/check_docs.py` | documentation integrity gate: links resolve, required indexes exist, structured data validates |
| `delivery/<program>/delivery-spec-<slug>.md` | founder-frozen intent for one PR; frozen before implementation, archived after merge (authority table in [specs/README.md](../../../README.md)) |
| Four-bucket change declaration (bug / spec gap / system change / seam change) | the Organization Standard's taxonomy; today declared in the PR body, target: a label |
| `workflow_dispatch` on demoted lanes | [ci-heavy-lanes.yml](../../../.github/workflows/ci-heavy-lanes.yml), [intent-tests.yml](../../../.github/workflows/intent-tests.yml), [release-e2e.yml](../../../.github/workflows/release-e2e.yml) — run by hand until re-gated |

## 4. Consumes

- **Every product/runtime spec's Proof section** — the tests the lanes run
  ([systems index](../../README.md)). A Proof section that names no test is
  a lane with nothing to schedule; the loop lists those as gaps, it does not
  invent tests.
- **Every spec's Code map** — the folders the boundary and fence checkers
  guard ([check_server_boundaries.py](../../../scripts/check_server_boundaries.py),
  [check_anyharness_fences.py](../../../scripts/check_anyharness_fences.py),
  [check_frontend_fences.py](../../../scripts/check_frontend_fences.py),
  [check_manifests.py](../../../scripts/check_manifests.py)).
- **Testing** ([TESTING.md](../testing/standard.md)) — defines the tiers; this
  system only schedules them.
- **Delivery** ([delivery/README.md](release-delivery.md)) — owns what
  happens after merge (release, deploy, promote). The loop ends at `main`.
- **Observability** ([observability/README.md](../observability/README.md)) —
  the per-PR observability delta the template asks for is that system's
  standard; the loop only requires the line be filled.
- GitHub: branch protection, `pull_request` / `pull_request_target` events,
  the `workflow` OAuth scope.

## 5. Laws

### Gating

**Only rollups are required.** Branch protection lists `ci-ok`, `server-ci-ok`, CodeQL ×3, and the metadata check — never an individual lane. A lane renamed, sharded, or deleted must fail the rollup's drift guard ([ci.yml](../../../.github/workflows/ci.yml) `ci-ok` step "Assert the rollup covers every job"), not silently leave the required set. *Failure closed:* the 2026-08 cull removed two smoke contexts from branch protection because they had become expected-but-never-reporting the moment their trigger left the PR path.

**Lanes no-op green, never skip.** A server lane on an irrelevant diff runs its change probe and exits success ([server-ci.yml](../../../.github/workflows/server-ci.yml) `changes` job); a job-level `if:` skip would read as satisfied and hide the lane from the rollup. `ci.yml` has no change detection today and runs all ten lanes on every PR (gap, below).

**A conflicting PR has no CI.** GitHub fires no `pull_request` workflow on a PR whose head cannot merge into base. "CI didn't trigger" means "rebase"; close/reopen does not help. The coordinator treats a check list that never populates as a conflict signal.

**Draft PRs are exempt from metadata; readiness is the gate.** [validate-pr-metadata.mjs](../../../scripts/ci-cd/validate-pr-metadata.mjs) returns early on drafts; on `ready_for_review` and every label event it re-derives area expectations from the final changed-file list. A red "Validate PR title and labels" seconds after opening is usually a label race; re-check after labels settle before acting.

**Touching `.github/workflows/**` needs the `workflow` OAuth scope on the pushing token.** Creating or modifying a workflow file is refused by GitHub without it; deleting one is not. Three of six cull PRs stalled on this. The coordinator verifies `gh auth status` shows `workflow` before dispatching any fork that will edit workflows.

### Constitution

**Rules are data; checkers are engines.** A mechanical rule lives as a `[[rule]]` record under [lints/](../../../lints/README.md) with a citable id, and the checker renders its diagnostic from the record. Prose docs cite ids, never restate rules.

**Exceptions are sites, ratchets shrink.** An exception ledger entry names one site, never a count; a ratchet allowance (`max_lines`, fence baselines, the mypy baseline) may only decrease. Growth fails; a stale entry whose file is now under allowance also fails ([check_max_lines.py](../../../scripts/check_max_lines.py)). Net-new exceptions are constitutional amendments and say so in the PR.

**Ratchets resolve to the observed count, never by hand-merge.** When two branches both shrink `ratchets.toml` or `mypy_baseline.json`, the merge resolution is "re-measure and write what the tool reports", not "pick a side". The mypy baseline keys on path, so a pure move shows as growth — resolve with a proven census (precedents #1656, #2222) or the `workflow_dispatch` comparison SHA, never by re-adding the old diagnostic.

**Fence checkers enter in warn mode and leave by dropping `--warn`.** [check_anyharness_fences.py](../../../scripts/check_anyharness_fences.py), [check_frontend_fences.py](../../../scripts/check_frontend_fences.py), and [check_manifests.py](../../../scripts/check_manifests.py) run with `--warn` in the repo-shape job today; the flip is a one-token change per checker once its baseline is exact.

### Generated artifacts and migrations

**Generated files are regenerated, never hand-merged.** [cloud/sdk/src/generated/openapi.ts](../../../cloud/sdk/src/generated/openapi.ts), the runtime SDK's generated types, `uv.lock`, `Cargo.lock`, and every `ratchets.toml` are the merge-conflict engine: every merge to `main` knocks the other open PRs to CONFLICTING through them. The rebase rule is: take either side, run the generator or lock command, commit the output.

**Alembic revision ids are minted, not authored.** 109 of the 151 files under [server/alembic/versions](../../../server/alembic/versions) carry hand-typed ids of the form `a1b2c3d4e5f6`; two forks minted the same one (`d7e8f9a0b1c2`) on 2026-08-25. [SRV-MIGRATE-2](../../../lints/server/migrations.toml) proves uniqueness within one tree, which cannot see a sibling branch. The law: ids come from `alembic revision` (random 12-hex) or `uuid4().hex[:12]`; a sequence-shaped id is a review finding. Cross-branch uniqueness is the coordinator's check before each merge (Minimum tonight, below).

**One head per merge; re-parent at merge time, never onto an unmerged branch.** Parallel migrations all parent on the same `main` head; each merge re-parents the next one serially ([SRV-MIGRATE-4](../../../lints/server/migrations.toml), [check_migration_heads.py](../../../scripts/check_migration_heads.py)). Re-parenting onto a sibling branch's head creates two heads the moment either merges first.

**Downgrades recreate structure.** The head-to-history downgrade test walks every revision back; a `NotImplementedError` downgrade breaks it for every later migration. Ship a structure-recreating downgrade, or pin the test to the revision that introduced the irreversibility — both were used on 2026-08-25 and both are legal; silently skipping the test is not.

### Parallel work

**One merge train per repository at a time.** Two fleets merging into `main` inside the same fifteen minutes invalidated every open PR's base twice. The train is serial: merge → wait for the next PR's rebase + green → merge. Budget ~10 minutes per merge when generated files are in play.

**Only the branch owner pushes.** The coordinator never pushes, rebases, or force-pushes a fork's branch; it asks the owner and waits for the idle notice. A fork force-pushing while the coordinator inspects fast-forward-ability is the failure this law closes.

**A merge and a branch delete are two commands.** `merge && delete-branch` across several PRs deleted the branches of two PRs whose merges were refused, and GitHub closed them. Delete only after the merge API reports success; recover a deleted head by recreating the ref at the PR's recorded head SHA and reopening.

**Forks that idle do not resume themselves.** The coordinator subscribes to idle notices and re-nudges with the exact branch and head SHA; a fork left idle mid-task is a stalled PR nobody is watching.

### Review

**Fresh-context adversarial review is the review layer.** Automated third-party review is off; a PR's reviewers are independent, fresh-context refuters prompted to disprove the change against its spec. At least one refuter must **complete**; an inline "I reviewed it myself" is a fallback note, never a pass. Session limits that kill a refuter mid-pass leave the PR unreviewed.

**Grep-gates cover display names.** A deletion PR's completeness gate greps for the workflow `name:`, the contact-point name, and the product name in prose — not only the filename slug. The E4 cull reviewer caught a guide referencing "Cloud Live Webhook" that no slug grep had seen.

**Spec disagreements are raised, never absorbed.** When code and spec disagree, spec wins or the same PR amends it; a frozen delivery spec that turns out wrong gets an implementation note recording the contradiction (as E2 did for its item 2), not a silent scope change.

### Local proof

**CI is authoritative; local is advisory.** Local Postgres at default settings (128 MB shared buffers) exhausts locks under `pytest -n 4` and reds unrelated suites. Run `-n 2` or sequential locally; treat a mass local red as an environment signal, not a code signal.

**No wall-clock day boundaries in assertions.** A billing test flaked from 00:00–00:05 UTC because it asserted by "today" rather than the event's date (fixed in #2224). Lint candidate for the testing system.

> [!decision] PABLO DECIDES: `server/infra` Terraform.
> The remote state (`s3://proliferate-terraform-state/server/terraform.tfstate`,
> serial 7) was last written 2026-03-24; a plan against
> [main.tf](../../../server/infra/main.tf) proposes 10 adds, 2 changes,
> **21 destroys** including the production ALB, listeners, ECS service, and
> both server secrets. Nobody applies. Options: (a) re-import live infra into
> state as a deliberate project; (b) cull `server/infra/main.tf`,
> `terraform-validate`, and the tracker-era variables, keeping
> `background.tf` only if the background plane is actually provisioned by it.
> Recommendation: (b) for launch week — the lane validates a file nobody can
> apply, which is ceremony without protection; re-import later if Terraform
> becomes the deploy path again.

> [!decision] PABLO DECIDES: two-lane process weight (seam vs edge).
> The raw draft proposed classifying PRs mechanically by seam paths
> (`lints/lanes.toml`) so edge PRs ship on a 3-line checklist and seam PRs
> keep the full discipline. Options: (a) build it now on top of
> `deriveAreaExpectation`; (b) defer until `ci.yml` change detection exists,
> since the lane label and the lane-aware CI are the same mechanism.
> Recommendation: (b) — land change detection first (Target, below), then the
> lane label is one more derived projection.

## 6. Emits

- `ci-ok` / `server-ci-ok` check runs — consumed by branch protection and by
  the delivery system's staging wait ([delivery/README.md](release-delivery.md)
  "waits for matching Server CI").
- `Validate PR title and labels` — consumed by branch protection; its
  `release:*` label is consumed by release-note generation (delivery).
- Rule-record diagnostics (`SRV-*`, `AH-*`, `FE-*`, `PROD-*` ids) in CI logs —
  consumed by the agent fixing the failure; the id is the lookup key into
  [lints/](../../../lints/README.md).
- The merged commit on `main` — the only artifact delivery consumes.
- Target: a `bucket:*` label (bug / spec-gap / system / seam) consumed by the
  spec-alignment audit and by release notes.

## 7. Fences

- **Testing** owns what a test proves and which tier it belongs to
  ([TESTING.md](../testing/standard.md)); the loop owns when it runs and what
  it gates.
- **Delivery** owns everything after `main`: release, deploy, promote,
  hotfix, template tags ([delivery/README.md](release-delivery.md)) and
  the operator procedures under [guides/deploying/](../../../guides/deploying/README.md).
- **Observability** owns the per-PR observability standard and the telemetry
  scrubbing law ([observability/README.md](../observability/README.md)).
- **Docs system** owns the authority table and the tree
  ([specs/README.md](../../../README.md), [docs-system.md](../../../guides/process/docs-system.md));
  the loop owns only that `check_docs.py` gates.
- **Each product/runtime spec** owns its own Proof and Code map; the loop
  never names a product test as its own.
- **Local development** (profiles, dev scripts) is a plane-infra concern
  ([guides/local/](../../../guides/local/README.md)); the loop's only
  local law is "CI is authoritative".

## 8. Code map

```text
.github/workflows/
├── ci.yml                        10 PR lanes → ci-ok rollup; required-checks ledger comment
├── server-ci.yml                 changes probe → lint / unit / integration (75-min) → server-ci-ok
├── pr-metadata.yml               pull_request_target → validate-pr-metadata.mjs (base-ref code only)
├── codeql.yml                    the three Analyze (…) required contexts
├── ci-heavy-lanes.yml            dispatch-only: candidate-build-handoff, login-budget, scroll-physics, workflow-definition-lifecycle
├── intent-tests.yml              dispatch-only provisional lanes
└── windows-*.yml                 path-filtered PR lanes outside every rollup (gate nothing; C5 open)

scripts/ci-cd/
├── pr-metadata.mjs               title grammar, ALLOWED_* label sets, AREA_RULES → deriveAreaExpectation
├── validate-pr-metadata.mjs      the readiness gate (draft-exempt)
├── configure-playwright-apt.test.mjs   per-workflow census — moves with the lanes it counts
└── server-release-build-separation.test.mjs   pins server-ci.yml's job list

scripts/
├── check_*.py                    constitution engines (22); each loads its records via lint_records.py
├── lint_records.py               record loader + diagnostic renderer
├── check_migration_heads.py      SRV-MIGRATE-2/3/4 — parseable unique ids, existing parents, one head
├── check_max_lines.py            ratchets.toml reader
└── check_docs.py                 links, required indexes, structured data

lints/
├── README.md                     the record contract, id allocation, exception + ratchet semantics
├── server/ · anyharness/ · frontend/ · product/
│   ├── <family>.toml             [[rule]] records
│   ├── exceptions.toml           one entry per grandfathered site
│   └── ratchets.toml             shrink-only allowances
server/scripts/mypy_baseline.json  path-keyed grandfathered diagnostics (+ check_mypy_baseline.py)

delivery/<program>/               frozen delivery specs (archive after merge)
guides/process/pull-requests.md   the contributor procedure
.github/pull_request_template.md  Summary / Testing / Observability / Readiness / Verification
```

## 9. Proof

- [validate-pr-metadata.test.mjs](../../../scripts/ci-cd/validate-pr-metadata.test.mjs)
  and the `pr-metadata.mjs` fixtures — title grammar, release/area rules,
  ambiguous-path blocking, draft exemption.
- `ci-ok` drift guard ([ci.yml](../../../.github/workflows/ci.yml)) —
  every job in the file is in `needs:`; simulated locally with the same Ruby
  logic on each cull PR.
- [server-release-build-separation.test.mjs](../../../scripts/ci-cd/server-release-build-separation.test.mjs)
  — `server-ci.yml` publishes nothing; the job list is pinned.
- [configure-playwright-apt.test.mjs](../../../scripts/ci-cd/configure-playwright-apt.test.mjs)
  — the Playwright install census per workflow (this is the test that reds
  `ci-cd-config` when a lane moves without its census entry — E3 found it).
- `python3 -m unittest scripts/test_check_*.py` — each checker's own tests,
  run in the repo-shape job before the checker.
- [test_mypy_baseline_checker.py](../../../server/tests/unit/test_mypy_baseline_checker.py)
  — baseline shrink-only semantics.
- [test_check_docs.py](../../../scripts/test_check_docs.py) — required
  index list and link validation.
- Live proof of the gating laws: the 2026-08-25 engineering-cull train
  (#2210–#2215) — six PRs, adversarially reviewed, merged serially; every
  law in §5 marked with a date is pinned to a failure observed on that train.

## Minimum tonight

Small, concrete, no product code:

1. **`scripts/ci-cd/pr-open.mjs`** — a `gh pr create` wrapper that diffs the
   branch against `origin/main`, runs `deriveAreaExpectation`, applies the
   derived `area:*` labels plus the `--release` label, and opens non-draft.
   Removes the label race and the five label-less PRs of tonight. Unit test
   on the label derivation; the `gh` call is a thin shell-out.
2. **`scripts/ci-cd/check-migration-ids-across-branches.sh`** — fetches all
   remote branches and fails on any alembic revision id present in two
   branches with different file content. The coordinator runs it before each
   merge; documented in the PR procedure.
3. **PR procedure: "Working in parallel"** section in
   [pull-requests.md](../../../guides/process/pull-requests.md) —
   conflicting-PR-has-no-CI, regenerate-not-hand-merge, minted alembic ids,
   the `workflow` scope, one merge train, owner-only pushes.

## Target

- **`ci.yml` change detection**, mirroring `server-ci.yml`'s probe: docs-only
  and single-plane PRs skip unrelated lanes by no-op-green, keeping the
  rollup honest. This is the mechanism the lane model rides on; the ≤12-min
  edge-PR gate follows from it, not the other way round.
- **`nightly-checks.yml`**: the demoted lanes (`ci-heavy-lanes`, intent,
  `agent-runtime-compat`'s anyharness suite, the release-e2e corridor when
  un-parked) run on a schedule against `main`; a red files one canonical
  issue with the rule id or lane name as the title key.
- **Fence flip**: drop `--warn` from the three fence/manifest checkers once
  their baselines are exact; every flip is a constitutional amendment PR.
- **`bucket:*` label** for the four-bucket taxonomy, derived where possible
  (schema paths → seam; `lints/**` → constitution), declared otherwise.
- **Migration id minting** as a rule record (`SRV-MIGRATE-5`, status `leaks`
  until a checker can see sibling branches).
- Re-gating decisions for scroll-physics, intent, candidate-build-handoff
  (deferred by the cull; recorded in
  [delivery-spec-ci-diet.md](../../../delivery/engineering-cull/delivery-spec-ci-diet.md)).

## Known gaps

- [ ] `ci.yml` runs every lane on every PR; docs-only PRs pay the full Rust
      and frontend cost. Target item 1.
- [ ] No nightly home for demoted lanes; `agent-runtime-compat.yml` is the
      sole route to `anyharness/tests` and runs only by hand.
- [ ] Alembic id minting is convention, not a checker (109 hand-shaped ids in
      the tree). Minimum tonight item 2 is the coordinator-side stopgap.
- [ ] The three Windows lanes are path-filtered PR lanes outside every rollup;
      they gate nothing. C5 ruling open (block or delete).
- [ ] The four-bucket declaration is prose in the PR body; nothing checks it.
- [ ] > [!decision] PABLO DECIDES: required reviewers. Branch protection
      requires no review and no up-to-date branch. With refuters as the only
      review layer, options: keep it policy (today) or require one approval
      from the coordinator account so an un-refuted PR cannot merge by
      accident. Recommendation: keep it policy for launch week; the merge
      train is a single actor.
- [ ] > [!decision] PABLO DECIDES: Terraform (§5 callout).
- [ ] > [!decision] PABLO DECIDES: two-lane process weight (§5 callout).
