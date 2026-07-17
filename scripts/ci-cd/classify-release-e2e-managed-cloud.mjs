#!/usr/bin/env node

import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execFile = promisify(execFileCallback);
const WORKFLOW_NAME = "Release E2E (tier 3)";
const MANAGED_CLOUD_JOB = "cloud-provision-1 (manual, strict)";

function safePositiveInteger(value, label) {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,19}$/.test(value)) {
    throw new Error(`${label} is malformed`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${label} exceeds the safe integer range`);
  return parsed;
}

function safeRepository(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) {
    throw new Error("GitHub repository identity is malformed");
  }
  return value;
}

function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is malformed`);
  }
  return value;
}

/**
 * Classifies the exact managed-cloud job from one completed workflow attempt.
 * A skipped or absent job never acquired provider resources; every other
 * completed conclusion is treated conservatively as started (including
 * failure, cancellation, and timeout).
 */
export function classifyManagedCloudAttempt(runValue, jobsValue, expected) {
  const run = record(runValue, "workflow run");
  const jobsPage = record(jobsValue, "workflow jobs page");
  if (
    run.name !== WORKFLOW_NAME ||
    run.status !== "completed" ||
    run.run_attempt !== expected.attempt ||
    run.repository?.full_name !== expected.repository ||
    typeof run.head_sha !== "string" ||
    !/^[0-9a-f]{40}$/.test(run.head_sha)
  ) {
    throw new Error("Target is not the exact completed Release E2E workflow attempt");
  }
  if (
    typeof jobsPage.total_count !== "number" ||
    !Number.isSafeInteger(jobsPage.total_count) ||
    jobsPage.total_count < 0 ||
    !Array.isArray(jobsPage.jobs) ||
    jobsPage.total_count !== jobsPage.jobs.length
  ) {
    throw new Error("Exact workflow job inventory was malformed or not exhausted");
  }
  const matches = jobsPage.jobs.filter(
    (value) => value && typeof value === "object" && !Array.isArray(value) && value.name === MANAGED_CLOUD_JOB,
  );
  if (matches.length > 1) throw new Error("Exact workflow job inventory contains duplicate managed-cloud jobs");
  if (matches.length === 0) {
    return {
      sourceSha: run.head_sha,
      managedCloudStarted: false,
      jobConclusion: "absent",
    };
  }
  const job = matches[0];
  if (job.status !== "completed" || typeof job.conclusion !== "string" || !job.conclusion) {
    throw new Error("Managed-cloud job did not have a terminal conclusion");
  }
  return {
    sourceSha: run.head_sha,
    managedCloudStarted: job.conclusion !== "skipped",
    jobConclusion: job.conclusion,
  };
}

async function ghJson(repository, endpoint) {
  const { stdout } = await execFile("gh", ["api", `repos/${repository}/${endpoint}`], {
    timeout: 60_000,
    maxBuffer: 8 * 1024 * 1024,
    encoding: "utf8",
  });
  return JSON.parse(stdout);
}

function parseArgs(argv, env = process.env) {
  if (argv.length !== 4 || argv[0] !== "--workflow-run-id" || argv[2] !== "--workflow-run-attempt") {
    throw new Error(
      "Usage: classify-release-e2e-managed-cloud --workflow-run-id <id> --workflow-run-attempt <attempt>",
    );
  }
  return {
    repository: safeRepository(env.GITHUB_REPOSITORY ?? ""),
    runId: safePositiveInteger(argv[1], "workflow run id"),
    attempt: safePositiveInteger(argv[3], "workflow run attempt"),
  };
}

async function main() {
  const inputs = parseArgs(process.argv.slice(2));
  const [run, jobs] = await Promise.all([
    ghJson(inputs.repository, `actions/runs/${inputs.runId}`),
    ghJson(
      inputs.repository,
      `actions/runs/${inputs.runId}/attempts/${inputs.attempt}/jobs?per_page=100`,
    ),
  ]);
  const result = classifyManagedCloudAttempt(run, jobs, inputs);
  console.log(JSON.stringify({
    kind: "release_e2e_managed_cloud_source_classification",
    schema_version: 1,
    workflow_run_id: String(inputs.runId),
    workflow_run_attempt: inputs.attempt,
    source_sha: result.sourceSha,
    managed_cloud_started: result.managedCloudStarted,
    job_conclusion: result.jobConclusion,
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message.slice(0, 400) : "source classification failed");
    process.exitCode = 2;
  });
}
