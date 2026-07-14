import type { EnvResolution } from "../config/env-resolution.js";
import { blockedReasonForMissingEnv, missingRequiredForLane, resolveEnv } from "../config/env-resolution.js";
import { envVarNames } from "../config/env-manifest.js";
import type { DesktopMode, TargetLane } from "../config/types.js";
import {
  isMatrixScenario,
  ScenarioBlockedError,
  ScenarioExpectedFailError,
  type MatrixScenarioDefinition,
  type ScenarioDefinition,
} from "../scenarios/types.js";
import type { CandidateBuildEvidenceV1 } from "../artifacts/build-map.js";
import type { TestRunReportV3 } from "../evidence/schema.js";
import { expectedVerdict, sanitizeReport } from "../evidence/schema.js";
import type { RunIdentityV1 } from "./identity.js";
import {
  clonePlannedCell,
  countByStatus,
  deriveVerdict,
  RESULT_REASON_CODES,
  ResultTracker,
  SCENARIO_DECLARABLE_STATUSES,
  type FinalCellResultV1,
  type PlannedCellV1,
  type ResultBehavior,
  type ResultReason,
  type ResultReasonCode,
  type ScenarioDeclarableStatus,
} from "./result.js";

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
  /**
   * The complete exact test plan, prebuilt and validated by runner/plan.ts
   * before any setup side effect (cli/command.ts owns the ordering).
   * Execution never re-expands or reorders cells.
   */
  cells: readonly PlannedCellV1[];
  /**
   * Bounded artifact identity from the validated candidate build map;
   * explicit null when a diagnostic run omitted the map. The caller
   * (cli/command.ts) owns loading and validation before any setup.
   */
  candidateBuild?: CandidateBuildEvidenceV1 | null;
  /** Names satisfied only by this run's local durable-user seeding. */
  locallySeeded?: ReadonlySet<string>;
  /** Injectable for tests; defaults to resolveEnv over the union of required env. */
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
 * Runs the required control flow: one pending slot per planned cell,
 * per-cell requirement preflight, plan or execute per behavior with matrix
 * collectors invoked once per scenario/runtime lane, one explicit outcome per
 * assigned cell, missing synthesis, and the diagnostic/strict verdict —
 * returning an unwritten, sanitized combined report V3.
 */
