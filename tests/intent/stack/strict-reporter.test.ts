import assert from "node:assert/strict";
import test from "node:test";
import type { FullResult, TestCase, TestResult } from "@playwright/test/reporter";
import StrictTier2Reporter from "./strict-reporter.ts";

function testCase(expectedStatus: TestCase["expectedStatus"] = "passed"): TestCase {
  return {
    id: "scenario-id",
    expectedStatus,
    titlePath: () => ["suite", "required scenario"],
  } as unknown as TestCase;
}

function result(status: TestResult["status"]): TestResult {
  return { status } as TestResult;
}

async function finish(reporter: StrictTier2Reporter): Promise<FullResult["status"] | undefined> {
  const originalError = console.error;
  console.error = () => {};
  try {
    return (await reporter.onEnd({ status: "passed" } as FullResult))?.status;
  } finally {
    console.error = originalError;
  }
}

test("accepts only a clean first-attempt pass with expectedStatus=passed", async () => {
  const reporter = new StrictTier2Reporter();
  reporter.onTestEnd(testCase(), result("passed"));
  assert.equal(await finish(reporter), undefined);
});

test("rejects an expected-fail test that unexpectedly passes", async () => {
  const reporter = new StrictTier2Reporter();
  reporter.onTestEnd(testCase("failed"), result("passed"));
  assert.equal(await finish(reporter), "failed");
});

test("rejects a skipped final result", async () => {
  const reporter = new StrictTier2Reporter();
  reporter.onTestEnd(testCase(), result("skipped"));
  assert.equal(await finish(reporter), "failed");
});

test("rejects a flaky retry even when the final attempt passes", async () => {
  const reporter = new StrictTier2Reporter();
  const required = testCase();
  reporter.onTestEnd(required, result("failed"));
  reporter.onTestEnd(required, result("passed"));
  assert.equal(await finish(reporter), "failed");
});
