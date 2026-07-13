import { test } from "node:test";
import assert from "node:assert/strict";

import { parseScenarioManifest } from "./load.js";
import type { ParsedManifest } from "./types.js";
import {
  resolveMergeSelection,
  resolveReleaseSelection,
  resolveExplicitSelection,
  resolveSelection,
} from "./selectors.js";

/**
 * A fixture manifest with a mix of tier-2/3/4 rows and journeys so the selector
 * rules (planned => deferred, unreferenced => deferred, collected => required)
 * can each be exercised independently of the real manifest's build-out state.
 */
function fixture(): ParsedManifest {
  return parseScenarioManifest({
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
      { id: "T2-BILL-1", tier: 2, implementation: { status: "planned" } },
      // Referenced by J-CHAT and collected => release requires it.
      { id: "T3-CHAT-1", tier: 3, implementation: { status: "collected" } },
      // Referenced by a journey but still planned => release defers it.
      { id: "T3-PLANNED-1", tier: 3, implementation: { status: "planned" } },
      // Not referenced by any journey => release defers it.
      { id: "T3-ORPHAN-1", tier: 3, implementation: { status: "collected" } },
      // A change-triggered Tier 4 row (flat, no world in the manifest).
      { id: "T4-UP-1", tier: 4, implementation: { status: "collected" } },
      { id: "T4-PLANNED-1", tier: 4, implementation: { status: "planned" } },
    ],
    composedJourneys: [
      {
        id: "J-CHAT",
        tier: 3,
        world: "managed-cloud",
        requiredHosts: ["hosted-web"],
        targetScenarioRefs: ["T3-CHAT-1", "T3-PLANNED-1"],
        implementation: { status: "collected" },
      },
    ],
  });
}

test("merge selects every Tier 2 row as required, even planned ones", () => {
  const parsed = fixture();
  const sel = resolveMergeSelection(parsed);
  const ids = sel.cells.map((c) => c.scenarioId).sort();
  assert.deepEqual(ids, ["T2-AUTH-1", "T2-BILL-1"]);
  assert.ok(sel.cells.every((c) => c.disposition === "required" && c.world === "tier-2"));
  assert.equal(sel.scenarioManifestHash, parsed.hash);
  assert.deepEqual(sel.deferredScenarioIds, []);
});

test("release requires collected/referenced Tier 3 and defers planned + unreferenced", () => {
  const parsed = fixture();
  const sel = resolveReleaseSelection(parsed);
  // Only T3-CHAT-1 is standing (journey-referenced) AND collected => required.
  const requiredIds = sel.cells.map((c) => c.scenarioId).sort();
  assert.deepEqual(requiredIds, ["T3-CHAT-1"]);
  assert.equal(sel.cells[0].world, "managed-cloud");
  // T3-PLANNED-1 (standing but planned) and T3-ORPHAN-1 (unreferenced) both defer.
  assert.deepEqual([...sel.deferredScenarioIds].sort(), ["T3-ORPHAN-1", "T3-PLANNED-1"]);
  assert.equal(sel.scenarioManifestHash, parsed.hash);
});

test("release deferred derivation is exact: a planned standing row never becomes required", () => {
  const parsed = fixture();
  const sel = resolveReleaseSelection(parsed);
  assert.ok(!sel.cells.some((c) => c.scenarioId === "T3-PLANNED-1"), "planned row is not required");
  assert.ok(sel.deferredScenarioIds.includes("T3-PLANNED-1"), "planned row is visibly deferred");
});

test("release accepts a change-triggered collected Tier 4 row (with an explicit world)", () => {
  const parsed = fixture();
  const sel = resolveReleaseSelection(parsed, {
    triggeredTier4: [{ scenarioId: "T4-UP-1", world: "desktop-upgrade" }],
  });
  assert.ok(sel.cells.some((c) => c.scenarioId === "T4-UP-1" && c.world === "desktop-upgrade"));
});

