import type { ScenarioDefinition } from "./types.js";
import type { QualificationWorld } from "../config/types.js";
import qualificationWorldInventory from "./qualification-world-scenarios.json";
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
import { t3Authroute1 } from "./t3-authroute-1.js";
import { t3Session1 } from "./t3-session-1.js";
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
import { selfhostInstall1 } from "./selfhost-install-1.js";
import { cloudProvision1 } from "./cloud-provision-1.js";
import { managedCloudFixtureSmoke1 } from "./managed-cloud-fixture-smoke-1.js";
import { selfhostIsolation1 } from "./selfhost-isolation-1.js";
import { selfhostQual1 } from "./selfhost-qual-1.js";
import { selfhostCfn1 } from "./selfhost-cfn-1.js";

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
  t3Authroute1,
  t3Session1,
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
  selfhostInstall1,
  cloudProvision1,
  managedCloudFixtureSmoke1,
  selfhostIsolation1,
  selfhostQual1,
  selfhostCfn1,
];

interface QualificationWorldEntry {
  runtime_lane: string;
  scenario_ids: string[];
}

interface QualificationWorldInventory {
  schema_version: number;
  kind: string;
  worlds: Record<QualificationWorld, QualificationWorldEntry>;
}

const QUALIFICATION_WORLD_INVENTORY = qualificationWorldInventory as unknown as QualificationWorldInventory;
const SCENARIOS_BY_ID = new Map(SCENARIOS.map((scenario) => [scenario.id, scenario]));
const QUALIFICATION_WORLD_SCENARIO_IDS = validateQualificationWorldInventory();

/** Exact executable scenario ids owned by a qualification world. This is the
 * runner-side reader for the same pre-install JSON inventory the shared
 * qualification preflight consumes. */
export function qualificationWorldScenarioIds(world: QualificationWorld): readonly string[] {
  return QUALIFICATION_WORLD_SCENARIO_IDS.get(world) ?? [];
}

export function allScenarioIds(): string[] {
  return SCENARIOS.map((scenario) => scenario.id);
}

export function selectScenarios(
  selector: readonly string[] | "all",
  qualificationWorld?: QualificationWorld,
): ScenarioDefinition[] {
  const worldIds = qualificationWorld === undefined
    ? null
    : qualificationWorldScenarioIds(qualificationWorld);
  if (selector === "all" || (selector.length === 1 && selector[0] === "all")) {
    return worldIds === null
      ? [...SCENARIOS]
      : worldIds.map((id) => SCENARIOS_BY_ID.get(id)!);
  }
  const allowed = worldIds === null ? null : new Set(worldIds);
  const selected: ScenarioDefinition[] = [];
  const unknown: string[] = [];
  const outsideWorld: string[] = [];
  for (const id of selector) {
    const scenario = SCENARIOS_BY_ID.get(id);
    if (!scenario) {
      unknown.push(id);
    } else if (allowed !== null && !allowed.has(id)) {
      outsideWorld.push(id);
    } else {
      selected.push(scenario);
    }
  }
  if (unknown.length > 0) {
    throw new Error(
      `Unknown scenario id(s): ${unknown.join(", ")}. Known scenarios: ${allScenarioIds().join(", ")}`,
    );
  }
  if (outsideWorld.length > 0) {
    throw new Error(
      `Scenario id(s) not executable in qualification world "${qualificationWorld}": ${outsideWorld.join(", ")}. ` +
        `Allowed scenarios: ${worldIds!.join(", ")}`,
    );
  }
  return selected;
}

function validateQualificationWorldInventory(): ReadonlyMap<QualificationWorld, readonly string[]> {
  if (
    QUALIFICATION_WORLD_INVENTORY.schema_version !== 1
    || QUALIFICATION_WORLD_INVENTORY.kind !== "proliferate.qualification-world-scenario-inventory"
  ) {
    throw new Error("Qualification-world scenario inventory has an unsupported kind or schema version.");
  }
  const validated = new Map<QualificationWorld, readonly string[]>();
  for (const world of ["local"] as const) {
    const entry = QUALIFICATION_WORLD_INVENTORY.worlds[world];
    if (!entry || entry.runtime_lane !== "local" || !Array.isArray(entry.scenario_ids)) {
      throw new Error(`Qualification-world scenario inventory entry "${world}" is malformed.`);
    }
    if (entry.scenario_ids.length === 0 || new Set(entry.scenario_ids).size !== entry.scenario_ids.length) {
      throw new Error(`Qualification-world scenario inventory entry "${world}" is empty or duplicated.`);
    }
    for (const id of entry.scenario_ids) {
      const scenario = SCENARIOS_BY_ID.get(id);
      if (!scenario) {
        throw new Error(`Qualification-world scenario inventory names unregistered scenario "${id}".`);
      }
      if (!scenario.lanes.includes("local")) {
        throw new Error(
          `Qualification-world scenario "${id}" does not declare runtime lane "${entry.runtime_lane}".`,
        );
      }
    }
    validated.set(world, Object.freeze([...entry.scenario_ids]));
  }
  return validated;
}
