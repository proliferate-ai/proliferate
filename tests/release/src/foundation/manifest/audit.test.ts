import { test } from "node:test";
import assert from "node:assert/strict";

import { parseScenarioManifest } from "./load.js";
import type { ParsedManifest } from "./types.js";
import { auditCollectors } from "./audit.js";
import { defineCollector, type CollectorRegistryEntry } from "./registry.js";
import type { WorldId, ProductHost } from "../contracts/identity.js";
import { COLLECTOR_DEFINITIONS } from "./registry.js";
import { resolveMergeSelection } from "./selectors.js";
import { loadScenarioManifest } from "./load.js";
import { defaultScenarioManifestPath } from "./paths.js";
import { cellKey } from "../contracts/identity.js";

function manifestWith(statuses: {
  chat?: "planned" | "collected" | "enforced";
  journey?: "planned" | "collected" | "enforced";
}): ParsedManifest {
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
      { id: "T3-CHAT-1", tier: 3, implementation: { status: statuses.chat ?? "planned" } },
    ],
    composedJourneys: [
      {
        id: "J-CHAT",
        tier: 3,
        world: "managed-cloud",
        requiredHosts: ["hosted-web"],
        targetScenarioRefs: ["T3-CHAT-1"],
        implementation: { status: statuses.journey ?? "planned" },
      },
    ],
  });
}


function fixtureDef(
  scenarioId: string,
  cells: readonly { scenarioId: string; world: WorldId; productHost: ProductHost | null; dimensions: Record<string, string> }[],
  collectorRef: string,
  coverage: "core" | "foundation-partial" = "core",
): CollectorRegistryEntry {
  return defineCollector({
    scenarioId,
    collectedTestId: "fixture://test-id",
    collectorRef,
    coverage,
    gate: "merge",
    evidence: "fixture",
    cellDefinitions: cells.map((cell) => ({
      cell,
      assertionIds: ["fixture-assertion"],
      async execute(ctx) {
        await ctx.proof.pass("fixture-assertion", "fixture");
        return { correlationIds: [] };
      },
    })),
  });
}

const CHAT_CELL = { scenarioId: "T3-CHAT-1", world: "managed-cloud", productHost: "hosted-web", dimensions: {} } as const;
const CHAT_KEY = cellKey(CHAT_CELL);

test("audit passes when a collected row has a matching collector", () => {
  const parsed = manifestWith({ chat: "collected" });
  const registry: CollectorRegistryEntry[] = [
    fixtureDef("T3-CHAT-1", [CHAT_CELL], "src/.../chat.ts"),
  ];
  const report = auditCollectors(parsed, registry);
  assert.ok(report.ok, report.defects.join("; "));
});

test("(a) a collected/enforced row without a collector fails the audit", () => {
  const parsed = manifestWith({ chat: "enforced" });
  const report = auditCollectors(parsed, []);
  assert.equal(report.ok, false);
  assert.deepEqual(report.uncoveredScenarioIds, ["T3-CHAT-1"]);
});

test("(a) a planned row without a collector is fine (planned means no collector)", () => {
  const parsed = manifestWith({ chat: "planned" });
  const report = auditCollectors(parsed, []);
  assert.ok(report.ok);
});

test("(a) a collected journey without a collector fails the audit", () => {
  const parsed = manifestWith({ chat: "collected", journey: "collected" });
  const registry: CollectorRegistryEntry[] = [
    fixtureDef("T3-CHAT-1", [CHAT_CELL], "src/.../chat.ts"),
  ];
  const report = auditCollectors(parsed, registry);
  assert.equal(report.ok, false);
  assert.ok(report.uncoveredScenarioIds.includes("J-CHAT"));
});

test("(b) a collector naming an unknown scenario id fails the audit", () => {
  const parsed = manifestWith({ chat: "collected" });
  const registry: CollectorRegistryEntry[] = [
    fixtureDef("T3-CHAT-1", [CHAT_CELL], "src/.../chat.ts"),
    fixtureDef(
      "T3-GHOST-1",
      [{ scenarioId: "T3-GHOST-1", world: "managed-cloud", productHost: null, dimensions: {} }],
      "src/.../ghost.ts",
    ),
  ];
  const report = auditCollectors(parsed, registry);
  assert.equal(report.ok, false);
  assert.deepEqual(report.orphanCollectorScenarioIds, ["T3-GHOST-1"]);
});

test("(c) two collectors claiming one cell key fail the audit", () => {
  const parsed = manifestWith({ chat: "collected" });
  const registry: CollectorRegistryEntry[] = [
    fixtureDef("T3-CHAT-1", [CHAT_CELL], "src/.../chat-a.ts"),
    fixtureDef("T3-CHAT-1", [CHAT_CELL], "src/.../chat-b.ts"),
  ];
  const report = auditCollectors(parsed, registry);
  assert.equal(report.ok, false);
  assert.equal(report.duplicateCellKeys.length, 1);
  assert.equal(report.duplicateCellKeys[0].cellKey, CHAT_KEY);
});

