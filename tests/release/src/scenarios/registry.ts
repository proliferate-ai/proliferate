import type { ScenarioDefinition } from "./types.js";
import { t3Prov1 } from "./t3-prov-1.js";
import { t3Prov2 } from "./t3-prov-2.js";
import { t3Wt1 } from "./t3-wt-1.js";
import { t3Chat1 } from "./t3-chat-1.js";
import { t3Gw1 } from "./t3-gw-1.js";
import { t3Cfg1 } from "./t3-cfg-1.js";
import { t3Update1 } from "./t3-update-1.js";
import { t3SecMat1 } from "./t3-sec-mat-1.js";
import { t3Repo1 } from "./t3-repo-1.js";
import { t3Int1 } from "./t3-int-1.js";
import { t3Bill1 } from "./t3-bill-1.js";
import { t3Bill2 } from "./t3-bill-2.js";
import { t3Bill3 } from "./t3-bill-3.js";
import { t3Bill4 } from "./t3-bill-4.js";
import { t4Cloud1 } from "./upgrade/t4-cloud-1.js";
import { t4Runtime1 } from "./upgrade/t4-runtime-1.js";
import { t4Desktop1 } from "./upgrade/t4-desktop-1.js";
import { t4Sh1 } from "./upgrade/t4-sh-1.js";
import { t4Sh2 } from "./upgrade/t4-sh-2.js";
import { t3Sh2 } from "./selfhost/t3-sh-2.js";
import { t3Sh3 } from "./selfhost/t3-sh-3.js";
import { t3Sh4 } from "./selfhost/t3-sh-4.js";
import { t3Sh5 } from "./selfhost/t3-sh-5.js";
import { localWorldSmoke1 } from "./local-world-smoke-1.js";
import { t2Bill } from "./tier2/t2-bill.js";
import { t2AuthOrg } from "./tier2/t2-auth-org.js";
import { selfhostInstall1 } from "./selfhost-install-1.js";
import { cloudProvision1 } from "./cloud-provision-1.js";

/**
 * The tier-3 first wave (specs/developing/testing/scenarios.md#tier-3--first-wave),
 * the self-hosting battery under `selfhost/` (specs/developing/testing/self-hosting.md),
 * the tier-4 upgrade-path scenarios under `upgrade/`, the provisional
 * LOCAL-WORLD-SMOKE-1 local-world infrastructure proof (see
 * `local-world-smoke-1.ts` — not the canonical LOCAL-2 guarantee), and
 * SELFHOST-INSTALL-1 (see `selfhost-install-1.ts`). T3-FIXTURE is
 * infrastructure (src/fixtures/identity.ts), not a registered scenario.
 *
 * `T3-SH-1` (cold boot to second user) is RETIRED: its assertions are absorbed
 * and strengthened by SELFHOST-INSTALL-1's four canonical cells (which
 * additionally drive the real Desktop renderer and a BYOK turn); its
 * capability-truth checks fold into `SH-INSTALL-CLAIM`
 * ("Prove One Real Self-Hosted Installation" reconciliation decision 2).
 * `t3-sh-2/3/4/5` remain registered as-is — their broader reconciliation is a
 * later pass; `t3-sh-5`'s ref stays `T3-SH-5` (reserved for the cloud/E2B
 * add-on).
 */
export const SCENARIOS: readonly ScenarioDefinition[] = [
  t3Prov1,
  t3Prov2,
  t3Wt1,
  t3Chat1,
  t3Gw1,
  t3Cfg1,
  t3Update1,
  t3SecMat1,
  t3Repo1,
  t3Int1,
  t3Bill1,
  t3Bill2,
  t3Bill3,
  t3Bill4,
  t3Sh2,
  t3Sh3,
  t3Sh4,
  t3Sh5,
  t4Cloud1,
  t4Runtime1,
  t4Desktop1,
  t4Sh1,
  t4Sh2,
  localWorldSmoke1,
  t2Bill,
  t2AuthOrg,
  selfhostInstall1,
  cloudProvision1,
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
