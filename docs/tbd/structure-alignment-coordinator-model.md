# Structure Alignment Coordinator Model

Status: migration operating model. This document tells Codex how to coordinate
structure-alignment phases with implementer and reviewer subagents. It is not a
canonical architecture standard for any area.

Use this when asking Codex to run an alignment effort, for example:

```text
Using docs/tbd/structure-alignment-coordinator-model.md and
docs/tbd/frontend-structure-alignment-migration.md, run phase 1 end to end.
```

For unattended or overnight runs, say so explicitly:

```text
Using docs/tbd/structure-alignment-coordinator-model.md and
<AREA_MIGRATION_PLAN>, run all phases end to end in unattended mode.
Use xhigh implementer and reviewer subagents across the board. Do not stop at
phase boundaries unless there is a real blocker, an unsafe merge decision, or a
permission/tooling limitation.
```

Area-specific rules and workstream inventories live in their owning docs, such
as:

- `docs/tbd/frontend-structure-alignment-migration.md`
- `docs/structures/server/audits/server-structure-hygiene.md`
- `docs/tbd/anyharness-structure-alignment-swarms.md`

Canonical architecture rules remain in each area doc under `docs/structures/**`
plus any required primitive, feature, or dev docs named by that area.

## Coordinator Mission

When invoked with this model, Codex is the coordinator. Codex should run the
requested alignment phase, swarm, lane, or workstream end to end by creating
dedicated worktrees, launching implementer subagents, launching reviewer
subagents after implementation, waking implementers for fix-up, and reporting
whether each PR is ready to squash merge.

The goal is code alignment with existing docs. This is not broad cleanup, not a
redesign, and not a license to change behavior unless the area-specific lane
explicitly requires that behavior change.

## Inputs

The user may ask for:

- one lane, swarm, or workstream
- one phase from an area migration plan
- all phases in order
- a resumed phase, swarm, lane, or workstream
- an unattended or overnight run that should keep advancing across phase
  boundaries

Codex should read the area-specific migration doc before deciding order. If the
request is ambiguous, choose the next unblocked phase or lane from that
area-specific doc and say what was chosen.

## Run Modes

Interactive mode is the default. In interactive mode, Codex reports at phase
boundaries before starting the next phase.

Unattended mode applies only when the user explicitly asks for an overnight,
while-I-sleep, all-phases, or keep-going run. In unattended mode, Codex should:

- run phases or swarms in the order defined by the area migration plan
- use `xhigh` reasoning effort for all implementer, reviewer, and fix-up
  subagents when the subagent tool supports it
- launch all non-conflicting lanes in the current phase with dedicated
  branches/worktrees
- as each lane implementation completes, start its reviewer loop immediately
  instead of waiting for every other lane in the phase
- wake the original implementer for fix-up after reviews finish
- continue until every lane in the phase is ready, merged if merge permission
  and tooling were provided, or explicitly deferred with an owned exception
- update downstream worktrees from the integration branch before starting the
  next phase
- continue into the next phase without asking for confirmation when there are
  no blockers
- stop only for the stop conditions below, unresolved high-risk review
  findings, unsafe merge decisions, missing permissions/tooling, or a behavior
  decision not answered by the docs

Unattended mode still preserves lane scope. It is not permission for broad
cleanup, unrelated refactors, or behavior changes outside the area migration
plan.

## Required Inputs Per Area

Every run needs:

- Coordinator model: this file.
- Area migration plan: the doc that lists phases, swarms, lanes, or
  workstreams.
- Canonical area docs: the authoritative structure docs and focused guides
  named by the area migration plan.
- Verification commands: the checks named by the area migration plan.

Examples:

- Frontend:
  - area migration plan:
    `docs/tbd/frontend-structure-alignment-migration.md`
  - canonical docs:
    `docs/structures/frontend/README.md`,
    `docs/structures/frontend/guides/**`,
    `docs/structures/frontend/packages/README.md`
- Server:
  - area migration plan:
    `docs/structures/server/audits/server-structure-hygiene.md`
  - canonical docs:
    `docs/structures/server/README.md`,
    `docs/structures/server/guides/**`
- AnyHarness:
  - area migration plan:
    `docs/tbd/anyharness-structure-alignment-swarms.md`
  - canonical docs:
    `docs/structures/anyharness/README.md`,
    `docs/structures/anyharness/guides/**`,
    `docs/structures/anyharness/specs/**`,
    relevant `docs/primitives/**` and `docs/features/product-mcps/**`

## Global Rules

- Do not run all unrelated areas at once.
- Run phases or swarms in the order defined by the area migration plan unless
  the user explicitly asks for a later lane.
- Use limited parallelism only when lanes do not contend for the same hot
  files.
- Keep every implementation branch focused on one lane.
- Protect unrelated dirty files. Do not modify or revert work the coordinator
  did not create.
- Preserve behavior unless the lane explicitly owns a behavior change.
- Prefer direct imports. Do not introduce barrels or convenience re-exports.
- Temporary migration exceptions should be rare and must name path, rule,
  owner/lane, reason, and target follow-up PR or branch.
