import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const testingDir = path.join(repoRoot, "specs/developing/testing");
const contractPath = path.join(testingDir, "core-release-validation.md");
const manifestPath = path.join(testingDir, "core-release-scenario-manifest.json");
const tier3ContractPath = path.join(testingDir, "tier-3-scenario-contract.md");
const tier4ContractPath = path.join(testingDir, "tier-4-scenario-contract.md");
const worldsContractPath = path.join(testingDir, "release-worlds-and-fixtures.md");
const migrationContractPath = path.join(repoRoot, "specs/tbd/web-desktop-unification-migration.md");
const contract = readFileSync(contractPath, "utf8");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const tier3Contract = readFileSync(tier3ContractPath, "utf8");
const tier4Contract = readFileSync(tier4ContractPath, "utf8");
const worldsContract = readFileSync(worldsContractPath, "utf8");
const migrationContract = readFileSync(migrationContractPath, "utf8");

function contractScenarioIds() {
  return [...contract.matchAll(/^\| `(T([234])-[^`]+)` \|/gm)].map((match) => ({
    id: match[1],
    tier: Number(match[2]),
  }));
}

test("the machine scenario inventory exactly matches the authoritative contract", () => {
  assert.equal(manifest.schemaVersion, 5);
  assert.equal(manifest.authoritativeContract, "core-release-validation.md");
  assert.deepEqual(
    manifest.requiredScenarios.map(({ id, tier }) => ({ id, tier })),
    contractScenarioIds(),
  );
});

test("composed world journeys exactly match the Tier 3 and standing Tier 4 contracts", () => {
  const tier3JourneyIds = [...tier3Contract.matchAll(/^#### `((?:LOCAL|CLOUD|SH)-[^`]+)`/gm)]
    .map((match) => match[1]);
  const tier4JourneyIds = [...tier4Contract.matchAll(/^### `(T4-(?:DESKTOP-CLEAN|DESKTOP|RUNTIME|SELFHOST)-1)`/gm)]
    .map((match) => match[1]);
  const contractJourneyIds = [...tier3JourneyIds, ...tier4JourneyIds];
  const journeys = manifest.composedJourneys;
  assert.deepEqual(journeys.map(({ id }) => id), contractJourneyIds);
  assert.equal(new Set(contractJourneyIds).size, contractJourneyIds.length);
  assert.equal(journeys.length, 47);

  const targetIds = new Set(manifest.requiredScenarios.map(({ id }) => id));
  const validWorlds = new Set([
    "local-runtime",
    "managed-cloud",
    "self-host",
    "tier-4",
  ]);
  const validHosts = new Set([
    "host-neutral",
    "desktop-renderer",
    "desktop-native",
    "hosted-web",
    "cross-host",
  ]);
  const validTier4Targets = new Set([
    "desktop-clean-install",
    "desktop-upgrade",
    "managed-cloud-runtime-upgrade",
    "self-host-upgrade",
  ]);
  for (const journey of journeys) {
    assert.ok(validWorlds.has(journey.world), `${journey.id}: invalid world`);
    assert.ok(Array.isArray(journey.requiredHosts) && journey.requiredHosts.length > 0);
    assert.ok(journey.requiredHosts.every((host) => validHosts.has(host)), `${journey.id}: invalid host`);
    assert.ok(Array.isArray(journey.targetScenarioRefs) && journey.targetScenarioRefs.length > 0);
    assert.ok(
      journey.targetScenarioRefs.every((id) => targetIds.has(id)),
      `${journey.id}: unknown target scenario reference`,
    );
    assert.ok(
      journey.targetScenarioRefs.some((id) => id.startsWith(`T${journey.tier}-`)),
      `${journey.id}: journey must contribute to its own tier`,
    );
    assert.deepEqual(journey.implementation, { status: "planned" });

    if (journey.tier === 3) {
      assert.equal(journey.target, undefined, `${journey.id}: Tier 3 has no target dimension`);
      assert.ok(
        !journey.requiredHosts.includes("desktop-native"),
        `${journey.id}: packaged/native Desktop belongs to Tier 4`,
      );
    } else if (journey.tier === 4) {
      assert.equal(journey.world, "tier-4");
      assert.ok(validTier4Targets.has(journey.target), `${journey.id}: invalid Tier 4 target`);
    }

    if (journey.id.startsWith("LOCAL-")) {
      assert.equal(journey.world, "local-runtime");
      assert.ok(!journey.requiredHosts.includes("hosted-web"));
      assert.ok(!journey.requiredHosts.includes("cross-host"));
    } else if (journey.id.startsWith("CLOUD-")) {
      assert.equal(journey.world, "managed-cloud");
    } else if (journey.id.startsWith("SH-")) {
      assert.equal(journey.world, "self-host");
      assert.ok(!journey.requiredHosts.includes("hosted-web"));
    }
  }

  assert.deepEqual(
    journeys.find(({ id }) => id === "CLOUD-HOSTS-1")?.requiredHosts,
    ["desktop-renderer", "hosted-web", "cross-host"],
  );
  assert.deepEqual(
    journeys.filter(({ tier }) => tier === 4).map(({ target }) => target),
    [...validTier4Targets],
  );
});

test("Tier 3 standing and deferred qualification sets are exhaustive and derived", () => {
  assert.deepEqual(manifest.qualificationPolicy, {
    tier3StandingSelection: {
      includeComposedJourneyReferences: true,
      standaloneScenarioIds: [],
      unreferencedDisposition: "deferred",
      fullCoreQualificationRequiresNoDeferred: true,
    },
    tier4TargetSelection: {
      standingTargets: [
        "desktop-clean-install",
        "desktop-upgrade",
        "managed-cloud-runtime-upgrade",
      ],
      changeTriggeredTargets: ["self-host-upgrade"],
      independentEvidenceRequired: true,
    },
  });

  const tier3Ids = manifest.requiredScenarios
    .filter(({ tier }) => tier === 3)
    .map(({ id }) => id);
  const tier3IdSet = new Set(tier3Ids);
  const journeyRefs = new Set(
    manifest.composedJourneys
      .filter(({ tier }) => tier === 3)
      .flatMap(({ targetScenarioRefs }) => targetScenarioRefs)
      .filter((id) => id.startsWith("T3-")),
  );
  const standaloneIds = manifest.qualificationPolicy
    .tier3StandingSelection.standaloneScenarioIds;
  assert.ok(standaloneIds.every((id) => tier3IdSet.has(id)));

  const standing = new Set([...journeyRefs, ...standaloneIds]);
  const deferred = tier3Ids.filter((id) => !standing.has(id));
  assert.equal(standing.size + deferred.length, tier3Ids.length);
  assert.ok(standing.size > 0, "foundation needs a non-empty standing Tier 3 set");
  assert.ok(deferred.length > 0, "foundation must expose the not-yet-composed Tier 3 set");

  for (const prefix of ["T3-BILL-", "T3-SH-"]) {
    const requiredCoreDomainIds = tier3Ids.filter((id) => id.startsWith(prefix));
    assert.ok(requiredCoreDomainIds.length > 0);
    assert.ok(
      requiredCoreDomainIds.every((id) => standing.has(id)),
      `${prefix} guarantees must all be reachable in the foundation wave`,
    );
  }
});

test("journey-to-guarantee mappings live only in the machine manifest", () => {
  const duplicateMappingPattern = /Maps primarily|map(?:s|ped)? (?:directly|collectively) to/i;
  assert.doesNotMatch(tier3Contract, duplicateMappingPattern);
  assert.doesNotMatch(tier4Contract, duplicateMappingPattern);
});

test("the required target has 69 Tier 2, 90 Tier 3, and 27 Tier 4 unique scenarios", () => {
  const scenarios = manifest.requiredScenarios;
  assert.equal(scenarios.length, 186);
  assert.equal(new Set(scenarios.map(({ id }) => id)).size, scenarios.length);
  assert.deepEqual(
    Object.fromEntries([2, 3, 4].map((tier) => [
      tier,
      scenarios.filter((scenario) => scenario.tier === tier).length,
    ])),
    { 2: 69, 3: 90, 4: 27 },
  );
  for (const scenario of scenarios) {
    assert.match(scenario.id, new RegExp(`^T${scenario.tier}-[A-Z0-9-]+$`));
  }
});

test("target presence is never treated as executable coverage", () => {
  const validStatuses = new Set(["planned", "collected", "enforced"]);
  const validGates = new Set(["merge", "staging", "release", "nightly"]);
  const validEvidence = new Set(["diagnostic", "partial", "qualification"]);

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
    if (implementation.status === "collected") {
      assert.notEqual(implementation.evidenceStatus, "qualification");
    }
    if (implementation.status === "enforced") {
      assert.equal(implementation.evidenceStatus, "qualification");
    }
  }
});

test("foundation recovery leaves target rows planned until execution mapping is audited", () => {
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

test("every local link in the canonical testing and migration contracts resolves", () => {
  const unresolved = [];
  for (const { contents, baseDir, label } of [
    { contents: contract, baseDir: testingDir, label: "core" },
    { contents: tier3Contract, baseDir: testingDir, label: "tier3" },
    { contents: tier4Contract, baseDir: testingDir, label: "tier4" },
    { contents: worldsContract, baseDir: testingDir, label: "worlds" },
    {
      contents: migrationContract,
      baseDir: path.dirname(migrationContractPath),
      label: "web-desktop migration",
    },
  ]) {
    for (const match of contents.matchAll(/\]\(([^)]+)\)/g)) {
      const target = match[1].trim();
      if (target.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(target)) {
        continue;
      }
      const relativePath = decodeURIComponent(target.split("#", 1)[0].split("?", 1)[0]);
      if (!relativePath) {
        continue;
      }
      const resolved = path.resolve(baseDir, relativePath);
      if (!existsSync(resolved)) {
        unresolved.push(`${label}: ${target}`);
      }
    }
  }
  assert.deepEqual(unresolved, []);
});
