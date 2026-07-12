import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FailureReport, ScenarioFailure } from "./types.js";
import { redactSecrets } from "./redaction.js";

/**
 * Single place that turns a scenario failure into the on-disk (and, later,
 * POSTable) report shape. Per specs/developing/testing/README.md, tier 3/4
 * failures file issues into the issues service and never block a merge — this
 * module produces the payload that flow will eventually consume.
 */
export function toFailureReport(
  failure: ScenarioFailure,
  env: NodeJS.ProcessEnv = process.env,
): FailureReport {
  return {
    flow: redactSecrets(failure.registryFlowRef, { env }),
    scenario_id: failure.scenarioId,
    lane: failure.lane,
    expected: redactSecrets(failure.expected, { env }),
    observed: redactSecrets(describeError(failure.error), { env }),
    logs_excerpt: redactSecrets(failure.logsExcerpt ?? "", { env }),
    correlation_ids: (failure.correlationIds ?? []).map((value) => redactSecrets(value, { env })),
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
    await writeFile(filePath, `${JSON.stringify(report, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    // `mode` applies only on creation; enforce it again if a timestamp
    // collision or prior file caused writeFile to reuse an inode.
    await chmod(filePath, 0o600);
    written.push(filePath);
  }
  return written;
}

export function failureConsoleLine(report: FailureReport): string {
  return `  - [${report.scenario_id}/${report.lane}] ${report.observed.split("\n")[0]}`;
}