test("release defers a triggered Tier 4 row that is still planned", () => {
  const parsed = fixture();
  const sel = resolveReleaseSelection(parsed, {
    triggeredTier4: [
      { scenarioId: "T4-PLANNED-1", world: "desktop-upgrade" },
      { scenarioId: "T4-UP-1", world: "desktop-upgrade" },
    ],
  });
  assert.ok(sel.deferredScenarioIds.includes("T4-PLANNED-1"));
  assert.ok(sel.cells.some((c) => c.scenarioId === "T4-UP-1"));
});

test("release rejects a triggered id that is not Tier 4 or not in the manifest", () => {
  const parsed = fixture();
  assert.throws(
    () => resolveReleaseSelection(parsed, { triggeredTier4: [{ scenarioId: "T3-CHAT-1", world: "managed-cloud" }] }),
    /only Tier 4 rows are change-triggered/,
  );
  assert.throws(
    () => resolveReleaseSelection(parsed, { triggeredTier4: [{ scenarioId: "NOPE", world: "managed-cloud" }] }),
    /not in the manifest/,
  );
});

test("release with zero required cells is a hard error before execution", () => {
  // A manifest where every Tier 3 row is planned (deferred) and no Tier 4 is
  // triggered mirrors the real build-out state: release must refuse to run.
  const parsed = parseScenarioManifest({
    schemaVersion: 4,
    qualificationPolicy: {
      tier3StandingSelection: {
        includeComposedJourneyReferences: true,
        standaloneScenarioIds: [],
        unreferencedDisposition: "deferred",
        fullCoreQualificationRequiresNoDeferred: true,
      },
    },
    requiredScenarios: [{ id: "T3-CHAT-1", tier: 3, implementation: { status: "planned" } }],
    composedJourneys: [
      {
        id: "J-CHAT",
        tier: 3,
        world: "managed-cloud",
        requiredHosts: ["hosted-web"],
        targetScenarioRefs: ["T3-CHAT-1"],
        implementation: { status: "planned" },
      },
    ],
  });
  assert.throws(() => resolveReleaseSelection(parsed), /empty selection cannot qualify/);
});

test("explicit rejects an unknown --cells id", () => {
  const parsed = fixture();
  assert.throws(
    () => resolveExplicitSelection(parsed, { cellIds: ["T2-AUTH-1", "T2-NOPE-9"], world: "tier-2" }),
    /unknown scenario id "T2-NOPE-9"/,
  );
});

test("explicit rejects an empty selection", () => {
  const parsed = fixture();
  assert.throws(() => resolveExplicitSelection(parsed, { cellIds: [], world: "tier-2" }), /empty selection/);
});

test("explicit binds the real hash for a pure-manifest selection", () => {
  const parsed = fixture();
  const sel = resolveExplicitSelection(parsed, { cellIds: ["T2-AUTH-1"], world: "tier-2" });
  assert.equal(sel.scenarioManifestHash, parsed.hash);
});

test("explicit with a fixture-namespace id is an ad hoc baseline with a null hash", () => {
  const parsed = fixture();
  const sel = resolveExplicitSelection(parsed, {
    cellIds: ["FIXTURE-ONLY-1"],
    world: "tier-2",
    fixtureNamespaceIds: ["FIXTURE-ONLY-1"],
  });
  assert.equal(sel.scenarioManifestHash, null, "a fixture-augmented selection can never qualify");
  assert.equal(sel.cells.length, 1);
});

test("resolveSelection dispatches on the selector label", () => {
  const parsed = fixture();
  assert.deepEqual(
    resolveSelection(parsed, { selector: "merge", cellIds: [], world: "tier-2" }).cells.map((c) => c.scenarioId).sort(),
    ["T2-AUTH-1", "T2-BILL-1"],
  );
  // merge/release ignore --cells entirely (the reproduced false-green fix).
  const merge = resolveSelection(parsed, { selector: "merge", cellIds: ["ARBITRARY"], world: "tier-2" });
  assert.ok(!merge.cells.some((c) => c.scenarioId === "ARBITRARY"));
  const explicit = resolveSelection(parsed, { selector: "explicit", cellIds: ["T2-AUTH-1"], world: "tier-2" });
  assert.equal(explicit.cells.length, 1);
});
