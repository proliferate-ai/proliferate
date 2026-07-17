import assert from "node:assert/strict";
import { test } from "node:test";

import { classifyManagedCloudAttempt } from "./classify-release-e2e-managed-cloud.mjs";

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
