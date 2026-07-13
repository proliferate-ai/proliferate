import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { parseScenarioManifest, loadScenarioManifest, ManifestValidationError } from "./load.js";
import { defaultScenarioManifestPath } from "./paths.js";

/** A minimal, valid manifest object (schemaVersion 4). */
function validManifest(): Record<string, unknown> {
  return {
    schemaVersion: 4,
    qualificationPolicy: {
      tier3StandingSelection: {
        includeComposedJourneyReferences: true,
        standaloneScenarioIds: [],
        unreferencedDisposition: "deferred",
        fullCoreQualificationRequiresNoDeferred: true,
      },
    },
    requiredScenarios: [
      { id: "T2-AUTH-1", tier: 2, implementation: { status: "collected" } },
      { id: "T3-CHAT-1", tier: 3, implementation: { status: "collected" } },
      { id: "T3-ORPHAN-1", tier: 3, implementation: { status: "planned" } },
    ],
    composedJourneys: [
      {
        id: "J-CHAT",
        tier: 3,
        world: "managed-cloud",
        requiredHosts: ["hosted-web"],
        targetScenarioRefs: ["T3-CHAT-1"],
        implementation: { status: "collected" },
      },
    ],
  };
}

test("parseScenarioManifest accepts a valid manifest and indexes ids", () => {
  const parsed = parseScenarioManifest(validManifest());
  assert.equal(parsed.manifest.schemaVersion, 4);
  assert.equal(parsed.manifest.requiredScenarios.length, 3);
  assert.ok(parsed.scenarioById.has("T2-AUTH-1"));
  assert.ok(parsed.journeyById.has("J-CHAT"));
  assert.match(parsed.hash, /^[0-9a-f]{64}$/);
});

test("canonical hash is key-order independent but value sensitive", () => {
  const a = validManifest();
  // Same content, keys inserted in a different order.
  const b: Record<string, unknown> = {
    composedJourneys: a.composedJourneys,
    requiredScenarios: a.requiredScenarios,
    qualificationPolicy: a.qualificationPolicy,
    schemaVersion: a.schemaVersion,
  };
  assert.equal(parseScenarioManifest(a).hash, parseScenarioManifest(b).hash);

  const mutated = validManifest();
  (mutated.requiredScenarios as { id: string }[])[0].id = "T2-AUTH-2";
  assert.notEqual(parseScenarioManifest(a).hash, parseScenarioManifest(mutated).hash);
});

test("a non-object root is rejected", () => {
  assert.throws(() => parseScenarioManifest([]), ManifestValidationError);
  assert.throws(() => parseScenarioManifest(null), ManifestValidationError);
});

test("an unsupported schemaVersion is rejected", () => {
  const m = validManifest();
  m.schemaVersion = 3;
  assert.throws(() => parseScenarioManifest(m), /unsupported schemaVersion/);
});

test("duplicate scenario ids are rejected", () => {
  const m = validManifest();
  (m.requiredScenarios as unknown[]).push({ id: "T2-AUTH-1", tier: 2, implementation: { status: "planned" } });
  assert.throws(() => parseScenarioManifest(m), /duplicate scenario id/);
});

test("an invalid tier value is rejected", () => {
  const m = validManifest();
  (m.requiredScenarios as { tier: number }[])[0].tier = 1;
  assert.throws(() => parseScenarioManifest(m), /tier must be 2, 3, or 4/);
});

test("an invalid implementation status is rejected", () => {
  const m = validManifest();
  (m.requiredScenarios as { implementation: { status: string } }[])[0].implementation.status = "shipped";
  assert.throws(() => parseScenarioManifest(m), /status must be one of/);
});

test("a dangling journey reference is rejected", () => {
  const m = validManifest();
  (m.composedJourneys as { targetScenarioRefs: string[] }[])[0].targetScenarioRefs = ["T3-DOES-NOT-EXIST"];
  assert.throws(() => parseScenarioManifest(m), /references unknown scenario id/);
});

test("a standalone standing selection that is not Tier 3 is rejected", () => {
  const m = validManifest();
  (m.qualificationPolicy as { tier3StandingSelection: { standaloneScenarioIds: string[] } })
    .tier3StandingSelection.standaloneScenarioIds = ["T2-AUTH-1"];
  assert.throws(() => parseScenarioManifest(m), /must be Tier 3/);
});

test("validation aggregates every issue before any hash exists", () => {
  const m = validManifest();
  m.schemaVersion = 99;
  (m.requiredScenarios as { tier: number }[])[0].tier = 7;
  try {
    parseScenarioManifest(m);
    assert.fail("expected ManifestValidationError");
  } catch (error) {
    assert.ok(error instanceof ManifestValidationError);
    assert.ok(error.issues.length >= 2, "collects multiple issues");
  }
});

test("the real manifest on disk loads and validates", () => {
  // Guards against the loader drifting from the authoritative manifest.
  const parsed = loadScenarioManifest(defaultScenarioManifestPath());
  assert.ok(parsed.manifest.requiredScenarios.length > 0);
  assert.match(parsed.hash, /^[0-9a-f]{64}$/);
});

test("loadScenarioManifest surfaces a typed error for missing/invalid files", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "manifest-load-"));
  try {
    assert.throws(() => loadScenarioManifest(path.join(dir, "nope.json")), ManifestValidationError);
    const bad = path.join(dir, "bad.json");
    writeFileSync(bad, "{ not json");
    assert.throws(() => loadScenarioManifest(bad), /invalid JSON/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
