/**
 * Manifest ↔ executable-registry agreement (PR 8 "Close the Remaining Core
 * Scenario Inventory", deliverable 1).
 *
 * The authoritative manifest
 * (`specs/developing/testing/core-release-scenario-manifest.json`) and this
 * runner's registries must agree — no orphan, duplicate, unknown, or
 * prose-only required cell:
 *
 * - a `deferred` manifest row (unmerged owning feature, or Tier 3 standing-set
 *   policy) must NOT have an executable Tier-2 case handler — the hard
 *   fabrication guard: coverage for an unmerged feature cannot be claimed
 *   ahead of its feature stack;
 * - every Tier-2 case id registered on the aggregate runner must resolve to a
 *   known manifest row (no unknown/invented ids);
 * - no Tier-2 case id is registered by two scenarios (no duplicate final-cell
 *   claim);
 * - every top-level `ScenarioDefinition` id is unique.
 *
 * Scenario-group ids (`T2-BILL`, world journeys like `CLOUD-PROVISION-1`) are
 * containers, not manifest guarantees; the manifest-facing unit for Tier 2 is
 * the case id. Non-manifest legacy ids remain allowed ONLY via the explicit
 * allowlist below, which must shrink — never grow — as PR 8's workstreams port
 * them onto real manifest rows.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { SCENARIOS } from "./registry.js";
import { isMatrixScenario } from "./types.js";
import { TIER2_CASE_DIMENSION } from "./tier2/harness.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const MANIFEST_PATH = path.join(
  REPO_ROOT,
  "specs/developing/testing/core-release-scenario-manifest.json",
);

interface ManifestRow {
  id: string;
  tier: number;
  implementation: { status: string; reason?: string };
}

interface Manifest {
  requiredScenarios: ManifestRow[];
}

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as Manifest;
const manifestById = new Map(manifest.requiredScenarios.map((row) => [row.id, row]));

/**
 * Registered Tier-2 case ids that predate the authoritative manifest. Each is
 * a PR-4 representative cell pending its PR-8 port onto real manifest rows.
 * Append-only registries may not grow this list; ports remove entries.
 */
const LEGACY_TIER2_CASE_IDS = new Set(["T2-AUTH-REP", "T2-ORG-ROLES-REP", "T2-INVITE-REP"]);

/** Every Tier-2 matrix case id, with its owning scenario id. */
async function collectTier2CaseIds(): Promise<Map<string, string>> {
  const byCaseId = new Map<string, string>();
  for (const scenario of SCENARIOS) {
    if (!isMatrixScenario(scenario)) {
      continue;
    }
    const cells = await scenario.expandCells({ runtimeLane: "local", desktop: "web", agents: ["claude"] });
    for (const cell of cells) {
      const caseId = cell.dimensions[TIER2_CASE_DIMENSION];
      if (!caseId) {
        continue;
      }
      const existing = byCaseId.get(caseId);
      assert.equal(
        existing,
        undefined,
        `case id "${caseId}" is claimed by both "${existing}" and "${scenario.id}" — duplicate collectors for one required cell`,
      );
      byCaseId.set(caseId, scenario.id);
    }
  }
  return byCaseId;
}

test("scenario ids in the executable registry are unique", () => {
  const ids = SCENARIOS.map((scenario) => scenario.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate ScenarioDefinition id registered");
});

test("every registered Tier-2 case id resolves to a known manifest row or the shrinking legacy allowlist", async () => {
  const byCaseId = await collectTier2CaseIds();
  for (const [caseId, scenarioId] of byCaseId) {
    if (LEGACY_TIER2_CASE_IDS.has(caseId)) {
      continue;
    }
    assert.ok(
      manifestById.has(caseId),
      `"${scenarioId}" registers case id "${caseId}", which is not a required manifest scenario`,
    );
  }
});

test("no executable Tier-2 case handler exists for a deferred manifest row (fabrication guard)", async () => {
  const byCaseId = await collectTier2CaseIds();
  for (const [caseId, scenarioId] of byCaseId) {
    const row = manifestById.get(caseId);
    if (!row) {
      continue;
    }
    assert.notEqual(
      row.implementation.status,
      "deferred",
      `"${scenarioId}" registers an executable cell for "${caseId}", but the manifest defers that row ` +
        `(${row.implementation.reason ?? "no reason"}) — cells must not be fabricated ahead of their feature stack`,
    );
  }
});

test("every deferred manifest row names a bounded reason", () => {
  for (const row of manifest.requiredScenarios) {
    if (row.implementation.status !== "deferred") {
      continue;
    }
    assert.ok(
      typeof row.implementation.reason === "string" && row.implementation.reason.length > 0,
      `${row.id}: deferred without a reason`,
    );
  }
});
