# Define the Exact Test Matrix and Verify Every Result

- Status: **frozen**
- Revision: **ETM1-frozen-1**
- Repository: `proliferate-ai/proliferate`
- Base SHA: `aafad3ff2456ff0945ab0b61d5f58a883f6a48aa`
- Founder authorized: 2026-07-14
- Pipeline stage: **specification frozen; implementation not started**

## Outcome

Extend the existing release runner so every independently judged test is
selected and reported separately, even when one scenario shares setup across
several tests.

```text
select scenarios
→ deterministically list their exact test cells
→ validate the candidate build
→ perform setup
→ let each scenario batch its related cells
→ require one explicit result per planned cell
→ write one report
→ reject any missing, duplicate, or unplanned result
```

This slice does not create servers, sandboxes, EC2 instances, provider
clients, fixtures, or complete product journeys. It makes the existing runner
capable of representing those journeys truthfully when later slices add them.

## Concrete defect

The current runner selects one broad test for each `scenario × runtime lane`:

```text
T3-CHAT-1/local
```

That scenario internally loops over five harnesses. It can log that Codex
failed, observe that Claude passed, return normally, and leave the broad test
green. The combined report then has no separate Codex result.

Target:

```text
T3-CHAT-1/local/harness=claude
T3-CHAT-1/local/harness=codex
T3-CHAT-1/local/harness=cursor
T3-CHAT-1/local/harness=grok
T3-CHAT-1/local/harness=opencode
```

The scenario may still create one workspace and reuse shared setup. It must
return a result for every assigned harness. One green harness cannot hide a
failed, blocked, or omitted harness.

`T3-CHAT-1` remains a legacy diagnostic scenario in this slice. Making its
per-harness reporting honest does not claim that canonical `LOCAL-2` is
implemented or that any target-manifest row is collected.

## Existing foundations

[`qualification-runner-core.md`](qualification-runner-core.md) provides:

- diagnostic and strict behavior;
- run, shard, attempt, and source identity;
- result normalization;
- strict fail-closed preflight;
- missing/duplicate detection;
- one sanitized combined report; and
- report-derived exit codes.

[`candidate-build-handoff.md`](candidate-build-handoff.md) provides:

- exact candidate build-map validation before setup;
- bounded candidate artifact evidence;
- exact AnyHarness materialization/launch/health proof; and
- the CI job that runs release-runner tests, typechecking, and the real
  AnyHarness handoff smoke.

This slice changes the selected unit from a broad scenario invocation to an
exact child test cell. It extends the existing `ResultTracker` and
`validateReport()`; it does not build a second aggregation system.

## Current to target flow

Current:

```text
parse arguments
→ create run identity
→ select scenarios
→ validate candidate build map
→ perform local-user/gateway setup
→ expand one broad test per scenario/runtime lane
→ execute each broad scenario
→ write report V2
```

Target:

```text
parse arguments
→ create run identity
→ select scenarios
→ validate candidate build map
→ deterministically expand and validate every selected test cell
→ only then perform local-user/gateway setup
→ preflight the exact cells
→ group runnable cells by scenario/runtime lane
→ invoke each collector once with its assigned cells
→ record every returned child result
→ synthesize omitted cells as missing
→ derive the existing diagnostic/strict verdict
→ validate and write report V3
```

Invalid or empty cell expansion exits `2`, writes no report, and runs no user,
gateway, provider, fixture, or scenario setup.

## Test-cell contract

The selected-cell array is the complete test plan for this invocation. A
separate plan file or plan hash is deferred until a real cross-job or
promotion consumer exists.

```ts
interface PlannedCellV1 {
  cell_id: string;
  scenario_id: string;
  registry_flow_ref: string;
  runtime_lane: RuntimeLane;
  dimensions: Record<string, string>;
  required_env: string[];
}

interface ScenarioCellSpec {
  dimensions: Record<string, string>;
  requiredEnv?: readonly string[];
}

interface ScenarioCellOutcome {
  cellId: string;
  status: "green" | "failed" | "blocked" | "expected_fail";
  reason?: ResultReason;
}
```

Runner-only terminal states remain `cancelled`, `not_run`, and `missing`.
Scenario code cannot self-declare those states.

### Scenario definitions

Existing one-cell scenarios remain source-compatible:

```ts
interface LeafScenarioDefinition extends ScenarioBase {
  kind?: "leaf";
  plan(ctx: ScenarioPlanContext): ScenarioPlanStep[];
  run(ctx: ScenarioRunContext): Promise<void>;
}
```