- If GitHub, PR, or subagent tooling is unavailable, fall back to local
  worktrees and structured review output, and state the limitation.

## Start Of Run

Before launching subagents, Codex should:

- read this coordinator model
- read the area migration plan
- read `docs/README.md`
- read the canonical structure docs named by the area migration plan
- read focused primitive, feature, dev, or package docs named by the lane
- inspect `git status --short`
- identify unrelated dirty files and leave them alone
- define the phase/lane checklist and run order
- choose dedicated branch/worktree names

Recommended branch naming:

```text
codex/<area>-<lane>
```

Examples:

```text
codex/frontend-guardrails
codex/server-db-session-threading
codex/anyharness-live-session-runtime
```

Recommended worktree naming:

```text
../proliferate-<area>-<lane>
```

## Lane Loop

For each requested lane:

1. Create or choose a dedicated branch/worktree.
2. Build a concrete implementer prompt from the area migration plan and this
   coordinator model.
3. Launch one implementer subagent in the dedicated worktree.
4. Wait until the implementer completes or reports a blocker.
5. Inspect the implementer diff for:
   - scope control
   - unrelated churn
   - behavior risk
   - docs alignment
   - verification run
6. Create or prepare a PR for the lane.
7. Launch two reviewer subagents against the PR or branch.
8. Wait for both reviewers to finish.
9. Collect reviewer findings.
10. Wake the original implementer with the fix-up prompt and the collected
    findings.
11. Wait for fix-up to complete.
12. Run the coordinator final pass.
13. Report readiness and blockers before moving to the next lane.

## Implementer Prompt Construction

For every implementer subagent, fill in:

- area
- lane/workstream/swarm name
- branch
- worktree path
- required docs
- canonical rules for the lane
- in-scope files or categories
- explicit non-goals
- verification expectations
- PR description expectations

Request `xhigh` reasoning effort when the subagent tool supports it. If the
tool does not support `xhigh`, use the highest available reasoning effort and
record that limitation.

The implementer owns implementation, focused checks, and PR preparation for one
lane. It should not review other lanes.

## Implementer Prompt Template

```text
You own the `<LANE>` structure alignment lane for `<AREA>`.

You are working in branch/worktree:

- Branch: `<BRANCH>`
- Worktree: `<WORKTREE_PATH>`

Your job is to align code with the existing canonical docs for this lane. This
is not broad cleanup, not a redesign, and not a behavior-change project.
Preserve current behavior unless the lane explicitly requires a behavior
change.

Read these docs before editing:

- `docs/README.md`
- `<AREA_MIGRATION_PLAN>`
- `<CANONICAL_AREA_DOCS>`
- `<FOCUSED_DOCS_FOR_THIS_LANE>`

Canonical rule summary for this lane:

- `<RULE_1>`
- `<RULE_2>`
- `<RULE_3>`

Scope:

- In scope:
  - `<IN_SCOPE_ITEM_1>`
  - `<IN_SCOPE_ITEM_2>`
  - `<IN_SCOPE_ITEM_3>`
- Out of scope:
  - unrelated refactors
  - cosmetic churn
  - behavior changes not needed for doc alignment
  - changing generated code by hand
  - changing unrelated dirty worktree files

Implementation expectations:

- Use the canonical docs as the contract.
- Prefer the repo's existing patterns and direct imports.
- Keep changes narrow and ownership-correct.
- Delete replaced dead code; do not leave duplicate old and new paths.
- If a rule is ambiguous, make the smallest doc clarification needed in the
  same PR, or report the ambiguity if it would change the lane scope.
- Temporary migration exceptions are allowed only when removing the violation is
  unsafe in this PR. Each exception must name path, rule, owner/lane, reason,
  and target follow-up PR or branch.

Verification expectations:

- Run the most focused checks that cover the changed code.
- Run the area guardrail/boundary checks named by the migration plan when
  relevant.
- Record commands run and outcomes.
- If a check cannot run, explain why and what risk remains.

Before handing off:

- Summarize the files changed by ownership boundary.
- Summarize how the PR aligns with the named docs.
- List tests/checks run.
- List remaining exceptions or explicitly say there are none.
- Prepare the PR with a title and description that state the alignment lane,
  docs referenced, behavior-preservation notes, and verification.
```

## Reviewer Prompt Construction

For every completed implementation PR or branch:

- launch exactly two reviewer subagents by default
- give both reviewers the same docs and lane goals
- ask reviewers to critique, not broadly rewrite
- ask for findings with severity, path, line, impact, and requested fix
- ask reviewers to leave PR comments directly if tooling is available
- otherwise collect structured findings in the coordinator thread
- request `xhigh` reasoning effort when the subagent tool supports it

Reviewers should focus on:

- canonical doc alignment
- ownership boundary mistakes
- behavior regressions
- missing tests/checks
- new structure drift
- remaining migration exceptions

## Reviewer Prompt Template

