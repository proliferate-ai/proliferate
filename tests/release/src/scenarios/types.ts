import type { EnvResolution } from "../config/env-resolution.js";
import type { DesktopMode, RuntimeLane, TargetLane } from "../config/types.js";

/**
 * Thrown by every stub scenario's `run()` when invoked outside --dry-run.
 * Tier-3 scenarios need real credentials (none exist yet) and a real E2B
 * template/AnyHarness binary; until phase 2 wires those up, this is the
 * expected outcome for a non-dry-run invocation.
 */
export class NotImplementedError extends Error {
  constructor(scenarioId: string) {
    super(
      `${scenarioId} is a skeleton stub (tier-3 runner phase 1). It describes its plan under ` +
        "--dry-run but does not execute yet — no tier-3 credentials exist for any target " +
        "deployment. See specs/developing/testing/scenarios.md for the scenario contract.",
    );
    this.name = "NotImplementedError";
  }
}

export interface ScenarioPlanStep {
  description: string;
}

export interface ScenarioRunContext {
  targetLane: TargetLane;
  runtimeLane: RuntimeLane;
  desktop: DesktopMode;
  /** Resolved `--agents` selection (catalog harness kinds), or ["all"]. */
  agents: readonly string[];
  dryRun: boolean;
  env: EnvResolution;
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
  /** Ordered human-readable steps; printed verbatim under --dry-run. */
  plan(ctx: ScenarioPlanContext): ScenarioPlanStep[];
  /** Executes the scenario for one runtime lane. Stubs throw NotImplementedError outside --dry-run. */
  run(ctx: ScenarioRunContext): Promise<void>;
}
