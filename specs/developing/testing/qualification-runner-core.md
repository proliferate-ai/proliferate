# Test Runner and Results Reporting

Status: frozen implementation contract for the first qualification-platform
slice. Revision: `Q1-frozen-2`. Audited base:
`2ec15eaf8cfc870cbdbb42c225a5f1428e5282b4`.

## Outcome

The release-test command runs the selected tests and truthfully reports what
happened:

```text
receive selected tests
→ check their declared requirements
→ run or plan them
→ record exactly one final result for every selected test
→ write one combined machine-readable report
→ exit using the status recorded in that report
```

This contract owns test selection, run identity, normalized results, the
combined report, and diagnostic/strict exit behavior. It does not provision
providers or worlds, build candidates, or add scenarios.

## Successor boundary

[`exact-test-matrix.md`](exact-test-matrix.md) preserves this contract's run
identity, terminal-state normalization, preflight, diagnostic/strict policy,
and report-derived exits while replacing the selected unit with exact child
test cells and advancing the combined report to V3. This document records the
frozen foundation as implemented; the successor document owns current
selected-cell and report shape.

## Vocabulary

A **selected test** is one current `ScenarioDefinition` expanded across one of
its declared runtime lanes:

```ts
interface SelectedTestV1 {
  test_id: `${string}/${"local" | "sandbox"}`;
  scenario_id: string;
  registry_flow_ref: string;
  runtime_lane: "local" | "sandbox";
}
```

`test_id = scenario_id/runtime_lane`.

This slice does not expose child results for agent, harness, model,
authentication route, configuration, target API lane, or Desktop mode. A
scenario that internally swallows one of those outcomes cannot claim that
child as covered; later scenario work owns that expansion.

## Current → target control flow

Current behavior:

```text
parse flags
→ select scenarios
→ best-effort local setup
→ run each scenario/runtime pair
→ separately count green, blocked, expected-fail, and failed outcomes
→ write JSON only for ordinary failures
→ exit nonzero only for ordinary failures
```

This permits blocked-only and expected-fail-only runs to exit `0` without a
complete record of what actually ran. Dry-run also does not call each
scenario's `plan()` method.

Target behavior:

```text
parse and validate invocation
→ resolve run identity
→ expand and deduplicate selected tests
→ initialize one pending result slot per selected test
→ preflight declared requirements
→ plan or execute according to behavior
→ normalize every outcome
→ synthesize any missing result as an integrity error
→ derive verdict and intended exit code
→ validate and atomically write one combined report
→ exit using the persisted verdict
```

## Run identity

```ts
interface RunIdentityV1 {
  run_id: string;
  shard_id: string;
  attempt: number;
  source_sha: string;
  origin: {
    kind: "local" | "github_actions";
    github_run_id: string | null;
    github_job: string | null;
  };
}
```

- IDs match `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`.
- GitHub Actions identity applies only when `GITHUB_ACTIONS === "true"`.
- GitHub defaults are `GITHUB_RUN_ID`, `GITHUB_JOB`,
  `GITHUB_RUN_ATTEMPT`, and `GITHUB_SHA`.
- The attempt is separate from `run_id`; retries preserve the logical run.
- Local defaults are `local-<timestamp>-<suffix>`, shard `local-0`, attempt
  `1`, and `git rev-parse HEAD`.
- Explicit run/shard/attempt overrides win without changing the recorded
  origin.
- Invalid or incomplete identity exits `2` before selection executes.

Every local invocation still has a shard so local and parallel CI reports have
the same shape.

## Preflight and execution

Preflight is limited to existing `requiredEnv` declarations and existing local
seed applicability. It does not contact or provision providers.

Diagnostic behavior:

```text
missing requirement → affected test blocked
satisfied independent test → execute
```

Strict behavior is fail-closed:

```text
if any selected test lacks a requirement:
  affected tests → blocked / missing_requirement
  otherwise-runnable tests → cancelled / strict_preflight_failed
  execute zero scenario bodies
  write selected_tests_failed report
  exit 1
```

Outside strict preflight, both behaviors continue independent sibling tests
after green, failed, blocked, or expected-fail outcomes.

Diagnostic dry-run calls every selected scenario's `plan()` and no scenario's
`run()`. A successful plan produces `not_run / dry_run`; a planning exception
produces `not_run / plan_error`, records a runner error, continues sibling
planning where possible, and exits `2`. Strict dry-run is invalid.

