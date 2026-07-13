import { test } from "node:test";
import assert from "node:assert/strict";

import { parseScenarioManifest } from "./load.js";
import type { ParsedManifest } from "./types.js";
import { cellKey } from "../contracts/identity.js";
import { defineCollector, type CollectorRegistryEntry } from "./registry.js";
import { loadScenarioManifest } from "./load.js";
import { defaultScenarioManifestPath } from "./paths.js";
import { COLLECTOR_DEFINITIONS, runnersForPlan } from "./registry.js";
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

/** Core registry for the fixture manifest's collected Tier 2 row. */
function mergeFixtureRegistry(): CollectorRegistryEntry[] {
  const auth = { scenarioId: "T2-AUTH-1", world: "tier-2", productHost: "desktop-web", dimensions: {} } as const;
  return [fixtureEntry("T2-AUTH-1", [auth], "fixture://auth", "core")];
}

test("merge expands collected rows via core collectors and keeps planned rows as bare placeholders", () => {
  const parsed = fixture();
  const sel = resolveMergeSelection(parsed, mergeFixtureRegistry());
  const ids = sel.cells.map((c) => c.scenarioId).sort();
  assert.deepEqual(ids, ["T2-AUTH-1", "T2-BILL-1"]);
  assert.ok(sel.cells.every((c) => c.disposition === "required" && c.world === "tier-2"));
  // Collected row rides the collector's exact identity; planned row is bare.
  const auth = sel.cells.find((c) => c.scenarioId === "T2-AUTH-1");
  const bill = sel.cells.find((c) => c.scenarioId === "T2-BILL-1");
  assert.equal(auth?.productHost, "desktop-web");
  assert.equal(bill?.productHost ?? null, null);
  assert.equal(sel.scenarioManifestHash, parsed.hash);
  assert.deepEqual(sel.deferredScenarioIds, []);
});


/** Fixture registry matching the fixture manifest's collected rows. */
function fixtureEntry(
  scenarioId: string,
  cells: readonly CollectorRegistryEntry["cells"][number][],
  collectorRef: string,
  coverage: CollectorRegistryEntry["coverage"] = "core",
): CollectorRegistryEntry {
  return defineCollector({
    scenarioId,
    collectorRef,
    coverage,
    gate: "release",
    evidence: "fixture",
    cellDefinitions: cells.map((cell) => ({ cell, execute: async () => undefined })),
  });
}

function fixtureRegistry(): CollectorRegistryEntry[] {
  const chat = { scenarioId: "T3-CHAT-1", world: "managed-cloud", productHost: null, dimensions: {} } as const;
  const up = { scenarioId: "T4-UP-1", world: "desktop-upgrade", productHost: null, dimensions: {} } as const;
  return [
    fixtureEntry("T3-CHAT-1", [chat], "fixture://chat"),
    fixtureEntry("T4-UP-1", [up], "fixture://up"),
  ];
}

test("release requires collected/referenced Tier 3 and defers planned + unreferenced", () => {
  const parsed = fixture();
  const sel = resolveReleaseSelection(parsed, {}, fixtureRegistry());
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
  const sel = resolveReleaseSelection(parsed, {}, fixtureRegistry());
  assert.ok(!sel.cells.some((c) => c.scenarioId === "T3-PLANNED-1"), "planned row is not required");
  assert.ok(sel.deferredScenarioIds.includes("T3-PLANNED-1"), "planned row is visibly deferred");
});

test("release accepts a change-triggered collected Tier 4 row (with an explicit world)", () => {
  const parsed = fixture();
  const sel = resolveReleaseSelection(
    parsed,
    { triggeredTier4: [{ scenarioId: "T4-UP-1", world: "desktop-upgrade" }] },
    fixtureRegistry(),
  );
  assert.ok(sel.cells.some((c) => c.scenarioId === "T4-UP-1" && c.world === "desktop-upgrade"));
});

test("release defers a triggered Tier 4 row that is still planned", () => {
  const parsed = fixture();
  const sel = resolveReleaseSelection(
    parsed,
    {
      triggeredTier4: [
        { scenarioId: "T4-PLANNED-1", world: "desktop-upgrade" },
        { scenarioId: "T4-UP-1", world: "desktop-upgrade" },
      ],
    },
    fixtureRegistry(),
  );
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
  const registry = mergeFixtureRegistry();
  assert.deepEqual(
    resolveSelection(parsed, { selector: "merge", cellIds: [], world: "tier-2", registry }).cells.map((c) => c.scenarioId).sort(),
    ["T2-AUTH-1", "T2-BILL-1"],
  );
  // merge/release ignore --cells entirely (the reproduced false-green fix).
  const merge = resolveSelection(parsed, { selector: "merge", cellIds: ["ARBITRARY"], world: "tier-2", registry });
  assert.ok(!merge.cells.some((c) => c.scenarioId === "ARBITRARY"));
  const explicit = resolveSelection(parsed, { selector: "explicit", cellIds: ["T2-AUTH-1"], world: "tier-2" });
  assert.equal(explicit.cells.length, 1);
});

