/**
 * Bidirectional collector audit.
 *
 * The manifest names guarantees; the collector definitions name the cells that
 * actually run, with a truthful coverage classification. Neither may drift from
 * the other, and the report never hides an honest gap behind "OK":
 *
 *  (a) a manifest row claiming `collected`/`enforced` with no CORE collector is
 *      a defect — a coverage claim with nothing (or only a partial slice)
 *      behind it;
 *  (b) a collector naming a scenario id ABSENT from the manifest is an orphan
 *      no gate can select;
 *  (c) two collectors claiming the SAME cell key produce duplicate finals;
 *  (d) a CORE collector pointing at a still-`planned` row is NOT a defect but
 *      is reported visibly (`plannedCoreCollectors`) — the row stays
 *      unqualified until its status is flipped deliberately; and
 *  (e) foundation-partial collectors are enumerated (`foundationPartial`) so a
 *      diagnostic slice is never mistaken for row coverage.
 */

import type { ParsedManifest } from "./types.js";
import type { CollectorDefinition } from "./registry.js";

export interface CollectorAuditReport {
  readonly ok: boolean;
  /** Collected/enforced manifest ids with no CORE collector. */
  readonly uncoveredScenarioIds: readonly string[];
  /** Collector scenario ids not present in the manifest. */
  readonly orphanCollectorScenarioIds: readonly string[];
  /** Cell keys claimed by more than one collector, with the claimants. */
  readonly duplicateCellKeys: readonly { readonly cellKey: string; readonly collectors: readonly string[] }[];
  /** Collected/enforced ids whose ONLY collectors are foundation-partial. */
  readonly partialOnlyCoreClaims: readonly string[];
  /** CORE collectors whose manifest row is still planned (visible, not ok-hidden). */
  readonly plannedCoreCollectors: readonly string[];
  /** All foundation-partial collectors (diagnostic slices, never row coverage). */
  readonly foundationPartial: readonly string[];
  /** Collected/enforced ids with a core collector — the actually-covered set. */
  readonly coreCoveredScenarioIds: readonly string[];
  /** Human-readable defect lines (empty when ok). */
  readonly defects: readonly string[];
}

export function auditCollectors(
  parsed: ParsedManifest,
  registry: readonly CollectorDefinition[],
): CollectorAuditReport {
  const coreIds = new Set(registry.filter((e) => e.coverage === "core").map((e) => e.scenarioId));
  const anyIds = new Set(registry.map((e) => e.scenarioId));

  const claimingRows = [...parsed.manifest.requiredScenarios, ...parsed.manifest.composedJourneys];

  // (a) collected/enforced rows must have a CORE collector; partial-only is a
  // distinct, named defect.
  const uncovered: string[] = [];
  const partialOnly: string[] = [];
  const coreCovered: string[] = [];
  for (const row of claimingRows) {
    const status = row.implementation.status;
    if (status !== "collected" && status !== "enforced") continue;
    if (coreIds.has(row.id)) {
      coreCovered.push(row.id);
    } else if (anyIds.has(row.id)) {
      partialOnly.push(row.id);
    } else {
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

  // (d) core collectors pointing at planned rows: visible, not silent.
  const plannedCore: string[] = [];
  for (const entry of registry) {
    if (entry.coverage !== "core") continue;
    const row = parsed.scenarioById.get(entry.scenarioId) ?? parsed.journeyById.get(entry.scenarioId);
    if (row && row.implementation.status === "planned") plannedCore.push(entry.scenarioId);
  }

  // (e) all partial collectors, enumerated.
  const foundationPartial = registry
    .filter((e) => e.coverage === "foundation-partial")
    .map((e) => e.scenarioId);

  const defects: string[] = [];
  for (const id of uncovered) {
    defects.push(`manifest row "${id}" claims collected/enforced but no collector is registered`);
  }
  for (const id of partialOnly) {
    defects.push(
      `manifest row "${id}" claims collected/enforced but only foundation-partial collectors exist; a partial slice cannot satisfy the core row`,
    );
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
    partialOnlyCoreClaims: partialOnly,
    plannedCoreCollectors: plannedCore,
    foundationPartial,
    coreCoveredScenarioIds: coreCovered,
    defects,
  };
}