## Final test results

`pending` is internal and never serialized. Every selected test ends in
exactly one state:

```ts
type FinalTestStatus =
  | "green"
  | "failed"
  | "blocked"
  | "expected_fail"
  | "cancelled"
  | "not_run"
  | "missing";
```

| State | Meaning |
| --- | --- |
| `green` | The real test completed and passed its assertions. |
| `failed` | The real test found a product, assertion, or runtime failure. |
| `blocked` | A known requirement prevented a meaningful assertion. |
| `expected_fail` | The test reached an explicitly diagnosed known product gap. |
| `cancelled` | Execution was requested, but a run-level condition prevented the test from running. |
| `not_run` | Diagnostic dry-run planned rather than executed the test. |
| `missing` | Finalization found no result for a selected test; runner-integrity failure. |

The first accepted final result wins. Duplicate finalization preserves the
first result, records an integrity error, and exits `2`.

## Diagnostic and strict verdicts

Diagnostic is for local investigation. Its report always says
`non_qualifying`; exit `0` means the diagnostic sweep completed within its
tolerated policy, not that the product qualified.

Strict is a future gate input. It requires every selected real test to be
green. This slice lacks candidate-build identity, world readiness, cleanup
proof, and full scenario coverage, so a green strict run says only
`selected_tests_passed` with `completeness = partial`.

| Result set or runner condition | Diagnostic | Strict |
| --- | --- | --- |
| Every selected real test green | Exit `0`; `non_qualifying` | Exit `0`; `selected_tests_passed` |
| Blocked only | Exit `0`; `non_qualifying` | Exit `1`; `selected_tests_failed` |
| Expected-fail only | Exit `0`; `non_qualifying` | Exit `1`; `selected_tests_failed` |
| Any failed | Exit `1`; `non_qualifying` | Exit `1`; `selected_tests_failed` |
| Any cancelled or missing | Exit `1`; `non_qualifying` | Exit `1`; `selected_tests_failed` |
| Successful diagnostic dry-run | Exit `0`; every test `not_run` | Invalid; exit `2` |
| Planning, runner, or integrity error | Exit `2`; `non_qualifying` if persisted | Exit `2`; failed if persisted |
| Invalid invocation, identity, or selection | Exit `2`; no selected-set report | Same |
| Combined report cannot be validated/written | Exit `2`; no persisted report | Same |

Exit precedence is:

```text
invalid invocation or identity before a valid selected set → 2
report validation/write, runner, or integrity error → 2
otherwise diagnostic/strict result policy → 0 or 1
```

Custom graceful signal handling is deferred.

## Command-line contract

Existing flags remain:

```text
--lane <local|staging>
--desktop <web|native>
--agents <list|all>
--scenarios <list|all>
--only <id-or-list>
--dry-run
--file-issues
--output-dir <path>
--help
```

Add:

```text
--behavior <diagnostic|strict>  required for direct command use
--run-id <safe-id>              optional override
--shard-id <safe-id>            optional override
--attempt <positive-integer>    optional override
```

`make release-e2e` passes `--behavior` explicitly and defaults
`BEHAVIOR ?= diagnostic`. No workflow YAML changes in this slice.

Reject empty lists, duplicate selections, unknown scenarios, mixed `all` plus
named values, and strict dry-run. `--help` exits `0` without identity or a
report.

Issue filing remains auxiliary and behavior-compatible. It consumes a view
derived only from normalized `failed` results after the combined test report;
this slice does not redesign issue filing or its failure semantics.

## Combined report

Write one artifact per invocation/shard/attempt:

```text
<output-dir>/<run-id>/<shard-id>/attempt-<n>/qualification-evidence.json
```

