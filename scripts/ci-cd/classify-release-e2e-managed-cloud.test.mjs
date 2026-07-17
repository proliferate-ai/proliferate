import assert from "node:assert/strict";
import { test } from "node:test";

import {
  classifyManagedCloudAttempt,
  classificationReceipt,
  listWorkflowAttemptJobs,
  parseClassificationArgs,
  readWorkflowAttempt,
} from "./classify-release-e2e-managed-cloud.mjs";

const EXPECTED = {
  repository: "proliferate-ai/proliferate",
  attempt: 2,
};
const RUN = {
  name: "Release E2E (tier 3)",
  status: "completed",
  run_attempt: 2,
  head_sha: "a".repeat(40),
  repository: { full_name: EXPECTED.repository },
};
const JOB_NAME = "cloud-provision-1 (manual, strict)";

function jobs(conclusion) {
  return {
    total_count: 2,
    jobs: [
      { name: "tier-3 local lane (provisional)", status: "completed", conclusion: "success" },
      { name: JOB_NAME, status: "completed", conclusion },
    ],
  };
}

test("a local-only attempt with the managed-cloud job skipped does not start provider cleanup", () => {
  assert.deepEqual(classifyManagedCloudAttempt(RUN, jobs("skipped"), EXPECTED), {
    sourceSha: RUN.head_sha,
    managedCloudStarted: false,
    jobConclusion: "skipped",
  });
});

test("an older attempt with no managed-cloud job is cleanly classified as not started", () => {
  assert.deepEqual(classifyManagedCloudAttempt(RUN, {
    total_count: 1,
    jobs: [{ name: "tier-3 local lane (provisional)", status: "completed", conclusion: "success" }],
  }, EXPECTED), {
    sourceSha: RUN.head_sha,
    managedCloudStarted: false,
    jobConclusion: "absent",
  });
});

test("every non-skipped terminal conclusion conservatively requires cleanup", () => {
  for (const conclusion of ["success", "failure", "cancelled", "timed_out", "action_required"]) {
    const result = classifyManagedCloudAttempt(RUN, jobs(conclusion), EXPECTED);
    assert.equal(result.managedCloudStarted, true, conclusion);
    assert.equal(result.jobConclusion, conclusion);
  }
});

test("an unexhausted or duplicate job inventory fails closed", () => {
  assert.throws(
    () => classifyManagedCloudAttempt(RUN, { ...jobs("success"), total_count: 101 }, EXPECTED),
    /not exhausted/,
  );
  const duplicate = jobs("success");
  duplicate.jobs.push({ name: JOB_NAME, status: "completed", conclusion: "success" });
  duplicate.total_count = 3;
  assert.throws(
    () => classifyManagedCloudAttempt(RUN, duplicate, EXPECTED),
    /duplicate managed-cloud jobs/,
  );
});

test("nonterminal jobs and mismatched run custody fail closed", () => {
  const nonterminal = jobs("success");
  nonterminal.jobs[1].status = "in_progress";
  assert.throws(
    () => classifyManagedCloudAttempt(RUN, nonterminal, EXPECTED),
    /terminal conclusion/,
  );
  assert.throws(
    () => classifyManagedCloudAttempt({ ...RUN, run_attempt: 3 }, jobs("success"), EXPECTED),
    /exact completed Release E2E/,
  );
});

test("reads immutable attempt metadata so a later rerun cannot suppress cleanup", async () => {
  const endpoints = [];
  const target = await readWorkflowAttempt(EXPECTED.repository, 42, EXPECTED.attempt, {
    async fetchAttempt(_repository, endpoint) {
      endpoints.push(endpoint);
      if (endpoint === "actions/runs/42/attempts/2") return RUN;
      return { ...RUN, status: "in_progress", run_attempt: 3 };
    },
  });

  assert.deepEqual(endpoints, ["actions/runs/42/attempts/2"]);
  assert.equal(classifyManagedCloudAttempt(target, jobs("cancelled"), EXPECTED).managedCloudStarted, true);
});

test("exhausts a second workflow-jobs page before classifying the attempt", async () => {
  const pages = new Map([
    [1, {
      total_count: 101,
      jobs: Array.from({ length: 100 }, (_, index) => ({ id: index + 1, name: `job-${index + 1}` })),
    }],
    [2, {
      total_count: 101,
      jobs: [{ id: 101, name: JOB_NAME, status: "completed", conclusion: "failure" }],
    }],
  ]);
  const requested = [];
  const inventory = await listWorkflowAttemptJobs(EXPECTED.repository, 42, 2, {
    fetchPage: async (_repository, endpoint) => {
      const page = Number(new URL(`https://example.invalid/${endpoint}`).searchParams.get("page"));
      requested.push(page);
      return pages.get(page);
    },
  });

  assert.deepEqual(requested, [1, 2]);
  assert.equal(inventory.jobs.length, 101);
  assert.equal(classifyManagedCloudAttempt(RUN, inventory, EXPECTED).managedCloudStarted, true);
});

test("workflow-jobs pagination fails closed on inconsistent totals and repeated pages", async () => {
  const first = {
    total_count: 101,
    jobs: Array.from({ length: 100 }, (_, index) => ({ id: index + 1, name: `job-${index + 1}` })),
  };
  await assert.rejects(
    () => listWorkflowAttemptJobs(EXPECTED.repository, 42, 2, {
      fetchPage: async (_repository, endpoint) => endpoint.endsWith("page=1")
        ? first
        : { total_count: 102, jobs: [{ id: 101, name: JOB_NAME }] },
    }),
    /total changed/,
  );
  await assert.rejects(
    () => listWorkflowAttemptJobs(EXPECTED.repository, 42, 2, {
      fetchPage: async (_repository, endpoint) => endpoint.endsWith("page=1")
        ? first
        : { total_count: 101, jobs: [{ id: 1, name: JOB_NAME }] },
    }),
    /repeated job id/,
  );
});

test("classification receipt is bound to the required cleanup revision", () => {
  const cleanupSha = "b".repeat(40);
  const inputs = parseClassificationArgs([
    "--workflow-run-id", "42",
    "--workflow-run-attempt", "2",
    "--cleanup-sha", cleanupSha,
  ], { GITHUB_REPOSITORY: EXPECTED.repository });
  const receipt = classificationReceipt({
    sourceSha: RUN.head_sha,
    managedCloudStarted: true,
    jobConclusion: "failure",
  }, inputs);
  assert.equal(receipt.cleanup_sha, cleanupSha);
  assert.equal(receipt.status, "classified");
  assert.throws(
    () => parseClassificationArgs([
      "--workflow-run-id", "42",
      "--workflow-run-attempt", "2",
    ], { GITHUB_REPOSITORY: EXPECTED.repository }),
    /cleanup sha is malformed/,
  );
});
