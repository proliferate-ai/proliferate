import type { EnvResolution } from "../config/env-resolution.js";
import { blockedReasonForMissingEnv, missingRequiredForLane, resolveEnv } from "../config/env-resolution.js";
import { envVarNames } from "../config/env-manifest.js";
import type { DesktopMode, TargetLane } from "../config/types.js";
import type { ScenarioDefinition } from "../scenarios/types.js";
import { ScenarioBlockedError, ScenarioExpectedFailError } from "../scenarios/types.js";
import type { TestRunReportV1 } from "../evidence/schema.js";
import { sanitizeReport } from "../evidence/schema.js";
import type { RunIdentityV1 } from "./identity.js";
import {
  countByStatus,
  deriveVerdict,
  ResultTracker,
  type FinalTestResultV1,
  type ResultBehavior,
  type SelectedTestV1,
} from "./result.js";

export class SelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SelectionError";
  }
}

/**
 * Expands scenarios across their declared runtime lanes into selected tests
 * (`test_id = scenario_id/runtime_lane`) and rejects duplicate expanded ids,
 * so a duplicate cell can never execute or record twice.
 */
export function expandSelectedTests(scenarios: readonly ScenarioDefinition[]): SelectedTestV1[] {
  const selected: SelectedTestV1[] = [];
  const seen = new Set<string>();
  const seenScenarioIds = new Set<string>();
  for (const scenario of scenarios) {
    // Duplicate scenario ids are rejected outright (not only duplicate
    // expanded test ids): later lookup is by scenario id, so two definitions
    // sharing an id — even with disjoint lanes — could execute one body
    // while reporting the other's metadata.
    if (seenScenarioIds.has(scenario.id)) {
      throw new SelectionError(`Duplicate scenario id "${scenario.id}" in the selection.`);
    }
    seenScenarioIds.add(scenario.id);
    for (const runtimeLane of scenario.lanes) {
      const testId = `${scenario.id}/${runtimeLane}`;
      if (seen.has(testId)) {
        throw new SelectionError(`Duplicate expanded test id "${testId}".`);
      }
      seen.add(testId);
      selected.push({
        test_id: testId,
        scenario_id: scenario.id,
        registry_flow_ref: scenario.registryFlowRef,
        runtime_lane: runtimeLane,
      });
    }
  }
  if (selected.length === 0) {
    throw new SelectionError("Selection expanded to zero tests.");
  }
  return selected;
}

export interface ExecuteInputs {
  targetLane: TargetLane;
  desktop: DesktopMode;
  agents: string[] | "all";
  scenarios: string[] | "all";
}

export interface ExecuteOptions {
  behavior: ResultBehavior;
  execution: "real" | "dry_run";
  identity: RunIdentityV1;
  inputs: ExecuteInputs;
  scenarios: readonly ScenarioDefinition[];
  /** Names satisfied only by this run's local durable-user seeding. */
  locallySeeded?: ReadonlySet<string>;
  /** Injectable for tests; defaults to resolveEnv over the union of requiredEnv. */
  resolveNeededEnv?: (names: readonly string[]) => EnvResolution;
  /**
   * Injectable for tests; defaults to every present secret value in the full
   * env manifest — not only the selected scenarios' requiredEnv — so a secret
   * a fixture uses opportunistically is still redacted from evidence.
   */
  resolveSecretValues?: () => string[];
  now?: () => Date;
  log?: (message: string) => void;
}

/**
 * Runs the required control flow: initialize one pending slot per selected
 * test, preflight declared requirements, plan or execute per behavior,
 * normalize every outcome, synthesize missing results, and derive the
 * verdict/intended exit — returning an unwritten, sanitized combined report.
 */
