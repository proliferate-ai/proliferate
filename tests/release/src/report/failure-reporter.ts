import type { FinalCellResultV1 } from "../runner/result.js";
import type { FailureReport } from "./types.js";

/**
 * In-memory compatibility mapping from normalized `failed` results to the
 * issue-filing payload (specs/developing/testing/qualification-runner-core.md
 * "Failure behavior"). Only normalized failed results produce a payload; no
 * status writes a per-failure JSON file — the combined report
 * (src/evidence/write.ts) is the only on-disk artifact. Payloads carry the
 * exact cell identity (specs/developing/testing/exact-test-matrix.md), so a
 * failed matrix child (`T3-CHAT-1/local/harness=codex`) files and dedupes as
 * its own issue rather than collapsing into its scenario.
 */
export function toFailureReports(failed: readonly FinalCellResultV1[]): FailureReport[] {
  return failed.filter((result) => result.status === "failed").map(toFailureReport);
}

function toFailureReport(result: FinalCellResultV1): FailureReport {
  return {
    flow: result.registry_flow_ref,
    // The issue payload's identity field carries the exact cell id; the
    // downstream filer's scenario+lane dedupe key therefore distinguishes
    // matrix children instead of hiding them behind one parent issue.
    scenario_id: result.cell_id,
    lane: result.runtime_lane,
    expected: `${result.cell_id} completes without error`,
    observed: result.reason?.message ?? "cell failed with no recorded reason",
    logs_excerpt: "",
    correlation_ids: [],
    timestamp: result.finished_at,
  };
}