test("the shipped registry agrees with the real manifest", () => {
  // Every registered collector must name a real manifest id (no orphans) and no
  // two collectors may claim one cell — the guarantee `pnpm run manifest-audit`
  // gives, asserted in a test so it cannot regress silently.
  const parsed = loadScenarioManifest(defaultScenarioManifestPath());
  const report = auditCollectors(parsed, COLLECTOR_DEFINITIONS);
  assert.equal(report.orphanCollectorScenarioIds.length, 0, report.defects.join("; "));
  assert.equal(report.duplicateCellKeys.length, 0, report.defects.join("; "));
  assert.ok(report.ok, report.defects.join("; "));
});

// ── Truthful coverage classification (post-review acceptance) ──

test("a collected row backed ONLY by a foundation-partial collector is a defect, never OK", () => {
  const parsed = manifestWith({ chat: "collected" });
  const registry: CollectorRegistryEntry[] = [
    fixtureDef("T3-CHAT-1", [CHAT_CELL], "src/.../chat.ts", "foundation-partial"),
  ];
  const report = auditCollectors(parsed, registry);
  assert.equal(report.ok, false);
  assert.deepEqual(report.partialOnlyCoreClaims, ["T3-CHAT-1"]);
  assert.ok(report.defects.some((d) => d.includes("partial slice cannot satisfy the core row")));
});

test("a core collector pointing at a planned row is a HARD defect (flip must be atomic)", () => {
  const parsed = manifestWith({ chat: "planned" });
  const registry: CollectorRegistryEntry[] = [
    fixtureDef("T3-CHAT-1", [CHAT_CELL], "src/.../chat.ts", "core"),
  ];
  const report = auditCollectors(parsed, registry);
  assert.equal(report.ok, false);
  assert.deepEqual(report.plannedCoreCollectors, ["T3-CHAT-1"]);
  assert.deepEqual(report.coreCoveredScenarioIds, []);
  assert.ok(report.defects.some((d) => d.includes("flip the row status atomically")));
});

// ── REAL-manifest regressions: the actual build-out state stays honest. ──

test("REAL MANIFEST: every row is planned and every current collector is foundation-partial", () => {
  const parsed = loadScenarioManifest(defaultScenarioManifestPath());
  const report = auditCollectors(parsed, COLLECTOR_DEFINITIONS);
  assert.equal(report.ok, true, report.defects.join("; "));
  // No row claims collected/enforced yet, so the core-covered set is empty …
  assert.deepEqual(report.coreCoveredScenarioIds, []);
  // … no collector claims core (T2-AUTH-1 skips its fresh-claim assertions on
  // a reused profile DB, so it is NOT qualification-safe yet) …
  assert.deepEqual(report.plannedCoreCollectors, []);
  // … and all three slices are enumerated as diagnostics, never coverage.
  assert.deepEqual([...report.foundationPartial].sort(), ["LOCAL-2", "T2-AUTH-1", "T2-BILL-1"]);
});

test("REAL MANIFEST: a foundation-partial collector cannot promote its core guarantee even if the row were flipped", () => {
  // Simulate the wrong flip: T2-BILL-1 marked collected while only the
  // partial checkout-to-grant slice exists. The audit must reject it and the
  // merge selector must refuse to resolve it.
  const parsed = loadScenarioManifest(defaultScenarioManifestPath());
  const flipped = parseScenarioManifest({
    schemaVersion: parsed.manifest.schemaVersion,
    qualificationPolicy: parsed.manifest.qualificationPolicy,
    requiredScenarios: parsed.manifest.requiredScenarios.map((r) =>
      r.id === "T2-BILL-1" ? { ...r, implementation: { status: "collected" } } : r,
    ),
    composedJourneys: parsed.manifest.composedJourneys,
  });
  const report = auditCollectors(flipped, COLLECTOR_DEFINITIONS);
  assert.equal(report.ok, false);
  assert.deepEqual(report.partialOnlyCoreClaims, ["T2-BILL-1"]);
  assert.throws(
    () => resolveMergeSelection(flipped, COLLECTOR_DEFINITIONS),
    /partial vertical slice cannot satisfy the core row/,
  );
});

test("REAL MANIFEST: merge keeps every planned Tier 2 row as a fail-closed placeholder (visibly unqualified)", () => {
  const parsed = loadScenarioManifest(defaultScenarioManifestPath());
  const sel = resolveMergeSelection(parsed, COLLECTOR_DEFINITIONS);
  const tier2Rows = parsed.manifest.requiredScenarios.filter((r) => r.tier === 2);
  // One bare placeholder per planned row: nothing expanded, nothing dropped.
  assert.equal(sel.cells.length, tier2Rows.length);
  assert.ok(sel.cells.every((c) => c.productHost === undefined || c.productHost === null));
  // A strict merge run against this plan can only report missing finals —
  // planned rows have no execution claim and remain visibly unqualified.
});
