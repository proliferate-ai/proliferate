import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  collectTier2ExecutionManifest,
  executionManifestPath,
} from "./collect-tier2-execution-manifest.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const manifest = JSON.parse(readFileSync(executionManifestPath, "utf8"));
const target = JSON.parse(
  readFileSync(path.join(repoRoot, "specs/developing/testing/core-release-scenario-manifest.json"), "utf8"),
);

test("the Tier-2 execution manifest is exact, unique, and paired with the target inventory", () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.targetManifest, "core-release-scenario-manifest.json");
  assert.equal(manifest.executionCells.length, 103);

  const uniqueTestIds = new Set();
  const counts = {};
  const targetIds = new Set(target.requiredScenarios.map(({ id }) => id));
  for (const cell of manifest.executionCells) {
    assert.equal(cell.gate, "merge");
    assert.match(cell.collector, /^tests\/intent\/playwright(?:\.[a-z]+)?\.config\.ts$/);
    assert.match(cell.file, /^tests\/intent\/specs\/.*\.spec\.ts$/);
    assert.ok(cell.title.length > 0);
    assert.equal(typeof cell.project, "string");
    assert.match(cell.testId, /^[a-f0-9]+-[a-f0-9]+$/);
    assert.equal(cell.expectedStatus, "passed");
    const identity = `${cell.lane}\0${cell.testId}`;
    assert.equal(uniqueTestIds.has(identity), false, `duplicate execution cell ${identity}`);
    uniqueTestIds.add(identity);
    counts[cell.lane] = (counts[cell.lane] ?? 0) + 1;
    for (const id of cell.targetScenarioRefs) {
      assert.ok(targetIds.has(id), `${cell.testId} claims unknown target scenario ${id}`);
    }
    assert.deepEqual(
      cell.targetScenarioRefs,
      [],
      `${cell.testId}: title-derived target coverage is forbidden without a semantic audit`,
    );
    assert.equal(
      cell.relationship,
      cell.legacyTitleIds.length > 0 ? "collection-identity-only" : "harness-readiness",
    );
  }
  assert.deepEqual(counts, {
    "tier2-billing": 25,
    "tier2-core": 73,
    "tier2-surfaces-readiness": 5,
  });
});

test("the checked-in Tier-2 execution manifest exactly matches Playwright collection", () => {
  assert.deepEqual(manifest, collectTier2ExecutionManifest());
});

test("dual-host readiness cells do not overclaim the incomplete T2-SURF target", () => {
  const surfaces = manifest.executionCells.filter(
    ({ lane }) => lane === "tier2-surfaces-readiness",
  );
  assert.equal(surfaces.length, 5);
  for (const cell of surfaces) {
    assert.deepEqual(cell.legacyTitleIds, []);
    assert.deepEqual(cell.targetScenarioRefs, []);
    assert.equal(cell.relationship, "harness-readiness");
  }
});