```text
You are reviewing the `<LANE>` structure alignment PR for `<AREA>`.

PR/branch/worktree:

- PR: `<PR_URL_OR_BRANCH>`
- Branch: `<BRANCH>`
- Worktree: `<WORKTREE_PATH>`

Your job is to critique the PR for correctness, doc alignment, ownership, and
regression risk. You are not the implementer. Do not make broad code changes.
If you have GitHub PR comment tools, leave concise review comments directly on
the PR. If not, produce structured review findings with file paths and line
numbers so the coordinator can relay them.

Read these docs before reviewing:

- `docs/README.md`
- `<AREA_MIGRATION_PLAN>`
- `<CANONICAL_AREA_DOCS>`
- `<FOCUSED_DOCS_FOR_THIS_LANE>`

Review against these lane rules:

- `<RULE_1>`
- `<RULE_2>`
- `<RULE_3>`

Review checklist:

- Does the PR align code with the canonical docs?
- Did it preserve behavior unless explicitly scoped?
- Did it keep imports direct and avoid barrels or convenience re-exports?
- Did it move code to the correct owner rather than merely moving files?
- Did it avoid adding forbidden imports in disallowed layers?
- Did it avoid leaving duplicate old and new paths?
- Did it delete replaced dead code?
- Are remaining migration exceptions rare, named, owned, and justified?
- Are tests/checks appropriate for the touched behavior and ownership boundary?

Finding format:

- Lead with actionable findings only.
- Include severity:
  - P0: blocks merge, data loss/security/major breakage
  - P1: likely regression or clear doc-contract violation
  - P2: important maintainability/ownership issue
  - P3: minor issue or follow-up suggestion
- Include file path and exact line when possible.
- Explain the impact and the requested fix.
- Do not leave comments for subjective style preferences that are not tied to
  docs, behavior, tests, or maintainability.

Final review output:

- Findings, ordered by severity.
- Open questions, if any.
- Checks you ran or inspected.
- Short merge-readiness assessment.
```

## Fix-Up Loop

After reviewers finish:

- wake the original implementer
- include all P0, P1, and P2 findings
- include important P3 findings when they affect maintainability or future
  lanes
- require focused checks after fixes
- require a fix summary by finding

Codex should inspect the fix-up diff before declaring the PR ready.

## Implementer Fix-Up Prompt Template

```text
Continue the `<LANE>` structure alignment PR for `<AREA>`.

You previously implemented branch/worktree:

- Branch: `<BRANCH>`
- Worktree: `<WORKTREE_PATH>`
- PR: `<PR_URL_OR_BRANCH>`

Review feedback to address:

`<REVIEW_FINDINGS>`

Your job is to fix the PR while preserving the lane scope:

- Address every P0/P1/P2 finding or explain why a finding is intentionally not
  being changed.
- Keep the implementation aligned with the canonical docs and migration plan.
- Do not add unrelated cleanup.
- Preserve behavior unless the accepted review fix requires a scoped behavior
  change.
- Rerun focused checks after changes.

Before handing back:

- Summarize fixes made by finding.
- List checks run and outcomes.
- List remaining exceptions or unresolved review items.
- Update the PR description if scope, verification, or exceptions changed.
```

## Coordinator Final Pass

Before reporting a lane ready to squash merge, Codex should verify:

- the diff stays inside lane scope
- canonical docs referenced by the lane were followed
- no unrelated dirty files were touched
- replaced code paths were removed
- behavior is preserved or changes are explicitly scoped
- focused checks passed or failures are explained
- remaining exceptions are rare, named, and owned
- PR title and description describe the alignment lane and verification

## Reporting Format

For each lane, report:

- Area:
- Lane:
- Branch:
- Worktree:
- PR:
- Status:
- High-level changes:
- Reviewer findings:
- Fix-up status:
- Checks run:
- Remaining exceptions:
- Blockers:
- Ready to squash merge: yes/no

For a phase or multi-lane run, report:

- Area:
- Phase/run:
- Completed lanes:
- Open PRs:
- Merged PRs, if any:
- Remaining lanes:
- Cross-lane conflicts:
- Recommended next action:

## Moving Between Phases

Codex should not begin the next phase until:

- all required lanes in the current phase are ready to merge, merged, or
  explicitly deferred with owned exceptions
- downstream worktrees have been updated from the integration branch
- the guardrail report, if available, reflects the current reduced inventory

In interactive mode, Codex should pause at phase boundaries to report status,
blockers, PRs, and merge readiness before starting the next phase.

In unattended mode, Codex should leave the phase-boundary status in the thread
and continue into the next phase without waiting for confirmation when all
current-phase lanes are ready, merged, or explicitly deferred with owned
exceptions.

## Merge Handling

If the user asks Codex to merge:

- confirm the PR is ready under the coordinator final pass
- prefer squash merge for each lane PR
- update the integration branch before starting dependent lanes
- do not merge PRs with unresolved P0, P1, or P2 findings unless the user
  explicitly accepts the risk

If Codex cannot merge because tooling or permissions are unavailable, report
the ready PRs and exact merge order.

## Stop Conditions

Stop and report instead of continuing when:

- a subagent repeatedly hits the same blocker
- a lane requires a behavior decision outside the docs
- a phase has conflicting PRs touching the same hot files without an obvious
  order
- verification reveals a likely product regression
- the user asks to pause or redirect
