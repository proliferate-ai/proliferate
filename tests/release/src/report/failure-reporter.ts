import type { FinalTestResultV1 } from "../runner/result.js";
import type { FailureReport } from "./types.js";

/**
 * In-memory compatibility mapping from normalized `failed` results to the
 * issue-filing payload (specs/developing/testing/qualification-runner-core.md
 * "Failure behavior"). Only normalized failed results produce a payload; no
 * status writes a per-failure JSON file — the combined report
 * (src/evidence/write.ts) is the only on-disk artifact.
 */
export function toFailureReports(failed: readonly FinalTestResultV1[]): FailureReport[] {
  return failed.filter((result) => result.status === "failed").map(toFailureReport);
}

function toFailureReport(result: FinalTestResultV1): FailureReport {
  return {
    flow: result.registry_flow_ref,
    scenario_id: result.scenario_id,
    lane: result.runtime_lane,
    expected: `${result.scenario_id} completes without error on the ${result.runtime_lane} lane`,
    observed: result.reason?.message ?? "scenario failed with no recorded reason",
    logs_excerpt: "",
    correlation_ids: [],
    timestamp: result.finished_at,
  };
}
