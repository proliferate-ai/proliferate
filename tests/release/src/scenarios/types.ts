import type { EnvResolution } from "../config/env-resolution.js";
import type { DesktopMode, RuntimeLane, TargetLane } from "../config/types.js";
import type { CandidateBuildMapV1 } from "../artifacts/build-map.js";
import type { CellEvidenceV1 } from "../evidence/schema.js";
import type { PlannedCellV1, ResultReason, ScenarioDeclarableStatus } from "../runner/result.js";

export interface ScenarioPlanStep {
  description: string;
}

/**
 * Thrown when a scenario cannot assert for real because of a known,
 * out-of-band blocker (not a scenario bug, not a product bug this scenario is
 * responsible for) — e.g. the `github_link_required` gate tracked in
 * `src/fixtures/identity.ts`. Distinct from an ordinary failure: a blocked run
 * does not get an issue filed against it (the blocker already has its own
 * tracking); it is reported so the gap stays visible instead of silently
 * passing or silently failing. How a blocked outcome affects the verdict and
 * exit code is owned by the runner policy in `../runner/result.ts`, not by
 * this class.
 */
export class ScenarioBlockedError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.name = "ScenarioBlockedError";
    this.reason = reason;
  }
}

/**
 * Thrown when a scenario was attempted for real (per README's "3 real
 * attempts, then mark expected-fail" rule) and the diagnosis is recorded
 * here, distinct from an actual product bug (which gets a filed issue
 * instead — see `../report/issue-filer.ts`). Whether an expected-fail run is
 * tolerated (diagnostic) or fails the gate (strict) is owned by the runner
 * policy in `../runner/result.ts`; it is a documented, known gap either way.
 */
export class ScenarioExpectedFailError extends Error {
  readonly diagnosis: string;

  constructor(diagnosis: string) {
    super(diagnosis);
    this.name = "ScenarioExpectedFailError";
    this.diagnosis = diagnosis;
  }
}

export interface ScenarioRunContext {
  targetLane: TargetLane;
  runtimeLane: RuntimeLane;
  desktop: DesktopMode;
  /** Resolved `--agents` selection (catalog harness kinds), or ["all"]. */
  agents: readonly string[];
  dryRun: boolean;
  env: EnvResolution;
  /**
   * The validated, path-bearing candidate build map (in-memory only), or null
   * when no `--candidate-build-map` was supplied. Never serialized. A world
   * constructor materializes the exact artifacts it names (BRIEF §7a).
   */
  candidateBuildMap: CandidateBuildMapV1 | null;
}

export interface ScenarioPlanContext {
  runtimeLane: RuntimeLane;
  desktop: DesktopMode;
  agents: readonly string[];
}

/**
 * One child cell a matrix scenario declares at planning time
 * (specs/developing/testing/exact-test-matrix.md "Test-cell contract"). The
 * runner turns each spec into a `PlannedCellV1` with a runner-created cell id;
 * scenario code never invents cell ids.
 */
export interface ScenarioCellSpec {
  dimensions: Record<string, string>;
  /** Extra requirements beyond the scenario-level requiredEnv, if any. */
  requiredEnv?: readonly string[];
}

/**
 * One explicit outcome a matrix collector returns for one assigned cell.
 * Scenario code may declare only real observed states; `cancelled`,
 * `not_run`, and `missing` remain runner-only terminal states.
 */
export interface ScenarioCellOutcome {
  cellId: string;
  status: ScenarioDeclarableStatus;
  reason?: ResultReason;
  /**
   * Bounded report-V4 evidence a matrix collector attaches to this cell. The
   * runner carries it into `FinalCellResultV2.evidence` (default `null`); this
   * is how `LOCAL-WORLD-SMOKE-1`'s green cell attaches its
   * `LocalWorkspaceTurnEvidenceV1` (BRIEF §7b).
   */
  evidence?: CellEvidenceV1;
}

interface ScenarioBase {
  id: string;
  title: string;
  /** Pointer into the scenario contract doc; the "registry" this runner implements against. */
  registryFlowRef: string;
  /** Runtime lanes this scenario is defined for. */
  lanes: readonly RuntimeLane[];
  /** Env var names (from src/config/env-manifest.ts) every cell of this scenario needs. */
  requiredEnv: readonly string[];
}

/**
 * The existing one-cell-per-lane scenario shape, source-compatible with every
 * scenario written before the exact-cell contract. The runner plans exactly
 * one cell per declared lane (`<id>/<lane>`, no dimensions).
 */
export interface LeafScenarioDefinition extends ScenarioBase {
  kind?: "leaf";
  /** Ordered human-readable steps; printed verbatim under --dry-run. */
  plan(ctx: ScenarioPlanContext): ScenarioPlanStep[];
  /**
   * Executes the scenario for one runtime lane. Throws `ScenarioBlockedError`
   * for a known out-of-band gate, `ScenarioExpectedFailError` for a diagnosed
   * real gap, or any other error for a genuine red — the runner
   * (`src/runner/execute.ts`) normalizes each into a final cell status.
   */
  run(ctx: ScenarioRunContext): Promise<void>;
}

/**
 * A scenario that owns several independently judged child cells but shares
 * setup across them. The runner invokes `runCells()` once per selected
 * scenario/runtime lane with the assigned planned cells; the collector must
 * return exactly one explicit outcome per assigned cell — returning normally
 * never turns children green, and an omitted child becomes a `missing`
 * integrity failure.
 */
export interface MatrixScenarioDefinition extends ScenarioBase {
  kind: "matrix";
  expandCells(ctx: ScenarioPlanContext): ScenarioCellSpec[] | Promise<ScenarioCellSpec[]>;
  planCell(ctx: ScenarioPlanContext, cell: PlannedCellV1): ScenarioPlanStep[];
  runCells(ctx: ScenarioRunContext, cells: readonly PlannedCellV1[]): Promise<ScenarioCellOutcome[]>;
}

export type ScenarioDefinition = LeafScenarioDefinition | MatrixScenarioDefinition;

export function isMatrixScenario(scenario: ScenarioDefinition): scenario is MatrixScenarioDefinition {
  return scenario.kind === "matrix";
}
