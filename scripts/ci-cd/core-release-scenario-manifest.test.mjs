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
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.authoritativeContract, "core-release-validation.md");
  assert.deepEqual(manifest.requiredScenarios, contractScenarioIds());
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
