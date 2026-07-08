import type { ScenarioDefinition } from "./types.js";
import { t3Prov1 } from "./t3-prov-1.js";
import { t3Prov2 } from "./t3-prov-2.js";
import { t3Wt1 } from "./t3-wt-1.js";
import { t3Chat1 } from "./t3-chat-1.js";
import { t3Cfg1 } from "./t3-cfg-1.js";
import { t3Update1 } from "./t3-update-1.js";
import { t3SecMat1 } from "./t3-sec-mat-1.js";
import { t3Repo1 } from "./t3-repo-1.js";

/**
 * The tier-3 first wave for the LOCAL lane
 * (specs/developing/testing/scenarios.md#tier-3--first-wave). T3-FIXTURE is
 * infrastructure (src/fixtures/identity.ts), not a registered scenario.
 * T3-INT-1 (Slack) and the T3-BILL-* rows are out of scope per the build
 * task that landed this wave — add them here when they graduate from draft.
 */
export const SCENARIOS: readonly ScenarioDefinition[] = [
  t3Prov1,
  t3Prov2,
  t3Wt1,
  t3Chat1,
  t3Cfg1,
  t3Update1,
  t3SecMat1,
  t3Repo1,
];

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
