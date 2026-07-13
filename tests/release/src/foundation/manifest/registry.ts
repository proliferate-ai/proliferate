/**
 * Collector registry — the machine-readable inverse of the scenario manifest.
 *
 * Entries are built from the REAL exported cell identities of the collector
 * modules, not hand-maintained copies: renaming a dimension, host, or scenario
 * id in a collector changes the registry automatically, so the bidirectional
 * audit (audit.ts) fails loudly instead of drifting silently.
 */

import { cellKey, type CellIdentity } from "../contracts/identity.js";
import { T2_AUTH_1_CELL } from "../worlds/tier2/cells/t2-auth-1.js";
import { T2_BILL_1_CELL } from "../worlds/tier2/cells/t2-bill-1.js";
import { local2CellIdentity } from "../worlds/local-runtime/local-2.js";

export interface CollectorRegistryEntry {
  /** Manifest guarantee/journey id the collector proves (must exist in the manifest). */
  readonly scenarioId: string;
  /** The exact executable cell identities this collector emits finals for. */
  readonly cells: readonly CellIdentity[];
  /** Every cell key this collector produces a final result for. */
  readonly cellKeys: readonly string[];
  /** Repo-relative path to the collector source, for triage. */
  readonly collectorRef: string;
}

function entry(scenarioId: string, cells: CellIdentity[], collectorRef: string): CollectorRegistryEntry {
  for (const cell of cells) {
    if (cell.scenarioId !== scenarioId) {
      throw new Error(
        `collector registry wiring bug: entry "${scenarioId}" contains a cell for "${cell.scenarioId}"`,
      );
    }
  }
  return { scenarioId, cells, cellKeys: cells.map(cellKey), collectorRef };
}

/**
 * The collectors implemented on this branch, keyed by the real exported cell
 * identities. World adapters append their own entries as they land; the audit
 * fails the build if this diverges from the manifest.
 */
export const COLLECTOR_REGISTRY: readonly CollectorRegistryEntry[] = [
  entry("T2-AUTH-1", [T2_AUTH_1_CELL], "src/foundation/worlds/tier2/cells/t2-auth-1.ts"),
  entry("T2-BILL-1", [T2_BILL_1_CELL], "src/foundation/worlds/tier2/cells/t2-bill-1.ts"),
  entry("LOCAL-2", [local2CellIdentity("claude")], "src/foundation/worlds/local-runtime/local-2.ts"),
];
