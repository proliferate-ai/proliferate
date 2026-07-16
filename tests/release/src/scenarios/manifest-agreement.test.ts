/**
 * Bidirectional manifest ↔ executable-registry agreement for PR 8.
 *
 * The frozen slice owns non-world/non-financial Tier-2 guarantees. Each such
 * row must be one of exactly two truthful states:
 *
 * - deferred with a bounded reason and no executable collector; or
 * - collected/enforced with exactly one registered case collector and audited
 *   execution metadata.
 *
 * The pre-existing BILL family, self-host family, and updater row retain their
 * owning slices. Registered Tier-2 cases are still checked globally for
 * unknown ids, duplicates, and fabricated collection of a deferred row.
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

type ImplementationStatus = "planned" | "deferred" | "collected" | "enforced";

interface ManifestImplementation {
  status: ImplementationStatus;
  reason?: string;
  collector?: string;
  testId?: string;
  lanes?: string[];
  gate?: string;
  evidenceStatus?: string;
}

interface ManifestRow {
  id: string;
  tier: number;
  implementation: ManifestImplementation;
}

interface Manifest {
  requiredScenarios: ManifestRow[];
}

interface CollectorClaim {
  caseId: string;
  scenarioId: string;
}

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as Manifest;

function isPr8Tier2Row(row: ManifestRow): boolean {
  return row.tier === 2
    && !row.id.startsWith("T2-BILL-")
    && !row.id.startsWith("T2-SH-")
    && row.id !== "T2-UPDATER-1";
}

async function collectTier2Claims(): Promise<CollectorClaim[]> {
  const claims: CollectorClaim[] = [];
  for (const scenario of SCENARIOS) {
    if (!isMatrixScenario(scenario)) {
      continue;
    }
    const cells = await scenario.expandCells({ runtimeLane: "local", desktop: "web", agents: ["claude"] });
    for (const cell of cells) {
      const caseId = cell.dimensions[TIER2_CASE_DIMENSION];
      if (caseId) {
        claims.push({ caseId, scenarioId: scenario.id });
      }
    }
  }
  return claims;
}

function agreementProblems(rows: readonly ManifestRow[], claims: readonly CollectorClaim[]): string[] {
  const problems: string[] = [];
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const claimsById = new Map<string, CollectorClaim[]>();
  for (const claim of claims) {
    const owners = claimsById.get(claim.caseId) ?? [];
    owners.push(claim);
    claimsById.set(claim.caseId, owners);
  }

  for (const [caseId, owners] of claimsById) {
    if (!rowsById.has(caseId)) {
      problems.push(`${caseId}: executable collector is not a required manifest row`);
    }
    if (owners.length !== 1) {
      problems.push(`${caseId}: expected exactly one collector, found ${owners.length} (${owners.map((owner) => owner.scenarioId).join(", ")})`);
    }
  }

  for (const row of rows) {
    const owners = claimsById.get(row.id) ?? [];
    if (row.implementation.status === "deferred" && owners.length > 0) {
      problems.push(`${row.id}: deferred row has fabricated executable coverage from ${owners.map((owner) => owner.scenarioId).join(", ")}`);
    }
    if (
      row.tier === 2
      && (row.implementation.status === "collected" || row.implementation.status === "enforced")
      && owners.length !== 1
    ) {
      problems.push(`${row.id}: ${row.implementation.status} row must map to exactly one collector, found ${owners.length}`);
    }
    if (!isPr8Tier2Row(row)) {
      continue;
    }
    if (row.implementation.status === "planned") {
      problems.push(`${row.id}: in-scope incomplete row must be deferred, not planned`);
    }
    if (row.implementation.status === "collected" || row.implementation.status === "enforced") {
      const implementation = row.implementation;
      if (
        !implementation.collector
        || !implementation.testId
        || !implementation.lanes?.length
        || !implementation.gate
        || !implementation.evidenceStatus
      ) {
        problems.push(`${row.id}: executable row is missing audited collector metadata`);
      }
    }
  }
  return problems;
}

test("scenario ids in the executable registry are unique", () => {
  const ids = SCENARIOS.map((scenario) => scenario.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate ScenarioDefinition id registered");
});

test("PR-8 Tier-2 manifest rows and registry collectors agree bidirectionally", async () => {
  assert.deepEqual(agreementProblems(manifest.requiredScenarios, await collectTier2Claims()), []);
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
    assert.ok(row.implementation.reason.length <= 500, `${row.id}: deferred reason is not bounded`);
  }
});

test("agreement audit rejects duplicate collectors", () => {
  const rows: ManifestRow[] = [{ id: "T2-TEST-1", tier: 2, implementation: { status: "collected" } }];
  const problems = agreementProblems(rows, [
    { caseId: "T2-TEST-1", scenarioId: "group-a" },
    { caseId: "T2-TEST-1", scenarioId: "group-b" },
  ]);
  assert.ok(problems.some((problem) => problem.includes("expected exactly one collector")));
});

test("agreement audit rejects a missing collector", () => {
  const rows: ManifestRow[] = [{ id: "T2-TEST-1", tier: 2, implementation: { status: "collected" } }];
  const problems = agreementProblems(rows, []);
  assert.ok(problems.some((problem) => problem.includes("must map to exactly one collector")));
});

test("agreement audit rejects fabricated executable coverage for a deferred row", () => {
  const rows: ManifestRow[] = [{
    id: "T2-TEST-1",
    tier: 2,
    implementation: { status: "deferred", reason: "not implemented" },
  }];
  const problems = agreementProblems(rows, [{ caseId: "T2-TEST-1", scenarioId: "fabricated" }]);
  assert.ok(problems.some((problem) => problem.includes("fabricated executable coverage")));
});