export async function executeSelectedCells(options: ExecuteOptions): Promise<TestRunReportV3> {
  const now = options.now ?? (() => new Date());
  const log = options.log ?? (() => undefined);
  const startedAt = now().toISOString();
  // The tracker deep-copies the plan at construction; everything below —
  // grouping, collector assignment, finalization, and the persisted
  // selected_cells — reads the tracker's protected canonical copy, so a
  // collector mutating the cell objects it received cannot alter evidence.
  const tracker = new ResultTracker(options.cells);
  const cells = tracker.selectedCells;
  const scenariosById = new Map(options.scenarios.map((scenario) => [scenario.id, scenario]));
  const locallySeeded = options.locallySeeded ?? new Set<string>();

  // Once a valid planned set exists, a recoverable runner defect (e.g. a
  // scenario referencing an undeclared env var) must not lose the planned
  // results: it becomes a runner error, pending cells finalize as missing,
  // and the report is still produced for persistence.
  try {
    const neededEnvNames = [...new Set(cells.flatMap((cell) => cell.required_env))];
    const resolveNeeded = options.resolveNeededEnv ?? ((names: readonly string[]) => resolveEnv(names));
    const neededEnv = resolveNeeded(neededEnvNames);

    if (options.execution === "dry_run") {
      planAll(cells, scenariosById, tracker, options, now);
    } else {
      await runAll(cells, scenariosById, tracker, options, neededEnv, locallySeeded, now, log);
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

  const report: TestRunReportV3 = {
    schema_version: 3,
    kind: "proliferate.test-run",
    candidate_build: options.candidateBuild ?? null,
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
      // Copied so no scenario holding a reference to the selector arrays can
      // alter the persisted invocation inputs.
      agents: options.inputs.agents === "all" ? "all" : [...options.inputs.agents],
      scenarios: options.inputs.scenarios === "all" ? "all" : [...options.inputs.scenarios],
    },
    selected_cells: cells.map(clonePlannedCell),
    results,
    summary: {
      selected: cells.length,
      finalized: results.length,
      by_status: countByStatus(results),
      integrity_errors: [...tracker.integrityErrors],
      runner_errors: [...tracker.runnerErrors],
      intended_exit_code: verdict.intendedExitCode,
    },
    verdict: {
      status: verdict.status,
      scope: "selected_cells",
      completeness: "partial",
      reasons: verdict.reasons,
    },
  };

  const resolveSecrets = options.resolveSecretValues ?? defaultResolveSecretValues;
  const sanitized = sanitizeReport(report, resolveSecrets());
  // The persisted verdict (including its reasons) is derived from the
  // sanitized content through the same single derivation the report
  // validator recomputes, so validation can require byte-for-byte equality.
  const finalVerdict = expectedVerdict(sanitized);
  return {
    ...sanitized,
    summary: { ...sanitized.summary, intended_exit_code: finalVerdict.intendedExitCode },
    verdict: { ...sanitized.verdict, status: finalVerdict.status, reasons: finalVerdict.reasons },
  };
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
  if (error instanceof SyntaxError) {
    return "SyntaxError: invalid JSON response (payload withheld from evidence)";
  }
  const status = error instanceof Error ? (error as { status?: unknown }).status : undefined;
  if (error instanceof Error && typeof status === "number" && "body" in error) {
    // Message shape is `${method} ${path} -> ${status}: ${body}`; keep the
    // safe prefix, withhold everything after it.
    const prefix = /^(.*?->\s*\d+)/.exec(error.message)?.[1] ?? `request failed with status ${status}`;
    return `${error.name}: ${prefix} (response body withheld from evidence)`;
  }
  if (error instanceof Error && ("stdout" in error || "stderr" in error)) {
    return `${error.name}: external command failed (output withheld from evidence)`;
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

function planAll(
  cells: readonly PlannedCellV1[],
  scenariosById: ReadonlyMap<string, ScenarioDefinition>,
  tracker: ResultTracker,
  options: ExecuteOptions,
  now: () => Date,
): void {
  const agents = options.inputs.agents === "all" ? ["all"] : options.inputs.agents;
  for (const cell of cells) {
    const scenario = scenariosById.get(cell.scenario_id)!;
    const planCtx = { runtimeLane: cell.runtime_lane, desktop: options.inputs.desktop, agents: [...agents] };
    try {
      const steps = isMatrixScenario(scenario)
        ? scenario.planCell(planCtx, clonePlannedCell(cell))
        : scenario.plan(planCtx);
      tracker.finalize(cell.cell_id, {
        status: "not_run",
        reason: { code: "dry_run", message: "Diagnostic dry-run planned this cell instead of executing it." },
        planSteps: steps.map((step) => step.description),
        finishedAt: now().toISOString(),
      });
    } catch (error) {
      const message = evidenceSafeMessage(error);
      tracker.finalize(cell.cell_id, {
        status: "not_run",
        reason: { code: "plan_error", message: `plan() threw: ${message}` },
        finishedAt: now().toISOString(),
      });
      tracker.recordRunnerError("runner_error", `plan() for "${cell.cell_id}" threw: ${message}`);
    }
  }
}

async function runAll(
  cells: readonly PlannedCellV1[],
  scenariosById: ReadonlyMap<string, ScenarioDefinition>,
  tracker: ResultTracker,
  options: ExecuteOptions,
  neededEnv: EnvResolution,
  locallySeeded: ReadonlySet<string>,
  now: () => Date,
  log: (message: string) => void,
): Promise<void> {
  const missingByCell = new Map<string, string[]>();
  for (const cell of cells) {
    const missing = missingRequiredForLane(cell.required_env, cell.runtime_lane, neededEnv, locallySeeded);
    if (missing.length > 0) {
      missingByCell.set(cell.cell_id, missing);
    }
  }

  // Strict preflight is fail-closed: any unsatisfied planned requirement
  // means zero collector bodies execute.
  if (options.behavior === "strict" && missingByCell.size > 0) {
    for (const cell of cells) {
      const missing = missingByCell.get(cell.cell_id);
      if (missing) {
        tracker.finalize(cell.cell_id, {
          status: "blocked",
          reason: {
            code: "missing_requirement",
            message: blockedReasonForMissingEnv(cell.cell_id, cell.runtime_lane, missing, locallySeeded),
          },
          finishedAt: now().toISOString(),
        });
      } else {
        tracker.finalize(cell.cell_id, {
          status: "cancelled",
          reason: {
            code: "strict_preflight_failed",
            message: "Strict preflight found unsatisfied requirements on sibling cells; no cell body ran.",
          },
          finishedAt: now().toISOString(),
        });
      }
    }
    return;
  }

  // Diagnostic preflight blocks only affected cells; runnable cells are then
  // grouped by scenario/runtime lane so a matrix collector is invoked exactly
  // once per group with its assigned cells (efficient shared setup).
  const groups = new Map<string, PlannedCellV1[]>();
  for (const cell of cells) {
    const missing = missingByCell.get(cell.cell_id);
    if (missing) {
      tracker.finalize(cell.cell_id, {
        status: "blocked",
        reason: {
          code: "missing_requirement",
          message: blockedReasonForMissingEnv(cell.cell_id, cell.runtime_lane, missing, locallySeeded),
        },
        finishedAt: now().toISOString(),
      });
      continue;
    }
    const groupKey = `${cell.scenario_id}/${cell.runtime_lane}`;
    const group = groups.get(groupKey);
    if (group) {
      group.push(cell);
    } else {
      groups.set(groupKey, [cell]);
    }
  }

  const agents = options.inputs.agents === "all" ? ["all"] : options.inputs.agents;
  for (const assigned of groups.values()) {
    const first = assigned[0];
    const scenario = scenariosById.get(first.scenario_id)!;
    const ctx = {
      targetLane: options.inputs.targetLane,
      runtimeLane: first.runtime_lane,
      desktop: options.inputs.desktop,
      // A fresh copy per invocation: a collector mutating ctx.agents cannot
      // alter the persisted invocation inputs or a sibling's context.
      agents: [...agents],
      dryRun: false,
      env: neededEnv,
    };
    const startedAt = now().toISOString();
    const startedMs = now().getTime();
    const finish = (cellId: string, status: FinalCellResultV1["status"], reason: ResultReason | null): void =>
      tracker.finalize(cellId, {
        status,
        reason: reason ?? undefined,
        startedAt,
        finishedAt: now().toISOString(),
        durationMs: now().getTime() - startedMs,
      });

    try {
      log(`running ${assigned.map((cell) => cell.cell_id).join(", ")}`);
      if (isMatrixScenario(scenario)) {
        // Collectors receive independent copies; the canonical plan stays
        // with the tracker.
        const outcomes = await scenario.runCells(ctx, assigned.map(clonePlannedCell));
        try {
          applyCollectorOutcomes(scenario, assigned, outcomes, tracker, finish);
        } catch (error) {
          // A throw while consuming the returned data (e.g. a poisoned
          // iterator) is malformed collector output — runner integrity, not
          // a product failure.
          tracker.recordIntegrityError(
            "selection_result_mismatch",
            `Collector "${scenario.id}" output could not be consumed: ${evidenceSafeMessage(error)}`,
          );
        }
      } else {
        await scenario.run(ctx);
        finish(first.cell_id, "green", null);
      }
    } catch (error) {
      // A collector-level throw applies its normalized outcome to every
      // still-pending cell assigned to this invocation; independent
      // scenario/runtime collectors continue afterward.
      const normalized = normalizeThrown(error);
      const stillPending = new Set(tracker.pendingCells().map((pending) => pending.cell_id));
      for (const cell of assigned) {
        if (stillPending.has(cell.cell_id)) {
          finish(cell.cell_id, normalized.status, normalized.reason);
        }
      }
      if (normalized.status === "failed") {
        log(
          `failed ${assigned.map((cell) => cell.cell_id).join(", ")}: ${
            error instanceof Error ? (error.stack ?? error.message) : String(error)
          }`,
        );
      }
    }
  }
}

/**
 * Applies a matrix collector's returned outcomes: exactly one explicit
 * outcome per assigned cell. Unknown and duplicate cell ids are integrity
 * errors; omitted cells stay pending and are synthesized as `missing` at
 * finalization. Scenario code cannot declare runner-only terminal states.
 */
function applyCollectorOutcomes(
  scenario: MatrixScenarioDefinition,
  assigned: readonly PlannedCellV1[],
  outcomes: unknown,
  tracker: ResultTracker,
  finish: (cellId: string, status: FinalCellResultV1["status"], reason: ResultReason | null) => void,
): void {
  // Malformed collector output (null/undefined/non-array, or entries without
  // a cell id and status) is a runner-integrity failure, not a product
  // failure: the affected cells stay pending and finalize as missing with
  // exit 2 — never as failed/exit 1.
  if (!Array.isArray(outcomes)) {
    tracker.recordIntegrityError(
      "selection_result_mismatch",
      `Collector "${scenario.id}" returned ${outcomes === null ? "null" : typeof outcomes} instead of an outcome array.`,
    );
    return;
  }
  const assignedIds = new Set(assigned.map((cell) => cell.cell_id));
  for (const raw of outcomes) {
    // The complete outcome — including the optional reason — is validated
    // separately from collector execution, and property reads are guarded:
    // a throwing getter or a malformed reason is runner integrity (the cell
    // stays pending and finalizes missing/exit 2), never an ordinary failed
    // result and never a lost aggregate.
    const outcome = readCollectorOutcome(raw);
    if (outcome === null) {
      tracker.recordIntegrityError(
        "selection_result_mismatch",
        `Collector "${scenario.id}" returned a malformed outcome entry.`,
      );
      continue;
    }
    if (!assignedIds.has(outcome.cellId)) {
      // Never finalize a cell outside this invocation's assignment — even one
      // that is planned for another collector — or one collector could write
      // another's results.
      tracker.recordIntegrityError(
        "selection_result_mismatch",
        `Collector "${scenario.id}" returned an outcome for unassigned cell "${outcome.cellId}".`,
      );
      continue;
    }
    if (!(SCENARIO_DECLARABLE_STATUSES as readonly string[]).includes(outcome.status)) {
      tracker.recordIntegrityError(
        "selection_result_mismatch",
        `Collector "${scenario.id}" declared runner-only status "${outcome.status}" for "${outcome.cellId}".`,
      );
      continue;
    }
    const status = outcome.status as ScenarioDeclarableStatus;
    finish(outcome.cellId, status, outcome.reason ?? defaultReasonFor(status));
  }
}

/**
 * Reads one raw collector outcome defensively: every property access is
 * guarded (a throwing getter is malformed data, not a scenario failure) and
 * the optional reason must be a well-formed `{ code, message }` with a known
 * reason code and string message — `reason: "oops"` would otherwise crash
 * sanitization and lose the aggregate. Returns null for any malformed entry.
 */
function readCollectorOutcome(
  raw: unknown,
): { cellId: string; status: string; reason?: ResultReason } | null {
  try {
    if (typeof raw !== "object" || raw === null) {
      return null;
    }
    const cellId = (raw as { cellId?: unknown }).cellId;
    const status = (raw as { status?: unknown }).status;
    const reason = (raw as { reason?: unknown }).reason;
    if (typeof cellId !== "string" || typeof status !== "string") {
      return null;
    }
    if (reason === undefined || reason === null) {
      return { cellId, status };
    }
    if (
      typeof reason !== "object" ||
      typeof (reason as { code?: unknown }).code !== "string" ||
      !(RESULT_REASON_CODES as readonly string[]).includes((reason as { code: string }).code) ||
      typeof (reason as { message?: unknown }).message !== "string"
    ) {
      return null;
    }
    return {
      cellId,
      status,
      reason: {
        code: (reason as { code: ResultReasonCode }).code,
        message: (reason as { message: string }).message,
      },
    };
  } catch {
    return null;
  }
}

function defaultReasonFor(status: ScenarioDeclarableStatus): ResultReason | null {
  switch (status) {
    case "green":
      return null;
    case "failed":
      return { code: "scenario_failure", message: "collector reported this cell failed" };
    case "blocked":
      return { code: "scenario_blocked", message: "collector reported this cell blocked" };
    case "expected_fail":
      return { code: "known_gap", message: "collector reported this cell as a diagnosed known gap" };
  }
}

function normalizeThrown(error: unknown): { status: "blocked" | "expected_fail" | "failed"; reason: ResultReason } {
  if (error instanceof ScenarioBlockedError) {
    return { status: "blocked", reason: { code: "scenario_blocked", message: error.reason } };
  }
  if (error instanceof ScenarioExpectedFailError) {
    return { status: "expected_fail", reason: { code: "known_gap", message: error.diagnosis } };
  }
  // The report stores the normalized message, never the raw stack (spec:
  // "raw stacks and provider payloads are not serialized"); the stack still
  // reaches the console via the runner's own logging.
  return { status: "failed", reason: { code: "scenario_failure", message: evidenceSafeMessage(error) } };
}