A matrix scenario explicitly declares and reports its child cells:

```ts
interface MatrixScenarioDefinition extends ScenarioBase {
  kind: "matrix";
  expandCells(
    ctx: ScenarioPlanContext,
  ): ScenarioCellSpec[] | Promise<ScenarioCellSpec[]>;
  planCell(
    ctx: ScenarioPlanContext,
    cell: PlannedCellV1,
  ): ScenarioPlanStep[];
  runCells(
    ctx: ScenarioRunContext,
    cells: readonly PlannedCellV1[],
  ): Promise<ScenarioCellOutcome[]>;
}

type ScenarioDefinition = LeafScenarioDefinition | MatrixScenarioDefinition;
```

The runner invokes `runCells()` once per selected scenario/runtime lane, not
once per child. This preserves efficient shared setup.

## Cell identity

The runner, not scenario code, creates cell IDs.

- Existing leaf cell: `T3-BILL-1/local`
- Matrix cell: `T3-CHAT-1/local/harness=claude`
- Dimension keys are sorted lexicographically.
- Keys are bounded stable identifiers; values are non-empty and safely
  encoded.
- Empty, duplicate, or invalid expansions fail before setup.
- The final selected-cell list is sorted by `cell_id`.
- Runtime-discovered values such as the exact probed model are execution
  evidence, not cell dimensions, unless a later product contract makes them
  independently required claims.

Leaf IDs remain unchanged so existing scenarios and issue references do not
move unnecessarily.

## Execution and failure behavior

- A leaf scenario keeps its current `run(): Promise<void>` behavior.
- A matrix collector must return exactly one outcome for every assigned cell.
- Mixed outcomes stay mixed; returning normally never turns all children
  green.
- An unknown or duplicate returned `cellId` is an integrity error.
- An omitted cell is synthesized as `missing`, records an integrity error,
  rejects the aggregate, and exits `2`.
- If a collector throws before returning, its normalized thrown outcome is
  applied to every runnable cell assigned to that invocation.
- Independent scenario/runtime collectors continue after one collector fails.
- `--dry-run` emits one `not_run` result and plan steps per exact cell.
- Strict preflight with any missing requirement executes zero collector
  bodies: affected cells are `blocked`, otherwise-runnable cells are
  `cancelled`, and the command exits nonzero.
- Diagnostic preflight blocks only affected cells and continues independent
  runnable cells.

| Situation | Diagnostic | Strict |
| --- | --- | --- |
| Every exact cell green | exit `0`, non-qualifying | exit `0`, selected cells passed |
| Only blocked / expected-fail / dry-run cells | exit `0`, non-qualifying | exit `1` |
| One ordinary failed or cancelled cell | exit `1`, non-qualifying | exit `1` |
| Missing, duplicate, unknown result or runner defect | exit `2`, non-qualifying | exit `2` |

The report remains explicitly partial. Passing selected cells is not a claim
that all Tier 3 or Tier 4 guarantees are implemented.

## Combined report V3

The semantic result unit changes, so the report schema advances rather than
silently changing V2:

```ts
interface TestRunReportV3 {
  schema_version: 3;
  kind: "proliferate.test-run";
  candidate_build: CandidateBuildEvidenceV1 | null;
  run: ExistingRunIdentityAndModeFields;
  inputs: ExistingCliInputFields;
  selected_cells: PlannedCellV1[];
  results: FinalCellResultV1[];
  summary: ExistingSummaryFields;
  verdict: {
    status:
      | "selected_cells_passed"
      | "selected_cells_failed"
      | "non_qualifying";
    scope: "selected_cells";
    completeness: "partial";
    reasons: string[];
  };
}
```

`FinalCellResultV1` repeats the planned cell's identity and dimensions plus the
existing timestamps, status, reason, and plan steps.

`validateReport()` remains the aggregate verifier. It must:

- reject duplicate selected cell IDs;
- require exact selected-cell/result ID equality;
- require every result's scenario, lane, reference, and dimensions to match
  its selected cell;
- require summary counts to match the result array;
- preserve candidate-evidence validation and redaction;
- recompute the verdict and intended exit code; and
- reject V3 shape tampering.

Current execution emits only V3. Repository history retains V1 and V2; no
parallel old/new execution path remains.

## First real matrix consumer

Convert only `T3-CHAT-1` in this slice.