// ── REGRESSION: selection/collection identity agreement (the reproduced
// 69-merge-cells/zero-collector-matches defect). A collected row's selected
// cell must be byte-identical (host + dimensions) to what its collector
// emits, or every required cell double-reports as missing AND unknown. ──

test("REGRESSION: merge selects the collector's EXACT cell identity for collected rows", () => {
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
    requiredScenarios: [
      { id: "T2-BILL-1", tier: 2, implementation: { status: "collected" } },
      { id: "T2-PLANNED-9", tier: 2, implementation: { status: "planned" } },
    ],
    composedJourneys: [],
  });
  const billCell = {
    scenarioId: "T2-BILL-1",
    world: "tier-2",
    productHost: "desktop-web",
    dimensions: { slice: "checkout-to-grant" },
  } as const;
  const registry: CollectorRegistryEntry[] = [
    fixtureEntry("T2-BILL-1", [billCell], "fixture://bill"),
  ];
  const sel = resolveMergeSelection(parsed, registry);
  const bill = sel.cells.find((c) => c.scenarioId === "T2-BILL-1");
  assert.ok(bill);
  // Exact identity: host AND matrix dimensions ride through selection.
  assert.equal(bill.productHost, "desktop-web");
  assert.deepEqual(bill.dimensions, { slice: "checkout-to-grant" });
  // The old behavior fabricated hostless, dimensionless cells; its key can
  // never match the collector-emitted final.
  const fabricated = cellKey({ scenarioId: "T2-BILL-1", world: "tier-2", productHost: null, dimensions: {} });
  assert.notEqual(cellKey(billCell), fabricated);
});

test("REGRESSION: merge hard-errors on a collected row with no registered collector", () => {
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
    requiredScenarios: [{ id: "T2-CLAIMED-1", tier: 2, implementation: { status: "collected" } }],
    composedJourneys: [],
  });
  assert.throws(() => resolveMergeSelection(parsed, []), /no collector is registered/);
});

test("unknown selector names are rejected, never treated as explicit", () => {
  const parsed = fixture();
  assert.throws(
    () => resolveSelection(parsed, { selector: "relaese", cellIds: ["T2-AUTH-1"], world: "tier-2" }),
    /unknown selector "relaese"/,
  );
});

// ── Explicit selection of registered collectors: exact declared cells ──

test("explicit --cells T2-BILL-1 expands to the partial collector's EXACT cell (host + dimensions), runnable via the shared CLI", () => {
  const parsed = loadScenarioManifest(defaultScenarioManifestPath());
  const sel = resolveExplicitSelection(
    parsed,
    { cellIds: ["T2-BILL-1"], world: "tier-2" },
    COLLECTOR_DEFINITIONS,
  );
  assert.equal(sel.cells.length, 1);
  assert.equal(sel.cells[0].productHost, "desktop-web");
  assert.deepEqual(sel.cells[0].dimensions, { slice: "checkout-to-grant" });
  // The runner registry materializes exactly this cell — no bypass needed.
  const key = cellKey({ scenarioId: "T2-BILL-1", world: "tier-2", productHost: "desktop-web", dimensions: { slice: "checkout-to-grant" } });
  const runners = runnersForPlan(new Set([key]), {} as never, COLLECTOR_DEFINITIONS);
  assert.equal(runners.length, 1);
  assert.equal(runners[0].cellKey, key);
});

test("explicit --cells LOCAL-2 expands to the harness-dimensioned cell", () => {
  const parsed = loadScenarioManifest(defaultScenarioManifestPath());
  const sel = resolveExplicitSelection(
    parsed,
    { cellIds: ["LOCAL-2"], world: "local-runtime" },
    COLLECTOR_DEFINITIONS,
  );
  assert.equal(sel.cells.length, 1);
  assert.equal(sel.cells[0].world, "local-runtime");
  assert.deepEqual(sel.cells[0].dimensions, { harness: "claude", route: "managed-gateway" });
});

test("partial collectors never satisfy merge/release: real-manifest merge has zero expanded cells", () => {
  const parsed = loadScenarioManifest(defaultScenarioManifestPath());
  const sel = resolveMergeSelection(parsed, COLLECTOR_DEFINITIONS);
  // Every Tier 2 row is planned; every collector is partial — so every merge
  // cell is a bare fail-closed placeholder and NONE carries collector identity.
  assert.ok(sel.cells.every((c) => (c.productHost ?? null) === null && !c.dimensions));
});
