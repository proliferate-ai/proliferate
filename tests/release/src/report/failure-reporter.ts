import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FailureReport, ScenarioFailure } from "./types.js";

/**
 * Single place that turns a scenario failure into the on-disk (and, later,
 * POSTable) report shape. Per specs/developing/testing/README.md, tier 3/4
 * failures file issues into the issues service and never block a merge — this
 * module produces the payload that flow will eventually consume.
 */
export function toFailureReport(failure: ScenarioFailure): FailureReport {
  return {
    flow: failure.registryFlowRef,
    scenario_id: failure.scenarioId,
    lane: failure.lane,
    expected: failure.expected,
    observed: describeError(failure.error),
    logs_excerpt: failure.logsExcerpt ?? "",
    correlation_ids: failure.correlationIds ?? [],
    timestamp: new Date().toISOString(),
  };
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }
  return String(error);
}

/**
 * Writes one JSON file per failed scenario under `outputDir`, named
 * `<scenario_id>-<lane>-<timestamp>.json`. Returns the written file paths.
 */
export async function writeFailureReports(
  failures: readonly ScenarioFailure[],
  outputDir: string,
): Promise<string[]> {
  if (failures.length === 0) {
    return [];
  }
  await mkdir(outputDir, { recursive: true });
  const written: string[] = [];
  for (const failure of failures) {
    const report = toFailureReport(failure);
    const safeTimestamp = report.timestamp.replace(/[:.]/g, "-");
    const filePath = path.join(outputDir, `${report.scenario_id}-${report.lane}-${safeTimestamp}.json`);
    await writeFile(filePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    written.push(filePath);
  }
  return written;
}
