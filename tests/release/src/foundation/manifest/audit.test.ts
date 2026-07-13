import { test } from "node:test";
import assert from "node:assert/strict";

import { parseScenarioManifest } from "./load.js";
import type { ParsedManifest } from "./types.js";
import { auditCollectors } from "./audit.js";
import type { CollectorRegistryEntry } from "./registry.js";
import { COLLECTOR_REGISTRY } from "./registry.js";
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

const CHAT_KEY = cellKey({ scenarioId: "T3-CHAT-1", world: "managed-cloud", productHost: "hosted-web", dimensions: {} });

test("audit passes when a collected row has a matching collector", () => {
  const parsed = manifestWith({ chat: "collected" });
  const registry: CollectorRegistryEntry[] = [
    { scenarioId: "T3-CHAT-1", cellKeys: [CHAT_KEY], collectorRef: "src/.../chat.ts" },
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
    { scenarioId: "T3-CHAT-1", cellKeys: [CHAT_KEY], collectorRef: "src/.../chat.ts" },
  ];
  const report = auditCollectors(parsed, registry);
  assert.equal(report.ok, false);
  assert.ok(report.uncoveredScenarioIds.includes("J-CHAT"));
});

test("(b) a collector naming an unknown scenario id fails the audit", () => {
  const parsed = manifestWith({ chat: "collected" });
  const registry: CollectorRegistryEntry[] = [
    { scenarioId: "T3-CHAT-1", cellKeys: [CHAT_KEY], collectorRef: "src/.../chat.ts" },
    { scenarioId: "T3-GHOST-1", cellKeys: ["managed-cloud/T3-GHOST-1/-/-"], collectorRef: "src/.../ghost.ts" },
  ];
  const report = auditCollectors(parsed, registry);
  assert.equal(report.ok, false);
  assert.deepEqual(report.orphanCollectorScenarioIds, ["T3-GHOST-1"]);
});

test("(c) two collectors claiming one cell key fail the audit", () => {
  const parsed = manifestWith({ chat: "collected" });
  const registry: CollectorRegistryEntry[] = [
    { scenarioId: "T3-CHAT-1", cellKeys: [CHAT_KEY], collectorRef: "src/.../chat-a.ts" },
    { scenarioId: "T3-CHAT-1", cellKeys: [CHAT_KEY], collectorRef: "src/.../chat-b.ts" },
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
  const report = auditCollectors(parsed, COLLECTOR_REGISTRY);
  assert.equal(report.orphanCollectorScenarioIds.length, 0, report.defects.join("; "));
  assert.equal(report.duplicateCellKeys.length, 0, report.defects.join("; "));
  assert.ok(report.ok, report.defects.join("; "));
});