export async function executeSelectedTests(options: ExecuteOptions): Promise<TestRunReportV1> {
  const now = options.now ?? (() => new Date());
  const log = options.log ?? (() => undefined);
  const startedAt = now().toISOString();
  const selected = expandSelectedTests(options.scenarios);
  const tracker = new ResultTracker(selected);
  const scenariosById = new Map(options.scenarios.map((scenario) => [scenario.id, scenario]));
  const locallySeeded = options.locallySeeded ?? new Set<string>();

  // Once a valid selected set exists, a recoverable runner defect (e.g. a
  // scenario referencing an undeclared env var) must not lose the selected
  // results: it becomes a runner error, pending tests finalize as missing,
  // and the report is still produced for persistence.
  try {
    const neededEnvNames = [...new Set(options.scenarios.flatMap((scenario) => scenario.requiredEnv))];
    const resolveNeeded = options.resolveNeededEnv ?? ((names: readonly string[]) => resolveEnv(names));
    const neededEnv = resolveNeeded(neededEnvNames);

    if (options.execution === "dry_run") {
      await planAll(selected, scenariosById, tracker, options, now);
    } else {
      await runAll(selected, scenariosById, tracker, options, neededEnv, locallySeeded, now, log);
    }
  } catch (error) {
    tracker.recordRunnerError("runner_error", `Runner failed after selection: ${evidenceSafeMessage(error)}`);
  }

  const results = tracker.finalizeRun(options.execution);

  const verdict = deriveVerdict({
    behavior: options.behavior,
    results,
    integrityErrors: tracker.integrityErrors,
    runnerErrors: tracker.runnerErrors,
  });

  const report: TestRunReportV1 = {
    schema_version: 1,
    kind: "proliferate.test-run",
    run: {
      ...options.identity,
      behavior: options.behavior,
      execution: options.execution,
      started_at: startedAt,
      finished_at: now().toISOString(),
    },
    inputs: {
      target_lane: options.inputs.targetLane,
      desktop: options.inputs.desktop,
      agents: options.inputs.agents,
      scenarios: options.inputs.scenarios,
    },
    selected_tests: [...selected],
    results,
    summary: {
      selected: selected.length,
      finalized: results.length,
      by_status: countByStatus(results),
      integrity_errors: [...tracker.integrityErrors],
      runner_errors: [...tracker.runnerErrors],
      intended_exit_code: verdict.intendedExitCode,
    },
    verdict: {
      status: verdict.status,
      scope: "selected_tests",
      completeness: "partial",
      reasons: verdict.reasons,
    },
  };

  const resolveSecrets = options.resolveSecretValues ?? defaultResolveSecretValues;
  return sanitizeReport(report, resolveSecrets());
}

/**
 * Normalizes a thrown value into an evidence-safe message. Known
 * payload-carrying errors (the ApiRequestError/LocalRuntimeError shape: a
 * numeric `status` plus a captured `body`) are summarized without their
 * response body — existing clients embed complete provider/HTTP payloads in
 * `Error.message`, which must never reach the report or issue payloads. The
 * raw error still exists in process memory for console diagnostics only.
 * URL-credential scrubbing and exact-secret redaction then apply to every
 * report message in `sanitizeReport`.
 */
