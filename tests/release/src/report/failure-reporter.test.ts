import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  failureConsoleLine,
  toFailureReport,
  writeFailureReports,
} from "./failure-reporter.js";
import type { ScenarioFailure } from "./types.js";

test("toFailureReport serializes an Error's stack into observed", () => {
  const failure: ScenarioFailure = {
    scenarioId: "T3-EXAMPLE",
    registryFlowRef: "specs/developing/testing/scenarios.md#T3-EXAMPLE",
    lane: "local",
    expected: "example completes without error",
    error: new Error("boom"),
  };
  const report = toFailureReport(failure);
  assert.equal(report.scenario_id, "T3-EXAMPLE");
  assert.equal(report.flow, failure.registryFlowRef);
  assert.equal(report.lane, "local");
  assert.match(report.observed, /boom/);
  assert.deepEqual(report.correlation_ids, []);
});

test("toFailureReport stringifies a non-Error thrown value", () => {
  const failure: ScenarioFailure = {
    scenarioId: "T3-EXAMPLE",
    registryFlowRef: "specs/developing/testing/scenarios.md#T3-EXAMPLE",
    lane: "sandbox",
    expected: "example completes without error",
    error: "a plain string throw",
  };
  const report = toFailureReport(failure);
  assert.equal(report.observed, "a plain string throw");
});

test("writeFailureReports writes nothing and returns [] for an empty failure list", async () => {
  const written = await writeFailureReports([], path.join(os.tmpdir(), "should-not-be-created"));
  assert.deepEqual(written, []);
});

test("writeFailureReports writes one JSON file per failure, parseable back to the same shape", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "release-e2e-report-test-"));
  try {
    const failures: ScenarioFailure[] = [
      {
        scenarioId: "T3-A",
        registryFlowRef: "specs/developing/testing/scenarios.md#T3-A",
        lane: "local",
        expected: "A completes without error",
        error: new Error("first"),
      },
      {
        scenarioId: "T3-B",
        registryFlowRef: "specs/developing/testing/scenarios.md#T3-B",
        lane: "sandbox",
        expected: "B completes without error",
        error: new Error("second"),
      },
    ];
    const written = await writeFailureReports(failures, dir);
    assert.equal(written.length, 2);
    for (const filePath of written) {
      const parsed = JSON.parse(await readFile(filePath, "utf8"));
      assert.ok(typeof parsed.scenario_id === "string");
      assert.ok(typeof parsed.observed === "string");
      assert.equal((await stat(filePath)).mode & 0o777, 0o600);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("failure console lines and owner-only reports redact manifest-declared secrets", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "release-e2e-redaction-test-"));
  const name = "RELEASE_E2E_GITHUB_TEST_TOKEN";
  const prior = process.env[name];
  const sentinel = "ghp_SENTINEL_never_reaches_console_or_artifact";
  process.env[name] = sentinel;
  try {
    const failure: ScenarioFailure = {
      scenarioId: "T3-SECRET",
      registryFlowRef: "specs/developing/testing/scenarios.md#T3-SECRET",
      lane: "sandbox",
      expected: "the credential remains private",
      error: new Error(`clone https://x-access-token:${sentinel}@github.com/example/repo failed`),
      logsExcerpt: `provider output accidentally echoed ${sentinel}`,
      correlationIds: [`safe-id-${sentinel}`],
    };
    const report = toFailureReport(failure);
    const consoleBytes = failureConsoleLine(report);
    assert.equal(consoleBytes.includes(sentinel), false);
    assert.match(consoleBytes, /REDACTED_SECRET/);

    const [filePath] = await writeFailureReports([failure], dir);
    const reportBytes = await readFile(filePath, "utf8");
    assert.equal(reportBytes.includes(sentinel), false);
    assert.match(reportBytes, /REDACTED_SECRET/);
    assert.equal((await stat(filePath)).mode & 0o777, 0o600);
  } finally {
    if (prior === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = prior;
    }
    await rm(dir, { recursive: true, force: true });
  }
});
