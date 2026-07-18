#!/usr/bin/env node

import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execFile = promisify(execFileCallback);
const WORKFLOW_NAME = "Release E2E (tier 3)";
const MANAGED_CLOUD_JOB = "cloud-provision-1 (manual, strict)";
const JOB_PAGE_SIZE = 100;
const MAX_JOB_PAGES = 100;

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

function safeCommitSha(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{40}$/.test(value)) {
    throw new Error(`${label} is malformed`);
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
    run.head_sha !== expected.sourceSha ||
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

/** Reads immutable metadata for one exact attempt, never the mutable run head. */
export async function readWorkflowAttempt(repository, runId, attempt, deps = {}) {
  const fetchAttempt = deps.fetchAttempt ?? ghJson;
  return fetchAttempt(
    repository,
    `actions/runs/${runId}/attempts/${attempt}`,
  );
}

/**
 * Exhausts the exact workflow-attempt job inventory. Classification must not
 * silently miss a managed-cloud job merely because GitHub returned it after
 * the first page.
 */
export async function listWorkflowAttemptJobs(repository, runId, attempt, deps = {}) {
  const fetchPage = deps.fetchPage ?? ghJson;
  let totalCount;
  let expectedPages;
  const jobs = [];
  const seenJobIds = new Set();
  for (let page = 1; page <= MAX_JOB_PAGES; page += 1) {
    const payload = record(await fetchPage(
      repository,
      `actions/runs/${runId}/attempts/${attempt}/jobs?per_page=${JOB_PAGE_SIZE}&page=${page}`,
    ), `workflow jobs page ${page}`);
    if (
      typeof payload.total_count !== "number" ||
      !Number.isSafeInteger(payload.total_count) ||
      payload.total_count < 0 ||
      payload.total_count > JOB_PAGE_SIZE * MAX_JOB_PAGES ||
      !Array.isArray(payload.jobs) ||
      payload.jobs.length > JOB_PAGE_SIZE
    ) {
      throw new Error(`Workflow jobs page ${page} was malformed or exceeded the bounded inventory`);
    }
    if (totalCount === undefined) {
      totalCount = payload.total_count;
      expectedPages = Math.max(1, Math.ceil(totalCount / JOB_PAGE_SIZE));
    } else if (payload.total_count !== totalCount) {
      throw new Error("Workflow jobs total changed while pagination was in progress");
    }
    if (page > expectedPages) {
      throw new Error("Workflow jobs pagination exceeded its declared inventory");
    }
    const expectedLength = page < expectedPages
      ? JOB_PAGE_SIZE
      : totalCount - JOB_PAGE_SIZE * (expectedPages - 1);
    if (payload.jobs.length !== expectedLength) {
      throw new Error(`Workflow jobs page ${page} did not exhaust its declared inventory`);
    }
    for (const rawJob of payload.jobs) {
      const job = record(rawJob, `workflow job on page ${page}`);
      if (!Number.isSafeInteger(job.id) || job.id <= 0 || seenJobIds.has(job.id)) {
        throw new Error("Workflow jobs pagination returned a malformed or repeated job id");
      }
      seenJobIds.add(job.id);
      jobs.push(job);
    }
    if (page === expectedPages) {
      return { total_count: totalCount, jobs };
    }
  }
  throw new Error("Workflow jobs pagination exceeded its safety bound");
}

export function parseClassificationArgs(argv, env = process.env) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined || values.has(key)) {
      throw new Error(
        "Usage: classify-release-e2e-managed-cloud --workflow-run-id <id> " +
        "--workflow-run-attempt <attempt> --cleanup-sha <sha>",
      );
    }
    values.set(key, value);
  }
  const allowed = new Set(["--workflow-run-id", "--workflow-run-attempt", "--cleanup-sha"]);
  for (const key of values.keys()) if (!allowed.has(key)) throw new Error(`Unknown argument ${key}`);
  return {
    repository: safeRepository(env.GITHUB_REPOSITORY ?? ""),
    runId: safePositiveInteger(values.get("--workflow-run-id"), "workflow run id"),
    attempt: safePositiveInteger(values.get("--workflow-run-attempt"), "workflow run attempt"),
    cleanupSha: safeCommitSha(values.get("--cleanup-sha"), "cleanup sha"),
    sourceSha: safeCommitSha(env.TARGET_SOURCE_SHA, "target source sha"),
  };
}

export function classificationReceipt(result, inputs) {
  return {
    kind: "release_e2e_managed_cloud_source_classification",
    schema_version: 1,
    workflow_run_id: String(inputs.runId),
    workflow_run_attempt: inputs.attempt,
    cleanup_sha: inputs.cleanupSha,
    status: "classified",
    source_sha: result.sourceSha,
    managed_cloud_started: result.managedCloudStarted,
    job_conclusion: result.jobConclusion,
  };
}

async function main() {
  const inputs = parseClassificationArgs(process.argv.slice(2));
  const [run, jobs] = await Promise.all([
    readWorkflowAttempt(inputs.repository, inputs.runId, inputs.attempt),
    listWorkflowAttemptJobs(inputs.repository, inputs.runId, inputs.attempt),
  ]);
  const result = classifyManagedCloudAttempt(run, jobs, inputs);
  console.log(JSON.stringify(classificationReceipt(result, inputs)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message.slice(0, 400) : "source classification failed");
    process.exitCode = 2;
  });
}