```ts
interface TestRunReportV1 {
  schema_version: 1;
  kind: "proliferate.test-run";
  run: RunIdentityV1 & {
    behavior: "diagnostic" | "strict";
    execution: "real" | "dry_run";
    started_at: string;
    finished_at: string;
  };
  inputs: {
    target_lane: "local" | "staging";
    desktop: "web" | "native";
    agents: string[] | "all";
    scenarios: string[] | "all";
  };
  selected_tests: SelectedTestV1[];
  results: Array<{
    test_id: string;
    scenario_id: string;
    registry_flow_ref: string;
    runtime_lane: "local" | "sandbox";
    status: FinalTestStatus;
    started_at: string | null;
    finished_at: string;
    duration_ms: number | null;
    reason: { code: string; message: string } | null;
    plan_steps: string[];
  }>;
  summary: {
    selected: number;
    finalized: number;
    by_status: Record<FinalTestStatus, number>;
    integrity_errors: Array<{ code: string; message: string }>;
    runner_errors: Array<{ code: string; message: string }>;
    intended_exit_code: 0 | 1 | 2;
  };
  verdict: {
    status:
      | "selected_tests_passed"
      | "selected_tests_failed"
      | "non_qualifying";
    scope: "selected_tests";
    completeness: "partial";
    reasons: string[];
  };
}
```

The report guarantees:

- selected and result test IDs are unique and exactly equal;
- `selected === finalized === results.length`;
- `by_status` contains all seven keys and exactly counts the results;
- verdict and intended exit match behavior, results, and errors;
- the write is atomic and refuses to overwrite an existing attempt;
- exact resolved secret values are replaced with `[REDACTED]`;
- messages are bounded to 4,096 Unicode code points;
- raw stacks and provider payloads are not serialized;
- no candidate, provider, world, cleanup, or correlation evidence is invented.

Per-failure JSON files disappear. Existing `FailureReport` construction may
remain only as an in-memory compatibility mapping from normalized `failed`
results to issue filing.

## Failure behavior

- Invalid command, selection, or identity runs no tests and exits `2`.
- Diagnostic missing requirements block affected tests and continue satisfied
  siblings.
- Strict missing requirements execute no test bodies and exit `1` with a
  complete failed selected-set report.
- Product/test failures become `failed` and do not stop independent siblings.
- Known gaps become `expected_fail`; only diagnostic tolerates them.
- Missing results are synthesized as `missing`, record an integrity error, and
  exit `2`.
- Duplicate finalization preserves the first result, records an integrity
  error, and exits `2`.
- Report validation or write failure exits `2`; no success may be claimed
  without a persisted report.

## Ownership and file plan

```text
Makefile                                      modify
tests/release/src/
  cli/
    args.ts                                   modify
    args.test.ts                              add
    run.ts                                    thin process adapter
  runner/
    identity.ts                               add
    identity.test.ts                          add
    result.ts                                 add
    result.test.ts                            add
    execute.ts                                add
    execute.test.ts                           add
  evidence/
    schema.ts                                 add
    write.ts                                  add
    write.test.ts                             add
  scenarios/
    types.ts                                  comments/contracts only
  report/
    types.ts                                  modify
    failure-reporter.ts                       failed-result mapping only
    failure-reporter.test.ts                  modify
    issue-filer.ts                            unchanged
```

No workflow YAML or scenario implementation changes.

## Acceptance proof

Focused tests prove:

- explicit/omitted behavior, preserved flags, help, list validation, strict
  dry-run rejection, and identity overrides;
- GitHub/local identity, stable logical run across retries/shards, safe IDs,
  source SHA, and non-overwriting attempt paths;
- unique scenario/runtime expansion and invalid selection rejection;
- normal return, blocked, expected-fail, ordinary error, and non-Error throw
  normalization;
- diagnostic continuation and strict zero-execution preflight;
- dry-run calls every `plan()` and no `run()`;
- missing and duplicate result integrity behavior;
- every diagnostic/strict matrix row and exit code;
- one valid aggregate for every representable result/error state;
- exact selected/result equality, counters, verdict, exit code, redaction,
  bounds, atomic write, and overwrite refusal;
- failed results still derive issue-filing compatibility payloads;
- the existing release-runner suite and typecheck remain green.

Required local proof:

```bash
pnpm -C tests/release test
pnpm -C tests/release typecheck
```

No live provider, model, sandbox, EC2 instance, Stripe event, packaged Desktop,
or candidate artifact is required.

## Non-goals

- Provider provisioning, Terraform, or persistent test services.
- Candidate or retained-production builders and receipts.
- Local-runtime, managed-cloud, or self-hosted world startup/readiness.
- Cleanup tracking.
- Scenario or guarantee expansion and per-harness child results.
- GitHub Actions redesign or removal of workflow `continue-on-error`.
- Production-promotion evidence consumption.
- Issue-tracker redesign.
- Custom graceful signal handling.
- Product bug fixes found by later scenarios.
