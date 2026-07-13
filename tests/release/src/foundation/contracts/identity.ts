/**
 * Run, shard, and cell identity — the spine every provider resource, ready
 * handle, attempt, evidence record, and cleanup entry carries.
 *
 * Frozen contract (specs/developing/testing/release-worlds-and-fixtures.md
 * "Run and shard identity"). World adapters consume these types; they do not
 * redefine them.
 */

/** The six worlds. `tier-2` is a world like any other, not a special mode. */
export type WorldId =
  | "tier-2"
  | "local-runtime"
  | "managed-cloud"
  | "self-host"
  | "desktop-upgrade"
  | "managed-cloud-upgrade";

export const ALL_WORLDS: readonly WorldId[] = [
  "tier-2",
  "local-runtime",
  "managed-cloud",
  "self-host",
  "desktop-upgrade",
  "managed-cloud-upgrade",
];

/** Product host is an independent axis, never collapsed into "lane". */
export type ProductHost = "desktop-web" | "desktop-native" | "hosted-web";

/** Where the runner process executes. Changes secret source, nothing else. */
export type ExecutionHost = "local" | "github-actions";

/** Result behavior: the only two. Planning/dry-run is not a behavior. */
export type ResultBehavior = "diagnostic" | "strict";

export interface RunIdentity {
  /** Groups the complete invocation and all of its evidence. */
  readonly runId: string;
  /** Exact source SHA under test. */
  readonly sourceSha: string;
  /** Canonical hash of the candidate manifest (see artifacts.ts). */
  readonly candidateManifestHash: string;
  /** Canonical hash of the retained N-1 manifest; null when no Tier 4 world selected. */
  readonly retainedManifestHash: string | null;
  readonly executionHost: ExecutionHost;
  /** GitHub workflow run URL or "local:<hostname>" — traceability, not config. */
  readonly origin: string;
  /** ISO-8601 creation instant, recorded once before any provider mutation. */
  readonly createdAt: string;
}

export interface ShardIdentity {
  readonly runId: string;
  /** Deterministic partition id, e.g. "shard-2-of-4". A one-shard run is "shard-1-of-1". */
  readonly shardId: string;
  readonly shardIndex: number;
  readonly shardCount: number;
}

/**
 * One required expansion of a guarantee/journey across derived dimensions.
 * `dimensions` holds only the axes that apply (harness, route, host, plan,
 * role, changedArtifact, ...) with stable lowercase values.
 */
export interface CellIdentity {
  /** Stable guarantee or composed-journey id, e.g. "T2-AUTH-1", "LOCAL-2". */
  readonly scenarioId: string;
  readonly world: WorldId;
  readonly productHost: ProductHost | null;
  readonly dimensions: Readonly<Record<string, string>>;
}

/**
 * Deterministic cell key: same identity always produces the same key, on any
 * host, in any process. Dimension order never affects it.
 */
export function cellKey(cell: CellIdentity): string {
  const dims = Object.keys(cell.dimensions)
    .sort()
    .map((k) => `${k}=${cell.dimensions[k]}`)
    .join(",");
  const host = cell.productHost ?? "-";
  return `${cell.world}/${cell.scenarioId}/${host}/${dims || "-"}`;
}

export interface AttemptIdentity {
  readonly runId: string;
  readonly shardId: string;
  readonly cellKey: string;
  /** 1-based; a retry gets a new attemptId without erasing the original. */
  readonly attemptNumber: number;
  readonly attemptId: string;
}