- `--agents all` derives the five shipped harness kinds from
  `catalogs/agents/catalog.json`, not a second hand-written list.
- Explicit `--agents` selection produces one cell per selected harness.
- The same expansion applies independently to local and sandbox runtime lanes.
- Live probing may choose the cheapest usable model, but cannot remove a
  planned harness.
- No compatible model becomes an explicit `blocked` child.
- A real turn/install/reopen failure becomes an explicit `failed` child.
- The existing sandbox implementation gap becomes explicit non-green child
  results rather than one green parent.
- Existing shared workspace setup and cleanup remain batched.
- No managed-gateway, BYOK, billing, host-parity, or configuration dimension
  is claimed in this slice.
- No canonical target-manifest row changes from `planned`.

The exact AnyHarness candidate-handoff smoke remains separate from the product
scenario registry. It is the required real regression proof that report V3
did not break the merged build handoff.

## Non-goals

- Candidate builders beyond the merged AnyHarness handoff.
- LiteLLM, GitHub, E2B, Stripe, AWS, DNS, ingress, or download setup.
- Local-workspace, managed-cloud, self-host, or update-world construction.
- Shared product fixtures or new product test journeys.
- Named release policies/selectors or target-manifest status promotion.
- Bidirectional manifest/collector coverage auditing.
- World, host, service, artifact, isolation, readiness, or cleanup fields on
  cells.
- A separate plan artifact, plan digest, or aggregate-verifier subsystem.
- Cross-shard aggregation, retry/attempt selection, CI attestation, or
  production-promotion trust.
- New CLI flags or GitHub Actions workflow design.
- Migrating every existing scenario to a matrix.

## File plan

```text
tests/release/src/
  runner/
    plan.ts                         add exact-cell expansion/validation
    plan.test.ts                    add
    result.ts                       selected cell/result types + tracker
    result.test.ts                  exact child integrity cases
    execute.ts                      consume prebuilt cells; batch collectors
    execute.test.ts                 matrix + strict/diagnostic behavior
  scenarios/
    types.ts                        leaf/matrix discriminated contract
    t3-chat-1.ts                    first real matrix consumer
    t3-chat-1.test.ts               catalog expansion + honest outcomes
  cli/
    command.ts                      create cells before setup; pass to runner
    command.test.ts                 zero-side-effect planning failures
  evidence/
    schema.ts                       replace current report output with V3
    write.ts                        V3 type update
    write.test.ts                   V3 validation/write tests
  report/
    failure-reporter.ts             use exact cell identity
    failure-reporter.test.ts        update
  artifacts/
    anyharness-smoke.ts             consume/assert report V3 only
    anyharness-smoke.test.ts        update

specs/developing/testing/
  exact-test-matrix.md              this contract
  qualification-runner-core.md      record successor/report terminology
  candidate-build-handoff.md        record report V3 successor
  README.md                         link this contract
```

Delete `expandSelectedTests()` when the exact-cell planner replaces it. Do not
leave two planning paths. No workflow file should change: the existing
Candidate build handoff CI job already runs the relevant test, typecheck, and
real smoke commands.

## Acceptance tests

- Leaf scenarios retain one unchanged `scenario/lane` cell.
- Matrix cell IDs and ordering are deterministic regardless of declaration or
  selector order.
- Invalid, empty, or duplicate expansion exits `2` before setup and writes no
  report.
- A fake three-cell collector returning green/failed/green preserves all three
  outcomes and strict exits `1`.
- Missing, duplicate, and unknown child outcomes force integrity exit `2`.
- A one-child matrix still must return one explicit child outcome.
- A collector-level throw finalizes all assigned runnable cells honestly.
- Diagnostic and strict cell-level preflight retain the merged behavior.
- Dry-run lists and reports every exact cell without executing collectors.
- Report V3 rejects any selected/result identity or dimension mismatch and
  recomputes verdict/exit.
- `T3-CHAT-1 --agents all` plans every catalog harness exactly once per lane.
- One failed or omitted T3 chat harness cannot be hidden by another green
  harness.
- Existing redaction, issue-filing, candidate-map, and runner tests remain
  green.
- The real candidate AnyHarness handoff still launches the exact binary and
  produces valid V3 evidence.

Required proof:

```bash
pnpm -C tests/release test
pnpm -C tests/release typecheck
node --test scripts/ci-cd/assemble-candidate-build-map.test.mjs
make qualification-candidate-handoff-smoke
```

No live provider credential is required.
