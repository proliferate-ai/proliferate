import { spawn } from "node:child_process";
import type { FailureReport } from "./types.js";

/**
 * Files one GitHub issue per distinct failure via the `gh` CLI. Off by
 * default (`--file-issues` opts in) — per specs/developing/testing/README.md,
 * tier 3/4 failures "file issues into the issues service"; until that service
 * exists, `gh issue create` against this repo is the interim sink. When the
 * issues-service exists, swap the body of `fileIssue` for a POST of the same
 * `FailureReport` (see ./failure-reporter.ts) without touching call sites.
 */
export async function fileIssuesForFailures(
  reports: readonly FailureReport[],
  options: { repo?: string } = {},
): Promise<string[]> {
  const distinct = dedupeByScenarioAndLane(reports);
  const urls: string[] = [];
  for (const report of distinct) {
    urls.push(await fileIssue(report, options.repo));
  }
  return urls;
}

function dedupeByScenarioAndLane(reports: readonly FailureReport[]): FailureReport[] {
  const seen = new Map<string, FailureReport>();
  for (const report of reports) {
    const key = `${report.scenario_id}:${report.lane}`;
    if (!seen.has(key)) {
      seen.set(key, report);
    }
  }
  return [...seen.values()];
}

async function fileIssue(report: FailureReport, repo?: string): Promise<string> {
  const title = `tier-3: ${report.scenario_id} failed on lane ${report.lane}`;
  const body = [
    `**Flow:** ${report.flow}`,
    `**Scenario:** ${report.scenario_id}`,
    `**Lane:** ${report.lane}`,
    `**Timestamp:** ${report.timestamp}`,
    "",
    "**Expected**",
    "```",
    report.expected,
    "```",
    "",
    "**Observed**",
    "```",
    report.observed,
    "```",
    "",
    report.correlation_ids.length > 0
      ? `**Correlation IDs:** ${report.correlation_ids.join(", ")}`
      : "**Correlation IDs:** (none)",
    "",
    "**Logs excerpt**",
    "```",
    report.logs_excerpt || "(none captured)",
    "```",
  ].join("\n");

  const args = ["issue", "create", "--title", title, "--body", body, "--label", "release-e2e"];
  if (repo) {
    args.push("--repo", repo);
  }
  return runGh(args);
}

function runGh(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("gh", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`gh issue create failed (${code}): ${stderr || stdout}`));
        return;
      }
      resolve(stdout.trim());
    });
  });
}
