import type { ScenarioDefinition } from "./types.js";
import { t3Prov1 } from "./t3-prov-1.js";
import { t3Prov2 } from "./t3-prov-2.js";
import { t3Wt1 } from "./t3-wt-1.js";
import { t3Chat1 } from "./t3-chat-1.js";
import { t3Update1 } from "./t3-update-1.js";

/**
 * The tier-3 first wave (specs/developing/testing/scenarios.md#tier-3--first-wave).
 * T3-FIXTURE is infrastructure (src/fixtures/identity.ts), not a registered
 * scenario. T3-SEC-MAT-1, T3-INT-1, T3-REPO-1 are named in scenarios.md but
 * out of scope for this phase-1 skeleton; add them here when they graduate
 * from draft.
 */
export const SCENARIOS: readonly ScenarioDefinition[] = [t3Prov1, t3Prov2, t3Wt1, t3Chat1, t3Update1];

export function allScenarioIds(): string[] {
  return SCENARIOS.map((scenario) => scenario.id);
}

export function selectScenarios(selector: readonly string[] | "all"): ScenarioDefinition[] {
  if (selector === "all" || (selector.length === 1 && selector[0] === "all")) {
    return [...SCENARIOS];
  }
  const byId = new Map(SCENARIOS.map((scenario) => [scenario.id, scenario]));
  const selected: ScenarioDefinition[] = [];
  const unknown: string[] = [];
  for (const id of selector) {
    const scenario = byId.get(id);
    if (scenario) {
      selected.push(scenario);
    } else {
      unknown.push(id);
    }
  }
  if (unknown.length > 0) {
    throw new Error(
      `Unknown scenario id(s): ${unknown.join(", ")}. Known scenarios: ${allScenarioIds().join(", ")}`,
    );
  }
  return selected;
}
