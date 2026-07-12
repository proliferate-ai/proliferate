import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const testingDir = path.join(repoRoot, "specs/developing/testing");
const contractPath = path.join(testingDir, "core-release-validation.md");
const manifestPath = path.join(testingDir, "core-release-scenario-manifest.json");
const contract = readFileSync(contractPath, "utf8");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

function contractScenarioIds() {
  return [...contract.matchAll(/^\| `(T([234])-[^`]+)` \|/gm)].map((match) => ({
    id: match[1],
    tier: Number(match[2]),
  }));
}

test("the machine scenario inventory exactly matches the authoritative contract", () => {
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.authoritativeContract, "core-release-validation.md");
  assert.deepEqual(
    manifest.requiredScenarios.map(({ id, tier }) => ({ id, tier })),
    contractScenarioIds(),
  );
});

test("the required target has 68 Tier 2, 90 Tier 3, and 27 Tier 4 unique scenarios", () => {
  const scenarios = manifest.requiredScenarios;
  assert.equal(scenarios.length, 185);
  assert.equal(new Set(scenarios.map(({ id }) => id)).size, scenarios.length);
  assert.deepEqual(
    Object.fromEntries([2, 3, 4].map((tier) => [
      tier,
      scenarios.filter((scenario) => scenario.tier === tier).length,
    ])),
    { 2: 68, 3: 90, 4: 27 },
  );
  for (const scenario of scenarios) {
    assert.match(scenario.id, new RegExp(`^T${scenario.tier}-[A-Z0-9-]+$`));
  }
});

test("target presence is never treated as executable coverage", () => {
  const validStatuses = new Set(["planned", "implemented", "blocking"]);
  const validGates = new Set(["merge", "staging", "release", "nightly"]);
  const validEvidence = new Set(["signal-only", "release-blocking", "qualification"]);

  for (const scenario of manifest.requiredScenarios) {
    const implementation = scenario.implementation;
    assert.equal(typeof implementation, "object", `${scenario.id} must declare implementation state`);
    assert.ok(validStatuses.has(implementation?.status), `${scenario.id} has an invalid implementation status`);

    if (implementation.status === "planned") {
      assert.deepEqual(
        Object.keys(implementation).sort(),
        ["status"],
        `${scenario.id}: planned rows cannot carry unaudited execution claims`,
      );
      continue;
    }

    assert.match(implementation.collector, /\.(?:ts|tsx|py|mjs|sh|ya?ml)$/);
    assert.ok(
      existsSync(path.resolve(repoRoot, implementation.collector)),
      `${scenario.id}: collector does not exist: ${implementation.collector}`,
    );
    assert.equal(typeof implementation.testId, "string");
    assert.ok(implementation.testId.length > 0, `${scenario.id}: collected test id is required`);
    assert.ok(Array.isArray(implementation.lanes) && implementation.lanes.length > 0);
    assert.equal(new Set(implementation.lanes).size, implementation.lanes.length);
    assert.ok(implementation.lanes.every((lane) => typeof lane === "string" && lane.length > 0));
    assert.ok(validGates.has(implementation.gate), `${scenario.id}: invalid gate`);
    assert.ok(validEvidence.has(implementation.evidenceStatus), `${scenario.id}: invalid evidence status`);
    if (implementation.status === "blocking") {
      assert.notEqual(
        implementation.evidenceStatus,
        "qualification",
        `${scenario.id}: a blocking row cannot claim qualification evidence`,
      );
    }
  }
});

test("WP0 leaves target rows explicitly planned until their execution mapping is audited", () => {
  assert.equal(
    manifest.requiredScenarios.filter(({ implementation }) => implementation.status === "planned").length,
    manifest.requiredScenarios.length,
  );
});

test("runtime activation authority is Worker mailbox to Supervisor, never Worker direct activation", () => {
  const runtimeRow = contract.match(/^\| `T4-RUNTIME-1` \|.*$/m)?.[0] ?? "";
  const workerRow = contract.match(/^\| `T4-WORKER-1` \|.*$/m)?.[0] ?? "";
  assert.match(runtimeRow, /Worker.*writes the atomic mailbox request/);
  assert.match(runtimeRow, /Supervisor.*swaps AnyHarness/);
  assert.match(runtimeRow, /rolls back/);
  assert.match(workerRow, /Worker.*writes the atomic mailbox request/);
  assert.match(workerRow, /Supervisor.*swaps Worker/);
  assert.match(workerRow, /rolls back/);
  assert.doesNotMatch(`${runtimeRow}\n${workerRow}`, /Worker (?:downloads|swaps|restarts|activates)/i);
});

test("every local link in the authoritative contract resolves", () => {
  const unresolved = [];
  for (const match of contract.matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1].trim();
    if (target.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(target)) {
      continue;
    }
    const relativePath = decodeURIComponent(target.split("#", 1)[0].split("?", 1)[0]);
    if (!relativePath) {
      continue;
    }
    const resolved = path.resolve(testingDir, relativePath);
    if (!existsSync(resolved)) {
      unresolved.push(target);
    }
  }
  assert.deepEqual(unresolved, []);
});
