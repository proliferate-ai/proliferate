#!/usr/bin/env -S npx tsx
/**
 * `pnpm -C tests/release run manifest-audit`
 *
 * Loads + validates the real core-release scenario manifest, runs the
 * bidirectional collector audit against the registered collectors, and prints
 * a names-and-shapes-only report. Exits nonzero on any defect (uncovered
 * collected/enforced row, orphan collector, or duplicate cell claim). Never
 * prints a secret.
 */

import { loadScenarioManifest } from "./load.js";
import { defaultScenarioManifestPath } from "./paths.js";
import { auditCollectors } from "./audit.js";
import { COLLECTOR_REGISTRY } from "./registry.js";

function main(): void {
  const manifestPath = process.argv[2] ?? defaultScenarioManifestPath();
  const parsed = loadScenarioManifest(manifestPath);
  const report = auditCollectors(parsed, COLLECTOR_REGISTRY);

  console.log(`Collector audit (manifest hash ${parsed.hash.slice(0, 12)}…):`);
  console.log(
    `  ${parsed.manifest.requiredScenarios.length} guarantees, ` +
      `${parsed.manifest.composedJourneys.length} journeys, ` +
      `${COLLECTOR_REGISTRY.length} registered collectors`,
  );

  // Truthful coverage breakdown — printed on every run so honest gaps are
  // never hidden behind a bare "OK".
  console.log(`  core-covered (collected/enforced + core collector): ${fmt(report.coreCoveredScenarioIds)}`);
  console.log(`  planned rows with a core collector awaiting a deliberate status flip: ${fmt(report.plannedCoreCollectors)}`);
  console.log(`  foundation-partial collectors (diagnostic slices, never row coverage): ${fmt(report.foundationPartial)}`);

  if (report.ok) {
    console.log("  OK: no coverage claim is unbacked and no collector is orphaned/duplicated.");
    return;
  }

  console.log(`\n${report.defects.length} defect(s):`);
  for (const defect of report.defects) console.log(`  - ${defect}`);
  process.exitCode = 1;
}

function fmt(ids: readonly string[]): string {
  return ids.length === 0 ? "none" : `${ids.length} [${ids.join(", ")}]`;
}

main();
