/**
 * Bidirectional collector audit.
 *
 * The manifest names guarantees; the collector registry names the cells that
 * actually run. Neither may drift from the other. The audit fails when:
 *
 *  (a) a manifest row claiming `collected`/`enforced` has NO registered
 *      collector — a coverage claim with nothing behind it;
 *  (b) a collector names a scenario id ABSENT from the manifest — an orphaned
 *      collector no gate can select; or
 *  (c) two collectors claim the SAME cell key — duplicate final results, which
 *      the aggregate rejects, so catch it at wiring time.
 *
 * `planned` manifest rows are expected to have no collector (that is what
 * `planned` means), so they never trigger (a). This is diagnostics-only data
 * (ids and shapes), never secrets.
 */

import type { ParsedManifest } from "./types.js";
import type { CollectorRegistryEntry } from "./registry.js";

export interface CollectorAuditReport {
  readonly ok: boolean;
  /** Collected/enforced manifest ids with no collector. */
  readonly uncoveredScenarioIds: readonly string[];
  /** Collector scenario ids not present in the manifest. */
  readonly orphanCollectorScenarioIds: readonly string[];
  /** Cell keys claimed by more than one collector, with the claimants. */
  readonly duplicateCellKeys: readonly { readonly cellKey: string; readonly collectors: readonly string[] }[];
  /** Human-readable defect lines (empty when ok). */
  readonly defects: readonly string[];
}

export function auditCollectors(
  parsed: ParsedManifest,
  registry: readonly CollectorRegistryEntry[],
): CollectorAuditReport {
  const collectorScenarioIds = new Set(registry.map((e) => e.scenarioId));

  // (a) collected/enforced rows (scenarios AND journeys) must have a collector.
  const uncovered: string[] = [];
  const claimingRows = [
    ...parsed.manifest.requiredScenarios,
    ...parsed.manifest.composedJourneys,
  ];
  for (const row of claimingRows) {
    const status = row.implementation.status;
    if ((status === "collected" || status === "enforced") && !collectorScenarioIds.has(row.id)) {
      uncovered.push(row.id);
    }
  }

  // (b) collectors must name a scenario/journey id that exists in the manifest.
  const orphans: string[] = [];
  for (const entry of registry) {
    if (!parsed.scenarioById.has(entry.scenarioId) && !parsed.journeyById.has(entry.scenarioId)) {
      orphans.push(entry.scenarioId);
    }
  }

  // (c) a cell key may be claimed by exactly one collector.
  const claimants = new Map<string, string[]>();
  for (const entry of registry) {
    for (const key of entry.cellKeys) {
      const list = claimants.get(key) ?? [];
      list.push(entry.scenarioId);
      claimants.set(key, list);
    }
  }
  const duplicates: { cellKey: string; collectors: string[] }[] = [];
  for (const [key, collectors] of claimants) {
    if (collectors.length > 1) duplicates.push({ cellKey: key, collectors });
  }

  const defects: string[] = [];
  for (const id of uncovered) {
    defects.push(`manifest row "${id}" claims collected/enforced but no collector is registered`);
  }
  for (const id of orphans) {
    defects.push(`collector for "${id}" names a scenario id absent from the manifest`);
  }
  for (const dup of duplicates) {
    defects.push(`cell "${dup.cellKey}" is claimed by multiple collectors: ${dup.collectors.join(", ")}`);
  }

  return {
    ok: defects.length === 0,
    uncoveredScenarioIds: uncovered,
    orphanCollectorScenarioIds: orphans,
    duplicateCellKeys: duplicates,
    defects,
  };
}
