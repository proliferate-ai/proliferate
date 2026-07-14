import { link, mkdir, unlink, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";

import {
  sanitizeReportV4Evidence,
  validateReport,
  validateReportV4,
  type TestRunReportV3,
  type TestRunReportV4,
} from "./schema.js";

export class ReportWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportWriteError";
  }
}

interface ReportPathIdentity {
  run: { run_id: string; shard_id: string; attempt: number };
}

export function reportPath(outputDir: string, report: ReportPathIdentity): string {
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
export async function writeReport(outputDir: string, report: TestRunReportV3): Promise<string> {
  validateReport(report);
  return writeValidatedReport(outputDir, report);
}

/**
 * V4 counterpart of `writeReport`: sanitizes every evidence string field
 * through the same redaction pipeline message fields use (BRIEF §6.6), then
 * validates and writes with the same atomic, no-overwrite semantics.
 * `secretValues` are the same resolved manifest secrets the V3 producer
 * (`runner/execute.ts`) redacts message fields with.
 */
export async function writeReportV4(
  outputDir: string,
  report: TestRunReportV4,
  secretValues: readonly string[] = [],
): Promise<string> {
  const sanitized = sanitizeReportV4Evidence(report, secretValues);
  validateReportV4(sanitized);
  return writeValidatedReport(outputDir, sanitized);
}

async function writeValidatedReport(outputDir: string, report: ReportPathIdentity): Promise<string> {
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
