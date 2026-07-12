import type { EnvResolution } from "../config/env-resolution.js";
import type { DesktopMode, RuntimeLane, TargetLane } from "../config/types.js";

export interface ScenarioPlanStep {
  description: string;
}

/**
 * Thrown when a scenario cannot assert for real because of a known,
 * out-of-band blocker (not a scenario bug, not a product bug this scenario is
 * responsible for) — e.g. the `github_link_required` gate tracked in
 * `src/fixtures/identity.ts`. Distinct from `ScenarioFailure`: a blocked run
 * does not fail the release gate and does not get an issue filed against it
 * (the blocker already has its own tracking); it is reported so the gap stays
 * visible instead of silently passing or silently failing.
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
 * instead — see `../report/issue-filer.ts`). An expected-fail run does not
 * fail the release gate; it is a documented, known gap.
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
   * Unique correlation ID for this scenario/lane run (WS10a live-scenario
   * policy). Injected by the runner; scenarios may thread it into product
   * requests so a live run is traceable. Optional so existing scenarios that
   * ignore it are unaffected.
   */
  correlationId?: string;
  /** Fixed per-scenario deadline in ms the runner enforces around `run`. */
  deadlineMs?: number;
}

export interface ScenarioPlanContext {
  runtimeLane: RuntimeLane;
  desktop: DesktopMode;
  agents: readonly string[];
}

export interface ScenarioDefinition {
  id: string;
  title: string;
  /** Pointer into the scenario contract doc; the "registry" this runner implements against. */
  registryFlowRef: string;
  /** Runtime lanes this scenario is defined for. */
  lanes: readonly RuntimeLane[];
  /** Env var names (from src/config/env-manifest.ts) this scenario needs to run for real. */
  requiredEnv: readonly string[];
  /** Additional env requirements that apply only to one runtime lane. */
  requiredEnvByLane?: Partial<Record<RuntimeLane, readonly string[]>>;
  /** Ordered human-readable steps; printed verbatim under --dry-run. */
  plan(ctx: ScenarioPlanContext): ScenarioPlanStep[];
  /**
   * Executes the scenario for one runtime lane. Throws `ScenarioBlockedError`
   * for a known out-of-band gate, `ScenarioExpectedFailError` for a diagnosed
   * real gap, or any other error for a genuine red — see the two classes
   * above for how the CLI (`src/cli/run.ts`) reports each differently.
   */
  run(ctx: ScenarioRunContext): Promise<void>;
}
