/**
 * Collector registry — the machine-readable inverse of the scenario manifest.
 *
 * World adapters register the cells their collectors actually claim here, so
 * the bidirectional audit (audit.ts) can prove the manifest and the executable
 * collectors agree: no collected/enforced manifest row without a collector, no
 * collector naming an unknown scenario, and no two collectors claiming one cell.
 *
 * `cellKeys` are computed via the frozen `cellKey` from the SAME cell identity
 * the collector emits, and `collectorRef` points at the real collector source,
 * so this registry drifts loudly rather than silently.
 */

import { cellKey, type CellIdentity } from "../contracts/identity.js";

export interface CollectorRegistryEntry {
  /** Manifest guarantee/journey id the collector proves (must exist in the manifest). */
  readonly scenarioId: string;
  /** Every cell key this collector produces a final result for. */
  readonly cellKeys: readonly string[];
  /** Repo-relative path to the collector source, for triage. */
  readonly collectorRef: string;
}

// --- Real cell identities (mirrors of the collector modules named below). ---

/** src/foundation/worlds/tier2/cells/t2-auth-1.ts `CELL`. */
const T2_AUTH_1_CELL: CellIdentity = {
  scenarioId: "T2-AUTH-1",
  world: "tier-2",
  productHost: "desktop-web",
  dimensions: {},
};

/** src/foundation/worlds/tier2/cells/t2-bill-1.ts `CELL`. */
const T2_BILL_1_CELL: CellIdentity = {
  scenarioId: "T2-BILL-1",
  world: "tier-2",
  productHost: "desktop-web",
  dimensions: { slice: "checkout-to-grant" },
};

/** src/foundation/worlds/local-runtime/local-2.ts `local2CellIdentity("claude")`. */
const LOCAL_2_CLAUDE_CELL: CellIdentity = {
  scenarioId: "LOCAL-2",
  world: "local-runtime",
  productHost: "desktop-web",
  dimensions: { harness: "claude", route: "managed-gateway" },
};

/**
 * The collectors implemented on this branch. World adapters append their own
 * entries as they land; the audit fails the build if this diverges from the
 * manifest.
 */
export const COLLECTOR_REGISTRY: readonly CollectorRegistryEntry[] = [
  {
    scenarioId: "T2-AUTH-1",
    cellKeys: [cellKey(T2_AUTH_1_CELL)],
    collectorRef: "src/foundation/worlds/tier2/cells/t2-auth-1.ts",
  },
  {
    scenarioId: "T2-BILL-1",
    cellKeys: [cellKey(T2_BILL_1_CELL)],
    collectorRef: "src/foundation/worlds/tier2/cells/t2-bill-1.ts",
  },
  {
    scenarioId: "LOCAL-2",
    cellKeys: [cellKey(LOCAL_2_CLAUDE_CELL)],
    collectorRef: "src/foundation/worlds/local-runtime/local-2.ts",
  },
];