function evidenceSafeMessage(error: unknown): string {
  const status = error instanceof Error ? (error as { status?: unknown }).status : undefined;
  if (error instanceof Error && typeof status === "number" && "body" in error) {
    // Message shape is `${method} ${path} -> ${status}: ${body}`; keep the
    // safe prefix, withhold everything after it.
    const prefix = /^(.*?->\s*\d+)/.exec(error.message)?.[1] ?? `request failed with status ${status}`;
    return `${error.name}: ${prefix} (response body withheld from evidence)`;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Every present secret value in the full env manifest — not only the selected
 * scenarios' requiredEnv — because fixtures may use a secret opportunistically
 * (e.g. an optional GitHub token embedded in a clone URL) without declaring it.
 */
function defaultResolveSecretValues(): string[] {
  return resolveEnv(envVarNames())
    .all.filter((entry) => entry.spec.secret && entry.value !== undefined)
    .map((entry) => entry.value as string);
}

async function planAll(
  selected: readonly SelectedTestV1[],
  scenariosById: ReadonlyMap<string, ScenarioDefinition>,
  tracker: ResultTracker,
  options: ExecuteOptions,
  now: () => Date,
): Promise<void> {
  const agents = options.inputs.agents === "all" ? ["all"] : options.inputs.agents;
  for (const test of selected) {
    const scenario = scenariosById.get(test.scenario_id)!;
    try {
      const steps = scenario.plan({
        runtimeLane: test.runtime_lane,
        desktop: options.inputs.desktop,
        agents,
      });
      tracker.finalize(test.test_id, {
        status: "not_run",
        reason: { code: "dry_run", message: "Diagnostic dry-run planned this test instead of executing it." },
        planSteps: steps.map((step) => step.description),
        finishedAt: now().toISOString(),
      });
    } catch (error) {
      const message = evidenceSafeMessage(error);
      tracker.finalize(test.test_id, {
        status: "not_run",
        reason: { code: "plan_error", message: `plan() threw: ${message}` },
        finishedAt: now().toISOString(),
      });
      tracker.recordRunnerError("runner_error", `plan() for "${test.test_id}" threw: ${message}`);
    }
  }
}

async function runAll(
  selected: readonly SelectedTestV1[],
  scenariosById: ReadonlyMap<string, ScenarioDefinition>,
  tracker: ResultTracker,
  options: ExecuteOptions,
  neededEnv: EnvResolution,
  locallySeeded: ReadonlySet<string>,
  now: () => Date,
  log: (message: string) => void,
): Promise<void> {
  const missingByTest = new Map<string, string[]>();
  for (const test of selected) {
    const scenario = scenariosById.get(test.scenario_id)!;
    const missing = missingRequiredForLane(scenario.requiredEnv, test.runtime_lane, neededEnv, locallySeeded);
    if (missing.length > 0) {
      missingByTest.set(test.test_id, missing);
    }
  }

  // Strict preflight is fail-closed: any unsatisfied selected requirement
  // means zero scenario bodies execute.
  if (options.behavior === "strict" && missingByTest.size > 0) {
    for (const test of selected) {
      const missing = missingByTest.get(test.test_id);
      if (missing) {
        tracker.finalize(test.test_id, {
          status: "blocked",
          reason: {
            code: "missing_requirement",
            message: blockedReasonForMissingEnv(test.scenario_id, test.runtime_lane, missing, locallySeeded),
          },
          finishedAt: now().toISOString(),
        });
      } else {
        tracker.finalize(test.test_id, {
          status: "cancelled",
          reason: {
            code: "strict_preflight_failed",
            message: "Strict preflight found unsatisfied requirements on sibling tests; no test body ran.",
          },
          finishedAt: now().toISOString(),
        });
      }
    }
    return;
  }

  const agents = options.inputs.agents === "all" ? ["all"] : options.inputs.agents;
  for (const test of selected) {
    const scenario = scenariosById.get(test.scenario_id)!;
    const missing = missingByTest.get(test.test_id);
    if (missing) {
      tracker.finalize(test.test_id, {
        status: "blocked",
        reason: {
          code: "missing_requirement",
          message: blockedReasonForMissingEnv(test.scenario_id, test.runtime_lane, missing, locallySeeded),
        },
        finishedAt: now().toISOString(),
      });
      continue;
    }
    const startedAt = now().toISOString();
    const startedMs = now().getTime();
    const finish = (status: "green" | "failed" | "blocked" | "expected_fail", reason: FinalTestResultV1["reason"]) =>
      tracker.finalize(test.test_id, {
        status,
        reason: reason ?? undefined,
        startedAt,
        finishedAt: now().toISOString(),
        durationMs: now().getTime() - startedMs,
      });
    try {
      log(`running ${test.test_id}`);
      await scenario.run({
        targetLane: options.inputs.targetLane,
        runtimeLane: test.runtime_lane,
        desktop: options.inputs.desktop,
        agents,
        dryRun: false,
        env: neededEnv,
      });
      finish("green", null);
    } catch (error) {
      if (error instanceof ScenarioBlockedError) {
        finish("blocked", { code: "scenario_blocked", message: error.reason });
      } else if (error instanceof ScenarioExpectedFailError) {
        finish("expected_fail", { code: "known_gap", message: error.diagnosis });
      } else {
        // The report stores the normalized message, never the raw stack
        // (spec: "raw stacks and provider payloads are not serialized");
        // the stack still reaches the console via the runner's own logging.
        finish("failed", {
          code: "scenario_failure",
          message: evidenceSafeMessage(error),
        });
        log(
          `failed ${test.test_id}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
        );
      }
    }
  }
}
