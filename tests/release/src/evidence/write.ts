import { link, mkdir, unlink, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";

import { validateReport, type TestRunReportV1 } from "./schema.js";

export class ReportWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportWriteError";
  }
}

export function reportPath(outputDir: string, report: TestRunReportV1): string {
  return path.join(
    outputDir,
    report.run.run_id,
    report.run.shard_id,
    `attempt-${report.run.attempt}`,
    "qualification-evidence.json",
  );
}

/**
 * Validates and writes the combined report: exactly one artifact per
 * invocation/shard/attempt. The write is atomic within the destination
 * filesystem (temp file + hard link, which fails with EEXIST instead of
 * replacing) and refuses to overwrite an existing attempt artifact, so a
 * retry can never destroy earlier evidence.
 */
export async function writeReport(outputDir: string, report: TestRunReportV1): Promise<string> {
  validateReport(report);
  const destination = reportPath(outputDir, report);
  try {
    await mkdir(path.dirname(destination), { recursive: true });
    const temp = `${destination}.tmp-${randomBytes(4).toString("hex")}`;
    await writeFile(temp, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    try {
      await link(temp, destination);
    } finally {
      await unlink(temp).catch(() => undefined);
    }
  } catch (error) {
    throw new ReportWriteError(
      `Could not persist the combined report at ${destination}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  return destination;
}
